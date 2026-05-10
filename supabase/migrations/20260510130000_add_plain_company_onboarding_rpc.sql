create or replace function public.create_onboarding_company(
  input_company_name text,
  input_country text,
  input_language text,
  input_currency text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_email text;
  v_profile_id uuid;
  v_company_id uuid;
  v_company_name text := trim(coalesce(input_company_name, ''));
  v_country text := trim(coalesce(input_country, ''));
  v_language text := lower(trim(coalesce(input_language, 'cs')));
  v_currency text := upper(trim(coalesce(input_currency, 'CZK')));
  v_full_name text;
  v_locale text;
  v_timezone text;
begin
  if v_auth_user_id is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  if length(v_company_name) < 2 then
    raise exception 'company_name_required' using errcode = 'P0001';
  end if;

  if v_country = '' then
    raise exception 'country_required' using errcode = 'P0001';
  end if;

  if v_language not in ('cs', 'en', 'de') then
    raise exception 'language_required' using errcode = 'P0001';
  end if;

  if v_currency not in ('CZK', 'EUR') then
    raise exception 'currency_required' using errcode = 'P0001';
  end if;

  v_locale := case
    when v_language = 'en' then 'en-GB'
    when v_language = 'de' then 'de-DE'
    else 'cs-CZ'
  end;

  v_timezone := case
    when lower(v_country) in ('germany', 'austria') then 'Europe/Berlin'
    when lower(v_country) = 'united kingdom' then 'Europe/London'
    else 'Europe/Prague'
  end;

  select
    u.email,
    nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', '')), '')
  into v_email, v_full_name
  from auth.users u
  where u.id = v_auth_user_id;

  v_full_name := coalesce(v_full_name, nullif(v_email, ''), 'Admin');

  select p.id into v_profile_id
  from public.profiles p
  where p.auth_user_id = v_auth_user_id
     or p.user_id = v_auth_user_id
     or (v_email is not null and lower(coalesce(p.email, '')) = lower(v_email))
  order by p.created_at asc
  limit 1;

  if v_profile_id is null then
    insert into public.profiles (
      auth_user_id,
      user_id,
      full_name,
      email,
      default_hourly_rate
    )
    values (
      v_auth_user_id,
      v_auth_user_id,
      v_full_name,
      v_email,
      0
    )
    returning id into v_profile_id;
  else
    update public.profiles
    set
      auth_user_id = coalesce(auth_user_id, v_auth_user_id),
      user_id = coalesce(user_id, v_auth_user_id),
      full_name = coalesce(nullif(full_name, ''), v_full_name),
      email = coalesce(email, v_email),
      updated_at = now()
    where id = v_profile_id;
  end if;

  insert into public.companies (
    name,
    email,
    currency,
    locale,
    timezone,
    billing_country
  )
  values (
    v_company_name,
    v_email,
    v_currency,
    v_locale,
    v_timezone,
    v_country
  )
  returning id into v_company_id;

  insert into public.company_members (
    company_id,
    profile_id,
    role,
    is_active
  )
  values (
    v_company_id,
    v_profile_id,
    'company_admin',
    true
  );

  insert into public.company_settings (
    company_id,
    require_job_check,
    allow_multi_day_jobs,
    require_before_after_photos,
    require_checklist_completion,
    require_work_time_tracking,
    default_job_status_after_worker_done
  )
  values (
    v_company_id,
    true,
    true,
    false,
    false,
    true,
    'waiting_check'
  )
  on conflict (company_id) do nothing;

  insert into public.company_payroll_settings (
    company_id,
    default_worker_type,
    default_pay_type,
    advances_enabled,
    advance_limit_type,
    advance_frequency,
    default_contractor_cost_mode
  )
  values (
    v_company_id,
    'employee',
    'monthly',
    true,
    'monthly_amount',
    'monthly',
    'hourly'
  )
  on conflict (company_id) do nothing;

  insert into public.company_billing_settings (
    company_id,
    billing_enabled,
    default_invoice_due_days,
    default_vat_rate,
    is_vat_payer,
    invoice_prefix,
    next_invoice_number
  )
  values (
    v_company_id,
    false,
    14,
    21,
    false,
    'FV',
    1
  )
  on conflict (company_id) do nothing;

  insert into public.company_modules (
    company_id,
    module_key,
    is_enabled
  )
  select v_company_id, module_key, module_key <> 'public_leads'
  from (
    values
      ('dashboard'),
      ('jobs'),
      ('customers'),
      ('workers'),
      ('shifts'),
      ('finance'),
      ('calendar'),
      ('absences'),
      ('advance_requests'),
      ('quotes'),
      ('invoices'),
      ('kalkulace'),
      ('photos'),
      ('customer_portal'),
      ('public_leads'),
      ('email'),
      ('payroll')
  ) as modules(module_key)
  on conflict (company_id, module_key) do nothing;

  insert into public.mailboxes (
    company_id,
    name,
    email_address,
    provider_type,
    is_active
  )
  values (
    v_company_id,
    'Support',
    coalesce(v_email, 'support@diriqo.com'),
    'resend',
    true
  )
  on conflict (company_id, email_address) do nothing;

  return v_company_id;
end;
$$;

grant execute on function public.create_onboarding_company(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
