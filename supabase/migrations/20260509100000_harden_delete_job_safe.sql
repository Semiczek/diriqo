begin;

create or replace function public.delete_job_safe(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_job record;
  job_ids uuid[];
  fk_row record;
begin
  if p_job_id is null then
    raise exception 'Missing job id.' using errcode = '22023';
  end if;

  select j.id, j.company_id
  into target_job
  from public.jobs j
  where j.id = p_job_id;

  if not found then
    raise exception 'Job was not found.' using errcode = 'P0002';
  end if;

  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = target_job.company_id
      and cm.is_active = true
      and cm.role in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  ) then
    raise exception 'You do not have permission to delete this job.' using errcode = '42501';
  end if;

  job_ids := array[p_job_id];

  -- Parent deletion detaches child jobs instead of deleting real day work.
  update public.jobs
  set parent_job_id = null
  where parent_job_id = p_job_id
    and company_id = target_job.company_id;

  -- Payroll/time evidence must stay available; only remove the job link.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'work_shifts'
      and column_name = 'job_id'
  ) then
    update public.work_shifts
    set job_id = null
    where job_id = any(job_ids);
  end if;

  -- Invoice snapshots must stay available; only remove the source job link.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoice_items'
      and column_name = 'source_job_id'
  ) then
    update public.invoice_items
    set source_job_id = null
    where source_job_id = any(job_ids);
  end if;

  -- Clean every remaining single-column FK to public.jobs(id). Nullable links are detached,
  -- required links are deleted, so no orphaned or blocking records remain.
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
  where id = any(job_ids)
    and company_id = target_job.company_id;
end;
$$;

revoke all on function public.delete_job_safe(uuid) from public;
grant execute on function public.delete_job_safe(uuid) to authenticated;

commit;
