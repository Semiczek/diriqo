alter table public.company_subscriptions
  add column if not exists billing_interval text not null default 'monthly';

update public.company_subscriptions
set
  plan_key = 'scale',
  updated_at = now()
where plan_key in ('enterprise', 'custom');

alter table public.company_subscriptions
  drop constraint if exists company_subscriptions_plan_key_check;

alter table public.company_subscriptions
  add constraint company_subscriptions_plan_key_check
  check (plan_key in ('starter', 'growth', 'business', 'scale'));

alter table public.company_subscriptions
  drop constraint if exists company_subscriptions_billing_interval_check;

alter table public.company_subscriptions
  add constraint company_subscriptions_billing_interval_check
  check (billing_interval in ('monthly', 'yearly'));

insert into public.billing_plans (
  key,
  name,
  min_members,
  max_members,
  monthly_price_eur,
  yearly_price_eur,
  is_custom,
  is_active
)
values
  ('starter', 'Starter', 1, 5, 19, 190, false, true),
  ('growth', 'Growth', 1, 15, 39, 390, false, true),
  ('business', 'Business', 1, 30, 79, 790, false, true),
  ('scale', 'Scale', 1, 50, 149, 1490, false, true)
on conflict (key) do update
set
  name = excluded.name,
  min_members = excluded.min_members,
  max_members = excluded.max_members,
  monthly_price_eur = excluded.monthly_price_eur,
  yearly_price_eur = excluded.yearly_price_eur,
  is_custom = excluded.is_custom,
  is_active = excluded.is_active,
  updated_at = now();

update public.billing_plans
set
  is_active = false,
  updated_at = now()
where key in ('enterprise', 'custom');

notify pgrst, 'reload schema';
