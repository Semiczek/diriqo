-- REVIEW BEFORE RUNNING IN SUPABASE SQL EDITOR
-- Keep job economics calculations in one database view.

create or replace view public.job_economics_summary as
with labor_summary as (
  select
    job_id,
    sum(labor_hours)::numeric as labor_hours_total,
    sum(labor_cost)::numeric as labor_cost_total,
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
    )::numeric as other_cost_total
  from public.job_cost_items jci
  group by jci.job_id
),
base as (
  select
    j.id as job_id,
    coalesce(l.labor_hours_total, 0::numeric) as labor_hours_total,
    coalesce(l.labor_cost_total, 0::numeric) as labor_cost_total,
    coalesce(c.other_cost_total, 0::numeric) as other_cost_total,
    l.labor_source,
    coalesce(j.price, 0::numeric) as revenue_total
  from public.jobs j
  left join labor_summary l on l.job_id = j.id
  left join cost_summary c on c.job_id = j.id
)
select
  job_id,
  labor_hours_total,
  labor_cost_total,
  other_cost_total,
  labor_source,
  revenue_total,
  labor_cost_total + other_cost_total as total_cost_total,
  revenue_total - labor_cost_total - other_cost_total as profit_total,
  case
    when revenue_total = 0 then null
    else round(((revenue_total - labor_cost_total - other_cost_total) / revenue_total) * 100, 2)
  end as margin_percent
from base;

alter view public.job_economics_summary set (security_invoker = true);
