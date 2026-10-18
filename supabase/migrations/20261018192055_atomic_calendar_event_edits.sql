-- C06-03: one revision covers the event header and its complete assignment set.
-- This migration changes no historical values and refuses ambiguous legacy aliases.
set local lock_timeout = '5s';
lock table public.calendar_events, public.calendar_event_assignments in share row exclusive mode;
do $preflight$
begin
  if exists(select 1 from public.calendar_events where
    (start_at is not null and starts_at is not null and start_at<>starts_at)
    or (end_at is not null and ends_at is not null and end_at<>ends_at))
    or exists(select 1 from public.calendar_event_assignments where event_id is not null
      and calendar_event_id is not null and event_id<>calendar_event_id) then
    raise exception 'CALENDAR_ALIAS_CONFLICT' using errcode='23514';
  end if;
  if exists(select 1 from public.calendar_event_assignments a left join public.calendar_events e
      on e.id=coalesce(a.event_id,a.calendar_event_id)
      where e.id is null or a.company_id is distinct from e.company_id)
    or exists(select 1 from public.calendar_event_assignments
      group by coalesce(event_id,calendar_event_id),profile_id having count(*)>1) then
    raise exception 'CALENDAR_SCOPE_INVALID' using errcode='23514';
  end if;
end;
$preflight$;

alter table public.calendar_events add column revision bigint not null default 0 check(revision>=0);
alter table public.calendar_events add constraint calendar_time_aliases_consistent check (
  (start_at is null or starts_at is null or start_at=starts_at)
  and (end_at is null or ends_at is null or end_at=ends_at)) not valid;
alter table public.calendar_event_assignments add constraint calendar_event_aliases_consistent check (
  coalesce(event_id,calendar_event_id) is not null
  and (event_id is null or calendar_event_id is null or event_id=calendar_event_id)) not valid;
create unique index calendar_assignment_logical_event_profile_uidx
  on public.calendar_event_assignments(coalesce(event_id,calendar_event_id),profile_id);
create index calendar_events_company_start_idx on public.calendar_events(company_id,start_at);
alter table public.calendar_events enable row level security;
alter table public.calendar_event_assignments enable row level security;

create function private.calendar_actor(p_company_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare v_actor uuid;
begin
  if auth.uid() is null then raise exception 'CALENDAR_FORBIDDEN' using errcode='42501'; end if;
  select p.id into v_actor from public.profiles p join public.company_members cm on cm.profile_id=p.id
  where p.auth_user_id=auth.uid() and p.is_active and cm.company_id=p_company_id and cm.is_active
    and cm.role in ('company_admin','super_admin');
  if v_actor is null then raise exception 'CALENDAR_FORBIDDEN' using errcode='42501'; end if;
  return v_actor;
end;
$f$;
revoke all on function private.calendar_actor(uuid) from public,anon,authenticated,service_role;

create function private.calendar_can_read(p_company_id uuid)
returns boolean language sql stable security definer set search_path='' as $f$
  select auth.uid() is not null and exists(select 1 from public.company_members cm
    join public.profiles p on p.id=cm.profile_id where cm.company_id=p_company_id
      and cm.is_active and p.is_active and p.auth_user_id=auth.uid());
$f$;
revoke all on function private.calendar_can_read(uuid) from public,anon,authenticated,service_role;
grant execute on function private.calendar_can_read(uuid) to authenticated;

-- Preserve member history reads, but remove every direct write route, including
-- column grants and TRUNCATE. No caller-settable bypass flag is accepted.
do $permissions$
declare t text; r record; cols text;
begin
  foreach t in array array['calendar_events','calendar_event_assignments'] loop
    for r in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',r.policyname,t);
    end loop;
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    select string_agg(quote_ident(column_name),',') into cols from information_schema.columns
      where table_schema='public' and table_name=t;
    execute format('revoke all (%s) on public.%I from public,anon,authenticated,service_role',cols,t);
    execute format('grant select on public.%I to authenticated',t);
    if t='calendar_events' then
      execute format('create policy calendar_member_history on public.%I for select to authenticated using (private.calendar_can_read(company_id))',t);
    end if;
  end loop;
end;
$permissions$;

-- The detail RPC supplies assignments only to current administrators. A new
-- broad assignment SELECT policy would expose data absent from the old policy.
revoke select on public.calendar_event_assignments from authenticated;

-- Revisions also cover foreign-key actions (job SET NULL and profile CASCADE),
-- so a snapshot cannot silently become stale outside the explicit RPCs.
-- Revisions are opaque monotonic tokens, not an operation count: one atomic
-- command can touch several assignments and advance the token several times.
create function private.calendar_bump_header_revision()
returns trigger language plpgsql security invoker set search_path='' as $f$
begin
  new.revision:=old.revision+1;
  new.updated_at:=clock_timestamp();
  return new;
end;
$f$;
revoke all on function private.calendar_bump_header_revision() from public,anon,authenticated,service_role;
create trigger calendar_header_revision before update on public.calendar_events
  for each row execute function private.calendar_bump_header_revision();

create function private.calendar_bump_assignment_revision()
returns trigger language plpgsql security definer set search_path='' as $f$
declare v_old uuid; v_new uuid;
begin
  if tg_op='UPDATE' and new is not distinct from old then return null; end if;
  if tg_op<>'INSERT' then v_old:=coalesce(old.event_id,old.calendar_event_id); end if;
  if tg_op<>'DELETE' then v_new:=coalesce(new.event_id,new.calendar_event_id); end if;
  perform e.id from public.calendar_events e where e.id in(v_old,v_new) order by e.id for update;
  -- The header trigger owns the increment. A cascading event deletion has no
  -- surviving header, so its child deletions need no separate update.
  update public.calendar_events set updated_at=clock_timestamp() where id in(v_old,v_new);
  return null;
end;
$f$;
revoke all on function private.calendar_bump_assignment_revision() from public,anon,authenticated,service_role;
create trigger calendar_assignment_revision after insert or update or delete on public.calendar_event_assignments
  for each row execute function private.calendar_bump_assignment_revision();

-- Called after the final DML as well as before writing. Existing rollout/grant
-- locks can wait, so evaluate again with a fresh clock after acquiring them.
-- The shared evaluator does not lock a paid receipt; lock and validate it here.
create function private.assert_calendar_mutation(p_company_id uuid)
returns void language plpgsql volatile security definer set search_path='' as $f$
declare v_access jsonb; v_paid public.company_module_entitlements%rowtype;
  v_test private.company_test_module_grants%rowtype; v_valid boolean; v_now timestamptz;
begin
  perform private.calendar_actor(p_company_id);
  perform 1 from public.company_modules m where m.company_id=p_company_id and m.module_key='calendar' for share;
  perform private.evaluate_company_capability_access(p_company_id,'core.calendar.manage',clock_timestamp());
  v_access:=private.evaluate_company_capability_access(p_company_id,'core.calendar.manage',clock_timestamp());
  if not coalesce((v_access->>'allowed')::boolean,false) then
    raise exception 'CALENDAR_MODULE_REQUIRED' using errcode='42501';
  end if;
  if v_access->>'reason'='paid' then
    select * into v_paid from public.company_module_entitlements e
      where e.id=(v_access->>'entitlement_id')::uuid and e.company_id=p_company_id for share;
    if not found then raise exception 'CALENDAR_MODULE_REQUIRED' using errcode='42501'; end if;
    v_now:=clock_timestamp();
    v_valid:=v_paid.product='diriqo_core' and v_paid.register_id is null
      and v_paid.policy_version='diriqo-capabilities-v0.1' and v_paid.origin='paid'
      and v_paid.state='active' and not v_paid.revoked
      and v_paid.livemode=(v_access->>'livemode')::boolean
      and v_paid.valid_from<=v_now and v_now<v_paid.valid_until
      and 'core.calendar.manage'=any(v_paid.capabilities);
  elsif v_access->>'reason'='test' then
    select * into v_test from private.company_test_module_grants g
      where g.id=(v_access->>'test_grant_id')::uuid and g.company_id=p_company_id for share;
    if not found then raise exception 'CALENDAR_MODULE_REQUIRED' using errcode='42501'; end if;
    v_now:=clock_timestamp();
    v_valid:=v_test.product='diriqo_core' and v_test.register_id is null
      and v_test.policy_version='diriqo-capabilities-v0.1' and v_test.origin='manual_grant'
      and v_test.state='active' and v_test.revoked_at is null and not v_test.livemode
      and (v_access->>'livemode')::boolean=false
      and v_test.valid_from<=v_now and v_now<v_test.valid_until
      and 'core.calendar.manage'=any(v_test.capabilities);
  else
    v_valid:=v_access->>'reason'='legacy' and (v_access->>'enforced')::boolean=false;
  end if;
  if v_valid is distinct from true then raise exception 'CALENDAR_MODULE_REQUIRED' using errcode='42501'; end if;
  -- Membership, profile and module changes committed during any preceding wait
  -- are checked now, before the transaction can commit its calendar changes.
  perform private.calendar_actor(p_company_id);
  if exists(select 1 from public.company_modules m where m.company_id=p_company_id
    and m.module_key='calendar' and m.is_enabled=false) then
    raise exception 'CALENDAR_DISABLED' using errcode='42501';
  end if;
exception when insufficient_privilege then
  if sqlerrm='MODULE_CAPABILITY_FORBIDDEN' then raise exception 'CALENDAR_FORBIDDEN' using errcode='42501'; end if;
  raise;
end;
$f$;
revoke all on function private.assert_calendar_mutation(uuid) from public,anon,authenticated,service_role;

-- One statement reads the header, revision and assignment set from one MVCC
-- snapshot. No second request can combine an old header with new assignments.
create function private.calendar_event_snapshot(p_company_id uuid,p_event_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare v_result jsonb; v_conflict boolean;
begin
  select jsonb_build_object('event',jsonb_build_object('id',e.id,'company_id',e.company_id,
      'title',e.title,'description',e.description,'start_at',coalesce(e.start_at,e.starts_at),
      'end_at',coalesce(e.end_at,e.ends_at),'job_id',e.job_id,'revision',e.revision::text),
      'assigned_profile_ids',coalesce(a.ids,'[]'::jsonb)),
    (e.start_at is not null and e.starts_at is not null and e.start_at<>e.starts_at)
      or (e.end_at is not null and e.ends_at is not null and e.end_at<>e.ends_at)
      or coalesce(a.conflict,false)
  into v_result,v_conflict from public.calendar_events e
  cross join lateral(select jsonb_agg(x.profile_id order by x.profile_id) ids,
    bool_or(x.company_id is distinct from e.company_id or
      (x.event_id is not null and x.calendar_event_id is not null and x.event_id<>x.calendar_event_id)) conflict
    from public.calendar_event_assignments x where x.event_id=e.id or x.calendar_event_id=e.id) a
  where e.company_id=p_company_id and e.id=p_event_id;
  if v_result is null then raise exception 'CALENDAR_NOT_FOUND' using errcode='P0002'; end if;
  if v_conflict then raise exception 'CALENDAR_ALIAS_CONFLICT' using errcode='23514'; end if;
  return v_result;
end;
$f$;
revoke all on function private.calendar_event_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

create function private.get_calendar_event_snapshot(p_company_id uuid,p_event_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare v_result jsonb;
begin
  perform private.calendar_actor(p_company_id);
  v_result:=private.calendar_event_snapshot(p_company_id,p_event_id);
  perform private.calendar_actor(p_company_id);
  return v_result;
end;
$f$;

-- Normalize only supplied input, never historical rows. Explicit JSON types and
-- timezone suffixes prevent browser or SQL callers from silently coercing data.
create function private.calendar_input(p_input jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $f$
declare v_title text; v_description text; v_start timestamptz; v_end timestamptz; v_job uuid; v_ids uuid[];
begin
  if jsonb_typeof(p_input) is distinct from 'object' or
    jsonb_typeof(p_input->'title') is distinct from 'string' or
    jsonb_typeof(p_input->'start_at') is distinct from 'string' or
    jsonb_typeof(p_input->'end_at') is distinct from 'string' or
    jsonb_typeof(p_input->'assigned_profile_ids') is distinct from 'array' or
    (p_input ? 'description' and jsonb_typeof(p_input->'description') not in ('string','null')) or
    (p_input ? 'job_id' and jsonb_typeof(p_input->'job_id') not in ('string','null')) then
    raise exception 'CALENDAR_INPUT_INVALID' using errcode='22023';
  end if;
  v_title:=btrim(p_input->>'title'); v_description:=nullif(btrim(p_input->>'description'),'');
  if length(v_title) not between 1 and 300 or length(coalesce(v_description,''))>10000
    or jsonb_array_length(p_input->'assigned_profile_ids')>500
    or exists(select 1 from jsonb_array_elements(p_input->'assigned_profile_ids') x where jsonb_typeof(x)<>'string')
    or (p_input->>'start_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
    or (p_input->>'end_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'CALENDAR_INPUT_INVALID' using errcode='22023';
  end if;
  v_start:=(p_input->>'start_at')::timestamptz; v_end:=(p_input->>'end_at')::timestamptz;
  v_job:=nullif(p_input->>'job_id','')::uuid;
  select coalesce(array_agg(distinct x::uuid order by x::uuid),'{}'::uuid[]) into v_ids
    from jsonb_array_elements_text(p_input->'assigned_profile_ids') x;
  if cardinality(v_ids)<>jsonb_array_length(p_input->'assigned_profile_ids') or not isfinite(v_start) or not isfinite(v_end)
    or v_start<'1900-01-01T00:00:00Z'::timestamptz or v_end>='10000-01-01T00:00:00Z'::timestamptz or v_end<=v_start then
    raise exception 'CALENDAR_INPUT_INVALID' using errcode='22023';
  end if;
  return jsonb_build_object('title',v_title,'description',v_description,'start_at',v_start,'end_at',v_end,
    'job_id',v_job,'assigned_profile_ids',to_jsonb(v_ids));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  raise exception 'CALENDAR_INPUT_INVALID' using errcode='22023';
end;
$f$;
revoke all on function private.calendar_input(jsonb) from public,anon,authenticated,service_role;

-- Lock every referenced profile/membership, not just their foreign-key IDs;
-- removing a worker or deactivating their profile cannot race this assignment.
create function private.lock_calendar_scope(p_company_id uuid,p_job_id uuid,p_profile_ids uuid[])
returns void language plpgsql volatile security definer set search_path='' as $f$
declare v_count integer;
begin
  if p_job_id is not null then
    perform 1 from public.jobs j where j.id=p_job_id and j.company_id=p_company_id for share;
    if not found then raise exception 'CALENDAR_SCOPE_INVALID' using errcode='23514'; end if;
  end if;
  perform p.id from public.profiles p where p.id=any(p_profile_ids) order by p.id for share;
  perform cm.profile_id from public.company_members cm where cm.company_id=p_company_id
    and cm.profile_id=any(p_profile_ids) order by cm.profile_id for share;
  select count(*) into v_count from public.profiles p join public.company_members cm on cm.profile_id=p.id
    where cm.company_id=p_company_id and p.id=any(p_profile_ids) and p.is_active and cm.is_active;
  if v_count<>cardinality(p_profile_ids) then raise exception 'CALENDAR_SCOPE_INVALID' using errcode='23514'; end if;
end;
$f$;
revoke all on function private.lock_calendar_scope(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;

create function private.create_calendar_event_atomic(p_company_id uuid,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare v_input jsonb; v_event uuid; v_job uuid; v_ids uuid[]; v_result jsonb;
begin
  perform private.calendar_actor(p_company_id);
  v_input:=private.calendar_input(p_input); v_job:=(v_input->>'job_id')::uuid;
  select coalesce(array_agg(x::uuid),'{}'::uuid[]) into v_ids from jsonb_array_elements_text(v_input->'assigned_profile_ids') x;
  perform private.lock_calendar_scope(p_company_id,v_job,v_ids);
  perform private.assert_calendar_mutation(p_company_id);
  insert into public.calendar_events(company_id,title,description,start_at,starts_at,end_at,ends_at,job_id)
    values(p_company_id,v_input->>'title',v_input->>'description',(v_input->>'start_at')::timestamptz,
      (v_input->>'start_at')::timestamptz,(v_input->>'end_at')::timestamptz,(v_input->>'end_at')::timestamptz,v_job)
    returning id into v_event;
  insert into public.calendar_event_assignments(company_id,event_id,calendar_event_id,profile_id)
    select p_company_id,v_event,v_event,x from unnest(v_ids) x;
  v_result:=private.calendar_event_snapshot(p_company_id,v_event);
  perform private.assert_calendar_mutation(p_company_id);
  return v_result;
end;
$f$;

create function private.update_calendar_event_atomic(p_company_id uuid,p_event_id uuid,p_expected_revision bigint,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare v_input jsonb; v_event public.calendar_events%rowtype; v_job uuid; v_ids uuid[]; v_before jsonb; v_result jsonb;
begin
  perform private.calendar_actor(p_company_id);
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'CALENDAR_INPUT_INVALID' using errcode='22023'; end if;
  v_input:=private.calendar_input(p_input); v_job:=(v_input->>'job_id')::uuid;
  select coalesce(array_agg(x::uuid),'{}'::uuid[]) into v_ids from jsonb_array_elements_text(v_input->'assigned_profile_ids') x;
  perform private.lock_calendar_scope(p_company_id,v_job,v_ids);
  perform 1 from public.calendar_event_assignments a where a.company_id=p_company_id and (a.event_id=p_event_id or a.calendar_event_id=p_event_id) order by a.id for update;
  select * into v_event from public.calendar_events e where e.company_id=p_company_id and e.id=p_event_id for update;
  if not found then raise exception 'CALENDAR_NOT_FOUND' using errcode='P0002'; end if;
  perform private.calendar_actor(p_company_id);
  if v_event.revision<>p_expected_revision then raise exception 'CALENDAR_STALE' using errcode='PT409'; end if;
  v_before:=private.calendar_event_snapshot(p_company_id,p_event_id);
  perform private.assert_calendar_mutation(p_company_id);
  if ((v_before->'event') - 'id' - 'company_id' - 'revision')=(v_input-'assigned_profile_ids')
    and v_before->'assigned_profile_ids'=v_input->'assigned_profile_ids'
    and v_event.start_at is not distinct from v_event.starts_at and v_event.end_at is not distinct from v_event.ends_at then
    perform private.assert_calendar_mutation(p_company_id);
    return v_before;
  end if;
  update public.calendar_events set title=v_input->>'title',description=v_input->>'description',
    start_at=(v_input->>'start_at')::timestamptz,starts_at=(v_input->>'start_at')::timestamptz,
    end_at=(v_input->>'end_at')::timestamptz,ends_at=(v_input->>'end_at')::timestamptz,
    job_id=v_job,updated_at=clock_timestamp() where company_id=p_company_id and id=p_event_id;
  delete from public.calendar_event_assignments a where (a.event_id=p_event_id or a.calendar_event_id=p_event_id)
    and not (a.profile_id=any(v_ids));
  -- A retained historical assignment keeps its ID and creation timestamp.
  update public.calendar_event_assignments a set event_id=p_event_id,calendar_event_id=p_event_id
    where (a.event_id=p_event_id or a.calendar_event_id=p_event_id) and (a.event_id is null or a.calendar_event_id is null);
  insert into public.calendar_event_assignments(company_id,event_id,calendar_event_id,profile_id)
    select p_company_id,p_event_id,p_event_id,x from unnest(v_ids) x where not exists(
      select 1 from public.calendar_event_assignments a where coalesce(a.event_id,a.calendar_event_id)=p_event_id and a.profile_id=x);
  v_result:=private.calendar_event_snapshot(p_company_id,p_event_id);
  perform private.assert_calendar_mutation(p_company_id);
  return v_result;
end;
$f$;

create function private.delete_calendar_event_atomic(p_company_id uuid,p_event_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare v_event public.calendar_events%rowtype;
begin
  perform private.calendar_actor(p_company_id);
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'CALENDAR_INPUT_INVALID' using errcode='22023'; end if;
  perform 1 from public.calendar_event_assignments a where a.company_id=p_company_id and (a.event_id=p_event_id or a.calendar_event_id=p_event_id) order by a.id for update;
  select * into v_event from public.calendar_events e where e.company_id=p_company_id and e.id=p_event_id for update;
  if not found then raise exception 'CALENDAR_NOT_FOUND' using errcode='P0002'; end if;
  perform private.calendar_actor(p_company_id);
  if v_event.revision<>p_expected_revision then raise exception 'CALENDAR_STALE' using errcode='PT409'; end if;
  perform private.calendar_event_snapshot(p_company_id,p_event_id);
  perform private.assert_calendar_mutation(p_company_id);
  delete from public.calendar_event_assignments a where a.event_id=p_event_id or a.calendar_event_id=p_event_id;
  delete from public.calendar_events e where e.company_id=p_company_id and e.id=p_event_id;
  perform private.assert_calendar_mutation(p_company_id);
  return jsonb_build_object('eventId',p_event_id,'deleted',true);
end;
$f$;

-- All elevated functions stay in the non-exposed schema. Only these four
-- authenticated invoker wrappers are API endpoints; helpers remain private.
revoke all on function private.get_calendar_event_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.create_calendar_event_atomic(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.update_calendar_event_atomic(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.delete_calendar_event_atomic(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function private.get_calendar_event_snapshot(uuid,uuid),private.create_calendar_event_atomic(uuid,jsonb),
  private.update_calendar_event_atomic(uuid,uuid,bigint,jsonb),private.delete_calendar_event_atomic(uuid,uuid,bigint) to authenticated;
create function public.get_calendar_event_snapshot(p_company_id uuid,p_event_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $f$
  select private.get_calendar_event_snapshot(p_company_id,p_event_id);
$f$;
create function public.create_calendar_event_atomic(p_company_id uuid,p_input jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $f$
  select private.create_calendar_event_atomic(p_company_id,p_input);
$f$;
create function public.update_calendar_event_atomic(p_company_id uuid,p_event_id uuid,p_expected_revision bigint,p_input jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $f$
  select private.update_calendar_event_atomic(p_company_id,p_event_id,p_expected_revision,p_input);
$f$;
create function public.delete_calendar_event_atomic(p_company_id uuid,p_event_id uuid,p_expected_revision bigint)
returns jsonb language sql volatile security invoker set search_path='' as $f$
  select private.delete_calendar_event_atomic(p_company_id,p_event_id,p_expected_revision);
$f$;
revoke all on function public.get_calendar_event_snapshot(uuid,uuid),public.create_calendar_event_atomic(uuid,jsonb),
  public.update_calendar_event_atomic(uuid,uuid,bigint,jsonb),public.delete_calendar_event_atomic(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.get_calendar_event_snapshot(uuid,uuid),public.create_calendar_event_atomic(uuid,jsonb),
  public.update_calendar_event_atomic(uuid,uuid,bigint,jsonb),public.delete_calendar_event_atomic(uuid,uuid,bigint) to authenticated;
