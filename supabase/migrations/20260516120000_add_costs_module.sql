create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid null references public.jobs(id) on delete set null,
  worker_id uuid null references public.profiles(id) on delete set null,
  name text not null,
  category text not null,
  amount numeric(12, 2) not null,
  currency text not null default 'CZK',
  expense_date date not null default current_date,
  source text not null default 'manual',
  note text null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  category text not null,
  amount numeric(12, 2) not null,
  currency text not null default 'CZK',
  due_day int null,
  recurrence text not null default 'monthly',
  start_date date not null default current_date,
  end_date date null,
  is_active boolean not null default true,
  note text null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_amount_non_negative') then
    alter table public.expenses
      add constraint expenses_amount_non_negative check (amount >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expenses_source_check') then
    alter table public.expenses
      add constraint expenses_source_check check (source in ('manual', 'shift', 'assignment', 'import'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expenses_name_not_empty') then
    alter table public.expenses
      add constraint expenses_name_not_empty check (length(btrim(name)) > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expenses_category_not_empty') then
    alter table public.expenses
      add constraint expenses_category_not_empty check (length(btrim(category)) > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expenses_currency_not_empty') then
    alter table public.expenses
      add constraint expenses_currency_not_empty check (length(btrim(currency)) between 3 and 12);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fixed_costs_amount_non_negative') then
    alter table public.fixed_costs
      add constraint fixed_costs_amount_non_negative check (amount >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fixed_costs_due_day_check') then
    alter table public.fixed_costs
      add constraint fixed_costs_due_day_check check (due_day is null or due_day between 1 and 31);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fixed_costs_recurrence_check') then
    alter table public.fixed_costs
      add constraint fixed_costs_recurrence_check check (recurrence in ('monthly', 'weekly', 'yearly', 'one_time'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fixed_costs_name_not_empty') then
    alter table public.fixed_costs
      add constraint fixed_costs_name_not_empty check (length(btrim(name)) > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fixed_costs_category_not_empty') then
    alter table public.fixed_costs
      add constraint fixed_costs_category_not_empty check (length(btrim(category)) > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fixed_costs_currency_not_empty') then
    alter table public.fixed_costs
      add constraint fixed_costs_currency_not_empty check (length(btrim(currency)) between 3 and 12);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fixed_costs_date_range_check') then
    alter table public.fixed_costs
      add constraint fixed_costs_date_range_check check (end_date is null or end_date >= start_date);
  end if;
end $$;

create index if not exists expenses_company_id_idx on public.expenses(company_id);
create index if not exists expenses_job_id_idx on public.expenses(job_id);
create index if not exists expenses_expense_date_idx on public.expenses(expense_date);
create index if not exists expenses_category_idx on public.expenses(category);
create index if not exists expenses_source_idx on public.expenses(source);
create index if not exists expenses_company_month_idx on public.expenses(company_id, expense_date desc);

create index if not exists fixed_costs_company_id_idx on public.fixed_costs(company_id);
create index if not exists fixed_costs_is_active_idx on public.fixed_costs(is_active);
create index if not exists fixed_costs_recurrence_idx on public.fixed_costs(recurrence);
create index if not exists fixed_costs_due_day_idx on public.fixed_costs(due_day);
create index if not exists fixed_costs_company_active_idx on public.fixed_costs(company_id, is_active);

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();

drop trigger if exists fixed_costs_set_updated_at on public.fixed_costs;
create trigger fixed_costs_set_updated_at
before update on public.fixed_costs
for each row execute function public.set_updated_at();

alter table public.expenses enable row level security;
alter table public.fixed_costs enable row level security;

grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert, update, delete on public.fixed_costs to authenticated;

drop policy if exists expenses_select_company_admins on public.expenses;
create policy expenses_select_company_admins
on public.expenses
for select
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin']));

drop policy if exists expenses_insert_company_admins on public.expenses;
create policy expenses_insert_company_admins
on public.expenses
for insert
to authenticated
with check (
  public.has_company_role(company_id, array['super_admin', 'company_admin'])
  and (created_by is null or created_by = public.current_profile_id())
);

drop policy if exists expenses_update_company_admins on public.expenses;
create policy expenses_update_company_admins
on public.expenses
for update
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin']))
with check (public.has_company_role(company_id, array['super_admin', 'company_admin']));

drop policy if exists expenses_delete_company_admins on public.expenses;
create policy expenses_delete_company_admins
on public.expenses
for delete
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin']));

drop policy if exists fixed_costs_select_company_admins on public.fixed_costs;
create policy fixed_costs_select_company_admins
on public.fixed_costs
for select
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin']));

drop policy if exists fixed_costs_insert_company_admins on public.fixed_costs;
create policy fixed_costs_insert_company_admins
on public.fixed_costs
for insert
to authenticated
with check (
  public.has_company_role(company_id, array['super_admin', 'company_admin'])
  and (created_by is null or created_by = public.current_profile_id())
);

drop policy if exists fixed_costs_update_company_admins on public.fixed_costs;
create policy fixed_costs_update_company_admins
on public.fixed_costs
for update
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin']))
with check (public.has_company_role(company_id, array['super_admin', 'company_admin']));

drop policy if exists fixed_costs_delete_company_admins on public.fixed_costs;
create policy fixed_costs_delete_company_admins
on public.fixed_costs
for delete
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin']));

notify pgrst, 'reload schema';
