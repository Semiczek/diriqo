-- Fleet module. Requires private.require_module_access and private.require_module_entitlement.
-- No automatic charge: additional capacity must be granted by an audited billing integration.
create table private.fleet_capacity_grants (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  source_ref text not null unique, additional_vehicles integer not null check(additional_vehicles between 1 and 10000),
  valid_from timestamptz not null, valid_until timestamptz not null, revoked boolean not null default false,
  created_at timestamptz not null default now(), check(valid_until > valid_from)
);
alter table private.fleet_capacity_grants enable row level security;
revoke all on private.fleet_capacity_grants from public,anon,authenticated,service_role;
create index fleet_capacity_company on private.fleet_capacity_grants(company_id);

create table public.fleet_vehicles (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  name text not null check(length(name) between 1 and 120), plate text not null check(length(plate) between 1 and 24),
  status text not null default 'active' check(status in ('active','service','inactive','archived')),
  initial_odometer numeric(12,1) not null check(initial_odometer between 0 and 99999999),
  driver_id uuid references public.profiles(id), cost_method text not null check(cost_method in ('mileage','actual')),
  km_rate numeric(10,2) not null default 0 check(km_rate between 0 and 10000),
  notes text not null default '' check(length(notes)<=4000), version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,plate)
);
create table public.fleet_trips (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  vehicle_id uuid not null, driver_id uuid not null references public.profiles(id),
  started_at timestamptz not null, ended_at timestamptz not null,
  origin text not null check(length(origin) between 1 and 200), destination text not null check(length(destination) between 1 and 200),
  purpose text not null check(length(purpose) between 1 and 1000),
  odometer_start numeric(12,1) not null check(odometer_start>=0), odometer_end numeric(12,1) not null,
  status text not null default 'draft' check(status in ('draft','submitted','approved','locked')),
  job_id uuid references public.jobs(id), cost_method text not null check(cost_method in ('mileage','actual')),
  km_rate numeric(10,2) not null check(km_rate>=0), mileage_amount numeric(14,2) not null check(mileage_amount>=0),
  return_reason text check(length(return_reason)<=1000), version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(company_id,vehicle_id) references public.fleet_vehicles(company_id,id), unique(company_id,id),
  check(ended_at>started_at and isfinite(started_at) and isfinite(ended_at) and odometer_end>=odometer_start)
);
create index fleet_trips_vehicle_time on public.fleet_trips(company_id,vehicle_id,started_at);
create index fleet_trips_driver_time on public.fleet_trips(company_id,driver_id,started_at);
create table public.fleet_services (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), vehicle_id uuid not null,
  title text not null check(length(title) between 1 and 200), due_on date not null check(isfinite(due_on)),
  status text not null default 'planned' check(status in ('planned','in_progress','completed','cancelled')),
  notes text not null default '' check(length(notes)<=4000), version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(company_id,vehicle_id) references public.fleet_vehicles(company_id,id), unique(company_id,id)
);
create index fleet_services_vehicle on public.fleet_services(company_id,vehicle_id,due_on);
create table public.fleet_costs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), vehicle_id uuid not null,
  kind text not null check(kind in ('fuel','charging','service','other')), incurred_on date not null check(isfinite(incurred_on)),
  description text not null check(length(description) between 1 and 400), amount numeric(14,2) not null check(amount>0 and amount<=100000000),
  quantity numeric(12,3) check(quantity>0 and quantity<=1000000), receipt_ref text not null check(length(receipt_ref) between 1 and 100),
  supplier text not null check(length(supplier) between 1 and 200), service_id uuid,
  created_at timestamptz not null default now(),
  foreign key(company_id,vehicle_id) references public.fleet_vehicles(company_id,id),
  foreign key(company_id,service_id) references public.fleet_services(company_id,id), unique(company_id,id),
  unique(company_id,supplier,receipt_ref), unique(company_id,service_id)
);
create index fleet_costs_vehicle on public.fleet_costs(company_id,vehicle_id,incurred_on);
create table public.fleet_cost_allocations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), vehicle_id uuid not null,
  cost_id uuid not null, job_id uuid not null references public.jobs(id), amount numeric(14,2) not null check(amount>0),
  created_at timestamptz not null default now(), foreign key(company_id,cost_id) references public.fleet_costs(company_id,id),
  foreign key(company_id,vehicle_id) references public.fleet_vehicles(company_id,id), unique(cost_id,job_id)
);
create index fleet_allocations_company on public.fleet_cost_allocations(company_id,vehicle_id);
create index fleet_allocations_job on public.fleet_cost_allocations(company_id,job_id);
create table public.fleet_documents (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), vehicle_id uuid not null,
  file_name text not null check(length(file_name) between 1 and 180), object_path text not null unique,
  created_at timestamptz not null default now(), foreign key(company_id,vehicle_id) references public.fleet_vehicles(company_id,id)
);
create index fleet_documents_vehicle on public.fleet_documents(company_id,vehicle_id);
create table public.fleet_audit_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), vehicle_id uuid not null,
  entity_id uuid not null, operation text not null, actor_id uuid not null references public.profiles(id),
  before_data jsonb, after_data jsonb, created_at timestamptz not null default now(),
  foreign key(company_id,vehicle_id) references public.fleet_vehicles(company_id,id)
);
create index fleet_audit_vehicle on public.fleet_audit_events(company_id,vehicle_id,created_at desc);
create table private.fleet_write_requests (
  company_id uuid not null, request_id uuid not null, fingerprint text not null, result_id uuid not null,
  created_at timestamptz not null default now(), primary key(company_id,request_id)
);
alter table private.fleet_write_requests enable row level security;
revoke all on private.fleet_write_requests from public,anon,authenticated,service_role;

create table private.fleet_upload_intents (
  request_id uuid primary key, company_id uuid not null references public.companies(id), vehicle_id uuid not null,
  actor_id uuid not null references public.profiles(id), object_path text not null unique,
  file_name text not null, mime_type text not null, size_bytes integer not null,
  expires_at timestamptz not null default now()+interval '15 minutes',
  foreign key(company_id,vehicle_id) references public.fleet_vehicles(company_id,id)
);
alter table private.fleet_upload_intents enable row level security;
revoke all on private.fleet_upload_intents from public,anon,authenticated,service_role;
create index fleet_upload_intents_company on private.fleet_upload_intents(company_id,vehicle_id);

create function private.fleet_upload_intent(target_company_id uuid,target_vehicle_id uuid,target_request_id uuid,target_file_name text,target_mime_type text,target_size_bytes integer)
returns text language plpgsql security definer set search_path='' as $$
declare actor uuid; old private.fleet_upload_intents; object_path text; extension text;
begin
  actor:=private.require_module_access(target_company_id,'fleet','fleet.vehicle.manage',null);
  if target_request_id is null or target_size_bytes is null or target_size_bytes not between 1 and 3145728 or target_file_name is null or length(target_file_name) not between 1 and 180 then raise exception 'FLEET_INVALID'; end if;
  extension:=case target_mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if extension is null then raise exception 'FLEET_INVALID'; end if;
  perform 1 from public.fleet_vehicles where company_id=target_company_id and id=target_vehicle_id and status<>'archived' for update;
  if not found then raise exception 'FLEET_FORBIDDEN'; end if;
  select * into old from private.fleet_upload_intents where request_id=target_request_id;
  if found then
    if old.company_id<>target_company_id or old.vehicle_id<>target_vehicle_id or old.actor_id<>actor or old.file_name<>target_file_name or old.mime_type<>target_mime_type or old.size_bytes<>target_size_bytes or old.expires_at<=now() then raise exception 'FLEET_CONFLICT'; end if;
    return old.object_path;
  end if;
  object_path:=target_company_id::text||'/'||target_vehicle_id::text||'/'||target_request_id::text||'.'||extension;
  insert into private.fleet_upload_intents(request_id,company_id,vehicle_id,actor_id,object_path,file_name,mime_type,size_bytes)
    values(target_request_id,target_company_id,target_vehicle_id,actor,object_path,target_file_name,target_mime_type,target_size_bytes);
  return object_path;
end $$;
revoke all on function private.fleet_upload_intent(uuid,uuid,uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function private.fleet_upload_intent(uuid,uuid,uuid,text,text,integer) to authenticated;
create function public.fleet_upload_intent(target_company_id uuid,target_vehicle_id uuid,target_request_id uuid,target_file_name text,target_mime_type text,target_size_bytes integer)
returns text language sql security invoker set search_path='' as $$ select private.fleet_upload_intent(target_company_id,target_vehicle_id,target_request_id,target_file_name,target_mime_type,target_size_bytes); $$;
revoke all on function public.fleet_upload_intent(uuid,uuid,uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.fleet_upload_intent(uuid,uuid,uuid,text,text,integer) to authenticated;

create function private.fleet_can_read(target_company_id uuid, target_vehicle_id uuid default null, target_driver_id uuid default null, manager_only boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid; manager boolean;
begin
  if not private.module_can_read(target_company_id,'fleet',false,null) then return false; end if;
  select pr.id into actor from public.profiles pr join public.company_members cm on cm.profile_id=pr.id
    where pr.auth_user_id=auth.uid() and (pr.user_id is null or pr.user_id=pr.auth_user_id) and cm.company_id=target_company_id and cm.is_active;
  if actor is null then return false; end if;
  select cm.role in ('super_admin','company_admin','manager') into manager from public.company_members cm
    where cm.company_id=target_company_id and cm.profile_id=actor and cm.is_active;
  if manager then return true; end if;
  if manager_only then return false; end if;
  if target_driver_id is not null then return target_driver_id=actor; end if;
  return exists(select 1 from public.fleet_vehicles v where v.company_id=target_company_id and v.id=target_vehicle_id and v.driver_id=actor);
exception when others then return false;
end $$;
revoke all on function private.fleet_can_read(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.fleet_can_read(uuid,uuid,uuid,boolean) to authenticated;

do $$ declare t text; begin
  foreach t in array array['fleet_vehicles','fleet_trips','fleet_services','fleet_costs','fleet_cost_allocations','fleet_documents','fleet_audit_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;
create policy fleet_vehicle_read on public.fleet_vehicles for select to authenticated using(private.fleet_can_read(company_id,id));
create policy fleet_trip_read on public.fleet_trips for select to authenticated using(private.fleet_can_read(company_id,vehicle_id,driver_id));
create policy fleet_service_read on public.fleet_services for select to authenticated using(private.fleet_can_read(company_id,vehicle_id));
create policy fleet_document_read on public.fleet_documents for select to authenticated using(private.fleet_can_read(company_id,vehicle_id));
create policy fleet_cost_read on public.fleet_costs for select to authenticated using(private.fleet_can_read(company_id,vehicle_id,null,true));
create policy fleet_allocation_read on public.fleet_cost_allocations for select to authenticated using(private.fleet_can_read(company_id,vehicle_id,null,true));
create policy fleet_audit_read on public.fleet_audit_events for select to authenticated using(private.fleet_can_read(company_id,vehicle_id,null,true));

create function private.fleet_write(target_company_id uuid, target_operation text, target_payload jsonb, target_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid; manager boolean; entity uuid; vehicle uuid; old public.fleet_vehicles; car public.fleet_vehicles;
  trip public.fleet_trips; cost public.fleet_costs; service public.fleet_services;
  before_value jsonb; after_value jsonb; fingerprint text; request private.fleet_write_requests;
  desired text; driver uuid; job uuid; started timestamptz; ended timestamptz; odo_start numeric; odo_end numeric;
  previous_odo numeric; next_odo numeric; amount numeric; capacity integer; method text;
begin
  if target_operation in ('trip.save','trip.transition') then
    actor := private.require_module_entitlement(target_company_id,'fleet','fleet.trip.record',null);
  else
    actor := private.require_module_access(target_company_id,'fleet','fleet.vehicle.manage',null);
  end if;
  if target_request_id is null or target_payload is null or jsonb_typeof(target_payload)<>'object' or octet_length(target_payload::text)>30000 then raise exception 'FLEET_INVALID'; end if;
  select cm.role in ('super_admin','company_admin','manager') into manager from public.company_members cm where cm.company_id=target_company_id and cm.profile_id=actor and cm.is_active;
  -- A company lock serializes capacity checks, driver overlap and immutable receipt deduplication.
  perform 1 from public.companies where id=target_company_id for update;
  fingerprint := md5(target_operation || target_payload::text);
  select * into request from private.fleet_write_requests where company_id=target_company_id and request_id=target_request_id;
  if found then
    if request.fingerprint<>fingerprint then raise exception 'FLEET_CONFLICT'; end if;
    return request.result_id;
  end if;
  entity := coalesce(nullif(target_payload->>'id','')::uuid,gen_random_uuid());
  vehicle := nullif(target_payload->>'vehicle_id','')::uuid;
  if target_operation='vehicle.save' then
    select * into old from public.fleet_vehicles where id=entity and company_id=target_company_id for update;
    before_value := case when found then to_jsonb(old) else null end;
    if before_value is not null and old.version is distinct from (target_payload->>'version')::integer then raise exception 'FLEET_CONFLICT'; end if;
    desired := target_payload->>'status'; driver := nullif(target_payload->>'driver_id','')::uuid;
    method := target_payload->>'cost_method'; odo_start := (target_payload->>'initial_odometer')::numeric;
    if desired is null or desired not in ('active','service','inactive','archived') or method is null or method not in ('mileage','actual') then raise exception 'FLEET_INVALID'; end if;
    if driver is not null and not exists(select 1 from public.company_members where company_id=target_company_id and profile_id=driver and is_active) then raise exception 'FLEET_FORBIDDEN'; end if;
    if before_value is not null and (old.cost_method<>method or old.initial_odometer<>odo_start) and
      (exists(select 1 from public.fleet_trips where vehicle_id=entity) or exists(select 1 from public.fleet_costs where vehicle_id=entity)) then raise exception 'FLEET_METHOD_LOCKED'; end if;
    if desired in ('active','service') and (before_value is null or old.status not in ('active','service')) then
      select 5+coalesce(sum(additional_vehicles),0)::integer into capacity from private.fleet_capacity_grants
        where company_id=target_company_id and not revoked and valid_from<=now() and now()<valid_until;
      if (select count(*) from public.fleet_vehicles where company_id=target_company_id and status in ('active','service'))>=capacity then raise exception 'FLEET_CAPACITY'; end if;
    end if;
    insert into public.fleet_vehicles(id,company_id,name,plate,status,initial_odometer,driver_id,cost_method,km_rate,notes)
      values(entity,target_company_id,btrim(target_payload->>'name'),upper(regexp_replace(target_payload->>'plate','\s','','g')),desired,odo_start,driver,method,(target_payload->>'km_rate')::numeric,coalesce(target_payload->>'notes',''))
      on conflict(id) do update set name=excluded.name,plate=excluded.plate,status=excluded.status,initial_odometer=excluded.initial_odometer,
        driver_id=excluded.driver_id,cost_method=excluded.cost_method,km_rate=excluded.km_rate,notes=excluded.notes,version=public.fleet_vehicles.version+1,updated_at=now()
      where public.fleet_vehicles.company_id=target_company_id returning to_jsonb(fleet_vehicles.*) into after_value;
    if after_value is null then raise exception 'FLEET_FORBIDDEN'; end if;
    vehicle:=entity;
  else
    select * into car from public.fleet_vehicles where company_id=target_company_id and id=vehicle for update;
    if not found then raise exception 'FLEET_FORBIDDEN'; end if;
    if target_operation='trip.save' then
      select * into trip from public.fleet_trips where company_id=target_company_id and id=entity and vehicle_id=vehicle for update;
      before_value := case when found then to_jsonb(trip) else null end;
      if before_value is not null and (trip.status<>'draft' or trip.version is distinct from (target_payload->>'version')::integer) then raise exception 'FLEET_LOCKED'; end if;
      if car.status<>'active' then raise exception 'FLEET_ARCHIVED'; end if;
      driver:=nullif(target_payload->>'driver_id','')::uuid; job:=nullif(target_payload->>'job_id','')::uuid;
      if driver is null or not exists(select 1 from public.company_members where company_id=target_company_id and profile_id=driver and is_active) then raise exception 'FLEET_FORBIDDEN'; end if;
      if not manager and (car.driver_id is distinct from actor or driver<>actor or (before_value is not null and trip.driver_id<>actor)) then raise exception 'FLEET_FORBIDDEN'; end if;
      if job is not null and not exists(select 1 from public.jobs where id=job and company_id=target_company_id) then raise exception 'FLEET_FORBIDDEN'; end if;
      started:=(target_payload->>'started_at')::timestamptz; ended:=(target_payload->>'ended_at')::timestamptz;
      odo_start:=(target_payload->>'odometer_start')::numeric; odo_end:=(target_payload->>'odometer_end')::numeric;
      if started is null or ended is null or not isfinite(started) or not isfinite(ended) or ended<=started or odo_start is null or odo_end is null or odo_end<odo_start or odo_start::text in ('NaN','Infinity','-Infinity') or odo_end::text in ('NaN','Infinity','-Infinity') or odo_end>99999999 then raise exception 'FLEET_INVALID'; end if;
      if exists(select 1 from public.fleet_trips t where t.company_id=target_company_id and t.id<>entity and (t.vehicle_id=vehicle or t.driver_id=driver) and t.started_at<ended and t.ended_at>started) then raise exception 'FLEET_TRIP_OVERLAP'; end if;
      select t.odometer_end into previous_odo from public.fleet_trips t where t.vehicle_id=vehicle and t.id<>entity and t.ended_at<=started order by t.ended_at desc limit 1;
      select t.odometer_start into next_odo from public.fleet_trips t where t.vehicle_id=vehicle and t.id<>entity and t.started_at>=ended order by t.started_at limit 1;
      if odo_start<>coalesce(previous_odo,car.initial_odometer) or (next_odo is not null and odo_end<>next_odo) then raise exception 'FLEET_ODOMETER_GAP'; end if;
      insert into public.fleet_trips(id,company_id,vehicle_id,driver_id,started_at,ended_at,origin,destination,purpose,odometer_start,odometer_end,job_id,cost_method,km_rate,mileage_amount)
      values(entity,target_company_id,vehicle,driver,started,ended,btrim(target_payload->>'origin'),btrim(target_payload->>'destination'),btrim(target_payload->>'purpose'),odo_start,odo_end,job,car.cost_method,car.km_rate,case when car.cost_method='mileage' then round((odo_end-odo_start)*car.km_rate,2) else 0 end)
      on conflict(id) do update set driver_id=excluded.driver_id,started_at=excluded.started_at,ended_at=excluded.ended_at,origin=excluded.origin,destination=excluded.destination,purpose=excluded.purpose,odometer_start=excluded.odometer_start,odometer_end=excluded.odometer_end,job_id=excluded.job_id,
        mileage_amount=case when fleet_trips.cost_method='mileage' then round((excluded.odometer_end-excluded.odometer_start)*fleet_trips.km_rate,2) else 0 end,version=fleet_trips.version+1,updated_at=now()
      where fleet_trips.company_id=target_company_id and fleet_trips.vehicle_id=vehicle returning to_jsonb(fleet_trips.*) into after_value;
    elsif target_operation='trip.transition' then
      select * into trip from public.fleet_trips where company_id=target_company_id and id=entity and vehicle_id=vehicle for update;
      if not found then raise exception 'FLEET_FORBIDDEN'; end if;
      if trip.version is distinct from (target_payload->>'version')::integer then raise exception 'FLEET_CONFLICT'; end if;
      if not manager and (trip.driver_id<>actor or car.driver_id is distinct from actor) then raise exception 'FLEET_FORBIDDEN'; end if;
      before_value:=to_jsonb(trip); desired:=target_payload->>'status';
      if desired is null or not ((trip.status='draft' and desired='submitted') or (manager and ((trip.status='submitted' and desired in ('draft','approved')) or (trip.status='approved' and desired in ('draft','locked'))))) then raise exception 'FLEET_INVALID_TRANSITION'; end if;
      if desired='draft' and length(btrim(coalesce(target_payload->>'return_reason','')))=0 then raise exception 'FLEET_INVALID'; end if;
      update public.fleet_trips set status=desired,return_reason=case when desired='draft' then btrim(target_payload->>'return_reason') else return_reason end,version=version+1,updated_at=now()
        where id=entity returning to_jsonb(fleet_trips.*) into after_value;
    elsif target_operation='cost.create' then
      if car.status='archived' then raise exception 'FLEET_ARCHIVED'; end if;
      if nullif(target_payload->>'service_id','') is not null and not exists(select 1 from public.fleet_services where id=(target_payload->>'service_id')::uuid and company_id=target_company_id and vehicle_id=vehicle) then raise exception 'FLEET_FORBIDDEN'; end if;
      insert into public.fleet_costs(id,company_id,vehicle_id,kind,incurred_on,description,amount,quantity,receipt_ref,supplier,service_id)
        values(entity,target_company_id,vehicle,target_payload->>'kind',(target_payload->>'incurred_on')::date,btrim(target_payload->>'description'),(target_payload->>'amount')::numeric,nullif(target_payload->>'quantity','')::numeric,upper(btrim(target_payload->>'receipt_ref')),upper(btrim(target_payload->>'supplier')),nullif(target_payload->>'service_id','')::uuid)
        returning to_jsonb(fleet_costs.*) into after_value;
    elsif target_operation='cost.allocate' then
      select * into cost from public.fleet_costs where company_id=target_company_id and vehicle_id=vehicle and id=(target_payload->>'cost_id')::uuid for update;
      if not found then raise exception 'FLEET_FORBIDDEN'; end if;
      if car.cost_method<>'actual' then raise exception 'FLEET_COST_METHOD'; end if;
      job:=(target_payload->>'job_id')::uuid; amount:=(target_payload->>'amount')::numeric;
      if amount is null or amount<=0 or not exists(select 1 from public.jobs where company_id=target_company_id and id=job) then raise exception 'FLEET_INVALID'; end if;
      if amount+(select coalesce(sum(a.amount),0) from public.fleet_cost_allocations a where a.cost_id=cost.id)>cost.amount then raise exception 'FLEET_ALLOCATION_EXCEEDED'; end if;
      insert into public.fleet_cost_allocations(id,company_id,vehicle_id,cost_id,job_id,amount) values(entity,target_company_id,vehicle,cost.id,job,amount) returning to_jsonb(fleet_cost_allocations.*) into after_value;
    elsif target_operation='service.save' then
      if car.status='archived' then raise exception 'FLEET_ARCHIVED'; end if;
      select * into service from public.fleet_services where company_id=target_company_id and id=entity and vehicle_id=vehicle for update;
      before_value:=case when found then to_jsonb(service) else null end;
      if before_value is not null and service.version is distinct from (target_payload->>'version')::integer then raise exception 'FLEET_CONFLICT'; end if;
      desired:=target_payload->>'status';
      if desired is null or desired not in ('planned','in_progress','completed','cancelled') or (before_value is not null and service.status in ('completed','cancelled')) then raise exception 'FLEET_INVALID_TRANSITION'; end if;
      insert into public.fleet_services(id,company_id,vehicle_id,title,due_on,status,notes) values(entity,target_company_id,vehicle,btrim(target_payload->>'title'),(target_payload->>'due_on')::date,desired,coalesce(target_payload->>'notes',''))
        on conflict(id) do update set title=excluded.title,due_on=excluded.due_on,status=excluded.status,notes=excluded.notes,version=fleet_services.version+1,updated_at=now()
        where fleet_services.company_id=target_company_id and fleet_services.vehicle_id=vehicle returning to_jsonb(fleet_services.*) into after_value;
    elsif target_operation='document.create' then
      if car.status='archived' then raise exception 'FLEET_ARCHIVED'; end if;
      if split_part(target_payload->>'object_path','/',1)<>target_company_id::text or split_part(target_payload->>'object_path','/',2)<>vehicle::text
        or not exists(select 1 from storage.objects o join private.fleet_upload_intents i on i.object_path=o.name
          where o.bucket_id='fleet-documents' and o.name=target_payload->>'object_path' and i.request_id=target_request_id
            and i.actor_id=actor and i.company_id=target_company_id and i.vehicle_id=vehicle and i.expires_at>now()
            and i.file_name=target_payload->>'file_name' and (o.metadata->>'size')::integer=i.size_bytes and o.metadata->>'mimetype'=i.mime_type)
          then raise exception 'FLEET_FORBIDDEN'; end if;
      insert into public.fleet_documents(id,company_id,vehicle_id,file_name,object_path) values(entity,target_company_id,vehicle,target_payload->>'file_name',target_payload->>'object_path') returning to_jsonb(fleet_documents.*) into after_value;
    else raise exception 'FLEET_INVALID'; end if;
  end if;
  if after_value is null then raise exception 'FLEET_FORBIDDEN'; end if;
  insert into public.fleet_audit_events(company_id,vehicle_id,entity_id,operation,actor_id,before_data,after_data) values(target_company_id,vehicle,entity,target_operation,actor,before_value,after_value);
  insert into private.fleet_write_requests(company_id,request_id,fingerprint,result_id) values(target_company_id,target_request_id,fingerprint,entity);
  return entity;
exception when unique_violation then raise exception 'FLEET_DUPLICATE';
end $$;
revoke all on function private.fleet_write(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.fleet_write(uuid,text,jsonb,uuid) to authenticated;
create function public.fleet_write(target_company_id uuid,target_operation text,target_payload jsonb,target_request_id uuid)
returns uuid language sql security invoker set search_path='' as $$ select private.fleet_write(target_company_id,target_operation,target_payload,target_request_id); $$;
revoke all on function public.fleet_write(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.fleet_write(uuid,text,jsonb,uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fleet-documents','fleet-documents',false,3145728,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create function private.fleet_storage_access(object_name text, writing boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare company uuid; vehicle uuid;
begin
  company:=split_part(object_name,'/',1)::uuid; vehicle:=split_part(object_name,'/',2)::uuid;
  if writing then
    perform private.require_module_access(company,'fleet','fleet.vehicle.manage',null);
    return exists(select 1 from private.fleet_upload_intents i join public.fleet_vehicles v on v.company_id=i.company_id and v.id=i.vehicle_id
      join public.profiles p on p.id=i.actor_id and p.auth_user_id=auth.uid()
      where i.object_path=object_name and i.company_id=company and i.vehicle_id=vehicle and i.expires_at>now() and v.status<>'archived');
  end if;
  return private.fleet_can_read(company,vehicle) and exists(select 1 from public.fleet_documents d where d.company_id=company and d.vehicle_id=vehicle and d.object_path=object_name);
exception when others then return false;
end $$;
revoke all on function private.fleet_storage_access(text,boolean) from public,anon,authenticated,service_role;
grant execute on function private.fleet_storage_access(text,boolean) to authenticated;
create policy fleet_document_storage_read on storage.objects for select to authenticated using(bucket_id='fleet-documents' and private.fleet_storage_access(name,false));
create policy fleet_document_storage_insert on storage.objects for insert to authenticated with check(bucket_id='fleet-documents' and private.fleet_storage_access(name,true));
