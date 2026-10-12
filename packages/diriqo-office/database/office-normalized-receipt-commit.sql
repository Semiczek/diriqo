-- Additive fix after office-normalized.sql. A deferred trigger runs after the
-- public SECURITY DEFINER RPC returns, under the caller's transaction role.
-- Only this private trigger needs owner access to inspect its own receipt row.
-- It takes no arguments, returns no data, has fixed search_path and no client grant.
begin;
alter function office_private.receipt_complete_v2() security definer;
alter function office_private.receipt_complete_v2() set search_path=pg_catalog;
revoke all on function office_private.receipt_complete_v2() from public,anon,authenticated,service_role;
commit;
