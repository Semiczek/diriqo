-- Repair existing installations where CREATE TABLE IF NOT EXISTS did not add
-- the canonical company/number constraint. Never renumber or delete history.
-- Ordinary NULL semantics intentionally allow multiple unnumbered drafts.
-- All statuses and years reserve their literal number within the company.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration$
declare
  v_company smallint;
  v_number smallint;
begin
  -- Keep the duplicate check and constraint installation in one protected step.
  lock table public.invoices in access exclusive mode;
  select attnum into strict v_company from pg_catalog.pg_attribute
    where attrelid = 'public.invoices'::regclass and attname = 'company_id' and not attisdropped;
  select attnum into strict v_number from pg_catalog.pg_attribute
    where attrelid = 'public.invoices'::regclass and attname = 'invoice_number' and not attisdropped;

  if exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.invoices'::regclass and conname = 'invoices_company_number_uidx'
  ) then
    -- Fresh canonical installations already have this constraint. Fail closed
    -- if the same name means something else instead of silently accepting drift.
    if not exists (
      select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_index i on i.indexrelid = c.conindid
      where c.conrelid = 'public.invoices'::regclass
        and c.conname = 'invoices_company_number_uidx' and c.contype = 'u'
        and c.conkey = array[v_company, v_number]::smallint[]
        and c.convalidated and not c.condeferrable
        and i.indisunique and i.indisvalid and i.indisready
        and not i.indnullsnotdistinct and i.indpred is null and i.indexprs is null
    ) then
      raise exception 'INVOICE_NUMBER_CONSTRAINT_DEFINITION_MISMATCH';
    end if;
    return;
  end if;

  if exists (
    select 1 from public.invoices
    where invoice_number is not null
    group by company_id, invoice_number having count(*) > 1
  ) then
    raise exception 'INVOICE_NUMBER_DUPLICATES_REQUIRE_REVIEW';
  end if;

  alter table public.invoices add constraint invoices_company_number_uidx
    unique (company_id, invoice_number);
end;
$migration$;
