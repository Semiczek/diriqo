alter table public.work_shifts
add column if not exists job_hours_override numeric null;
