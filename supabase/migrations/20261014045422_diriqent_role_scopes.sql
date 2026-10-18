-- Diriqent history follows the current membership, including a downgrade from
-- company_admin to manager. "company_admin" is an application role, not proof
-- of legal ownership. Existing ambiguous privileged history stays admin-only.
alter table public.diriqent_conversations add column access_scope text not null default 'company_admin'
 check (access_scope in ('worker','manager','company_admin'));
alter table public.diriqent_operations add column access_scope text not null default 'company_admin'
 check (access_scope in ('worker','manager','company_admin'));
alter table public.diriqent_job_proposals add column access_scope text not null default 'company_admin'
 check (access_scope = 'company_admin');
update public.diriqent_conversations set access_scope='worker' where not requires_manager;
update public.diriqent_operations set access_scope='worker' where not requires_manager;

create function private.diriqent_scope_allows(c uuid,scope text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(case scope
  when 'worker' then public.has_company_role(c,array['super_admin','company_admin','manager','worker'])
  when 'manager' then public.has_company_role(c,array['super_admin','company_admin','manager'])
  when 'company_admin' then public.has_company_role(c,array['super_admin','company_admin'])
  else false end,false);
$$;
-- The membership lock makes authorization and each RPC one transaction: a role
-- change cannot interleave a credit reservation or a provider claim.
create function private.diriqent_locked_scope(c uuid,p uuid) returns text language plpgsql security definer set search_path='' as $$
declare member_role text;
begin
 select m.role into member_role from public.company_members m
 where m.company_id=c and m.profile_id=p and m.is_active for share;
 if member_role in ('super_admin','company_admin') then return 'company_admin'; end if;
 if member_role in ('manager','worker') then return member_role; end if;
 raise exception 'MODULE_FORBIDDEN' using errcode='42501';
end $$;
revoke all on function private.diriqent_scope_allows(uuid,text),private.diriqent_locked_scope(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.diriqent_scope_allows(uuid,text) to authenticated;

-- A new application can refuse paid work before reserving any credit when this
-- migration is absent. This check exposes no business data or module settings.
create function public.diriqent_access_policy(c uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; scope text;
begin
 actor:=public.current_profile_id();scope:=private.diriqent_locked_scope(c,actor);
 return jsonb_build_object('policyVersion','diriqent-role-scopes-v1','scope',scope,'companyId',c,'profileId',actor);
end $$;
revoke all on function public.diriqent_access_policy(uuid) from public,anon,authenticated,service_role;
grant execute on function public.diriqent_access_policy(uuid) to authenticated;

drop policy own_conversation_history on public.diriqent_conversations;
create policy own_conversation_history on public.diriqent_conversations for select to authenticated
 using (private.diriqent_can_read(company_id,profile_id,'chat') and private.diriqent_scope_allows(company_id,access_scope));
drop policy own_operation_history on public.diriqent_operations;
create policy own_operation_history on public.diriqent_operations for select to authenticated
 using (private.diriqent_can_read(company_id,profile_id,kind) and private.diriqent_scope_allows(company_id,access_scope));
drop policy own_proposal_history on public.diriqent_job_proposals;
create policy own_proposal_history on public.diriqent_job_proposals for select to authenticated
 using (private.diriqent_can_read(company_id,profile_id,'proposal') and private.diriqent_scope_allows(company_id,access_scope));

-- Preserve the existing reservation and settlement accounting implementation.
-- The old entry points become inaccessible internal implementations.
alter function public.diriqent_reserve(uuid,uuid,text,uuid,text,text,integer,text) set schema private;
alter function private.diriqent_reserve(uuid,uuid,text,uuid,text,text,integer,text) rename to diriqent_reserve_v1;
alter function public.diriqent_read(uuid,text) set schema private;
alter function private.diriqent_read(uuid,text) rename to diriqent_read_v1;
alter function public.diriqent_operation(uuid,uuid) set schema private;
alter function private.diriqent_operation(uuid,uuid) rename to diriqent_operation_v1;
alter function public.diriqent_export(uuid,text,uuid) set schema private;
alter function private.diriqent_export(uuid,text,uuid) rename to diriqent_export_v1;
alter function public.diriqent_provider_claim(uuid,uuid,uuid,jsonb) set schema private;
alter function private.diriqent_provider_claim(uuid,uuid,uuid,jsonb) rename to diriqent_provider_claim_v1;
revoke all on function private.diriqent_reserve_v1(uuid,uuid,text,uuid,text,text,integer,text),private.diriqent_read_v1(uuid,text),private.diriqent_operation_v1(uuid,uuid),private.diriqent_export_v1(uuid,text,uuid),private.diriqent_provider_claim_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.diriqent_reserve(c uuid,request_id uuid,k text,conversation uuid,prompt text,fingerprint text,max_units integer,source_name text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; scope text; existing public.diriqent_operations; body jsonb; conv uuid;
begin
 actor:=public.current_profile_id();scope:=private.diriqent_locked_scope(c,actor);
 -- Use the same lock as the existing ledger, including concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended(c::text,6106));
 select * into existing from public.diriqent_operations where id=request_id for update;
 if existing.id is not null then
  if existing.company_id<>c or existing.profile_id<>actor or existing.access_scope<>scope then
   raise exception 'Požadavek není dostupný pro aktuální oprávnění.' using errcode='42501';
  end if;
  return private.diriqent_reserve_v1(c,request_id,k,conversation,prompt,fingerprint,max_units,source_name);
 end if;
 if k in ('chat','proposal') and conversation is not null and not exists(
  select 1 from public.diriqent_conversations x where x.id=conversation and x.company_id=c and x.profile_id=actor and x.access_scope=scope
 ) then raise exception 'Rozhovor není dostupný pro aktuální oprávnění. Začněte nový.' using errcode='42501'; end if;
 body:=private.diriqent_reserve_v1(c,request_id,k,conversation,prompt,fingerprint,max_units,source_name);
 update public.diriqent_operations set access_scope=scope where id=request_id returning to_jsonb(diriqent_operations.*) into body;
 conv:=(body->>'conversation_id')::uuid;
 if conversation is null and conv is not null then
  update public.diriqent_conversations set access_scope=scope where id=conv;
 end if;
 return body;
end $$;

create function public.diriqent_read(c uuid,k text default 'chat') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; available bigint;
begin
 perform private.diriqent_locked_scope(c,public.current_profile_id());
 actor:=private.diriqent_guard(c,k,true);
 select coalesce(sum(l.units+coalesce(x.credit,0)-coalesce(x.reserved,0)),0) into available from private.ai_credit_lots l
 left join lateral(select sum(credit_delta) credit,sum(reserved_delta) reserved from private.ai_credit_ledger where lot_id=l.id)x on true
 where l.company_id=c and (l.expires_at is null or l.expires_at>now());
 -- Apply authorization before pagination. Hidden higher-scope rows must not
 -- displace accessible history from the bounded workspace response.
 return jsonb_build_object('companyId',c,'profileId',actor,
  'canRun',private.module_has_entitlement(c,private.diriqent_product(k),private.diriqent_capability(k)),
  'availableUnits',available,'rateVersion','diriqent-test-czk-v1',
  'policyVersion','diriqent-role-scopes-v1','roleScope',(
   select m.role from public.company_members m where m.company_id=c and m.profile_id=actor and m.is_active
  ),
  'conversations',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
   select * from public.diriqent_conversations where company_id=c and profile_id=actor and k in ('chat','proposal')
    and private.diriqent_scope_allows(c,access_scope) order by created_at desc limit 50
  )x),'[]'::jsonb),
  'operations',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
   select * from public.diriqent_operations where company_id=c and profile_id=actor
    and private.diriqent_scope_allows(c,access_scope)
    and case when k in ('chat','proposal') then kind in ('chat','proposal') else kind=k end
   order by created_at desc limit 100
  )x),'[]'::jsonb),
  'proposals',coalesce((select jsonb_agg(to_jsonb(x)) from public.diriqent_job_proposals x
   where company_id=c and profile_id=actor and k in ('chat','proposal') and private.diriqent_scope_allows(c,access_scope)
  ),'[]'::jsonb));
end $$;

create function public.diriqent_operation(c uuid,operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.diriqent_locked_scope(c,public.current_profile_id());
 if not exists(select 1 from public.diriqent_operations o where o.id=operation and o.company_id=c
  and o.profile_id=public.current_profile_id() and private.diriqent_scope_allows(c,o.access_scope)) then
  raise exception 'Požadavek není dostupný.' using errcode='42501';
 end if;
 return private.diriqent_operation_v1(c,operation)||jsonb_build_object('policyVersion','diriqent-role-scopes-v1');
end $$;

create function public.diriqent_export(c uuid,k text default 'chat',operation uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; product text; capability text; records jsonb; proposal_records jsonb; amount bigint;
begin
 perform private.diriqent_locked_scope(c,public.current_profile_id());
 actor:=private.diriqent_guard(c,k,true);product:=private.diriqent_product(k);capability:=product||'.history.export';
 if not private.module_has_entitlement(c,product,capability) then raise exception 'Chybí oprávnění k exportu historie.' using errcode='42501'; end if;
 -- Only accessible records count towards the export limit. An invisible admin
 -- archive cannot block a downgraded member's otherwise valid small export.
 select count(*) into amount from public.diriqent_operations o where o.company_id=c and o.profile_id=actor
  and private.diriqent_scope_allows(c,o.access_scope) and (operation is null or o.id=operation)
  and case when k in ('chat','proposal') then o.kind in ('chat','proposal') else o.kind=k end;
 if operation is not null and amount<>1 then raise exception 'Výsledek není dostupný.' using errcode='42501'; end if;
 if amount>1000 then raise exception 'AI_EXPORT_LIMIT: Historie má více než 1000 záznamů. Exportujte jednotlivé výsledky.'; end if;
 select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at),'[]'::jsonb) into records from public.diriqent_operations o
  where o.company_id=c and o.profile_id=actor and private.diriqent_scope_allows(c,o.access_scope)
   and (operation is null or o.id=operation)
   and case when k in ('chat','proposal') then o.kind in ('chat','proposal') else o.kind=k end;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at),'[]'::jsonb) into proposal_records from public.diriqent_job_proposals p
  where p.company_id=c and p.profile_id=actor and private.diriqent_scope_allows(c,p.access_scope)
   and k in ('chat','proposal') and (operation is null or p.operation_id=operation);
 return jsonb_build_object('companyId',c,'rateVersion','diriqent-test-czk-v1','recordCount',amount,'complete',true,
  'operations',records,'proposals',proposal_records,'policyVersion','diriqent-role-scopes-v1');
end $$;

create function public.diriqent_provider_claim(operation uuid,c uuid,p uuid,context jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare scope text; op public.diriqent_operations; body jsonb; history jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 scope:=private.diriqent_locked_scope(c,p);
 select * into op from public.diriqent_operations o where o.id=operation and o.company_id=c and o.profile_id=p for update;
 if op.id is null or op.access_scope<>scope then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 body:=private.diriqent_provider_claim_v1(operation,c,p,context);
 if coalesce((body->>'claimed')::boolean,false) then
  select coalesce(jsonb_agg(jsonb_build_object('question',left(x.prompt,800),'answer',left(x.result->>'answer',1400)) order by x.created_at),'[]'::jsonb) into history
  from (select o.prompt,o.result,o.created_at from public.diriqent_operations o
   where o.company_id=c and o.profile_id=p and o.conversation_id=op.conversation_id and o.access_scope=scope
    and o.state='completed' and o.kind in ('chat','proposal') order by o.created_at desc limit 5)x;
  body:=jsonb_set(body,'{history}',history);
 end if;
 return body;
end $$;

revoke all on function public.diriqent_reserve(uuid,uuid,text,uuid,text,text,integer,text),public.diriqent_read(uuid,text),public.diriqent_operation(uuid,uuid),public.diriqent_export(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.diriqent_reserve(uuid,uuid,text,uuid,text,text,integer,text),public.diriqent_read(uuid,text),public.diriqent_operation(uuid,uuid),public.diriqent_export(uuid,text,uuid) to authenticated;
revoke all on function public.diriqent_provider_claim(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.diriqent_provider_claim(uuid,uuid,uuid,jsonb) to service_role;
