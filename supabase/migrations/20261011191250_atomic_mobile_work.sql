-- Additive migration. No existing time, payroll or assignment values are rewritten.
-- If historic duplicate timers exist, abort for explicit reconciliation rather than
-- guessing which payroll record to delete or close.
set local lock_timeout = '5s';
create unique index work_shifts_one_running_per_worker
  on public.work_shifts(company_id, profile_id)
  where started_at is not null and ended_at is null;

-- The public invoker wrapper exposes one narrow operation, never arbitrary writes.
-- The definer implementation derives the actor from the verified database identity.
create function private.mutate_my_job_work(
  target_company_id uuid, operation text,
  target_job_id uuid default null, target_shift_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_profile uuid;
  v_assignment public.job_assignments%rowtype;
  v_shift public.work_shifts%rowtype;
  v_access jsonb;
  v_enabled boolean;
  v_now timestamptz;
  v_zone text;
begin
  if auth.uid() is null then
    raise exception 'WORK_FORBIDDEN' using errcode = '42501';
  end if;
  if target_company_id is null or operation is null or operation not in ('start','stop','complete')
    or (operation in ('start','complete') and (target_job_id is null or target_shift_id is not null))
    or (operation = 'stop' and (target_shift_id is null or target_job_id is not null)) then
    raise exception 'WORK_INVALID_INPUT' using errcode = '22023';
  end if;

  -- Serialize all three operations for this identity/company, including starts on
  -- different jobs and complete-vs-start. The unique index also covers other writers.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('my-work:' || target_company_id::text || ':' || auth.uid()::text, 0));

  begin
    select p.id into strict v_profile
    from public.company_members cm join public.profiles p on p.id = cm.profile_id
    where cm.company_id = target_company_id and cm.is_active
      and lower(cm.role::text) in ('worker','manager','company_admin','super_admin')
      and p.auth_user_id = auth.uid()
      and (p.user_id is null or p.user_id = p.auth_user_id)
    for share of cm, p;
  exception when no_data_found or too_many_rows then
    raise exception 'WORK_FORBIDDEN' using errcode = '42501';
  end;

  -- Ending existing own work is settlement, so remains possible after expiry or
  -- assignment removal. Active membership is still mandatory.
  if operation = 'stop' then
    select * into v_shift from public.work_shifts
      where id = target_shift_id and company_id = target_company_id and profile_id = v_profile
      for update;
    if not found or v_shift.started_at is null then
      raise exception 'WORK_SHIFT_NOT_FOUND' using errcode = '42501';
    end if;
    if v_shift.ended_at is not null then
      return jsonb_build_object('shift_id',v_shift.id,'job_id',v_shift.job_id,'reused',true);
    end if;
    update public.work_shifts set ended_at = greatest(clock_timestamp(),started_at),
      status = 'completed', updated_at = clock_timestamp() where id = v_shift.id;
    return jsonb_build_object('shift_id',v_shift.id,'job_id',v_shift.job_id,'reused',false);
  end if;

  -- Recheck both license and module setting INSIDE the write transaction. These
  -- locks order committed membership/grant/module revocation against this operation.
  v_access := private.evaluate_company_capability_access(target_company_id,
    case when operation = 'start' then 'core.time.record' else 'core.jobs.update' end,
    clock_timestamp());
  if not coalesce((v_access->>'allowed')::boolean,false) then
    raise exception 'WORK_MODULE_REQUIRED' using errcode = '42501';
  end if;
  select is_enabled into v_enabled from public.company_modules
    where company_id = target_company_id
      and module_key = case when operation = 'start' then 'shifts' else 'jobs' end for share;
  if v_enabled = false then
    raise exception 'WORK_MODULE_DISABLED' using errcode = '42501';
  end if;

  select ja.* into v_assignment
  from public.job_assignments ja join public.jobs j on j.id = ja.job_id and j.company_id = ja.company_id
  where ja.company_id = target_company_id and ja.profile_id = v_profile
    and ja.job_id = target_job_id and ja.archived_at is null
  for update of ja, j;
  if not found then
    raise exception 'WORK_JOB_NOT_ASSIGNED' using errcode = '42501';
  end if;
  -- A lock wait must not authorize work using a timestamp from before expiry.
  -- Test grants are locked by the evaluator; lock the paid grant as well, then
  -- evaluate against the fresh database clock after all blocking access locks.
  if v_access->>'entitlement_id' is not null then
    perform 1 from public.company_module_entitlements
      where id = (v_access->>'entitlement_id')::uuid for share;
  end if;
  v_access := private.evaluate_company_capability_access(target_company_id,
    case when operation = 'start' then 'core.time.record' else 'core.jobs.update' end,
    clock_timestamp());
  if not coalesce((v_access->>'allowed')::boolean,false) then
    raise exception 'WORK_MODULE_REQUIRED' using errcode = '42501';
  end if;
  if v_assignment.completed_at is not null or v_assignment.work_completed_at is not null
    or v_assignment.status = 'completed' then
    if operation = 'complete' then
      return jsonb_build_object('job_id',target_job_id,'reused',true);
    end if;
    raise exception 'WORK_ALREADY_COMPLETED' using errcode = '23514';
  end if;

  if operation = 'complete' then
    if exists(select 1 from public.work_shifts where company_id = target_company_id
      and profile_id = v_profile and job_id = target_job_id
      and started_at is not null and ended_at is null) then
      raise exception 'WORK_SHIFT_STILL_RUNNING' using errcode = '23514';
    end if;
    v_now := clock_timestamp();
    update public.job_assignments set status = 'completed', completed_at = v_now,
      work_completed_at = v_now, updated_at = v_now where id = v_assignment.id;
    update public.jobs set status = 'waiting_check', work_state = 'partially_done',
      updated_at = v_now where id = target_job_id and company_id = target_company_id
      and status in ('planned','scheduled','in_progress','waiting_check');
    return jsonb_build_object('job_id',target_job_id,'reused',false);
  end if;

  select * into v_shift from public.work_shifts where company_id = target_company_id
    and profile_id = v_profile and started_at is not null and ended_at is null for update;
  if found then
    if v_shift.job_id = target_job_id then
      return jsonb_build_object('shift_id',v_shift.id,'job_id',v_shift.job_id,'reused',true);
    end if;
    raise exception 'WORK_ANOTHER_SHIFT_RUNNING' using errcode = '23514';
  end if;
  select timezone into v_zone from public.companies where id = target_company_id;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = v_zone) then
    raise exception 'WORK_TIMEZONE_INVALID' using errcode = '22023';
  end if;
  -- A direct administrative shift writer may have held the SELECT FOR UPDATE
  -- above until after expiry. Never reuse the pre-wait license timestamp.
  v_access := private.evaluate_company_capability_access(target_company_id,'core.time.record',clock_timestamp());
  if not coalesce((v_access->>'allowed')::boolean,false) then
    raise exception 'WORK_MODULE_REQUIRED' using errcode = '42501';
  end if;
  v_now := clock_timestamp();
  insert into public.work_shifts(company_id,profile_id,job_id,shift_date,started_at,status,note)
    values(target_company_id,v_profile,target_job_id,(v_now at time zone v_zone)::date,
      v_now,'running','Start z worker flow')
    returning * into v_shift;
  update public.job_assignments set status = 'in_progress',
    work_started_at = coalesce(work_started_at,v_now), updated_at = v_now
    where id = v_assignment.id;
  return jsonb_build_object('shift_id',v_shift.id,'job_id',target_job_id,'reused',false);
end;
$function$;
revoke all on function private.mutate_my_job_work(uuid,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.mutate_my_job_work(uuid,text,uuid,uuid) to authenticated;

create function public.mutate_my_job_work(
  target_company_id uuid, operation text,
  target_job_id uuid default null, target_shift_id uuid default null
) returns jsonb
language sql security invoker set search_path = ''
as $function$
  select private.mutate_my_job_work(target_company_id,operation,target_job_id,target_shift_id);
$function$;
revoke all on function public.mutate_my_job_work(uuid,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mutate_my_job_work(uuid,text,uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
