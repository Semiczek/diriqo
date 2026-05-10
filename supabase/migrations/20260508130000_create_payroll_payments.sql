create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  payroll_month text not null,
  amount numeric(12, 2) not null default 0,
  status text not null default 'paid',
  paid_at timestamptz not null default now(),
  paid_by uuid null references public.profiles(id) on delete set null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_payments_month_format check (payroll_month ~ '^\d{4}-\d{2}$'),
  constraint payroll_payments_status_check check (status in ('paid')),
  constraint payroll_payments_company_profile_month_unique unique(company_id, profile_id, payroll_month)
);

create index if not exists payroll_payments_company_month_idx
  on public.payroll_payments(company_id, payroll_month);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'payroll_payments_set_updated_at'
      and tgrelid = 'public.payroll_payments'::regclass
  ) then
    create trigger payroll_payments_set_updated_at
      before update on public.payroll_payments
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.payroll_payments enable row level security;

grant select, insert, update, delete on public.payroll_payments to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'payroll_payments'
      and policyname = 'payroll_payments_admin_select'
  ) then
    create policy payroll_payments_admin_select on public.payroll_payments
      for select to authenticated
      using (public.has_company_role(company_id, array['super_admin', 'company_admin']));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'payroll_payments'
      and policyname = 'payroll_payments_admin_write'
  ) then
    create policy payroll_payments_admin_write on public.payroll_payments
      for all to authenticated
      using (public.has_company_role(company_id, array['super_admin', 'company_admin']))
      with check (public.has_company_role(company_id, array['super_admin', 'company_admin']));
  end if;
end $$;
