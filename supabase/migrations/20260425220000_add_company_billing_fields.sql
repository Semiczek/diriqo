alter table public.companies
add column if not exists billing_name text null,
add column if not exists company_number text null,
add column if not exists vat_number text null,
add column if not exists billing_street text null,
add column if not exists billing_city text null,
add column if not exists billing_postal_code text null,
add column if not exists billing_country text null,
add column if not exists bank_account_number text null,
add column if not exists bank_code text null,
add column if not exists iban text null,
add column if not exists swift_bic text null,
add column if not exists ares_last_checked_at timestamptz null;
