alter table public.companies
  add column if not exists ares_last_checked_at timestamptz null;

notify pgrst, 'reload schema';
