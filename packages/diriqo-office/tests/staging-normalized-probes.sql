-- TEMPORARY TEST HELPERS: only the two authorized disposable branches.
-- Never part of a host migration; remove with staging-normalized-probes-cleanup.sql.
begin;
create or replace function public.office_staging_normalized_hold(p_company_id uuid,p_file_id text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'STAGING_PROBE_FORBIDDEN';end if;
 if coalesce(auth.jwt()->>'ref','') not in ('amuhcvnvubsrvsfclqtg','pkjzoplczxqqmmstnqgy') then raise exception 'STAGING_PROBE_TARGET_FORBIDDEN';end if;
 perform set_config('application_name','office-normalized-staging-blocker',true);
 perform 1 from office_private.files where company_id=p_company_id and id=p_file_id for update;
 if not found then raise exception 'STAGING_PROBE_FILE_NOT_FOUND';end if;
 perform pg_sleep(9);
 return true;
end;$$;
create or replace function public.office_staging_normalized_observe()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'STAGING_PROBE_FORBIDDEN';end if;
 if coalesce(auth.jwt()->>'ref','') not in ('amuhcvnvubsrvsfclqtg','pkjzoplczxqqmmstnqgy') then raise exception 'STAGING_PROBE_TARGET_FORBIDDEN';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'operation',
  case when application_name='office-normalized-staging-blocker' then 'blocker'
       when query like '%office_set_enabled%' then 'module-toggle' else 'office-request' end,
  'waitType',wait_event_type,'wait',wait_event,'blockers',pg_blocking_pids(pid))),'[]'::jsonb)
 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and state='active'
 and (application_name='office-normalized-staging-blocker' or query like '%office_request%' or query like '%office_set_enabled%'));
end;$$;
revoke all on function public.office_staging_normalized_hold(uuid,text),public.office_staging_normalized_observe() from public,anon,authenticated;
grant execute on function public.office_staging_normalized_hold(uuid,text),public.office_staging_normalized_observe() to service_role;
commit;
