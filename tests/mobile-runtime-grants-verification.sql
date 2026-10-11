-- Run after the migration in Diriqo only. Contains no data writes.
-- Checks actual effective privileges, unlike mocked TypeScript route tests.
begin;
do $$
declare needed record; c text;
begin
  for needed in select * from (values
    ('jobs','SELECT',array['id','company_id','parent_job_id','title','address','start_at','status','created_at']),
    ('jobs','UPDATE',array['status','work_state']),
    ('company_members','SELECT',array['id','company_id','profile_id','role','is_active']),
    ('profiles','SELECT',array['id','full_name']),
    ('work_shifts','SELECT',array['id','company_id','profile_id','job_id','started_at','ended_at']),
    ('work_shifts','INSERT',array['company_id','profile_id','job_id','shift_date','started_at','status','note']),
    ('work_shifts','UPDATE',array['ended_at','status']),
    ('job_assignments','SELECT',array['id','company_id','job_id','profile_id','archived_at']),
    ('job_assignments','UPDATE',array['status','work_started_at','completed_at','work_completed_at']),
    ('job_photos','SELECT',array['id','company_id','job_id','photo_type','file_name','note','taken_at','storage_path','thumb_storage_path']),
    ('job_photos','INSERT',array['id','company_id','job_id','uploaded_by','photo_type','file_name','note','mime_type','size_bytes','taken_at','storage_path','thumb_storage_path'])
  ) as requirements(tbl,operation,cols) loop
    foreach c in array needed.cols loop
      if not has_column_privilege('service_role','public.'||needed.tbl,c,needed.operation) then
        raise exception 'MOBILE_GRANT_MISSING: %.% %', needed.tbl,c,needed.operation;
      end if;
    end loop;
  end loop;
  if has_column_privilege('service_role','public.profiles','email','SELECT')
    or has_column_privilege('service_role','public.jobs','price','UPDATE')
    or has_table_privilege('service_role','public.company_members','INSERT')
    or has_table_privilege('service_role','public.work_shifts','DELETE') then
    raise exception 'MOBILE_GRANTS_TOO_BROAD';
  end if;
end $$;

set local role service_role;
-- Compile/execute the real query shapes using an impossible company; no PII output.
select id,title,address,start_at,status from public.jobs where company_id='00000000-0000-0000-0000-000000000000' order by created_at desc limit 100;
select count(*) from public.jobs where company_id='00000000-0000-0000-0000-000000000000';
select id,profile_id,role from public.company_members where company_id='00000000-0000-0000-0000-000000000000' and is_active order by id limit 100;
select id,profile_id,job_id,started_at from public.work_shifts where company_id='00000000-0000-0000-0000-000000000000' and ended_at is null order by started_at limit 100;
select id,full_name from public.profiles where id='00000000-0000-0000-0000-000000000000';
select id,parent_job_id from public.jobs where company_id='00000000-0000-0000-0000-000000000000';
select job_id from public.job_assignments where company_id='00000000-0000-0000-0000-000000000000' and profile_id='00000000-0000-0000-0000-000000000000' and archived_at is null;
select p.storage_path,p.file_name,p.job_id from public.job_photos p join public.jobs j on j.id=p.job_id where j.company_id='00000000-0000-0000-0000-000000000000';
reset role;
select 'MOBILE_SERVER_RUNTIME_GRANTS_PASS' as result;
rollback;
