-- REVIEW BEFORE RUNNING IN SUPABASE SQL EDITOR
-- Backfills advance_requests.payroll_month for older rows.
--
-- Payroll month rule:
-- - paid_at is the primary date for paid advances
-- - fallback: approved_at, reviewed_at, requested_at, created_at
-- - dates from the 19th onward belong to the next payroll month
-- - dates from the 1st through 18th belong to the same payroll month
--
-- This script only fills NULL payroll_month values.

with source_dates as (
  select
    ar.id,
    coalesce(ar.paid_at, ar.approved_at, ar.reviewed_at, ar.requested_at, ar.created_at) as effective_at
  from public.advance_requests ar
  where ar.payroll_month is null
),
calculated_months as (
  select
    id,
    case
      when effective_at is null then null
      when extract(day from (effective_at at time zone 'Europe/Prague')) >= 19 then
        date_trunc('month', (effective_at at time zone 'Europe/Prague') + interval '1 month')::date
      else
        date_trunc('month', effective_at at time zone 'Europe/Prague')::date
    end as payroll_month
  from source_dates
)
update public.advance_requests ar
set payroll_month = cm.payroll_month
from calculated_months cm
where ar.id = cm.id
  and ar.payroll_month is null
  and cm.payroll_month is not null;

-- Optional check after running:
-- select status, payroll_month, count(*), sum(coalesce(amount, requested_amount, 0))
-- from public.advance_requests
-- group by status, payroll_month
-- order by payroll_month desc, status;
