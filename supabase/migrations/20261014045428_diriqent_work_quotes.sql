-- Local/test tariffs only. No billing configuration, purchase, job, assignment,
-- invoice or attendance mutation is introduced by advanced assistant work.
create table private.diriqent_work_quotes (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 profile_id uuid not null references public.profiles(id),
 access_scope text not null check(access_scope in ('worker','manager','company_admin')),
 work_mode text not null check(work_mode in ('analytics','plan')),
 work_spec jsonb not null check(jsonb_typeof(work_spec)='object'),
 prompt text not null check(length(btrim(prompt)) between 1 and 4000),
 max_units integer not null check(max_units between 100 and 5000),
 rate_version text not null,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '10 minutes'),
 operation_id uuid unique references public.diriqent_operations(id),
 confirmed_at timestamptz,
 check((operation_id is null)=(confirmed_at is null)),
 check((work_mode='analytics' and rate_version='diriqent-analytics-test-czk-v1') or
       (work_mode='plan' and rate_version='diriqent-plan-test-czk-v1')),
 check(work_spec->>'dataset'<>'finance' or access_scope='company_admin')
);
alter table private.diriqent_work_quotes enable row level security;
revoke all on private.diriqent_work_quotes from public,anon,authenticated,service_role;
create index on private.diriqent_work_quotes(company_id,profile_id,created_at desc);

alter table public.diriqent_conversations
 add column work_mode text not null default 'basic' check(work_mode in ('basic','analytics','plan'));

alter table public.diriqent_operations
 add column work_mode text not null default 'basic' check(work_mode in ('basic','analytics','plan')),
 add column work_spec jsonb,
 add column work_quote_id uuid unique references private.diriqent_work_quotes(id),
 add constraint diriqent_work_metadata_consistent check(
  (work_mode='basic' and work_spec is null and work_quote_id is null) or
  (work_mode in ('analytics','plan') and kind='chat' and work_spec is not null and work_quote_id is not null)
 );

create function private.diriqent_quote_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Cenová nabídka je neměnná.'; end if;
 if (to_jsonb(new)-array['operation_id','confirmed_at']) is distinct from (to_jsonb(old)-array['operation_id','confirmed_at'])
  or old.operation_id is not null or new.operation_id is null or new.confirmed_at is null then
  raise exception 'Cenová nabídka je neměnná.';
 end if;
 return new;
end $$;
create trigger immutable_diriqent_quote before update or delete on private.diriqent_work_quotes
 for each row execute function private.diriqent_quote_immutable();
revoke all on function private.diriqent_quote_immutable() from public,anon,authenticated,service_role;

create function private.diriqent_rate_snapshot(version text) returns jsonb language plpgsql immutable set search_path='' as $$
declare multiplier integer;
begin
 multiplier:=case version when 'diriqent-test-czk-v1' then 3 when 'diriqent-analytics-test-czk-v1' then 6 when 'diriqent-plan-test-czk-v1' then 9 end;
 if multiplier is null then raise exception 'Neznámá verze testovací sazby.'; end if;
 return jsonb_build_object('inputUsdPerMillion',2,'cachedUsdPerMillion',0.2,'outputUsdPerMillion',12,
  'usdCzk',25,'creditMultiplier',multiplier,'version',version);
end $$;
revoke all on function private.diriqent_rate_snapshot(text) from public,anon,authenticated,service_role;

-- Capture the rate before the provider attempt starts. Settlement/recording can
-- change its state and usage, but cannot rewrite the agreed tariff snapshot.
create function private.diriqent_attempt_pricing() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.pricing:=private.diriqent_rate_snapshot((select o.rate_version from public.diriqent_operations o where o.id=new.operation_id));
 elsif new.pricing is distinct from old.pricing then raise exception 'Sazba zahájeného pokusu je neměnná.';
 end if;
 return new;
end $$;
create trigger immutable_diriqent_attempt_pricing before insert or update on private.ai_provider_attempts
 for each row execute function private.diriqent_attempt_pricing();
revoke all on function private.diriqent_attempt_pricing() from public,anon,authenticated,service_role;

create or replace function public.diriqent_access_policy(c uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; scope text;
begin
 actor:=public.current_profile_id();scope:=private.diriqent_locked_scope(c,actor);
 return jsonb_build_object('policyVersion','diriqent-role-scopes-v1','workPolicyVersion','diriqent-work-v1','scope',scope,'companyId',c,'profileId',actor);
end $$;

alter function public.diriqent_reserve(uuid,uuid,text,uuid,text,text,integer,text) set schema private;
alter function private.diriqent_reserve(uuid,uuid,text,uuid,text,text,integer,text) rename to diriqent_reserve_scoped;
revoke all on function private.diriqent_reserve_scoped(uuid,uuid,text,uuid,text,text,integer,text) from public,anon,authenticated,service_role;
create function public.diriqent_reserve(c uuid,request_id uuid,k text,conversation uuid,prompt text,fingerprint text,max_units integer,source_name text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.diriqent_locked_scope(c,public.current_profile_id());
 perform pg_advisory_xact_lock(hashtextextended(c::text,6106));
 if exists(select 1 from public.diriqent_operations where id=request_id and work_mode<>'basic') then
  raise exception 'Pokročilý požadavek spouštějte pouze přes potvrzenou cenovou nabídku.' using errcode='42501';
 end if;
 if conversation is not null and exists(select 1 from public.diriqent_conversations where id=conversation and work_mode<>'basic') then
  raise exception 'Pro běžný dotaz začněte nový rozhovor.' using errcode='42501';
 end if;
 return private.diriqent_reserve_scoped(c,request_id,k,conversation,prompt,fingerprint,max_units,source_name);
end $$;

create function public.diriqent_prepare_work(c uuid,mode text,spec jsonb,prompt text,max_units integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; scope text; first_date date; last_date date; q private.diriqent_work_quotes; version text;
begin
 actor:=public.current_profile_id();scope:=private.diriqent_locked_scope(c,actor);
 perform private.diriqent_guard(c,'chat',false);
 perform private.require_module_entitlement(c,'diriqo_core',null);
 if mode is null or mode not in ('analytics','plan') or spec is null or jsonb_typeof(spec)<>'object'
  or spec-array['dataset','from','to']<>'{}'::jsonb
  or coalesce(spec->>'dataset','') not in ('operations','finance')
  or coalesce(spec->>'from','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or coalesce(spec->>'to','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or prompt is null or length(btrim(prompt)) not between 1 and 4000
  or max_units is null or max_units not between 100 and 5000 then raise exception 'Zkontrolujte režim, období a cenový limit 1 až 50 Kč.'; end if;
 first_date:=(spec->>'from')::date;last_date:=(spec->>'to')::date;
 if not isfinite(first_date) or not isfinite(last_date) or last_date<first_date or last_date-first_date>89 then
  raise exception 'Vyberte období nejvýše 90 dní včetně krajních dnů.';
 end if;
 if spec->>'dataset'='finance' and scope<>'company_admin' then raise exception 'Finanční souhrn vyžaduje oprávnění administrátora firmy.' using errcode='42501'; end if;
 version:=case mode when 'analytics' then 'diriqent-analytics-test-czk-v1' else 'diriqent-plan-test-czk-v1' end;
 insert into private.diriqent_work_quotes(company_id,profile_id,access_scope,work_mode,work_spec,prompt,max_units,rate_version)
 values(c,actor,scope,mode,jsonb_build_object('dataset',spec->>'dataset','from',first_date,'to',last_date),btrim(prompt),max_units,version) returning * into q;
 return jsonb_build_object('id',q.id,'companyId',c,'profileId',actor,'scope',scope,'mode',mode,'spec',q.work_spec,'prompt',q.prompt,
  'maxUnits',q.max_units,'rateVersion',q.rate_version,'multiplier',case mode when 'analytics' then 2 else 3 end,'expiresAt',q.expires_at);
end $$;

create function public.diriqent_reserve_work(c uuid,quote_id uuid,request_id uuid,accepted_max_units integer,accepted_rate_version text,confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; scope text; q private.diriqent_work_quotes; fingerprint text; body jsonb;
begin
 actor:=public.current_profile_id();scope:=private.diriqent_locked_scope(c,actor);
 perform private.diriqent_guard(c,'chat',false);perform private.require_module_entitlement(c,'diriqo_core',null);
 if confirmed is distinct from true or request_id is null then raise exception 'Nejdříve výslovně potvrďte zobrazenou sazbu a limit.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,6106));
 select * into q from private.diriqent_work_quotes x where x.id=quote_id and x.company_id=c and x.profile_id=actor for update;
 if q.id is null or q.access_scope<>scope then raise exception 'Cenová nabídka není dostupná pro aktuální oprávnění.' using errcode='42501'; end if;
 if accepted_max_units is distinct from q.max_units or accepted_rate_version is distinct from q.rate_version then
  raise exception 'Cenová nabídka se neshoduje s potvrzenou sazbou nebo limitem.';
 end if;
 if q.work_spec->>'dataset'='finance' and scope<>'company_admin' then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 if q.operation_id is not null then
  if q.operation_id<>request_id then raise exception 'Cenová nabídka již byla použita pro jiný požadavek.'; end if;
  return public.diriqent_operation(c,q.operation_id);
 end if;
 if q.expires_at<=clock_timestamp() then raise exception 'Platnost cenové nabídky skončila. Připravte ji znovu.'; end if;
 -- A pre-existing basic request must never be relabelled with a higher tariff,
 -- even if someone reproduces the deterministic fingerprint through direct RPC.
 if exists(select 1 from public.diriqent_operations where id=request_id) then raise exception 'Identifikátor požadavku už byl použit.'; end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('quoteId',q.id,'companyId',c,'profileId',actor,'scope',scope,
  'mode',q.work_mode,'spec',q.work_spec,'prompt',q.prompt,'maxUnits',q.max_units,'rateVersion',q.rate_version)::text,'UTF8')),'hex');
 perform private.diriqent_reserve_scoped(c,request_id,'chat',null,q.prompt,fingerprint,q.max_units,null);
 update public.diriqent_operations set work_mode=q.work_mode,work_spec=q.work_spec,work_quote_id=q.id,rate_version=q.rate_version
  where id=request_id returning to_jsonb(diriqent_operations.*) into body;
 update public.diriqent_conversations set work_mode=q.work_mode where id=(body->>'conversation_id')::uuid;
 update private.diriqent_work_quotes set operation_id=request_id,confirmed_at=clock_timestamp() where id=q.id;
 return body;
end $$;

-- This helper is reachable only from the service-authorized claim transaction.
-- Dates are inclusive Europe/Prague calendar dates. Both source sets are capped
-- before aggregation; the response expressly describes this limited selection.
create function private.diriqent_work_context(c uuid,p uuid,scope text,spec jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; since_time timestamptz; until_time timestamptz; snapshot_at timestamptz:=clock_timestamp();
begin
 since_time:=((spec->>'from')::date::timestamp at time zone 'Europe/Prague');
 until_time:=(((spec->>'to')::date+1)::timestamp at time zone 'Europe/Prague');
 if spec->>'dataset'='finance' and scope<>'company_admin' then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 with job_candidates as materialized (
  select j.id,j.title,j.status,j.work_state,j.start_at,j.end_at,
   case when scope='company_admin' and spec->>'dataset'='finance' then j.price else null end as price,
   case when scope='company_admin' and spec->>'dataset'='finance' then j.currency else null end as currency
  from public.jobs j where j.company_id=c and j.archived_at is null and j.start_at>=since_time and j.start_at<until_time
   and (scope in ('company_admin','manager') or exists(select 1 from public.job_assignments a
    where a.company_id=c and a.job_id=j.id and a.profile_id=p and a.archived_at is null))
  order by j.start_at,j.id limit 201
 ), selected_jobs as materialized (select * from job_candidates order by start_at,id limit 200),
 shift_candidates as materialized (
  select w.id,w.started_at,w.ended_at,
   case when w.job_hours_override is not null then case when w.job_hours_override>=0 and w.job_hours_override::text not in ('NaN','Infinity','-Infinity') then w.job_hours_override end
    when w.hours_override is not null then case when w.hours_override>=0 and w.hours_override::text not in ('NaN','Infinity','-Infinity') then w.hours_override end
    when w.ended_at>w.started_at then extract(epoch from(w.ended_at-w.started_at))/3600.0 else 0 end as recorded_hours
  from public.work_shifts w where w.company_id=c and w.profile_id=p and w.started_at>=since_time and w.started_at<until_time
  order by w.started_at,w.id limit 501
 ), selected_shifts as materialized (select * from shift_candidates order by started_at,id limit 500),
 coverage as (select (select count(*) from selected_jobs) as job_count,(select count(*)>200 from job_candidates) as jobs_truncated,
  (select count(*) from selected_shifts) as shift_count,(select count(*)>500 from shift_candidates) as shifts_truncated)
 select jsonb_build_object('scope',case scope when 'worker' then 'Pouze vlastní přidělené zakázky a vlastní směny.' else 'Provozní zakázky aktivní firmy a pouze vlastní směny. Bez mezd.' end,
  'asOf',snapshot_at,'period',jsonb_build_object('from',spec->>'from','to',spec->>'to','timeZone','Europe/Prague'),
  'metrics',jsonb_build_object('jobCount',v.job_count,
   'completedJobCount',(select count(*) from selected_jobs where work_state='done' or status='done'),
   'overdueJobCount',(select count(*) from selected_jobs where end_at<snapshot_at and coalesce(work_state,'')<>'done' and coalesce(status,'') not in ('done','cancelled','canceled')),
   'ownCompletedShiftCount',(select count(*) from selected_shifts where ended_at>started_at),
   'ownHours',(select round(coalesce(sum(recorded_hours),0)::numeric,2) from selected_shifts))
   ||case when scope='company_admin' and spec->>'dataset'='finance' then jsonb_build_object('contractValueByCurrency',coalesce((
    select jsonb_agg(jsonb_build_object('currency',x.currency,'amount',x.amount) order by x.currency) from (
     select coalesce(nullif(btrim(currency),''),'UNKNOWN') as currency,round(sum(price),2) as amount from selected_jobs
      where price>=0 and price::text not in ('NaN','Infinity','-Infinity') group by coalesce(nullif(btrim(currency),''),'UNKNOWN')
    )x),'[]'::jsonb)) else '{}'::jsonb end,
  'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'status',x.status,'startAt',x.start_at,'endAt',x.end_at) order by x.start_at,x.id)
   from (select * from selected_jobs order by start_at,id limit 30)x),'[]'::jsonb),
  'coverage',jsonb_build_object('jobLimit',200,'jobRows',v.job_count,'jobsTruncated',v.jobs_truncated,'shiftLimit',500,'shiftRows',v.shift_count,
   'shiftsTruncated',v.shifts_truncated,'truncated',v.jobs_truncated or v.shifts_truncated,'previewJobLimit',30,
   'jobsSelection','start_at_in_period','shiftsSelection','started_at_in_period'),
  'warnings',jsonb_build_array('Souhrn zahrnuje pouze zakázky a vlastní směny se začátkem ve zvoleném období. Hodiny používají uložené ruční opravy před délkou směny.')
   ||case when v.jobs_truncated or v.shifts_truncated then jsonb_build_array('Výběr překročil limit. Součty platí jen pro uvedený omezený výběr; pro úplnější pohled zúžte období.') else '[]'::jsonb end
   ||case when exists(select 1 from selected_shifts where recorded_hours is null) then jsonb_build_array('Neplatná oprava hodin byla ze součtu vynechána.') else '[]'::jsonb end
   ||case when scope='company_admin' and spec->>'dataset'='finance' then jsonb_build_array('Hodnota zakázek je součet evidovaných cen dle měny, nikoli tržba, zisk nebo stav úhrad. Nevyplněné nebo neplatné ceny nejsou započteny.') else '[]'::jsonb end
 ) into result from coverage v;
 return result;
end $$;
revoke all on function private.diriqent_work_context(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

alter function public.diriqent_provider_claim(uuid,uuid,uuid,jsonb) set schema private;
alter function private.diriqent_provider_claim(uuid,uuid,uuid,jsonb) rename to diriqent_provider_claim_scoped;
revoke all on function private.diriqent_provider_claim_scoped(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.diriqent_provider_claim(operation uuid,c uuid,p uuid,context jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scope text; op public.diriqent_operations; q private.diriqent_work_quotes; body jsonb; canonical jsonb; history jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 scope:=private.diriqent_locked_scope(c,p);
 select * into op from public.diriqent_operations where id=operation and company_id=c and profile_id=p for update;
 if op.id is null or op.access_scope<>scope then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 if op.work_mode<>'basic' then
  select * into q from private.diriqent_work_quotes where id=op.work_quote_id and operation_id=op.id and company_id=c and profile_id=p;
  if q.id is null or q.access_scope<>scope or q.work_mode<>op.work_mode or q.work_spec is distinct from op.work_spec or q.prompt<>op.prompt
   or q.max_units<>op.reserved_units or q.rate_version<>op.rate_version
   or (q.work_spec->>'dataset'='finance' and scope<>'company_admin')
   or not private.module_has_entitlement(c,'diriqo_core',null) then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 end if;
 body:=private.diriqent_provider_claim_scoped(operation,c,p,context);
 if coalesce((body->>'claimed')::boolean,false) and op.work_mode<>'basic' then
  canonical:=private.diriqent_work_context(c,p,scope,op.work_spec);
  update public.diriqent_operations set context_snapshot=canonical where id=op.id;
  body:=jsonb_set(body,'{context}',canonical);
  body:=jsonb_set(body,'{history}','[]'::jsonb);
 elsif coalesce((body->>'claimed')::boolean,false) then
  select coalesce(jsonb_agg(jsonb_build_object('question',left(x.prompt,800),'answer',left(x.result->>'answer',1400)) order by x.created_at),'[]'::jsonb) into history
  from (select o.prompt,o.result,o.created_at from public.diriqent_operations o
   where o.company_id=c and o.profile_id=p and o.conversation_id=op.conversation_id and o.access_scope=scope
    and o.work_mode='basic' and o.state='completed' and o.kind in ('chat','proposal') order by o.created_at desc limit 5)x;
  body:=jsonb_set(body,'{history}',history);
 end if;
 return body;
end $$;

-- Keep the existing append-only allocation/settlement algorithm. Only the tariff
-- factor is selected from the immutable, explicitly accepted rate snapshot.
create or replace function public.diriqent_settle(operation uuid,attempt uuid,result jsonb,success boolean,input_tokens integer,output_tokens integer,cached_tokens integer,error_code text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op public.diriqent_operations; a private.ai_provider_attempts; provider_cost bigint; charge integer; remaining integer; used integer; x record; tariff jsonb; factor integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into op from public.diriqent_operations where id=operation for update;
 if op.id is null then raise exception 'Požadavek není dostupný.'; end if;
 if op.state in ('completed','failed') then return to_jsonb(op); end if;
 select * into a from private.ai_provider_attempts where id=attempt and operation_id=operation for update;
 if a.id is null then raise exception 'Neshodný pokus.'; end if;
 tariff:=private.diriqent_rate_snapshot(op.rate_version);
 if a.pricing is distinct from tariff then raise exception 'Sazba pokusu neodpovídá potvrzené verzi.'; end if;
 factor:=(tariff->>'creditMultiplier')::integer*2500;
 if input_tokens is null or output_tokens is null or cached_tokens is null or input_tokens<0 or output_tokens<0 or cached_tokens not between 0 and input_tokens or input_tokens>2000000 or output_tokens>100000 then raise exception 'Neplatná spotřeba.'; end if;
 if success is null or (success and (result is null or jsonb_typeof(result)<>'object' or octet_length(result::text)>100000)) then raise exception 'Chybí použitelný výsledek.'; end if;
 provider_cost:=ceil(((input_tokens-cached_tokens)::numeric*2000000+cached_tokens::numeric*200000+output_tokens::numeric*12000000)/1000000);
 charge:=case when success then least(op.reserved_units,ceil(provider_cost*factor::numeric/1000000)::integer) else 0 end;remaining:=charge;
 for x in select al.*,l.expires_at,l.created_at from private.ai_credit_allocations al join private.ai_credit_lots l on l.id=al.lot_id where operation_id=operation order by l.expires_at asc nulls last,l.created_at,l.id loop
  used:=least(remaining,x.units);remaining:=remaining-used;
  if used>0 then insert into private.ai_credit_ledger(company_id,operation_id,lot_id,event,credit_delta,reserved_delta) values(op.company_id,op.id,x.lot_id,'settle',-used,-used); end if;
  if x.units>used then insert into private.ai_credit_ledger(company_id,operation_id,lot_id,event,credit_delta,reserved_delta) values(op.company_id,op.id,x.lot_id,'release',0,-(x.units-used)); end if;
 end loop;
 if remaining<>0 then raise exception 'Nesoulad rezervace a vypořádání.'; end if;
 update private.ai_provider_attempts set state=case when success then 'completed' else 'failed' end,input_tokens=diriqent_settle.input_tokens,output_tokens=diriqent_settle.output_tokens,cached_tokens=diriqent_settle.cached_tokens,
  provider_cost_microusd=provider_cost,unbilled_credit_units=greatest(0,ceil(provider_cost*factor::numeric/1000000)::integer-charge),updated_at=now() where id=a.id;
 update public.diriqent_operations set state=case when success then 'completed' else 'failed' end,result=case when success then diriqent_settle.result else null end,charged_units=charge,error_code=diriqent_settle.error_code,finished_at=now() where id=op.id returning * into op;
 return to_jsonb(op);
end $$;

revoke all on function public.diriqent_prepare_work(uuid,text,jsonb,text,integer),public.diriqent_reserve_work(uuid,uuid,uuid,integer,text,boolean),public.diriqent_access_policy(uuid),public.diriqent_reserve(uuid,uuid,text,uuid,text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.diriqent_prepare_work(uuid,text,jsonb,text,integer),public.diriqent_reserve_work(uuid,uuid,uuid,integer,text,boolean),public.diriqent_access_policy(uuid),public.diriqent_reserve(uuid,uuid,text,uuid,text,text,integer,text) to authenticated;
revoke all on function public.diriqent_provider_claim(uuid,uuid,uuid,jsonb),public.diriqent_settle(uuid,uuid,jsonb,boolean,integer,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.diriqent_provider_claim(uuid,uuid,uuid,jsonb),public.diriqent_settle(uuid,uuid,jsonb,boolean,integer,integer,integer,text) to service_role;
