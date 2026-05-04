create table if not exists public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  payroll_month text not null,
  item_type text not null,
  amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_items_month_format check (payroll_month ~ '^\d{4}-\d{2}$'),
  constraint payroll_items_type_check check (item_type in ('bonus', 'meal', 'deduction')),
  constraint payroll_items_amount_non_negative check (amount >= 0)
);

alter table public.payroll_items
  add column if not exists profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists payroll_month text,
  add column if not exists item_type text,
  add column if not exists amount numeric not null default 0,
  add column if not exists note text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payroll_items_month_format'
      and conrelid = 'public.payroll_items'::regclass
  ) then
    alter table public.payroll_items
      add constraint payroll_items_month_format check (payroll_month ~ '^\d{4}-\d{2}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'payroll_items_type_check'
      and conrelid = 'public.payroll_items'::regclass
  ) then
    alter table public.payroll_items
      add constraint payroll_items_type_check check (item_type in ('bonus', 'meal', 'deduction'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'payroll_items_amount_non_negative'
      and conrelid = 'public.payroll_items'::regclass
  ) then
    alter table public.payroll_items
      add constraint payroll_items_amount_non_negative check (amount >= 0);
  end if;
end $$;

create index if not exists payroll_items_profile_month_idx
on public.payroll_items (profile_id, payroll_month);
