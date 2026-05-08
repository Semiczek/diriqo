-- BLOK E: additive flow safety patch.
-- Makes quote -> job creation idempotent at database level.

alter table public.jobs
  add column if not exists source_quote_id uuid null references public.quotes(id) on delete set null;

create unique index if not exists jobs_company_source_quote_root_unique
  on public.jobs(company_id, source_quote_id)
  where source_quote_id is not null and parent_job_id is null;

create index if not exists jobs_source_quote_idx
  on public.jobs(source_quote_id)
  where source_quote_id is not null;
