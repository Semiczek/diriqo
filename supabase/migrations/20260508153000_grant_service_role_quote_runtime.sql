begin;

-- The quote detail page uses the server-side service role client to backfill
-- public offer share tokens. Keep this server-side and scoped by company_id in code.
grant usage on schema public to service_role;
grant select, update on table public.quotes to service_role;

commit;
