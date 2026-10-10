-- Preserve the repository's country defaults/validation and complete module defaults.
-- Live RPC had drifted from 20260510173000; keep the independent Auth identity boundary.
create or replace function public.create_onboarding_company(
  input_company_name text,
  input_country_code text,
  input_language text,
  input_currency text,
  input_registration_number text default null,
  input_tax_number text default null,
  input_address text default null,
  input_phone text default null,
  input_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_auth_email text;
  v_email text;
  v_profile_id uuid;
  v_company_id uuid;
  v_company_name text := trim(coalesce(input_company_name, ''));
  v_country_code text := upper(trim(coalesce(input_country_code, '')));
  v_language text := lower(trim(coalesce(input_language, '')));
  v_currency text := upper(trim(coalesce(input_currency, '')));
  v_registration_number text := nullif(trim(coalesce(input_registration_number, '')), '');
  v_tax_number text := nullif(trim(coalesce(input_tax_number, '')), '');
  v_address text := nullif(trim(coalesce(input_address, '')), '');
  v_phone text := nullif(trim(coalesce(input_phone, '')), '');
  v_input_email text := nullif(trim(coalesce(input_email, '')), '');
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

  if v_country_code = '' then
    raise exception 'country_required' using errcode = 'P0001';
  end if;

  if v_country_code !~ '^[A-Z0-9]{2,8}$' then
    raise exception 'country_required' using errcode = 'P0001';
  end if;

  if v_registration_number is not null and length(v_registration_number) > 64 then
    raise exception 'registration_number_invalid' using errcode = 'P0001';
  end if;

  if v_tax_number is not null and length(v_tax_number) > 64 then
    raise exception 'tax_number_invalid' using errcode = 'P0001';
  end if;

  if v_language = '' then
    v_language := case
      when v_country_code = 'CZ' then 'cs'
      when v_country_code = 'SK' then 'sk'
      when v_country_code in ('DE', 'AT', 'CH') then 'de'
      when v_country_code in ('PL') then 'pl'
      when v_country_code in ('HU') then 'hu'
      when v_country_code in ('FR') then 'fr'
      when v_country_code in ('IT') then 'it'
      when v_country_code in ('ES', 'MX') then 'es'
      when v_country_code in ('PT', 'BR') then 'pt'
      when v_country_code in ('NL', 'BE') then 'nl'
      when v_country_code = 'DK' then 'da'
      when v_country_code = 'SE' then 'sv'
      when v_country_code = 'FI' then 'fi'
      when v_country_code = 'NO' then 'no'
      else 'en'
    end;
  end if;

  if v_currency = '' then
    v_currency := case
      when v_country_code = 'CZ' then 'CZK'
      when v_country_code = 'PL' then 'PLN'
      when v_country_code = 'HU' then 'HUF'
      when v_country_code = 'DK' then 'DKK'
      when v_country_code = 'SE' then 'SEK'
      when v_country_code = 'NO' then 'NOK'
      when v_country_code = 'UK' then 'GBP'
      when v_country_code = 'US' then 'USD'
      when v_country_code = 'CA' then 'CAD'
      when v_country_code = 'MX' then 'MXN'
      when v_country_code = 'AU' then 'AUD'
      when v_country_code = 'NZ' then 'NZD'
      when v_country_code = 'BR' then 'BRL'
      when v_country_code = 'IN' then 'INR'
      when v_country_code = 'ZA' then 'ZAR'
      when v_country_code = 'SG' then 'SGD'
      when v_country_code = 'AE' then 'AED'
      when v_country_code = 'CH' then 'CHF'
      when v_country_code = 'JP' then 'JPY'
      when v_country_code = 'KR' then 'KRW'
      else 'EUR'
    end;
  end if;

  if v_currency not in (
    'CZK', 'EUR', 'PLN', 'HUF', 'DKK', 'SEK', 'NOK', 'GBP', 'USD', 'CAD',
    'MXN', 'AUD', 'NZD', 'BRL', 'INR', 'ZAR', 'SGD', 'AED', 'CHF', 'JPY', 'KRW'
  ) then
    raise exception 'currency_required' using errcode = 'P0001';
  end if;

  v_locale := case
    when v_language in ('cs', 'sk') then 'cs-CZ'
    when v_language = 'de' then 'de-DE'
    else 'en-GB'
  end;

  v_timezone := case
    when v_country_code in ('UK', 'IE') then 'Europe/London'
    when v_country_code in ('DE', 'AT', 'CH', 'NL', 'BE', 'FR', 'IT', 'ES', 'DK', 'SE', 'NO') then 'Europe/Berlin'
    when v_country_code in ('PL', 'HU', 'SK') then 'Europe/Prague'
    else 'Europe/Prague'
  end;

  select
    u.email,
    nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', '')), '')
  into v_auth_email, v_full_name
  from auth.users u
  where u.id = v_auth_user_id;

  v_email := coalesce(v_input_email, v_auth_email);
  v_full_name := coalesce(v_full_name, nullif(v_auth_email, ''), 'Admin');

  -- Serialize this account's provisioning across both entry points.
  perform pg_advisory_xact_lock(hashtextextended(v_auth_user_id::text, 0));
  if exists (
    select 1 from public.profiles p
    where (p.auth_user_id = v_auth_user_id or p.user_id = v_auth_user_id)
      and ((p.auth_user_id is not null and p.auth_user_id <> v_auth_user_id)
        or (p.user_id is not null and p.user_id <> v_auth_user_id))
  ) or (
    select count(*) from public.profiles p
    where p.auth_user_id = v_auth_user_id or p.user_id = v_auth_user_id
  ) > 1 then
    raise exception 'profile_identity_conflict' using errcode = '42501';
  end if;

  select p.id into v_profile_id
  from public.profiles p
  where p.auth_user_id = v_auth_user_id
     or p.user_id = v_auth_user_id
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
      v_auth_email,
      0
    )
    returning id into v_profile_id;
  else
    update public.profiles
    set
      auth_user_id = coalesce(auth_user_id, v_auth_user_id),
      user_id = coalesce(user_id, v_auth_user_id),
      full_name = coalesce(nullif(full_name, ''), v_full_name),
      email = coalesce(email, v_auth_email),
      updated_at = now()
    where id = v_profile_id;
  end if;

  insert into public.companies (
    name,
    email,
    phone,
    address,
    currency,
    locale,
    timezone,
    billing_country,
    country_code,
    default_language,
    default_currency,
    registration_number,
    tax_number,
    vat_number,
    company_number,
    ico,
    dic
  )
  values (
    v_company_name,
    v_email,
    v_phone,
    v_address,
    v_currency,
    v_locale,
    v_timezone,
    v_country_code,
    v_country_code,
    v_language,
    v_currency,
    v_registration_number,
    v_tax_number,
    v_tax_number,
    v_registration_number,
    v_registration_number,
    v_tax_number
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
    coalesce(v_auth_email, 'support@diriqo.com'),
    'resend',
    true
  )
  on conflict (company_id, email_address) do nothing;

  return v_company_id;
end;
$$;

revoke all on function public.create_onboarding_company(text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_onboarding_company(text, text, text, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
