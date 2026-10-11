-- Canonical context is built inside the claim transaction, never supplied by the browser/server snapshot.
create or replace function public.diriqent_provider_claim(operation uuid,c uuid,p uuid,context jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.diriqent_operations; attempt uuid; member_role text; manager boolean; canonical jsonb; history jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select m.role into member_role from public.company_members m where m.company_id=c and m.profile_id=p and m.is_active for share;
 manager:=coalesce(member_role in ('super_admin','company_admin','manager'),false);
 select * into op from public.diriqent_operations where id=operation and company_id=c and profile_id=p for update;
 if op.id is null then raise exception 'Požadavek není dostupný.'; end if;
 if op.state<>'reserved' then return jsonb_build_object('claimed',false); end if;
 if member_role is null or member_role not in ('super_admin','company_admin','manager','worker') or op.requires_manager<>manager
  or (op.kind not in ('chat','proposal') and not manager)
  or not private.module_has_entitlement(c,private.diriqent_product(op.kind),private.diriqent_capability(op.kind)) then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 canonical:=null;history:='[]'::jsonb;
 if op.kind in ('chat','proposal') then
  if private.module_has_entitlement(c,'diriqo_core',null) then
   canonical:=jsonb_build_object('asOf',now(),'scope',case when manager then 'Posledních 30 zakázek aktivní firmy, nejvýše 30 zákazníků a pouze vlastní docházka. Bez mezd.' else 'Jen vlastní přidělené zakázky a vlastní docházka. Bez mezd a bez adresáře.' end,
    'jobs',coalesce((select jsonb_agg(to_jsonb(x)) from (select j.id,j.title,j.status,j.start_at,j.end_at from public.jobs j where j.company_id=c and j.archived_at is null and (manager or exists(select 1 from public.job_assignments a where a.company_id=c and a.job_id=j.id and a.profile_id=p and a.archived_at is null)) order by j.updated_at desc limit 30)x),'[]'::jsonb),
    'customers',case when manager then coalesce((select jsonb_agg(to_jsonb(x)) from (select id,name from public.customers where company_id=c order by name limit 30)x),'[]'::jsonb) else '[]'::jsonb end,
    'ownShifts',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,job_id,started_at,ended_at,status from public.work_shifts where company_id=c and profile_id=p order by created_at desc limit 20)x),'[]'::jsonb));
  else canonical:=jsonb_build_object('asOf',now(),'scope','Bez firemních zakázek: chybí oprávnění k historii Core.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('question',left(x.prompt,800),'answer',left(x.result->>'answer',1400)) order by x.created_at),'[]'::jsonb) into history
   from (select o.prompt,o.result,o.created_at from public.diriqent_operations o where o.company_id=c and o.profile_id=p and o.conversation_id=op.conversation_id and o.requires_manager=manager and o.state='completed' and o.kind in ('chat','proposal') order by o.created_at desc limit 5)x;
 end if;
 insert into private.ai_provider_attempts(operation_id,provider_request_id) values(op.id,op.id::text) returning id into attempt;
 update public.diriqent_operations set state='running',context_snapshot=canonical where id=op.id;
 return jsonb_build_object('claimed',true,'attemptId',attempt,'context',canonical,'history',history);
end $$;

-- An unclaimed reservation can be safely released. A provider attempt can never be cancelled here.
create function public.diriqent_cancel_unstarted(c uuid,operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; op public.diriqent_operations; x record;
begin
 actor:=public.current_profile_id();
 if actor is null or not public.has_company_role(c,array['super_admin','company_admin','manager','worker']) then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 select * into op from public.diriqent_operations where id=operation and company_id=c and profile_id=actor for update;
 if op.id is null then raise exception 'Požadavek není dostupný.' using errcode='42501'; end if;
 if op.state='failed' and op.error_code='cancelled_before_provider' then return jsonb_build_object('id',op.id,'state','failed'); end if;
 if op.state<>'reserved' or exists(select 1 from private.ai_provider_attempts a where a.operation_id=op.id) then raise exception 'Zpracování už začalo. Ověřte výsledek.'; end if;
 for x in select * from private.ai_credit_allocations al where al.operation_id=op.id loop
  insert into private.ai_credit_ledger(company_id,operation_id,lot_id,event,credit_delta,reserved_delta) values(c,op.id,x.lot_id,'release',0,-x.units);
 end loop;
 update public.diriqent_operations set state='failed',error_code='cancelled_before_provider',finished_at=now() where id=op.id;
 return jsonb_build_object('id',op.id,'state','failed');
end $$;
revoke all on function public.diriqent_cancel_unstarted(uuid,uuid) from public,anon,service_role;
grant execute on function public.diriqent_cancel_unstarted(uuid,uuid) to authenticated;

-- A full export refuses silently truncated output. Individual old operations are looked up directly.
create function public.diriqent_export(c uuid,k text default 'chat',operation uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; product text; capability text; manager boolean; records jsonb; proposal_records jsonb; amount bigint;
begin
 actor:=private.diriqent_guard(c,k,true);product:=private.diriqent_product(k);capability:=product||'.history.export';
 if not private.module_has_entitlement(c,product,capability) then raise exception 'Chybí oprávnění k exportu historie.' using errcode='42501'; end if;
 manager:=public.has_company_role(c,array['super_admin','company_admin','manager']);
 select count(*) into amount from public.diriqent_operations o where o.company_id=c and o.profile_id=actor and (not o.requires_manager or manager) and (operation is null or o.id=operation) and case when k in ('chat','proposal') then o.kind in ('chat','proposal') else o.kind=k end;
 if operation is not null and amount<>1 then raise exception 'Výsledek není dostupný.' using errcode='42501'; end if;
 if amount>1000 then raise exception 'AI_EXPORT_LIMIT: Historie má více než 1000 záznamů. Exportujte jednotlivé výsledky.'; end if;
 select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at),'[]'::jsonb) into records from public.diriqent_operations o where o.company_id=c and o.profile_id=actor and (not o.requires_manager or manager) and (operation is null or o.id=operation) and case when k in ('chat','proposal') then o.kind in ('chat','proposal') else o.kind=k end;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at),'[]'::jsonb) into proposal_records from public.diriqent_job_proposals p where p.company_id=c and p.profile_id=actor and manager and k in ('chat','proposal') and (operation is null or p.operation_id=operation);
 return jsonb_build_object('companyId',c,'rateVersion','diriqent-test-czk-v1','recordCount',amount,'complete',true,'operations',records,'proposals',proposal_records);
end $$;
revoke all on function public.diriqent_export(uuid,text,uuid) from public,anon,service_role;
grant execute on function public.diriqent_export(uuid,text,uuid) to authenticated;
