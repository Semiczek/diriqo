-- Additive protection for cached spreadsheet previews. Apply before preview imports.
-- The normalized snapshot remains readable/copyable; metadata-only changes stay available.
begin;
set local lock_timeout = '5s';

create or replace function office_private.guard_cached_preview_content()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if old.content #>> '{workbook,officeCalculationMode}' = 'cached-readonly-v1'
     and new.content is distinct from old.content then
    perform office_private.fail('SPREADSHEET_PREVIEW_ONLY',
      'This spreadsheet is a read-only preview. Download the original to edit it.',409);
  end if;
  return new;
end;
$$;

create or replace function office_private.guard_cached_preview_proposal()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare parent_mode text;
begin
  -- The RPC already locks settings, then this same company/file before proposals.
  -- SHARE also protects the marker if a privileged caller inserts directly.
  select f.content #>> '{workbook,officeCalculationMode}' into parent_mode from office_private.files f
    where f.company_id = new.company_id and f.id = new.file_id for share;
  if parent_mode = 'cached-readonly-v1' then
    perform office_private.fail('SPREADSHEET_PREVIEW_ONLY',
      'This spreadsheet is a read-only preview. Download the original to edit it.',409);
  end if;
  return new;
end;
$$;

revoke all on function office_private.guard_cached_preview_content(),
  office_private.guard_cached_preview_proposal() from public,anon,authenticated,service_role;

drop trigger if exists office_cached_preview_content on office_private.files;
create trigger office_cached_preview_content before update of content on office_private.files
  for each row execute function office_private.guard_cached_preview_content();
drop trigger if exists office_cached_preview_proposal on office_private.proposals;
create trigger office_cached_preview_proposal before insert on office_private.proposals
  for each row execute function office_private.guard_cached_preview_proposal();
commit;
