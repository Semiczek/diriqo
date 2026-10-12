-- Preserve issued/cancelled invoice history even when DELETE bypasses the draft RPC.
-- Additive only: no rows, grants, existing functions, licences or lifecycle states are rewritten.
set local lock_timeout = '5s';

create function private.guard_invoice_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  -- Mirrors the existing draft-delete RPC; OLD also applies to referential cascades.
  -- Fail closed for an unexpected NULL status on any legacy schema that permits it.
  if old.status is distinct from 'draft'
    or old.issued_at is not null
    or old.pohoda_export_status = 'exported' then
    raise exception 'INVOICE_DELETE_FORBIDDEN' using errcode = '42501';
  end if;
  -- No licence check: unissued/unexported drafts remain removable after expiry.
  return old;
end;
$function$;

revoke all on function private.guard_invoice_delete()
  from public, anon, authenticated, service_role;

create trigger guard_invoice_delete
before delete on public.invoices
for each row execute function private.guard_invoice_delete();