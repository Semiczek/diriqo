create or replace view public.job_economics_summary as
with assignment_summary as (
  select
    ja.job_id,
    sum(
      case
        when coalesce(ja.labor_hours, 0) > 0 then ja.labor_hours
        when ja.work_started_at is not null
          and ja.work_completed_at is not null
          and ja.work_completed_at > ja.work_started_at
        then extract(epoch from (ja.work_completed_at - ja.work_started_at)) / 3600.0
        else 0
      end
    )::numeric(12, 2) as labor_hours_total,
    sum(
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
  left join public.profiles p on p.id = ja.profile_id
  group by ja.job_id
),
cost_summary as (
  select
    jci.job_id,
    sum(
      coalesce(
        jci.total_price,
        coalesce(jci.quantity, 0) * coalesce(jci.unit_price, 0)
      )
    )::numeric(12, 2) as other_cost_total
  from public.job_cost_items jci
  group by jci.job_id
)
select
  j.id as job_id,
  coalesce(a.labor_hours_total, 0::numeric) as labor_hours_total,
  coalesce(a.labor_cost_total, 0::numeric) as labor_cost_total,
  coalesce(c.other_cost_total, 0::numeric) as other_cost_total
from public.jobs j
left join assignment_summary a on a.job_id = j.id
left join cost_summary c on c.job_id = j.id;

alter view public.job_economics_summary set (security_invoker = true);
