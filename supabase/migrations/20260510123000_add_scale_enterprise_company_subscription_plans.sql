alter table public.company_subscriptions
  drop constraint if exists company_subscriptions_plan_key_check;

alter table public.company_subscriptions
  add constraint company_subscriptions_plan_key_check
  check (plan_key in ('starter', 'growth', 'business', 'scale', 'enterprise', 'custom'));

create or replace function public.enforce_company_worker_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_key text;
  v_worker_limit integer;
  v_current_workers integer;
begin
  if new.is_active is not true or lower(coalesce(new.role, '')) <> 'worker' then
    return new;
  end if;

  select cs.plan_key
  into v_plan_key
  from public.company_subscriptions cs
  where cs.company_id = new.company_id
  limit 1;

  v_worker_limit := case coalesce(v_plan_key, 'starter')
    when 'starter' then 5
    when 'growth' then 15
    when 'business' then 30
    when 'scale' then 50
    when 'enterprise' then 100
    else null
  end;

  if v_worker_limit is null then
    return new;
  end if;

  select count(*)::integer
  into v_current_workers
  from public.company_members cm
  where cm.company_id = new.company_id
    and cm.is_active = true
    and lower(coalesce(cm.role, '')) = 'worker'
    and cm.id is distinct from new.id;

  if v_current_workers >= v_worker_limit then
    raise exception 'company_worker_limit_exceeded:%', v_worker_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
