-- Extend the existing warehouse entity; movement/FIFO history stays unchanged.
alter table public.gastro_warehouses
 add column warehouse_kind text not null default 'other' check (warehouse_kind in ('main','job','mobile','other')),
 add column job_id uuid references public.jobs(id),
 add column location text not null default '' check (length(location)<=300),
 add column notes text not null default '' check (length(notes)<=1000),
 add constraint warehouse_job_kind check ((warehouse_kind='job')=(job_id is not null));
create index gastro_warehouses_job_idx on public.gastro_warehouses(company_id,job_id) where job_id is not null;
create unique index gastro_warehouses_one_main_idx on public.gastro_warehouses(company_id) where warehouse_kind='main' and not archived;

-- The existing module guard locks grants; evaluate their validity again using wall time
-- after every possible lock wait, while profile/membership locks protect this transaction.
create function private.inventory_warehouse_actor(c uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; access jsonb;
begin
 actor:=private.require_module_access(c,'inventory','inventory.movement.post');
 perform 1 from public.profiles where id=actor for share;
 perform 1 from public.company_members where company_id=c and profile_id=actor for share;
 if not exists(select 1 from public.profiles p join public.company_members m on m.profile_id=p.id
  where p.id=actor and p.auth_user_id=auth.uid() and p.is_active and m.company_id=c and m.is_active and m.role in ('super_admin','company_admin','manager')) then
  raise exception 'MODULE_FORBIDDEN' using errcode='42501';end if;
 access:=private.evaluate_company_capability_access(c,'inventory.movement.post',clock_timestamp());
 -- Evaluation may itself wait for a grant or rollout lock.
 access:=private.evaluate_company_capability_access(c,'inventory.movement.post',clock_timestamp());
 if not coalesce((access->>'allowed')::boolean,false)then raise exception 'MODULE_REQUIRED' using errcode='42501';end if;
 return actor;
end $$;
revoke all on function private.inventory_warehouse_actor(uuid) from public,anon,authenticated,service_role;

-- Settings share the original command registry and company lock with all stock writes.
create function private.inventory_warehouse_write(c uuid,p jsonb,r uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; obj uuid; job uuid; kind text; is_archived boolean; existing public.gastro_warehouses; command record; result jsonb;
begin
 actor:=private.inventory_warehouse_actor(c);
 if r is null or p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>10000 then raise exception 'INVENTORY_INVALID'; end if;
 if not exists(select 1 from public.profiles where id=actor and is_active is true) then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.companies where id=c for update;
 actor:=private.inventory_warehouse_actor(c);
 if not exists(select 1 from public.profiles where id=actor and is_active is true) then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 select * into command from private.inventory_commands where company_id=c and request_id=r;
 if found then
  if command.operation<>'warehouse_settings' or command.payload<>p then raise exception 'INVENTORY_RETRY_CONFLICT'; end if;
  return command.result;
 end if;
 obj:=nullif(p->>'id','')::uuid; job:=nullif(p->>'job_id','')::uuid; kind:=p->>'warehouse_kind';
 if kind is null or kind not in ('main','job','mobile','other') or jsonb_typeof(p->'archived') is distinct from 'boolean'
  or jsonb_typeof(p->'name') is distinct from 'string' or length(btrim(p->>'name')) not between 1 and 160
  or jsonb_typeof(p->'location') is distinct from 'string' or length(p->>'location')>300
  or jsonb_typeof(p->'notes') is distinct from 'string' or length(p->>'notes')>1000 then raise exception 'INVENTORY_INVALID'; end if;
 is_archived:=(p->>'archived')::boolean;
 if (kind='job') is distinct from (job is not null) then raise exception 'INVENTORY_WAREHOUSE_JOB'; end if;
 if job is not null then
  perform 1 from public.jobs where id=job and company_id=c for key share;
  if not found then raise exception 'INVENTORY_WAREHOUSE_JOB'; end if;
 end if;
 if obj is not null then
  select * into existing from public.gastro_warehouses where company_id=c and id=obj for update;
  if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
  if existing.version is distinct from (p->>'version')::integer then raise exception 'INVENTORY_CONFLICT'; end if;
  if is_archived and not existing.archived and (
   exists(select 1 from public.gastro_stock_lots where company_id=c and warehouse_id=obj and remaining>0)
   or exists(select 1 from public.inventory_reservations where company_id=c and warehouse_id=obj and released_at is null)
   or exists(select 1 from public.inventory_documents where company_id=c and status='draft' and (warehouse_id=obj or destination_id=obj))
   or exists(select 1 from public.inventory_orders where company_id=c and warehouse_id=obj and status not in ('closed','cancelled'))
  ) then raise exception 'INVENTORY_WAREHOUSE_BUSY'; end if;
 end if;
 if not is_archived and (obj is null or existing.archived) and (select count(*) from public.gastro_warehouses where company_id=c and not archived)>=3 then raise exception 'INVENTORY_WAREHOUSE_LIMIT'; end if;
 if kind='main' and not is_archived and exists(select 1 from public.gastro_warehouses where company_id=c and warehouse_kind='main' and not archived and id is distinct from obj) then raise exception 'INVENTORY_WAREHOUSE_MAIN'; end if;
 actor:=private.inventory_warehouse_actor(c);
 if not exists(select 1 from public.profiles where id=actor and is_active is true) then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 if obj is null then
  insert into public.gastro_warehouses(company_id,name,warehouse_kind,job_id,location,notes,archived)
  values(c,btrim(p->>'name'),kind,job,btrim(p->>'location'),btrim(p->>'notes'),is_archived) returning id into obj;
 else
  update public.gastro_warehouses set name=btrim(p->>'name'),warehouse_kind=kind,job_id=job,location=btrim(p->>'location'),notes=btrim(p->>'notes'),archived=is_archived,version=version+1 where id=obj and company_id=c;
 end if;
 result:=jsonb_build_object('id',obj);
 insert into public.inventory_audit(company_id,actor_id,operation,entity_id,payload) values(c,actor,'warehouse_settings',obj,p);
 insert into private.inventory_commands(company_id,request_id,operation,payload,result) values(c,r,'warehouse_settings',p,result);
 perform private.inventory_warehouse_actor(c);
 return result;
end $$;
revoke all on function private.inventory_warehouse_write(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.inventory_warehouse_write(uuid,jsonb,uuid) to authenticated;
create function public.inventory_warehouse_write(company uuid,payload jsonb,request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.inventory_warehouse_write(company,payload,request_id); $$;
revoke all on function public.inventory_warehouse_write(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inventory_warehouse_write(uuid,jsonb,uuid) to authenticated;
