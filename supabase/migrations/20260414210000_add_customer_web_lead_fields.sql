alter table public.customers
add column if not exists lead_contact_name text null,
add column if not exists lead_source text null,
add column if not exists lead_locale text null,
add column if not exists lead_service_slug text null,
add column if not exists lead_message text null,
add column if not exists lead_page_url text null,
add column if not exists lead_referrer text null,
add column if not exists lead_user_agent text null,
add column if not exists lead_submitted_at timestamptz null;
