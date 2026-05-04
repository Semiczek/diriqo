alter table public.customers
add column if not exists billing_name text null,
add column if not exists billing_street text null,
add column if not exists billing_city text null,
add column if not exists billing_postal_code text null,
add column if not exists billing_country text null,
add column if not exists company_number text null,
add column if not exists vat_number text null,
add column if not exists ares_last_checked_at timestamptz null;
