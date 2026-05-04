-- Robust delete for grouped jobs.
-- If deleting a parent job, child jobs are preserved and detached first.
-- If deleting a child job, only that child job is deleted.
-- Attendance shifts and invoice item snapshots keep their history by nulling job links.

create or replace function public.delete_job_safe(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_ids uuid[];
  fk_row record;
begin
  job_ids := array[p_job_id];

  if job_ids is null or array_length(job_ids, 1) is null then
    return;
  end if;

  -- Deleting a synthetic/main parent must not delete the real day jobs.
  update public.jobs
  set parent_job_id = null
  where parent_job_id = p_job_id;

  -- Preserve attendance rows; they belong to payroll even if the job is removed.
  if to_regclass('public.work_shifts') is not null then
    update public.work_shifts
    set job_id = null
    where job_id = any(job_ids);
  end if;

  -- Preserve invoice item snapshots; invoices must not disappear with jobs.
  if to_regclass('public.invoice_items') is not null then
    update public.invoice_items
    set source_job_id = null
    where source_job_id = any(job_ids);
  end if;

  -- Clean every remaining FK pointing at public.jobs(id). Nullable links are detached,
  -- required links are deleted. This covers optional modules/tables without hardcoding them.
  for fk_row in
    select
      child_ns.nspname as child_schema,
      child_cls.relname as child_table,
      child_att.attname as child_column,
      child_att.attnotnull as child_not_null
    from pg_constraint con
    join pg_class parent_cls on parent_cls.oid = con.confrelid
    join pg_namespace parent_ns on parent_ns.oid = parent_cls.relnamespace
    join pg_class child_cls on child_cls.oid = con.conrelid
    join pg_namespace child_ns on child_ns.oid = child_cls.relnamespace
    join unnest(con.conkey) with ordinality as child_key(attnum, ord) on true
    join unnest(con.confkey) with ordinality as parent_key(attnum, ord) on parent_key.ord = child_key.ord
    join pg_attribute child_att on child_att.attrelid = child_cls.oid and child_att.attnum = child_key.attnum
    join pg_attribute parent_att on parent_att.attrelid = parent_cls.oid and parent_att.attnum = parent_key.attnum
    where con.contype = 'f'
      and parent_ns.nspname = 'public'
      and parent_cls.relname = 'jobs'
      and parent_att.attname = 'id'
      and array_length(con.conkey, 1) = 1
      and not (child_ns.nspname = 'public' and child_cls.relname = 'jobs' and child_att.attname = 'parent_job_id')
      and not (child_ns.nspname = 'public' and child_cls.relname = 'work_shifts' and child_att.attname = 'job_id')
      and not (child_ns.nspname = 'public' and child_cls.relname = 'invoice_items' and child_att.attname = 'source_job_id')
  loop
    if fk_row.child_not_null then
      execute format(
        'delete from %I.%I where %I = any($1)',
        fk_row.child_schema,
        fk_row.child_table,
        fk_row.child_column
      )
      using job_ids;
    else
      execute format(
        'update %I.%I set %I = null where %I = any($1)',
        fk_row.child_schema,
        fk_row.child_table,
        fk_row.child_column,
        fk_row.child_column
      )
      using job_ids;
    end if;
  end loop;

  delete from public.jobs
  where id = any(job_ids);
end;
$$;

grant execute on function public.delete_job_safe(uuid) to authenticated;
