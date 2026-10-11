-- Preserve every issued/cancelled invoice's accounting snapshot at the shared table boundary.
-- Additive only: no existing rows, issue/licence authority, RLS, or status workflow is rewritten.
set local lock_timeout = '5s';

create function private.guard_invoice_accounting_content()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_operational_columns constant text[] := array[
    'status', 'sent_at', 'paid_at', 'cancelled_at', 'updated_at',
    'pohoda_export_status', 'pohoda_exported_at', 'pohoda_last_error',
    'pohoda_external_id', 'pohoda_last_export_id'
  ];
begin
  -- Draft edits and the first issue retain their existing authority and validation.
  -- OLD is deliberate: changing status in the same statement must not unlock content.
  if old.status = 'draft' and old.issued_at is null then
    return new;
  end if;

  -- All accounting fields, aliases and future columns are protected by default.
  -- Only explicit operational fields are mutable; the existing issue guard still
  -- validates numbering, tenant scope and lifecycle transitions.
  v_old := to_jsonb(old) - v_operational_columns;
  v_new := to_jsonb(new) - v_operational_columns;

  -- Preserve historical FK SET NULL and delete_job_safe's explicit detach.
  -- Reassignment and reattachment remain forbidden. Detach never permits any
  -- other accounting content to change, including snapshots and legacy aliases.
  -- job_id exists only on runtime-patched schemas; absent optional fields must
  -- not break an ordinary operational update on a canonical migration schema.
  if v_old ? 'job_id' and v_old->'job_id' <> 'null'::jsonb and v_new->'job_id' = 'null'::jsonb then
    v_new := jsonb_set(v_new, array['job_id'], v_old->'job_id');
  end if;
  if v_old ? 'created_by' and v_old->'created_by' <> 'null'::jsonb and v_new->'created_by' = 'null'::jsonb then
    v_new := jsonb_set(v_new, array['created_by'], v_old->'created_by');
  end if;

  if v_new is distinct from v_old then
    raise exception 'INVOICE_CONTENT_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_invoice_accounting_content()
  from public, anon, authenticated, service_role;

-- This trigger performs no privileged reads/writes and does not grant a new RPC.
-- Its name orders it before guard_invoice_issue for deterministic content errors.
create trigger guard_invoice_accounting_content
before update on public.invoices
for each row execute function private.guard_invoice_accounting_content();