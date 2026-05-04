-- Propagate app shift check-ins to the explicitly selected job.
-- Mobile attendance writes to work_shifts. Job state and job detail read job_assignments.

create or replace function public.sync_shift_arrival_to_assigned_jobs(
  p_shift_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  shift_row record;
begin
  select
    ws.id,
    ws.profile_id,
    ws.job_id,
    ws.shift_date,
    ws.started_at,
    ws.ended_at
  into shift_row
  from public.work_shifts ws
  where ws.id = p_shift_id;

  if shift_row.id is null or shift_row.profile_id is null or shift_row.job_id is null then
    return;
  end if;

  if shift_row.started_at is null and shift_row.ended_at is null then
    return;
  end if;

  update public.job_assignments ja
  set
    work_started_at =
      case
        when shift_row.started_at is null then ja.work_started_at
        when ja.work_started_at is null then shift_row.started_at
        when shift_row.started_at < ja.work_started_at then shift_row.started_at
        else ja.work_started_at
      end,
    work_completed_at =
      case
        when shift_row.ended_at is null then ja.work_completed_at
        when ja.work_completed_at is null then shift_row.ended_at
        when shift_row.ended_at > ja.work_completed_at then shift_row.ended_at
        else ja.work_completed_at
      end
  where ja.job_id = shift_row.job_id
    and ja.profile_id = shift_row.profile_id
    and ja.archived_at is null
    and ja.job_id = shift_row.job_id;
end;
$$;

create or replace function public.handle_shift_arrival_assignment_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'DELETE' then
    perform public.sync_shift_arrival_to_assigned_jobs(new.id);
    return new;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_work_shifts_sync_arrivals_to_assignments on public.work_shifts;

create trigger trg_work_shifts_sync_arrivals_to_assignments
after insert or update of profile_id, job_id, shift_date, started_at, ended_at
on public.work_shifts
for each row
execute function public.handle_shift_arrival_assignment_sync();

do $$
declare
  shift_row record;
begin
  for shift_row in
    select id
    from public.work_shifts
    where job_id is not null
      and (
        started_at is not null
        or ended_at is not null
      )
  loop
    perform public.sync_shift_arrival_to_assigned_jobs(shift_row.id);
  end loop;
end;
$$;
