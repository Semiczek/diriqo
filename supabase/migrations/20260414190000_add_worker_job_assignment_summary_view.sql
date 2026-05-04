create or replace view public.worker_job_assignment_summary as
select
  ja.id as assignment_id,
  ja.job_id,
  ja.profile_id,
  (
    case
      when coalesce(ja.labor_hours, 0) > 0 then ja.labor_hours
      when ja.work_started_at is not null
        and ja.work_completed_at is not null
        and ja.work_completed_at > ja.work_started_at
      then extract(epoch from (ja.work_completed_at - ja.work_started_at)) / 3600.0
      else 0
    end
  )::numeric(12, 2) as labor_hours_total,
  (
    case
      when coalesce(ja.hourly_rate, 0) > 0 then ja.hourly_rate
      when coalesce(p.default_hourly_rate, 0) > 0 then p.default_hourly_rate
      else 0
    end
  )::numeric(12, 2) as effective_hourly_rate,
  (
    (
      case
        when coalesce(ja.labor_hours, 0) > 0 then ja.labor_hours
        when ja.work_started_at is not null
          and ja.work_completed_at is not null
          and ja.work_completed_at > ja.work_started_at
        then extract(epoch from (ja.work_completed_at - ja.work_started_at)) / 3600.0
        else 0
      end
    ) * (
      case
        when coalesce(ja.hourly_rate, 0) > 0 then ja.hourly_rate
        when coalesce(p.default_hourly_rate, 0) > 0 then p.default_hourly_rate
        else 0
      end
    )
  )::numeric(12, 2) as labor_cost_total
from public.job_assignments ja
left join public.profiles p on p.id = ja.profile_id;

alter view public.worker_job_assignment_summary set (security_invoker = true);
