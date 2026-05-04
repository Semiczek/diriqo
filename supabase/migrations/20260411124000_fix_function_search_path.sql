alter function public.detach_customer_from_job(uuid) set search_path = public, pg_temp;
alter function public.delete_calendar_event_safe(uuid) set search_path = public, pg_temp;
alter function public.delete_job_safe(uuid) set search_path = public, pg_temp;
alter function public.handle_job_billing_status() set search_path = public, pg_temp;
alter function public.sync_job_assignment_from_shifts(uuid, uuid) set search_path = public, pg_temp;
alter function public.handle_work_shift_assignment_sync() set search_path = public, pg_temp;
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.get_complete_schema() set search_path = public, pg_temp;
