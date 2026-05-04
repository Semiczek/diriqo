create or replace view public.job_economics_summary as
with assignment_rates as (
  select
    ja.job_id,
    ja.profile_id,
    max(nullif(ja.hourly_rate, 0)) as hourly_rate
  from public.job_assignments ja
  group by ja.job_id, ja.profile_id
),
shift_summary as (
  select
    ws.job_id,
    sum(
      case
        when ws.job_hours_override is not null then ws.job_hours_override
        when ws.hours_override is not null then ws.hours_override
        when ws.started_at is not null
          and ws.ended_at is not null
          and ws.ended_at > ws.started_at
        then extract(epoch from (ws.ended_at - ws.started_at)) / 3600.0
        else 0
      end
    )::numeric(12, 2) as labor_hours_total,
    sum(
      (
        case
          when ws.job_hours_override is not null then ws.job_hours_override
          when ws.hours_override is not null then ws.hours_override
          when ws.started_at is not null
            and ws.ended_at is not null
            and ws.ended_at > ws.started_at
          then extract(epoch from (ws.ended_at - ws.started_at)) / 3600.0
          else 0
        end
      ) * coalesce(ar.hourly_rate, p.default_hourly_rate, 0)
    )::numeric(12, 2) as labor_cost_total
  from public.work_shifts ws
  left join assignment_rates ar
    on ar.job_id = ws.job_id
   and ar.profile_id = ws.profile_id
  left join public.profiles p on p.id = ws.profile_id
  where ws.job_id is not null
  group by ws.job_id
),
assignment_summary as (
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
      ) * coalesce(nullif(ja.hourly_rate, 0), p.default_hourly_rate, 0)
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
  coalesce(s.labor_hours_total, a.labor_hours_total, 0::numeric) as labor_hours_total,
  coalesce(s.labor_cost_total, a.labor_cost_total, 0::numeric) as labor_cost_total,
  coalesce(c.other_cost_total, 0::numeric) as other_cost_total
from public.jobs j
left join shift_summary s on s.job_id = j.id
left join assignment_summary a on a.job_id = j.id
left join cost_summary c on c.job_id = j.id;

alter view public.job_economics_summary set (security_invoker = true);

create or replace view public.worker_job_assignment_summary as
with shift_summary as (
  select
    ja.id as assignment_id,
    sum(
      case
        when ws.job_hours_override is not null then ws.job_hours_override
        when ws.hours_override is not null then ws.hours_override
        when ws.started_at is not null
          and ws.ended_at is not null
          and ws.ended_at > ws.started_at
        then extract(epoch from (ws.ended_at - ws.started_at)) / 3600.0
        else 0
      end
    )::numeric(12, 2) as labor_hours_total
  from public.job_assignments ja
  join public.work_shifts ws
    on ws.job_id = ja.job_id
   and ws.profile_id = ja.profile_id
  group by ja.id
)
select
  ja.id as assignment_id,
  ja.job_id,
  ja.profile_id,
  coalesce(
    ss.labor_hours_total,
    (
      case
        when coalesce(ja.labor_hours, 0) > 0 then ja.labor_hours
        when ja.work_started_at is not null
          and ja.work_completed_at is not null
          and ja.work_completed_at > ja.work_started_at
        then extract(epoch from (ja.work_completed_at - ja.work_started_at)) / 3600.0
        else 0
      end
    )
  )::numeric(12, 2) as labor_hours_total,
  coalesce(nullif(ja.hourly_rate, 0), p.default_hourly_rate, 0)::numeric(12, 2) as effective_hourly_rate,
  (
    coalesce(
      ss.labor_hours_total,
      (
        case
          when coalesce(ja.labor_hours, 0) > 0 then ja.labor_hours
          when ja.work_started_at is not null
            and ja.work_completed_at is not null
            and ja.work_completed_at > ja.work_started_at
          then extract(epoch from (ja.work_completed_at - ja.work_started_at)) / 3600.0
          else 0
        end
      )
    ) * coalesce(nullif(ja.hourly_rate, 0), p.default_hourly_rate, 0)
  )::numeric(12, 2) as labor_cost_total
from public.job_assignments ja
left join shift_summary ss on ss.assignment_id = ja.id
left join public.profiles p on p.id = ja.profile_id;

alter view public.worker_job_assignment_summary set (security_invoker = true);
