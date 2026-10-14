-- Extend only the export audit allowlist. Keep the installed tenant, author,
-- sharing, role and audit implementation and its existing EXECUTE privileges.
-- DOC is import-only and must not be accepted as an export format.
begin;
set local lock_timeout = '5s';

do $migration$
declare
  request_function regprocedure := to_regprocedure('public.office_request(uuid,jsonb,text)');
  definition text;
  old_clause constant text := $old$if coalesce(p_request->>'format','') not in ('docx','xlsx','csv','txt','html','pdf','print') then perform office_private.fail('UNSUPPORTED_FORMAT','Unsupported format.');end if;$old$;
  new_clause constant text := $new$if coalesce(p_request->>'format','') not in ('docx','xlsx','csv','txt','html','pdf','print','odt','ods','xls','tsv') then perform office_private.fail('UNSUPPORTED_FORMAT','Unsupported format.');end if;$new$;
  old_count integer;
  new_count integer;
begin
  if request_function is null then
    raise exception 'OFFICE_EXPORT_MIGRATION_MISSING_FUNCTION';
  end if;
  definition := pg_get_functiondef(request_function);
  old_count := (length(definition) - length(replace(definition, old_clause, ''))) / length(old_clause);
  new_count := (length(definition) - length(replace(definition, new_clause, ''))) / length(new_clause);
  if old_count = 1 and new_count = 0 then
    execute replace(definition, old_clause, new_clause);
  elsif old_count = 0 and new_count = 1 then
    -- Safe to apply again without recreating a function or changing privileges.
    null;
  else
    -- Never guess when an earlier migration or manual change has changed the API.
    raise exception 'OFFICE_EXPORT_MIGRATION_UNEXPECTED_FUNCTION';
  end if;
end;
$migration$;

commit;
