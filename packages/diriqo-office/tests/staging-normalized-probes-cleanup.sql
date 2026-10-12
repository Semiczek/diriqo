-- Remove only the temporary test helpers, on the same authorized staging branch.
begin;
drop function if exists public.office_staging_normalized_hold(uuid,text);
drop function if exists public.office_staging_normalized_observe();
commit;
