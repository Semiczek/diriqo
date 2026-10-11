-- Explicit test credit only. No subscription payment or automatic credit is fabricated.
create table private.ai_credit_lots (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 units integer not null check(units>0),origin text not null check(origin in ('test','included','topup')),
 source_ref text not null unique,expires_at timestamptz,created_at timestamptz not null default now(),reason text not null
);
create table public.diriqent_conversations (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),profile_id uuid not null references public.profiles(id),
 title text not null,requires_manager boolean not null default false,created_at timestamptz not null default now(),unique(company_id,profile_id,id)
);
create table public.diriqent_operations (
 id uuid primary key,company_id uuid not null references public.companies(id),profile_id uuid not null references public.profiles(id),
 conversation_id uuid,kind text not null check(kind in ('chat','proposal','smart_quotes.ocr','inventory.ocr','invoicing.ocr')),
 prompt text not null,fingerprint text not null,requires_manager boolean not null default false,source_name text,source_path text,source_mime text,
 state text not null default 'reserved' check(state in ('reserved','running','unknown','completed','failed')),
 reserved_units integer not null,charged_units integer not null default 0,rate_version text not null default 'diriqent-test-czk-v1',
 result jsonb,context_snapshot jsonb,error_code text,created_at timestamptz not null default now(),finished_at timestamptz,
 foreign key(company_id,profile_id,conversation_id) references public.diriqent_conversations(company_id,profile_id,id)
);
create table private.ai_credit_allocations (
 operation_id uuid not null references public.diriqent_operations(id),lot_id uuid not null references private.ai_credit_lots(id),
 units integer not null check(units>0),primary key(operation_id,lot_id)
);
create table private.ai_credit_ledger (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 operation_id uuid not null references public.diriqent_operations(id),lot_id uuid not null references private.ai_credit_lots(id),
 event text not null check(event in ('reserve','settle','release')),credit_delta integer not null,reserved_delta integer not null,
 created_at timestamptz not null default now(),unique(operation_id,lot_id,event)
);
create table private.ai_provider_attempts (
 id uuid primary key default gen_random_uuid(),operation_id uuid not null unique references public.diriqent_operations(id),
 provider_request_id text not null unique,provider_response_id text unique,model text not null default 'gpt-5.6-terra',
 state text not null default 'claimed',input_tokens integer,output_tokens integer,cached_tokens integer,
 provider_cost_microusd bigint,unbilled_credit_units integer not null default 0,
 pricing jsonb not null default '{"inputUsdPerMillion":2,"cachedUsdPerMillion":0.2,"outputUsdPerMillion":12,"usdCzk":25,"creditMultiplier":3,"version":"diriqent-test-czk-v1"}',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.diriqent_job_proposals (
 operation_id uuid primary key references public.diriqent_operations(id),company_id uuid not null references public.companies(id),profile_id uuid not null references public.profiles(id),
 payload jsonb not null,payload_hash text not null,expires_at timestamptz not null,job_id uuid unique references public.jobs(id),
 approved_at timestamptz,created_at timestamptz not null default now()
);
create index on public.diriqent_operations(company_id,profile_id,created_at desc);
create index on public.diriqent_conversations(company_id,profile_id);
create index on private.ai_credit_lots(company_id,expires_at);
create index on private.ai_credit_ledger(lot_id);
create index on public.diriqent_job_proposals(company_id,profile_id);

create function private.diriqent_product(k text) returns text language sql immutable set search_path='' as $$
 select case when k in ('chat','proposal') then 'ai_assistant' else split_part(k,'.',1) end;
$$;
create function private.diriqent_capability(k text) returns text language sql immutable set search_path='' as $$
 select case when k in ('chat','proposal') then 'ai_assistant.conversation.run' else k||'.request' end;
$$;
create function private.diriqent_can_read(c uuid,p uuid,k text) returns boolean language sql stable security definer set search_path='' as $$
 select p=public.current_profile_id() and private.module_can_read(c,private.diriqent_product(k),k not in ('chat','proposal'));
$$;
revoke all on function private.diriqent_product(text),private.diriqent_capability(text) from public,anon,authenticated,service_role;
revoke all on function private.diriqent_can_read(uuid,uuid,text) from public,anon,service_role;
grant execute on function private.diriqent_can_read(uuid,uuid,text) to authenticated;
alter table public.diriqent_conversations enable row level security;
alter table public.diriqent_operations enable row level security;
alter table public.diriqent_job_proposals enable row level security;
revoke all on public.diriqent_conversations,public.diriqent_operations,public.diriqent_job_proposals from public,anon,authenticated,service_role;
grant select on public.diriqent_conversations,public.diriqent_operations,public.diriqent_job_proposals to authenticated;
create policy own_conversation_history on public.diriqent_conversations for select to authenticated using(private.diriqent_can_read(company_id,profile_id,'chat') and (not requires_manager or public.has_company_role(company_id,array['super_admin','company_admin','manager'])));
create policy own_operation_history on public.diriqent_operations for select to authenticated using(private.diriqent_can_read(company_id,profile_id,kind) and (not requires_manager or public.has_company_role(company_id,array['super_admin','company_admin','manager'])));
create policy own_proposal_history on public.diriqent_job_proposals for select to authenticated using(private.diriqent_can_read(company_id,profile_id,'proposal') and public.has_company_role(company_id,array['super_admin','company_admin','manager']));
do $$ declare t text; begin foreach t in array array['ai_credit_lots','ai_credit_allocations','ai_credit_ledger','ai_provider_attempts'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
end loop; end $$;
create function private.ai_ledger_immutable() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'AI účetní kniha je neměnná.'; end $$;
create trigger immutable_ai_ledger before update or delete on private.ai_credit_ledger for each row execute function private.ai_ledger_immutable();
create trigger immutable_ai_credit_lot before update or delete on private.ai_credit_lots for each row execute function private.ai_ledger_immutable();
create trigger immutable_ai_allocation before update or delete on private.ai_credit_allocations for each row execute function private.ai_ledger_immutable();
revoke all on function private.ai_ledger_immutable() from public,anon,authenticated,service_role;

create function private.diriqent_guard(c uuid,k text,history boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if k not in ('chat','proposal','smart_quotes.ocr','inventory.ocr','invoicing.ocr') or k is null then raise exception 'Neznámá AI služba.'; end if;
 if k in ('chat','proposal') then return private.require_module_entitlement(c,'ai_assistant',case when history then null else private.diriqent_capability(k) end); end if;
 return private.require_module_access(c,private.diriqent_product(k),case when history then null else private.diriqent_capability(k) end);
end $$;
revoke all on function private.diriqent_guard(uuid,text,boolean) from public,anon,authenticated,service_role;

create function public.diriqent_test_credit_grant(c uuid,units integer,source_ref text,reason text,expires_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if units not between 1 and 100000 or length(btrim(reason))<10 or length(source_ref)<8 or expires_at<=now() then raise exception 'Neplatný testovací grant.'; end if;
 if not exists(select 1 from private.company_test_module_grants where company_id=c and revoked_at is null and not livemode and valid_until>now()) then raise exception 'Firma nemá výslovný testovací nárok.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,6106));
 insert into private.ai_credit_lots(company_id,units,origin,source_ref,expires_at,reason) values(c,units,'test',source_ref,expires_at,reason) on conflict on constraint ai_credit_lots_source_ref_key do nothing returning id into result;
 if result is null then select l.id into result from private.ai_credit_lots l where l.source_ref=diriqent_test_credit_grant.source_ref and l.company_id=c and l.units=diriqent_test_credit_grant.units and l.reason=diriqent_test_credit_grant.reason and l.expires_at=diriqent_test_credit_grant.expires_at; end if;
 if result is null then raise exception 'Idempotentní reference už byla použita jinak.'; end if;
 return result;
end $$;
revoke all on function public.diriqent_test_credit_grant(uuid,integer,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.diriqent_test_credit_grant(uuid,integer,text,text,timestamptz) to service_role;

create function public.diriqent_read(c uuid,k text default 'chat') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; available bigint; manager boolean; begin
 actor:=private.diriqent_guard(c,k,true);
 manager:=public.has_company_role(c,array['super_admin','company_admin','manager']);
 select coalesce(sum(l.units+coalesce(x.credit,0)-coalesce(x.reserved,0)),0) into available from private.ai_credit_lots l
 left join lateral(select sum(credit_delta) credit,sum(reserved_delta) reserved from private.ai_credit_ledger where lot_id=l.id)x on true
 where l.company_id=c and (l.expires_at is null or l.expires_at>now());
 return jsonb_build_object('companyId',c,'profileId',actor,'canRun',private.module_has_entitlement(c,private.diriqent_product(k),private.diriqent_capability(k)),
  'availableUnits',available,'rateVersion','diriqent-test-czk-v1','conversations',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select * from public.diriqent_conversations where company_id=c and profile_id=actor and k in ('chat','proposal') and (not requires_manager or manager) order by created_at desc limit 50)x),'[]'::jsonb),
  'operations',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select * from public.diriqent_operations where company_id=c and profile_id=actor and (not requires_manager or manager) and case when k in ('chat','proposal') then kind in ('chat','proposal') else kind=k end order by created_at desc limit 100)x),'[]'::jsonb),
  'proposals',coalesce((select jsonb_agg(to_jsonb(x)) from public.diriqent_job_proposals x where company_id=c and profile_id=actor and k in ('chat','proposal') and manager),'[]'::jsonb));
end $$;
revoke all on function public.diriqent_read(uuid,text) from public,anon;
grant execute on function public.diriqent_read(uuid,text) to authenticated;

create function public.diriqent_context(c uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; manager boolean; begin
 actor:=private.diriqent_guard(c,'chat',false);manager:=public.has_company_role(c,array['super_admin','company_admin','manager']);
 if not private.module_has_entitlement(c,'diriqo_core',null) then return jsonb_build_object('asOf',now(),'scope','Bez firemních zakázek: chybí oprávnění k historii Core.'); end if;
 return jsonb_build_object('asOf',now(),'scope',case when manager then 'Posledních 30 zakázek aktivní firmy, nejvýše 30 zákazníků a pouze vlastní docházka. Bez mezd.' else 'Jen vlastní přidělené zakázky a vlastní docházka. Bez mezd a bez adresáře.' end,
 'jobs',coalesce((select jsonb_agg(to_jsonb(x)) from (select j.id,j.title,j.status,j.start_at,j.end_at from public.jobs j where j.company_id=c and j.archived_at is null and (manager or exists(select 1 from public.job_assignments a where a.company_id=c and a.job_id=j.id and a.profile_id=actor and a.archived_at is null)) order by j.updated_at desc limit 30)x),'[]'::jsonb),
 'customers',case when manager then coalesce((select jsonb_agg(to_jsonb(x)) from (select id,name from public.customers where company_id=c order by name limit 30)x),'[]'::jsonb) else '[]'::jsonb end,
 'ownShifts',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,job_id,started_at,ended_at,status from public.work_shifts where company_id=c and profile_id=actor order by created_at desc limit 20)x),'[]'::jsonb));
end $$;
revoke all on function public.diriqent_context(uuid) from public,anon;
grant execute on function public.diriqent_context(uuid) to authenticated;

create function public.diriqent_reserve(c uuid,request_id uuid,k text,conversation uuid,prompt text,fingerprint text,max_units integer,source_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; op public.diriqent_operations; conv uuid; remaining integer; usable integer; take_units integer; l record; manager boolean; begin
 actor:=private.diriqent_guard(c,k,false);
 manager:=public.has_company_role(c,array['super_admin','company_admin','manager']);
 if request_id is null or length(btrim(prompt)) not between 1 and 4000 or fingerprint !~ '^[0-9a-f]{64}$' or max_units not between 100 and 5000 or length(coalesce(source_name,''))>160 then raise exception 'Neplatné zadání nebo limit.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,6106));
 select * into op from public.diriqent_operations where id=request_id for update;
 if op.id is not null then
  if op.company_id<>c or op.profile_id<>actor or op.fingerprint<>fingerprint or op.kind<>k or op.reserved_units<>max_units or (op.requires_manager and not manager) then raise exception 'Identifikátor požadavku už byl použit pro jiné zadání.'; end if;
  return to_jsonb(op);
 end if;
 if (select count(*) from public.diriqent_operations where company_id=c and profile_id=actor and state in ('reserved','running','unknown'))>=2 then raise exception 'Nejdřív dokončete nebo ověřte rozpracované požadavky.'; end if;
 conv:=conversation;
 if k in ('chat','proposal') then
  if conv is null then insert into public.diriqent_conversations(company_id,profile_id,title,requires_manager) values(c,actor,left(prompt,80),manager) returning id into conv;
  elsif not exists(select 1 from public.diriqent_conversations where id=conv and company_id=c and profile_id=actor and requires_manager=manager) then raise exception 'Rozhovor není dostupný pro aktuální oprávnění. Začněte nový.'; end if;
 else conv:=null; end if;
 insert into public.diriqent_operations(id,company_id,profile_id,conversation_id,kind,prompt,fingerprint,reserved_units,source_name,requires_manager)
 values(request_id,c,actor,conv,k,prompt,fingerprint,max_units,source_name,manager) returning * into op;
 remaining:=max_units;
 for l in select * from private.ai_credit_lots where company_id=c and (expires_at is null or expires_at>now()) order by expires_at asc nulls last,created_at,id for update loop
  select l.units+coalesce(sum(credit_delta),0)-coalesce(sum(reserved_delta),0) into usable from private.ai_credit_ledger where lot_id=l.id;
  take_units:=least(remaining,greatest(usable,0));
  if take_units>0 then
   insert into private.ai_credit_allocations(operation_id,lot_id,units) values(op.id,l.id,take_units);
   insert into private.ai_credit_ledger(company_id,operation_id,lot_id,event,credit_delta,reserved_delta) values(c,op.id,l.id,'reserve',0,take_units);
   remaining:=remaining-take_units;
  end if;
  exit when remaining=0;
 end loop;
 if remaining>0 then raise exception 'Na tento limit není dost dostupného kreditu. Snižte limit nebo doplňte kredit.'; end if;
 return to_jsonb(op);
end $$;
revoke all on function public.diriqent_reserve(uuid,uuid,text,uuid,text,text,integer,text) from public,anon;
grant execute on function public.diriqent_reserve(uuid,uuid,text,uuid,text,text,integer,text) to authenticated;

create function public.diriqent_operation(c uuid,operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.diriqent_operations; actor uuid; begin
 select * into op from public.diriqent_operations where id=operation and company_id=c;
 if op.id is null then raise exception 'Požadavek není dostupný.'; end if;
 actor:=private.diriqent_guard(c,op.kind,true);
 if op.profile_id<>actor or (op.requires_manager and not public.has_company_role(c,array['super_admin','company_admin','manager'])) then raise exception 'Požadavek není dostupný.' using errcode='42501'; end if;
 return to_jsonb(op)||coalesce((select jsonb_build_object('providerResponseId',a.provider_response_id,'providerAttemptId',a.id) from private.ai_provider_attempts a where a.operation_id=op.id),'{}'::jsonb);
end $$;
revoke all on function public.diriqent_operation(uuid,uuid) from public,anon;
grant execute on function public.diriqent_operation(uuid,uuid) to authenticated;

create function public.diriqent_provider_claim(operation uuid,c uuid,p uuid,context jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.diriqent_operations; attempt uuid; begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into op from public.diriqent_operations where id=operation and company_id=c and profile_id=p for update;
 if op.id is null then raise exception 'Požadavek není dostupný.'; end if;
 if op.state<>'reserved' then return jsonb_build_object('claimed',false); end if;
 if not private.module_has_entitlement(c,private.diriqent_product(op.kind),private.diriqent_capability(op.kind))
  or not exists(select 1 from public.company_members where company_id=c and profile_id=p and is_active and ((op.kind in ('chat','proposal') and not op.requires_manager) or role in ('super_admin','company_admin','manager'))) then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 insert into private.ai_provider_attempts(operation_id,provider_request_id) values(op.id,op.id::text) returning id into attempt;
 update public.diriqent_operations set state='running',context_snapshot=context where id=op.id;
 return jsonb_build_object('claimed',true,'attemptId',attempt);
end $$;
revoke all on function public.diriqent_provider_claim(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.diriqent_provider_claim(uuid,uuid,uuid,jsonb) to service_role;

create function public.diriqent_provider_record(operation uuid,attempt uuid,response_id text,source_path text default null,source_mime text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 update private.ai_provider_attempts set provider_response_id=response_id,state=case when response_id is null then 'unknown' else 'running' end,updated_at=now()
 where id=attempt and operation_id=operation and (provider_response_id is null or provider_response_id=response_id) and state not in ('completed','failed');
 if not found then raise exception 'Neshodný pokus poskytovatele.'; end if;
 update public.diriqent_operations set state=case when response_id is null then 'unknown' else 'running' end,
 source_path=coalesce(diriqent_provider_record.source_path,diriqent_operations.source_path),source_mime=coalesce(diriqent_provider_record.source_mime,diriqent_operations.source_mime)
 where id=operation and state in ('running','unknown');
end $$;
revoke all on function public.diriqent_provider_record(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.diriqent_provider_record(uuid,uuid,text,text,text) to service_role;

create function public.diriqent_settle(operation uuid,attempt uuid,result jsonb,success boolean,input_tokens integer,output_tokens integer,cached_tokens integer,error_code text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op public.diriqent_operations; a private.ai_provider_attempts; provider_cost bigint; charge integer; remaining integer; used integer; x record; begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into op from public.diriqent_operations where id=operation for update;
 if op.id is null then raise exception 'Požadavek není dostupný.'; end if;
 if op.state in ('completed','failed') then return to_jsonb(op); end if;
 select * into a from private.ai_provider_attempts where id=attempt and operation_id=operation for update;
 if a.id is null then raise exception 'Neshodný pokus.'; end if;
 if input_tokens is null or output_tokens is null or cached_tokens is null or input_tokens<0 or output_tokens<0 or cached_tokens not between 0 and input_tokens or input_tokens>2000000 or output_tokens>100000 then raise exception 'Neplatná spotřeba.'; end if;
 if success is null or (success and (result is null or jsonb_typeof(result)<>'object' or octet_length(result::text)>100000)) then raise exception 'Chybí použitelný výsledek.'; end if;
 provider_cost:=ceil(((input_tokens-cached_tokens)::numeric*2000000+cached_tokens::numeric*200000+output_tokens::numeric*12000000)/1000000);
 charge:=case when success then least(op.reserved_units,ceil(provider_cost*7500::numeric/1000000)::integer) else 0 end;remaining:=charge;
 for x in select al.*,l.expires_at,l.created_at from private.ai_credit_allocations al join private.ai_credit_lots l on l.id=al.lot_id where operation_id=operation order by l.expires_at asc nulls last,l.created_at,l.id loop
  used:=least(remaining,x.units);remaining:=remaining-used;
  if used>0 then insert into private.ai_credit_ledger(company_id,operation_id,lot_id,event,credit_delta,reserved_delta) values(op.company_id,op.id,x.lot_id,'settle',-used,-used); end if;
  if x.units>used then insert into private.ai_credit_ledger(company_id,operation_id,lot_id,event,credit_delta,reserved_delta) values(op.company_id,op.id,x.lot_id,'release',0,-(x.units-used)); end if;
 end loop;
 if remaining<>0 then raise exception 'Nesoulad rezervace a vypořádání.'; end if;
 update private.ai_provider_attempts set state=case when success then 'completed' else 'failed' end,input_tokens=diriqent_settle.input_tokens,output_tokens=diriqent_settle.output_tokens,cached_tokens=diriqent_settle.cached_tokens,
 provider_cost_microusd=provider_cost,unbilled_credit_units=greatest(0,ceil(provider_cost*7500::numeric/1000000)::integer-charge),updated_at=now() where id=a.id;
 update public.diriqent_operations set state=case when success then 'completed' else 'failed' end,result=case when success then diriqent_settle.result else null end,charged_units=charge,error_code=diriqent_settle.error_code,finished_at=now() where id=op.id returning * into op;
 return to_jsonb(op);
end $$;
revoke all on function public.diriqent_settle(uuid,uuid,jsonb,boolean,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function public.diriqent_settle(uuid,uuid,jsonb,boolean,integer,integer,integer,text) to service_role;

create function public.diriqent_prepare_job(c uuid,operation uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; op public.diriqent_operations; clean jsonb; customer uuid; start_time timestamptz; end_time timestamptz; price numeric; proposal public.diriqent_job_proposals; begin
 actor:=private.require_module_access(c,'ai_assistant','ai_assistant.conversation.run');
 if not public.has_company_role(c,array['super_admin','company_admin']) then raise exception 'Novou zakázku potvrzuje administrátor firmy.' using errcode='42501'; end if;
 perform private.require_module_access(c,'diriqo_core','core.jobs.create');
 select * into op from public.diriqent_operations where id=operation and company_id=c and profile_id=actor and kind='proposal' and state='completed' for update;
 if op.id is null then raise exception 'Použitelný návrh není dostupný.'; end if;
 if length(btrim(coalesce(payload->>'title',''))) not between 1 and 200 or length(coalesce(payload->>'description',''))>8000 or length(coalesce(payload->>'address',''))>1000 then raise exception 'Zkontrolujte údaje zakázky.'; end if;
 customer:=nullif(payload->>'customerId','')::uuid;start_time:=(payload->>'startAt')::timestamptz;end_time:=(payload->>'endAt')::timestamptz;price:=(payload->>'price')::numeric;
 if start_time is null or end_time is null or end_time<=start_time or price is null or price not between 0 and 999999999 then raise exception 'Doplňte termín a cenu zakázky.'; end if;
 if customer is not null and not exists(select 1 from public.customers where company_id=c and id=customer) then raise exception 'Zákazník není dostupný v aktivní firmě.'; end if;
 clean:=jsonb_build_object('title',btrim(payload->>'title'),'description',coalesce(payload->>'description',''),'address',coalesce(payload->>'address',''),'customerId',customer,'customerName',(select name from public.customers where id=customer and company_id=c),'startAt',start_time,'endAt',end_time,'price',round(price,2));
 insert into public.diriqent_job_proposals(operation_id,company_id,profile_id,payload,payload_hash,expires_at) values(operation,c,actor,clean,encode(sha256(convert_to(clean::text,'UTF8')),'hex'),now()+interval '30 minutes')
 on conflict(operation_id) do update set payload=excluded.payload,payload_hash=excluded.payload_hash,expires_at=excluded.expires_at where diriqent_job_proposals.job_id is null returning * into proposal;
 if proposal.operation_id is null then raise exception 'Tento návrh už byl převeden na zakázku.'; end if;
 return to_jsonb(proposal);
end $$;
revoke all on function public.diriqent_prepare_job(uuid,uuid,jsonb) from public,anon;
grant execute on function public.diriqent_prepare_job(uuid,uuid,jsonb) to authenticated;

create function public.diriqent_confirm_job(c uuid,operation uuid,expected_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; p public.diriqent_job_proposals; customer uuid; job uuid; begin
 actor:=private.require_module_access(c,'ai_assistant','ai_assistant.conversation.run');
 if not public.has_company_role(c,array['super_admin','company_admin']) then raise exception 'Novou zakázku potvrzuje administrátor firmy.' using errcode='42501'; end if;
 perform private.require_module_access(c,'diriqo_core','core.jobs.create');
 select * into p from public.diriqent_job_proposals where operation_id=operation and company_id=c and profile_id=actor for update;
 if p.operation_id is null or p.payload_hash is distinct from expected_hash then raise exception 'Návrh se změnil. Znovu jej zkontrolujte.'; end if;
 if p.job_id is not null then return p.job_id; end if;
 if p.expires_at<=now() then raise exception 'Platnost návrhu skončila. Připravte jej znovu.'; end if;
 customer:=(p.payload->>'customerId')::uuid;
 if customer is not null and not exists(select 1 from public.customers where id=customer and company_id=c) then raise exception 'Zákazník už není dostupný.'; end if;
 insert into public.jobs(company_id,customer_id,title,description,address,price,currency,status,work_state,billing_state,billing_status,is_paid,is_internal,start_at,end_at,scheduled_start,scheduled_end)
 values(c,customer,p.payload->>'title',p.payload->>'description',p.payload->>'address',(p.payload->>'price')::numeric,'CZK','planned','not_started','waiting_for_invoice','waiting_for_invoice',false,false,(p.payload->>'startAt')::timestamptz,(p.payload->>'endAt')::timestamptz,(p.payload->>'startAt')::timestamptz,(p.payload->>'endAt')::timestamptz) returning id into job;
 update public.diriqent_job_proposals set job_id=job,approved_at=now() where operation_id=operation;
 return job;
end $$;
revoke all on function public.diriqent_confirm_job(uuid,uuid,text) from public,anon;
grant execute on function public.diriqent_confirm_job(uuid,uuid,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('diriqent-documents','diriqent-documents',false,3145728,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
-- Deliberately no browser storage policy. Download/signing uses an authorized own-operation lookup.
