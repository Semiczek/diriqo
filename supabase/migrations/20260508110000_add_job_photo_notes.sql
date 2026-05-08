alter table public.job_photos
  add column if not exists note text null;
