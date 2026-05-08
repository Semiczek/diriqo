-- Block H: accounting-first job economics.
-- Revenue is sourced from invoices/invoice_items; jobs.price remains quoted/planned value.

alter table public.invoice_items
  add column if not exists source_job_id uuid null references public.jobs(id) on delete set null;

create index if not exists invoice_items_source_job_idx
  on public.invoice_items(source_job_id)
  where source_job_id is not null;

create table if not exists public.job_economics_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  actor_profile_id uuid null references public.profiles(id) on delete set null,
  event_type text not null,
  before_value jsonb not null default '{}'::jsonb,
  after_value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.job_economics_audit_events enable row level security;

create index if not exists job_economics_audit_events_company_job_idx
  on public.job_economics_audit_events(company_id, job_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'job_economics_audit_events'
      and policyname = 'job_economics_audit_events_select_admin'
  ) then
    create policy job_economics_audit_events_select_admin
      on public.job_economics_audit_events
      for select
      to authenticated
      using (public.is_company_admin(company_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'job_economics_audit_events'
      and policyname = 'job_economics_audit_events_insert_admin'
  ) then
    create policy job_economics_audit_events_insert_admin
      on public.job_economics_audit_events
      for insert
      to authenticated
      with check (
        public.is_company_admin(company_id)
        and actor_profile_id = public.current_profile_id()
      );
  end if;
end $$;

create or replace view public.job_economics_summary
with (security_invoker = true) as
with shift_labor as (
  select
    ws.job_id,
    coalesce(sum(coalesce(ws.job_hours_override, ws.hours_override, extract(epoch from (ws.ended_at - ws.started_at)) / 3600.0, 0)), 0)::numeric(12, 2) as labor_hours_total,
    coalesce(sum(
      case when coalesce(p.worker_type, 'employee') = 'contractor' then 0 else
        coalesce(ws.job_hours_override, ws.hours_override, extract(epoch from (ws.ended_at - ws.started_at)) / 3600.0, 0)
        * coalesce(nullif(ws.hourly_rate, 0), nullif(p.default_hourly_rate, 0), nullif(p.hourly_rate, 0), 0)
      end
    ), 0)::numeric(12, 2) as internal_labor_cost_total,
    coalesce(sum(
      case when coalesce(p.worker_type, 'employee') = 'contractor' then
        coalesce(ws.job_hours_override, ws.hours_override, extract(epoch from (ws.ended_at - ws.started_at)) / 3600.0, 0)
        * coalesce(nullif(ws.hourly_rate, 0), nullif(p.contractor_default_rate, 0), nullif(p.default_hourly_rate, 0), nullif(p.hourly_rate, 0), 0)
      else 0 end
    ), 0)::numeric(12, 2) as external_labor_cost_total
  from public.work_shifts ws
  left join public.profiles p on p.id = ws.profile_id
  where ws.job_id is not null
  group by ws.job_id
),
log_labor as (
  select
    wl.job_id,
    coalesce(sum(coalesce(nullif(wl.hours, 0), extract(epoch from (wl.ended_at - wl.started_at)) / 3600.0, 0)), 0)::numeric(12, 2) as labor_hours_total,
    coalesce(sum(
      case when coalesce(p.worker_type, 'employee') = 'contractor' then 0 else
        coalesce(nullif(wl.hours, 0), extract(epoch from (wl.ended_at - wl.started_at)) / 3600.0, 0)
        * coalesce(nullif(p.default_hourly_rate, 0), nullif(p.hourly_rate, 0), 0)
      end
    ), 0)::numeric(12, 2) as internal_labor_cost_total,
    coalesce(sum(
      case when coalesce(p.worker_type, 'employee') = 'contractor' then
        coalesce(nullif(wl.hours, 0), extract(epoch from (wl.ended_at - wl.started_at)) / 3600.0, 0)
        * coalesce(nullif(p.contractor_default_rate, 0), nullif(p.default_hourly_rate, 0), nullif(p.hourly_rate, 0), 0)
      else 0 end
    ), 0)::numeric(12, 2) as external_labor_cost_total
  from public.work_logs wl
  left join public.profiles p on p.id = wl.profile_id
  where wl.job_id is not null
    and wl.archived_at is null
    and not exists (
      select 1
      from public.work_shifts ws
      where ws.job_id = wl.job_id
        and ws.profile_id = wl.profile_id
    )
  group by wl.job_id
),
assignment_labor as (
  select
    ja.job_id,
    coalesce(sum(coalesce(ja.labor_hours, 0)), 0)::numeric(12, 2) as labor_hours_total,
    coalesce(sum(
      case when coalesce(ja.worker_type_snapshot, p.worker_type, 'employee') = 'contractor' then 0 else
        coalesce(ja.labor_hours, 0)
        * coalesce(nullif(ja.hourly_rate, 0), nullif(p.default_hourly_rate, 0), nullif(p.hourly_rate, 0), 0)
      end
    ), 0)::numeric(12, 2) as internal_labor_cost_total,
    coalesce(sum(
      case when coalesce(ja.worker_type_snapshot, p.worker_type, 'employee') = 'contractor' then
        case
          when coalesce(ja.assignment_billing_type, p.contractor_billing_type, 'hourly') <> 'hourly'
            and ja.external_amount is not null
          then ja.external_amount
          else coalesce(ja.labor_hours, 0)
            * coalesce(nullif(ja.hourly_rate, 0), nullif(p.contractor_default_rate, 0), nullif(p.default_hourly_rate, 0), nullif(p.hourly_rate, 0), 0)
        end
      else 0 end
    ), 0)::numeric(12, 2) as external_labor_cost_total
  from public.job_assignments ja
  left join public.profiles p on p.id = ja.profile_id
  where ja.archived_at is null
    and not exists (
      select 1
      from public.work_shifts ws
      where ws.job_id = ja.job_id
        and ws.profile_id = ja.profile_id
    )
    and not exists (
      select 1
      from public.work_logs wl
      where wl.job_id = ja.job_id
        and wl.profile_id = ja.profile_id
        and wl.archived_at is null
    )
  group by ja.job_id
),
labor as (
  select
    job_id,
    sum(labor_hours_total)::numeric(12, 2) as labor_hours_total,
    sum(internal_labor_cost_total)::numeric(12, 2) as internal_labor_cost_total,
    sum(external_labor_cost_total)::numeric(12, 2) as external_labor_cost_total
  from (
    select * from shift_labor
    union all
    select * from log_labor
    union all
    select * from assignment_labor
  ) source
  group by job_id
),
direct_costs as (
  select
    jci.job_id,
    coalesce(sum(coalesce(nullif(jci.total_price, 0), jci.quantity * jci.unit_price, 0)), 0)::numeric(12, 2) as other_cost_total
  from public.job_cost_items jci
  group by jci.job_id
),
invoice_item_revenue as (
  select
    ii.source_job_id as job_id,
    coalesce(sum(coalesce(nullif(ii.total_without_vat, 0), nullif(ii.total_price, 0), ii.total_with_vat, 0)), 0)::numeric(12, 2) as revenue_total
  from public.invoice_items ii
  join public.invoices i on i.id = ii.invoice_id
  where ii.source_job_id is not null
    and coalesce(i.status, 'draft') not in ('cancelled', 'canceled', 'void')
  group by ii.source_job_id
),
invoice_job_revenue as (
  select
    i.job_id,
    coalesce(sum(coalesce(nullif(i.total_without_vat, 0), nullif(i.total_amount, 0), i.total_with_vat, 0)), 0)::numeric(12, 2) as revenue_total
  from public.invoices i
  where i.job_id is not null
    and coalesce(i.status, 'draft') not in ('cancelled', 'canceled', 'void')
    and not exists (
      select 1
      from public.invoice_items ii
      where ii.invoice_id = i.id
        and ii.source_job_id is not null
    )
  group by i.job_id
),
revenue as (
  select job_id, sum(revenue_total)::numeric(12, 2) as revenue_total
  from (
    select * from invoice_item_revenue
    union all
    select * from invoice_job_revenue
  ) source
  group by job_id
)
select
  j.id as job_id,
  j.company_id,
  coalesce(j.price, 0)::numeric(12, 2) as quoted_revenue_total,
  coalesce(r.revenue_total, 0)::numeric(12, 2) as revenue_total,
  coalesce(l.labor_hours_total, 0)::numeric(12, 2) as labor_hours_total,
  coalesce(l.internal_labor_cost_total, 0)::numeric(12, 2) as internal_labor_cost_total,
  coalesce(l.external_labor_cost_total, 0)::numeric(12, 2) as external_labor_cost_total,
  (coalesce(l.internal_labor_cost_total, 0) + coalesce(l.external_labor_cost_total, 0))::numeric(12, 2) as labor_cost_total,
  coalesce(dc.other_cost_total, 0)::numeric(12, 2) as other_cost_total,
  (coalesce(l.internal_labor_cost_total, 0) + coalesce(l.external_labor_cost_total, 0) + coalesce(dc.other_cost_total, 0))::numeric(12, 2) as total_cost_total,
  (coalesce(j.price, 0) - coalesce(l.internal_labor_cost_total, 0) - coalesce(l.external_labor_cost_total, 0) - coalesce(dc.other_cost_total, 0))::numeric(12, 2) as profit_total,
  case
    when coalesce(j.price, 0) > 0 then
      round(((coalesce(j.price, 0) - coalesce(l.internal_labor_cost_total, 0) - coalesce(l.external_labor_cost_total, 0) - coalesce(dc.other_cost_total, 0)) / j.price) * 100, 2)
    else null
  end as margin_percent
from public.jobs j
left join labor l on l.job_id = j.id
left join direct_costs dc on dc.job_id = j.id
left join revenue r on r.job_id = j.id;

grant select on table public.job_economics_summary to authenticated;
