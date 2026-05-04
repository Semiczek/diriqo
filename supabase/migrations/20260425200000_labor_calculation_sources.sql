-- REVIEW BEFORE RUNNING IN SUPABASE SQL EDITOR
-- Unified labor calculation source:
-- - shift: real work_shift time
-- - manual_override: shift override hours
-- - assignment_fallback: job_assignment fallback only when no matching worker+job shift exists

create or replace view public.job_labor_calculation_rows as
with assignment_rates as (
  select
    ja.job_id,
    ja.profile_id,
    max(nullif(ja.hourly_rate, 0)) as hourly_rate
  from public.job_assignments ja
  group by ja.job_id, ja.profile_id
),
shift_rows as (
  select
    ws.job_id,
    ws.profile_id,
    null::uuid as assignment_id,
    ws.id as work_shift_id,
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
    )::numeric(12, 2) as labor_hours,
    coalesce(ar.hourly_rate, p.default_hourly_rate, 0)::numeric(12, 2) as hourly_rate,
    case
      when ws.job_hours_override is not null or ws.hours_override is not null then 'manual_override'
      else 'shift'
    end as calculation_source
  from public.work_shifts ws
  left join assignment_rates ar
    on ar.job_id = ws.job_id
   and ar.profile_id = ws.profile_id
  left join public.profiles p on p.id = ws.profile_id
  where ws.job_id is not null
),
assignment_fallback_rows as (
  select
    ja.job_id,
    ja.profile_id,
    ja.id as assignment_id,
    null::uuid as work_shift_id,
    (
      case
        when coalesce(ja.labor_hours, 0) > 0 then ja.labor_hours
        when ja.work_started_at is not null
          and ja.work_completed_at is not null
          and ja.work_completed_at > ja.work_started_at
        then extract(epoch from (ja.work_completed_at - ja.work_started_at)) / 3600.0
        else 0
      end
    )::numeric(12, 2) as labor_hours,
    coalesce(nullif(ja.hourly_rate, 0), p.default_hourly_rate, 0)::numeric(12, 2) as hourly_rate,
    'assignment_fallback' as calculation_source
  from public.job_assignments ja
  left join public.profiles p on p.id = ja.profile_id
  where not exists (
    select 1
    from public.work_shifts ws
    where ws.job_id = ja.job_id
      and ws.profile_id = ja.profile_id
  )
)
select
  job_id,
  profile_id,
  assignment_id,
  work_shift_id,
  labor_hours,
  hourly_rate,
  (labor_hours * hourly_rate)::numeric(12, 2) as labor_cost,
  calculation_source
from shift_rows
where labor_hours > 0
union all
select
  job_id,
  profile_id,
  assignment_id,
  work_shift_id,
  labor_hours,
  hourly_rate,
  (labor_hours * hourly_rate)::numeric(12, 2) as labor_cost,
  calculation_source
from assignment_fallback_rows
where labor_hours > 0;

alter view public.job_labor_calculation_rows set (security_invoker = true);

create or replace view public.job_economics_summary as
with labor_summary as (
  select
    job_id,
    sum(labor_hours)::numeric(12, 2) as labor_hours_total,
    sum(labor_cost)::numeric(12, 2) as labor_cost_total,
    case
      when bool_or(calculation_source = 'shift') then 'shift'
      when bool_or(calculation_source = 'manual_override') then 'manual_override'
      when bool_or(calculation_source = 'assignment_fallback') then 'assignment_fallback'
      else null
    end as labor_source
  from public.job_labor_calculation_rows
  group by job_id
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
  coalesce(l.labor_hours_total, 0::numeric) as labor_hours_total,
  coalesce(l.labor_cost_total, 0::numeric) as labor_cost_total,
  coalesce(c.other_cost_total, 0::numeric) as other_cost_total,
  l.labor_source
from public.jobs j
left join labor_summary l on l.job_id = j.id
left join cost_summary c on c.job_id = j.id;

alter view public.job_economics_summary set (security_invoker = true);

create or replace view public.worker_job_assignment_summary as
select
  ja.id as assignment_id,
  ja.job_id,
  ja.profile_id,
  coalesce(sum(l.labor_hours), 0::numeric)::numeric(12, 2) as labor_hours_total,
  coalesce(max(l.hourly_rate), coalesce(nullif(ja.hourly_rate, 0), p.default_hourly_rate, 0), 0)::numeric(12, 2) as effective_hourly_rate,
  coalesce(sum(l.labor_cost), 0::numeric)::numeric(12, 2) as labor_cost_total,
  case
    when bool_or(l.calculation_source = 'shift') then 'shift'
    when bool_or(l.calculation_source = 'manual_override') then 'manual_override'
    when bool_or(l.calculation_source = 'assignment_fallback') then 'assignment_fallback'
    else 'assignment_fallback'
  end as calculation_source
from public.job_assignments ja
left join public.job_labor_calculation_rows l
  on l.job_id = ja.job_id
 and l.profile_id = ja.profile_id
left join public.profiles p on p.id = ja.profile_id
group by ja.id, ja.job_id, ja.profile_id, ja.hourly_rate, p.default_hourly_rate;

alter view public.worker_job_assignment_summary set (security_invoker = true);
