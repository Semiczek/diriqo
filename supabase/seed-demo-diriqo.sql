-- Diriqo demo seed.
-- Safe demo data only. Does not create Supabase Auth users.
-- Run after applying the Diriqo schema to a new Supabase database.

create schema if not exists diriqo_seed;

create or replace function diriqo_seed.upsert_json(
  target_table text,
  payload jsonb,
  conflict_columns text[] default array['id']
)
returns void
language plpgsql
as $$
declare
  target_reg regclass;
  available_columns text[];
  insert_columns text;
  update_columns text;
  conflict_sql text;
begin
  target_reg := to_regclass('public.' || target_table);

  if target_reg is null then
    raise notice 'Skipping %. Table does not exist.', target_table;
    return;
  end if;

  select array_agg(column_name order by ordinal_position)
    into available_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = target_table
    and payload ? column_name;

  if available_columns is null or array_length(available_columns, 1) is null then
    raise notice 'Skipping %. No matching columns in payload.', target_table;
    return;
  end if;

  if not conflict_columns <@ available_columns then
    raise notice 'Skipping %. Conflict columns % are not available.', target_table, conflict_columns;
    return;
  end if;

  select string_agg(format('%I', column_name), ', ')
    into insert_columns
  from unnest(available_columns) as column_name;

  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
    into update_columns
  from unnest(available_columns) as column_name
  where not column_name = any(conflict_columns);

  select string_agg(format('%I', column_name), ', ')
    into conflict_sql
  from unnest(conflict_columns) as column_name;

  if update_columns is null then
    execute format(
      'insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1) on conflict (%s) do nothing',
      target_reg,
      insert_columns,
      insert_columns,
      target_reg,
      conflict_sql
    )
    using payload;
  else
    execute format(
      'insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1) on conflict (%s) do update set %s',
      target_reg,
      insert_columns,
      insert_columns,
      target_reg,
      conflict_sql,
      update_columns
    )
    using payload;
  end if;
exception
  when others then
    raise notice 'Skipping %. %', target_table, sqlerrm;
end;
$$;

do $$
declare
  company_id uuid := '10000000-0000-4000-8000-000000000001';
  admin_id uuid := '10000000-0000-4000-8000-000000000101';
  manager_id uuid := '10000000-0000-4000-8000-000000000102';
  jana_id uuid := '10000000-0000-4000-8000-000000000201';
  petr_id uuid := '10000000-0000-4000-8000-000000000202';
  martin_id uuid := '10000000-0000-4000-8000-000000000203';
  eva_id uuid := '10000000-0000-4000-8000-000000000204';
  supermarket_id uuid := '10000000-0000-4000-8000-000000001001';
  hotel_id uuid := '10000000-0000-4000-8000-000000001002';
  office_id uuid := '10000000-0000-4000-8000-000000001003';
  svj_id uuid := '10000000-0000-4000-8000-000000001004';
  job_today uuid := '10000000-0000-4000-8000-000000002001';
  job_yesterday uuid := '10000000-0000-4000-8000-000000002002';
  job_tomorrow uuid := '10000000-0000-4000-8000-000000002003';
  job_reconstruction uuid := '10000000-0000-4000-8000-000000002004';
  job_issue uuid := '10000000-0000-4000-8000-000000002005';
  job_monthly uuid := '10000000-0000-4000-8000-000000002006';
  job_carpet uuid := '10000000-0000-4000-8000-000000002007';
  job_low_margin uuid := '10000000-0000-4000-8000-000000002008';
begin
  perform diriqo_seed.upsert_json('companies', jsonb_build_object(
    'id', company_id,
    'name', 'Diriqo Demo s.r.o.',
    'billing_name', 'Diriqo Demo s.r.o.',
    'company_number', '00000000',
    'vat_number', 'CZ00000000',
    'billing_street', 'Demo ulice 1',
    'billing_city', 'Praha',
    'billing_postal_code', '110 00',
    'billing_country', 'CZ',
    'email', 'demo@diriqo.com',
    'phone', '+420 000 000 000',
    'domain', 'demo.diriqo.com',
    'created_at', now(),
    'updated_at', now()
  ));

  perform diriqo_seed.upsert_json('mailboxes', jsonb_build_object(
    'id', '10000000-0000-4000-8000-000000009001',
    'company_id', company_id,
    'name', 'Diriqo',
    'email_address', 'no-reply@diriqo.com',
    'provider_type', 'resend',
    'is_active', true,
    'is_default_outbound', true,
    'is_default_inbound', true,
    'created_at', now(),
    'updated_at', now()
  ));

  perform diriqo_seed.upsert_json('company_modules', jsonb_build_object('id', '10000000-0000-4000-8000-000000000401', 'company_id', company_id, 'module_key', 'jobs', 'is_enabled', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_modules', jsonb_build_object('id', '10000000-0000-4000-8000-000000000402', 'company_id', company_id, 'module_key', 'customers', 'is_enabled', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_modules', jsonb_build_object('id', '10000000-0000-4000-8000-000000000403', 'company_id', company_id, 'module_key', 'workers', 'is_enabled', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_modules', jsonb_build_object('id', '10000000-0000-4000-8000-000000000404', 'company_id', company_id, 'module_key', 'shifts', 'is_enabled', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_modules', jsonb_build_object('id', '10000000-0000-4000-8000-000000000405', 'company_id', company_id, 'module_key', 'economics', 'is_enabled', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_modules', jsonb_build_object('id', '10000000-0000-4000-8000-000000000406', 'company_id', company_id, 'module_key', 'calendar', 'is_enabled', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_modules', jsonb_build_object('id', '10000000-0000-4000-8000-000000000407', 'company_id', company_id, 'module_key', 'quotes', 'is_enabled', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_modules', jsonb_build_object('id', '10000000-0000-4000-8000-000000000408', 'company_id', company_id, 'module_key', 'invoices', 'is_enabled', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_modules', jsonb_build_object('id', '10000000-0000-4000-8000-000000000409', 'company_id', company_id, 'module_key', 'photos', 'is_enabled', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_modules', jsonb_build_object('id', '10000000-0000-4000-8000-000000000410', 'company_id', company_id, 'module_key', 'leads', 'is_enabled', false, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_modules', jsonb_build_object('id', '10000000-0000-4000-8000-000000000411', 'company_id', company_id, 'module_key', 'customer_portal', 'is_enabled', true, 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('profiles', jsonb_build_object('id', admin_id, 'full_name', 'Adam Admin', 'email', 'admin@demo.diriqo.com', 'default_hourly_rate', 0, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('profiles', jsonb_build_object('id', manager_id, 'full_name', 'Martina Managerova', 'email', 'manager@demo.diriqo.com', 'default_hourly_rate', 0, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('profiles', jsonb_build_object('id', jana_id, 'full_name', 'Jana Novakova', 'email', 'jana@demo.diriqo.com', 'phone', '+420 000 000 001', 'default_hourly_rate', 260, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('profiles', jsonb_build_object('id', petr_id, 'full_name', 'Petr Dvorak', 'email', 'petr@demo.diriqo.com', 'phone', '+420 000 000 002', 'default_hourly_rate', 280, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('profiles', jsonb_build_object('id', martin_id, 'full_name', 'Martin Svoboda', 'email', 'martin@demo.diriqo.com', 'phone', '+420 000 000 003', 'default_hourly_rate', 270, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('profiles', jsonb_build_object('id', eva_id, 'full_name', 'Eva Cerna', 'email', 'eva@demo.diriqo.com', 'phone', '+420 000 000 004', 'default_hourly_rate', 255, 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('company_members', jsonb_build_object('id', '10000000-0000-4000-8000-000000000301', 'company_id', company_id, 'profile_id', admin_id, 'role', 'company_admin', 'is_active', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_members', jsonb_build_object('id', '10000000-0000-4000-8000-000000000302', 'company_id', company_id, 'profile_id', manager_id, 'role', 'manager', 'is_active', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_members', jsonb_build_object('id', '10000000-0000-4000-8000-000000000303', 'company_id', company_id, 'profile_id', jana_id, 'role', 'worker', 'is_active', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_members', jsonb_build_object('id', '10000000-0000-4000-8000-000000000304', 'company_id', company_id, 'profile_id', petr_id, 'role', 'worker', 'is_active', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_members', jsonb_build_object('id', '10000000-0000-4000-8000-000000000305', 'company_id', company_id, 'profile_id', martin_id, 'role', 'worker', 'is_active', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('company_members', jsonb_build_object('id', '10000000-0000-4000-8000-000000000306', 'company_id', company_id, 'profile_id', eva_id, 'role', 'worker', 'is_active', true, 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('customers', jsonb_build_object('id', supermarket_id, 'company_id', company_id, 'name', 'Supermarket Demo', 'type', 'retail', 'email', 'supermarket@demo.diriqo.com', 'phone', '+420 000 000 101', 'contact_name', 'Lenka Provozni', 'billing_name', 'Supermarket Demo', 'billing_street', 'Demo ulice 10', 'billing_city', 'Praha', 'billing_postal_code', '110 00', 'billing_country', 'CZ', 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('customers', jsonb_build_object('id', hotel_id, 'company_id', company_id, 'name', 'Hotel Aurora', 'type', 'hotel', 'email', 'hotel@demo.diriqo.com', 'phone', '+420 000 000 102', 'contact_name', 'Tomas Recepce', 'billing_name', 'Hotel Aurora', 'billing_street', 'Demo ulice 20', 'billing_city', 'Praha', 'billing_postal_code', '110 00', 'billing_country', 'CZ', 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('customers', jsonb_build_object('id', office_id, 'company_id', company_id, 'name', 'Office Park Nova', 'type', 'offices', 'email', 'office@demo.diriqo.com', 'phone', '+420 000 000 103', 'contact_name', 'Petra Facility', 'billing_name', 'Office Park Nova', 'billing_street', 'Demo ulice 30', 'billing_city', 'Praha', 'billing_postal_code', '110 00', 'billing_country', 'CZ', 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('customers', jsonb_build_object('id', svj_id, 'company_id', company_id, 'name', 'Bytovy dum Slunecna', 'type', 'svj', 'email', 'svj@demo.diriqo.com', 'phone', '+420 000 000 104', 'contact_name', 'Jan Vybor', 'billing_name', 'Bytovy dum Slunecna', 'billing_street', 'Slunecna 1', 'billing_city', 'Praha', 'billing_postal_code', '110 00', 'billing_country', 'CZ', 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('customer_contacts', jsonb_build_object('id', '10000000-0000-4000-8000-000000001101', 'company_id', company_id, 'customer_id', supermarket_id, 'name', 'Lenka Provozni', 'email', 'supermarket@demo.diriqo.com', 'phone', '+420 000 000 101', 'role', 'provoz', 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('customer_contacts', jsonb_build_object('id', '10000000-0000-4000-8000-000000001102', 'company_id', company_id, 'customer_id', hotel_id, 'name', 'Tomas Recepce', 'email', 'hotel@demo.diriqo.com', 'phone', '+420 000 000 102', 'role', 'recepce', 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('customer_contacts', jsonb_build_object('id', '10000000-0000-4000-8000-000000001103', 'company_id', company_id, 'customer_id', office_id, 'name', 'Petra Facility', 'email', 'office@demo.diriqo.com', 'phone', '+420 000 000 103', 'role', 'facility', 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('customer_contacts', jsonb_build_object('id', '10000000-0000-4000-8000-000000001104', 'company_id', company_id, 'customer_id', svj_id, 'name', 'Jan Vybor', 'email', 'svj@demo.diriqo.com', 'phone', '+420 000 000 104', 'role', 'vybor', 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('jobs', jsonb_build_object('id', job_today, 'company_id', company_id, 'customer_id', supermarket_id, 'title', 'Dnesni pravidelny uklid', 'description', 'Demo provozovna, standardni denni uklid.', 'address', 'Demo ulice 10, Praha', 'status', 'in_progress', 'price', 4500, 'currency', 'CZK', 'start_at', date_trunc('day', now()) + interval '8 hours', 'end_at', date_trunc('day', now()) + interval '12 hours', 'is_paid', false, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('jobs', jsonb_build_object('id', job_yesterday, 'company_id', company_id, 'customer_id', hotel_id, 'title', 'Vcerejsi dokonceny uklid', 'description', 'Uklid hotelovych spolecnych prostor.', 'address', 'Demo ulice 20, Praha', 'status', 'done', 'price', 7200, 'currency', 'CZK', 'start_at', date_trunc('day', now()) - interval '1 day' + interval '9 hours', 'end_at', date_trunc('day', now()) - interval '1 day' + interval '14 hours', 'is_paid', false, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('jobs', jsonb_build_object('id', job_tomorrow, 'company_id', company_id, 'customer_id', office_id, 'title', 'Zitrejsi myti oken', 'description', 'Mytí oken v kancelarskem arealu.', 'address', 'Demo ulice 30, Praha', 'status', 'planned', 'price', 12500, 'currency', 'CZK', 'start_at', date_trunc('day', now()) + interval '1 day 8 hours', 'end_at', date_trunc('day', now()) + interval '1 day 15 hours', 'is_paid', false, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('jobs', jsonb_build_object('id', job_reconstruction, 'company_id', company_id, 'customer_id', svj_id, 'title', 'Generalni uklid po rekonstrukci', 'description', 'Velky uklid spolecnych prostor po stavebnich pracich.', 'address', 'Slunecna 1, Praha', 'status', 'planned', 'price', 28000, 'currency', 'CZK', 'start_at', date_trunc('day', now()) + interval '5 days 8 hours', 'end_at', date_trunc('day', now()) + interval '5 days 18 hours', 'is_paid', false, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('jobs', jsonb_build_object('id', job_issue, 'company_id', company_id, 'customer_id', supermarket_id, 'title', 'Reklamace / docisteni', 'description', 'Zakaznik pozadal o docisteni vstupu.', 'address', 'Demo ulice 10, Praha', 'status', 'waiting_check', 'price', 0, 'currency', 'CZK', 'start_at', date_trunc('day', now()) + interval '2 days 10 hours', 'end_at', date_trunc('day', now()) + interval '2 days 12 hours', 'is_paid', false, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('jobs', jsonb_build_object('id', job_monthly, 'company_id', company_id, 'customer_id', office_id, 'title', 'Pravidelny mesicni uklid kancelari', 'description', 'Hotovo, ceka na fakturaci.', 'address', 'Demo ulice 30, Praha', 'status', 'done', 'price', 18500, 'currency', 'CZK', 'start_at', date_trunc('month', now()) + interval '3 days 8 hours', 'end_at', date_trunc('month', now()) + interval '3 days 16 hours', 'is_paid', false, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('jobs', jsonb_build_object('id', job_carpet, 'company_id', company_id, 'customer_id', hotel_id, 'title', 'Jednorazove cisteni kobercu', 'description', 'Hotova ziskova zakazka.', 'address', 'Demo ulice 20, Praha', 'status', 'done', 'price', 9800, 'currency', 'CZK', 'start_at', date_trunc('day', now()) - interval '5 days' + interval '8 hours', 'end_at', date_trunc('day', now()) - interval '5 days' + interval '13 hours', 'is_paid', true, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('jobs', jsonb_build_object('id', job_low_margin, 'company_id', company_id, 'customer_id', supermarket_id, 'title', 'Nizka marze / problemova zakazka', 'description', 'Demo zakazka s vysokymi naklady.', 'address', 'Demo ulice 10, Praha', 'status', 'done', 'price', 6000, 'currency', 'CZK', 'start_at', date_trunc('day', now()) - interval '3 days' + interval '8 hours', 'end_at', date_trunc('day', now()) - interval '3 days' + interval '17 hours', 'is_paid', false, 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('job_assignments', jsonb_build_object('id', '10000000-0000-4000-8000-000000003001', 'company_id', company_id, 'job_id', job_today, 'profile_id', jana_id, 'role_label', 'worker', 'hourly_rate', 260, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_assignments', jsonb_build_object('id', '10000000-0000-4000-8000-000000003002', 'company_id', company_id, 'job_id', job_today, 'profile_id', petr_id, 'role_label', 'worker', 'hourly_rate', 280, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_assignments', jsonb_build_object('id', '10000000-0000-4000-8000-000000003003', 'company_id', company_id, 'job_id', job_yesterday, 'profile_id', jana_id, 'role_label', 'worker', 'hourly_rate', 260, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_assignments', jsonb_build_object('id', '10000000-0000-4000-8000-000000003004', 'company_id', company_id, 'job_id', job_yesterday, 'profile_id', eva_id, 'role_label', 'worker', 'hourly_rate', 255, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_assignments', jsonb_build_object('id', '10000000-0000-4000-8000-000000003005', 'company_id', company_id, 'job_id', job_tomorrow, 'profile_id', petr_id, 'role_label', 'worker', 'hourly_rate', 280, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_assignments', jsonb_build_object('id', '10000000-0000-4000-8000-000000003006', 'company_id', company_id, 'job_id', job_tomorrow, 'profile_id', martin_id, 'role_label', 'worker', 'hourly_rate', 270, 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('job_assignments', jsonb_build_object('id', '10000000-0000-4000-8000-000000003007', 'company_id', company_id, 'job_id', job_reconstruction, 'profile_id', jana_id, 'role_label', 'worker', 'hourly_rate', 260, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_assignments', jsonb_build_object('id', '10000000-0000-4000-8000-000000003008', 'company_id', company_id, 'job_id', job_reconstruction, 'profile_id', petr_id, 'role_label', 'worker', 'hourly_rate', 280, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_assignments', jsonb_build_object('id', '10000000-0000-4000-8000-000000003009', 'company_id', company_id, 'job_id', job_reconstruction, 'profile_id', martin_id, 'role_label', 'worker', 'hourly_rate', 270, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_assignments', jsonb_build_object('id', '10000000-0000-4000-8000-000000003010', 'company_id', company_id, 'job_id', job_reconstruction, 'profile_id', eva_id, 'role_label', 'worker', 'hourly_rate', 255, 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('work_shifts', jsonb_build_object('id', '10000000-0000-4000-8000-000000004001', 'company_id', company_id, 'job_id', job_today, 'profile_id', jana_id, 'started_at', date_trunc('day', now()) + interval '8 hours', 'ended_at', null, 'status', 'running', 'hours_override', 4, 'job_hours_override', 4, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('work_shifts', jsonb_build_object('id', '10000000-0000-4000-8000-000000004002', 'company_id', company_id, 'job_id', job_yesterday, 'profile_id', eva_id, 'started_at', date_trunc('day', now()) - interval '1 day' + interval '9 hours', 'ended_at', date_trunc('day', now()) - interval '1 day' + interval '14 hours', 'status', 'completed', 'hours_override', 5, 'job_hours_override', 5, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('work_shifts', jsonb_build_object('id', '10000000-0000-4000-8000-000000004003', 'company_id', company_id, 'job_id', job_tomorrow, 'profile_id', petr_id, 'started_at', date_trunc('day', now()) + interval '1 day 8 hours', 'ended_at', date_trunc('day', now()) + interval '1 day 15 hours', 'status', 'planned', 'hours_override', 7, 'job_hours_override', 7, 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('job_cost_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000005001', 'company_id', company_id, 'job_id', job_today, 'cost_type', 'material', 'name', 'Chemie', 'title', 'Chemie', 'amount', 420, 'quantity', 1, 'unit', 'ks', 'unit_price', 420, 'total_price', 420, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_cost_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000005002', 'company_id', company_id, 'job_id', job_tomorrow, 'cost_type', 'transport', 'name', 'Doprava', 'title', 'Doprava', 'amount', 900, 'quantity', 1, 'unit', 'km', 'unit_price', 900, 'total_price', 900, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_cost_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000005003', 'company_id', company_id, 'job_id', job_reconstruction, 'cost_type', 'material', 'name', 'Pytle a spotrebni material', 'title', 'Pytle a spotrebni material', 'amount', 1600, 'quantity', 1, 'unit', 'set', 'unit_price', 1600, 'total_price', 1600, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_cost_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000005004', 'company_id', company_id, 'job_id', job_low_margin, 'cost_type', 'equipment', 'name', 'Zapujceni stroje', 'title', 'Zapujceni stroje', 'amount', 4300, 'quantity', 1, 'unit', 'den', 'unit_price', 4300, 'total_price', 4300, 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('calendar_events', jsonb_build_object('id', '10000000-0000-4000-8000-000000006001', 'company_id', company_id, 'job_id', job_today, 'title', 'Dnesni uklid', 'description', 'Kontrola prubehu prace.', 'start_at', date_trunc('day', now()) + interval '8 hours', 'end_at', date_trunc('day', now()) + interval '12 hours', 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('calendar_events', jsonb_build_object('id', '10000000-0000-4000-8000-000000006002', 'company_id', company_id, 'job_id', job_tomorrow, 'title', 'Zitrejsi myti oken', 'description', 'Planovana realizace.', 'start_at', date_trunc('day', now()) + interval '1 day 8 hours', 'end_at', date_trunc('day', now()) + interval '1 day 15 hours', 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('calendar_events', jsonb_build_object('id', '10000000-0000-4000-8000-000000006003', 'company_id', company_id, 'title', 'Kontrola kvality', 'description', 'Interni kontrola demo zakazek.', 'start_at', date_trunc('day', now()) + interval '2 days 10 hours', 'end_at', date_trunc('day', now()) + interval '2 days 11 hours', 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('calendar_events', jsonb_build_object('id', '10000000-0000-4000-8000-000000006004', 'company_id', company_id, 'title', 'Schuzka se zakaznikem', 'description', 'Demo obchodni schuzka.', 'start_at', date_trunc('day', now()) + interval '3 days 14 hours', 'end_at', date_trunc('day', now()) + interval '3 days 15 hours', 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('issues', jsonb_build_object('id', '10000000-0000-4000-8000-000000007001', 'company_id', company_id, 'job_id', job_today, 'title', 'Chybejici klice od provozovny', 'description', 'Kontaktovat provozni osobu.', 'status', 'open', 'created_by', admin_id, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('issues', jsonb_build_object('id', '10000000-0000-4000-8000-000000007002', 'company_id', company_id, 'job_id', job_issue, 'title', 'Zakaznik pozadal o docisteni vstupu', 'description', 'Naplanovat do 48 hodin.', 'status', 'open', 'created_by', manager_id, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('issues', jsonb_build_object('id', '10000000-0000-4000-8000-000000007003', 'company_id', company_id, 'title', 'Praskly drzak mopu', 'description', 'Vymenit v demo skladu.', 'status', 'open', 'created_by', manager_id, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('issues', jsonb_build_object('id', '10000000-0000-4000-8000-000000007004', 'company_id', company_id, 'title', 'Nutno objednat chemii', 'description', 'Doplnit zasoby pro pristi tyden.', 'status', 'open', 'created_by', manager_id, 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('checklist_templates', jsonb_build_object('id', '10000000-0000-4000-8000-000000008901', 'company_id', company_id, 'name', 'Standardni uklid provozovny', 'description', 'Zakladni sablona pro pravidelny uklid.', 'created_at', now()));
  perform diriqo_seed.upsert_json('checklist_template_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008911', 'company_id', company_id, 'template_id', '10000000-0000-4000-8000-000000008901', 'title', 'zamest a vytrit podlahy', 'sort_order', 1, 'created_at', now()));
  perform diriqo_seed.upsert_json('checklist_template_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008912', 'company_id', company_id, 'template_id', '10000000-0000-4000-8000-000000008901', 'title', 'vycistit socialni zarizeni', 'sort_order', 2, 'created_at', now()));
  perform diriqo_seed.upsert_json('checklist_template_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008913', 'company_id', company_id, 'template_id', '10000000-0000-4000-8000-000000008901', 'title', 'vynest kose', 'sort_order', 3, 'created_at', now()));
  perform diriqo_seed.upsert_json('checklist_template_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008914', 'company_id', company_id, 'template_id', '10000000-0000-4000-8000-000000008901', 'title', 'doplnit hygienicke potreby', 'sort_order', 4, 'created_at', now()));
  perform diriqo_seed.upsert_json('checklist_template_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008915', 'company_id', company_id, 'template_id', '10000000-0000-4000-8000-000000008901', 'title', 'zkontrolovat vstupni prostory', 'sort_order', 5, 'created_at', now()));
  perform diriqo_seed.upsert_json('checklist_template_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008916', 'company_id', company_id, 'template_id', '10000000-0000-4000-8000-000000008901', 'title', 'nafotit vysledek', 'sort_order', 6, 'created_at', now()));
  perform diriqo_seed.upsert_json('checklist_templates', jsonb_build_object('id', '10000000-0000-4000-8000-000000008902', 'company_id', company_id, 'name', 'Myti oken', 'description', 'Sablona pro myti oken.', 'created_at', now()));
  perform diriqo_seed.upsert_json('checklist_template_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008921', 'company_id', company_id, 'template_id', '10000000-0000-4000-8000-000000008902', 'title', 'pripravit bezpecnostni pomucky', 'sort_order', 1, 'created_at', now()));
  perform diriqo_seed.upsert_json('checklist_template_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008922', 'company_id', company_id, 'template_id', '10000000-0000-4000-8000-000000008902', 'title', 'umyt ramy', 'sort_order', 2, 'created_at', now()));
  perform diriqo_seed.upsert_json('checklist_template_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008923', 'company_id', company_id, 'template_id', '10000000-0000-4000-8000-000000008902', 'title', 'umyt skla', 'sort_order', 3, 'created_at', now()));
  perform diriqo_seed.upsert_json('checklist_template_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008924', 'company_id', company_id, 'template_id', '10000000-0000-4000-8000-000000008902', 'title', 'zkontrolovat smouhy', 'sort_order', 4, 'created_at', now()));
  perform diriqo_seed.upsert_json('checklist_template_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008925', 'company_id', company_id, 'template_id', '10000000-0000-4000-8000-000000008902', 'title', 'nafotit pred/po', 'sort_order', 5, 'created_at', now()));
  perform diriqo_seed.upsert_json('job_checklists', jsonb_build_object('id', '10000000-0000-4000-8000-000000008001', 'company_id', company_id, 'job_id', job_today, 'template_id', '10000000-0000-4000-8000-000000008901', 'title', 'Standardni uklid provozovny', 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_checklist_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008101', 'company_id', company_id, 'job_checklist_id', '10000000-0000-4000-8000-000000008001', 'title', 'zamest a vytrit podlahy', 'sort_order', 1, 'is_done', false, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_checklist_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008102', 'company_id', company_id, 'job_checklist_id', '10000000-0000-4000-8000-000000008001', 'title', 'vycistit socialni zarizeni', 'sort_order', 2, 'is_done', false, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_checklists', jsonb_build_object('id', '10000000-0000-4000-8000-000000008002', 'company_id', company_id, 'job_id', job_tomorrow, 'template_id', '10000000-0000-4000-8000-000000008902', 'title', 'Myti oken', 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_checklist_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008201', 'company_id', company_id, 'job_checklist_id', '10000000-0000-4000-8000-000000008002', 'title', 'pripravit bezpecnostni pomucky', 'sort_order', 1, 'is_done', false, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('job_checklist_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000008202', 'company_id', company_id, 'job_checklist_id', '10000000-0000-4000-8000-000000008002', 'title', 'umyt ramy', 'sort_order', 2, 'is_done', false, 'created_at', now(), 'updated_at', now()));

  perform diriqo_seed.upsert_json('calculations', jsonb_build_object('id', '10000000-0000-4000-8000-000000010001', 'company_id', company_id, 'customer_id', office_id, 'title', 'Kalkulace pravidelneho uklidu kancelari', 'status', 'ready', 'calculation_date', current_date, 'subtotal_cost', 12000, 'subtotal_price', 18500, 'margin_amount', 6500, 'total_price', 18500, 'currency', 'CZK', 'created_by', admin_id, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('quotes', jsonb_build_object('id', '10000000-0000-4000-8000-000000011001', 'company_id', company_id, 'customer_id', office_id, 'source_calculation_id', '10000000-0000-4000-8000-000000010001', 'quote_number', 'DQ-2026-001', 'title', 'Pravidelny uklid kancelari', 'status', 'draft', 'quote_date', current_date, 'valid_until', current_date + 14, 'subtotal_price', 18500, 'total_price', 18500, 'currency', 'CZK', 'created_by', admin_id, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('quotes', jsonb_build_object('id', '10000000-0000-4000-8000-000000011002', 'company_id', company_id, 'customer_id', svj_id, 'quote_number', 'DQ-2026-002', 'title', 'Generalni uklid', 'status', 'sent', 'quote_date', current_date - 3, 'sent_at', now() - interval '3 days', 'valid_until', current_date + 11, 'subtotal_price', 28000, 'total_price', 28000, 'currency', 'CZK', 'created_by', admin_id, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('quotes', jsonb_build_object('id', '10000000-0000-4000-8000-000000011003', 'company_id', company_id, 'customer_id', office_id, 'quote_number', 'DQ-2026-003', 'title', 'Myti oken', 'status', 'accepted', 'quote_date', current_date - 10, 'sent_at', now() - interval '10 days', 'accepted_at', now() - interval '8 days', 'valid_until', current_date + 4, 'subtotal_price', 12500, 'total_price', 12500, 'currency', 'CZK', 'created_by', admin_id, 'created_at', now(), 'updated_at', now()));
  perform diriqo_seed.upsert_json('quote_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000011101', 'quote_id', '10000000-0000-4000-8000-000000011001', 'sort_order', 1, 'name', 'Pravidelny mesicni uklid kancelari', 'quantity', 1, 'unit', 'mesic', 'unit_price', 18500, 'created_at', now()));
  perform diriqo_seed.upsert_json('quote_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000011102', 'quote_id', '10000000-0000-4000-8000-000000011002', 'sort_order', 1, 'name', 'Generalni uklid po rekonstrukci', 'quantity', 1, 'unit', 'akce', 'unit_price', 28000, 'created_at', now()));
  perform diriqo_seed.upsert_json('quote_items', jsonb_build_object('id', '10000000-0000-4000-8000-000000011103', 'quote_id', '10000000-0000-4000-8000-000000011003', 'sort_order', 1, 'name', 'Myti oken', 'quantity', 1, 'unit', 'akce', 'unit_price', 12500, 'created_at', now()));

  raise notice 'Diriqo demo seed finished. Demo company id: %', company_id;
end $$;

drop function if exists diriqo_seed.upsert_json(text, jsonb, text[]);
