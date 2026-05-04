alter table public.work_shifts
add column if not exists job_hours_override numeric null;

create or replace function public.sync_job_assignment_from_shifts(
  p_job_id uuid,
  p_profile_id uuid
)
returns void
language plpgsql
as $$
declare
  total_hours numeric;
  existing_assignment_id uuid;
begin
  if p_job_id is null or p_profile_id is null then
    return;
  end if;

  select
    round(
      coalesce(
        sum(
          case
            when ws.job_hours_override is not null then ws.job_hours_override
            else 0
          end
        ),
        0
      )::numeric,
      2
    )
  into total_hours
  from public.work_shifts ws
  where ws.job_id = p_job_id
    and ws.profile_id = p_profile_id;

  select ja.id
  into existing_assignment_id
  from public.job_assignments ja
  where ja.job_id = p_job_id
    and ja.profile_id = p_profile_id
  order by ja.id
  limit 1;

  if existing_assignment_id is null then
    if total_hours > 0 then
      insert into public.job_assignments (
        job_id,
        profile_id,
        labor_hours
      ) values (
        p_job_id,
        p_profile_id,
        total_hours
      );
    end if;
  else
    update public.job_assignments
    set labor_hours = case when total_hours > 0 then total_hours else null end
    where id = existing_assignment_id;
  end if;
end;
$$;

create or replace function public.handle_work_shift_assignment_sync()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.sync_job_assignment_from_shifts(old.job_id, old.profile_id);
  end if;

  if tg_op <> 'DELETE' then
    perform public.sync_job_assignment_from_shifts(new.job_id, new.profile_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_work_shifts_sync_job_assignments on public.work_shifts;

create trigger trg_work_shifts_sync_job_assignments
after insert or update or delete
on public.work_shifts
for each row
execute function public.handle_work_shift_assignment_sync();

do $$
declare
  shift_row record;
begin
  for shift_row in
    select distinct ws.job_id, ws.profile_id
    from public.work_shifts ws
    where ws.job_id is not null
      and ws.profile_id is not null
  loop
    perform public.sync_job_assignment_from_shifts(shift_row.job_id, shift_row.profile_id);
  end loop;
end;
$$;
