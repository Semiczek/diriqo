alter table public.companies
  add column if not exists country_code text,
  add column if not exists default_language text,
  add column if not exists default_currency text,
  add column if not exists registration_number text,
  add column if not exists tax_number text,
  add column if not exists vat_number text;

update public.companies
set
  country_code = coalesce(
    nullif(upper(trim(country_code)), ''),
    case lower(trim(coalesce(billing_country, '')))
      when 'czech republic' then 'CZ'
      when 'ceska republika' then 'CZ'
      when 'česká republika' then 'CZ'
      when 'slovakia' then 'SK'
      when 'germany' then 'DE'
      when 'austria' then 'AT'
      when 'united kingdom' then 'UK'
      when 'united states' then 'US'
      else case
        when upper(trim(coalesce(billing_country, ''))) ~ '^[A-Z0-9]{2,8}$'
          then upper(trim(billing_country))
        else 'ZZ'
      end
    end
  ),
  default_language = coalesce(
    nullif(lower(trim(default_language)), ''),
    case
      when lower(coalesce(locale, '')) like 'cs%' then 'cs'
      when lower(coalesce(locale, '')) like 'sk%' then 'sk'
      when lower(coalesce(locale, '')) like 'de%' then 'de'
      when lower(coalesce(locale, '')) like 'en%' then 'en'
      else null
    end
  ),
  default_currency = coalesce(nullif(upper(trim(default_currency)), ''), nullif(upper(trim(currency)), '')),
  registration_number = coalesce(nullif(trim(registration_number), ''), nullif(trim(company_number), ''), nullif(trim(ico), '')),
  tax_number = coalesce(nullif(trim(tax_number), ''), nullif(trim(dic), ''), nullif(trim(vat_number), '')),
  vat_number = coalesce(nullif(trim(vat_number), ''), nullif(trim(dic), ''), nullif(trim(tax_number), ''))
where country_code is null
   or default_language is null
   or default_currency is null
   or registration_number is null
   or tax_number is null
   or vat_number is null;

update public.companies
set
  country_code = case
    when upper(coalesce(nullif(trim(country_code), ''), 'CZ')) ~ '^[A-Z0-9]{2,8}$'
      then upper(coalesce(nullif(trim(country_code), ''), 'CZ'))
    else 'ZZ'
  end,
  default_language = lower(coalesce(nullif(trim(default_language), ''), 'cs')),
  default_currency = upper(coalesce(nullif(trim(default_currency), ''), nullif(trim(currency), ''), 'CZK')),
  currency = upper(coalesce(nullif(trim(currency), ''), nullif(trim(default_currency), ''), 'CZK')),
  locale = coalesce(
    locale,
    case
      when lower(coalesce(nullif(trim(default_language), ''), 'cs')) in ('cs', 'sk') then 'cs-CZ'
      when lower(coalesce(nullif(trim(default_language), ''), 'cs')) = 'de' then 'de-DE'
      else 'en-GB'
    end
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_country_code_format_chk'
  ) then
    alter table public.companies
      add constraint companies_country_code_format_chk
      check (country_code is null or country_code ~ '^[A-Z0-9]{2,8}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'companies_registration_number_length_chk'
  ) then
    alter table public.companies
      add constraint companies_registration_number_length_chk
      check (registration_number is null or length(registration_number) <= 64);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'companies_tax_number_length_chk'
  ) then
    alter table public.companies
      add constraint companies_tax_number_length_chk
      check (tax_number is null or length(tax_number) <= 64);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'companies_vat_number_length_chk'
  ) then
    alter table public.companies
      add constraint companies_vat_number_length_chk
      check (vat_number is null or length(vat_number) <= 64);
  end if;
end $$;

drop function if exists public.create_onboarding_company(text, text, text, text);

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

  select p.id into v_profile_id
  from public.profiles p
  where p.auth_user_id = v_auth_user_id
     or p.user_id = v_auth_user_id
     or (v_auth_email is not null and lower(coalesce(p.email, '')) = lower(v_auth_email))
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

grant execute on function public.create_onboarding_company(text, text, text, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
