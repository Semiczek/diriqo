-- LOCAL PGLITE BASELINE ONLY. Never run this fixture against hosted Supabase.
-- The local receipt table deliberately omits payment-ledger provenance and its
-- immutable write authority. These synthetic rows exercise calendar eligibility
-- selection; they are NOT genuine paid receipts or evidence of Stripe payment.
do $test$
declare
  company uuid:=gen_random_uuid(); foreign_company uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid();
  profile uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid(); event_id uuid;
  input jsonb:=jsonb_build_object('title','Local paid branch','description',null,
    'start_at','2026-11-01T10:00:00Z','end_at','2026-11-01T11:00:00Z','job_id',null,'assigned_profile_ids','[]'::jsonb);
  result jsonb; original jsonb; problem text; c record; passed jsonb:='[]';
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data) values(actor,'calendar-paid-'||actor||'@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name,is_active) values(profile,actor,actor,'Local paid admin',true);
    insert into public.companies(id,name) values(company,'Local paid fixture'),(foreign_company,'Local foreign fixture');
    insert into public.company_members(company_id,profile_id,role,is_active) values(company,profile,'company_admin',true);
    insert into public.company_modules(company_id,module_key,is_enabled) values(company,'calendar',true);
    insert into private.company_module_rollouts(company_id,product,livemode) values(company,'diriqo_core',true);
    insert into public.company_module_entitlements(id,company_id,product,register_id,policy_version,origin,state,revoked,livemode,valid_from,valid_until,capabilities)
      values(receipt,company,'diriqo_core',null,'diriqo-capabilities-v0.1','paid','active',false,true,
        now()-interval '1 hour',now()+interval '1 hour',array['core.calendar.manage']);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',actor::text,true);
    execute 'set local role authenticated';
    original:=public.create_calendar_event_atomic(company,input);
    event_id:=(original->'event'->>'id')::uuid;
    assert original->'event'->>'title'='Local paid branch','paid_eligible_receipt_allows_create';
    passed:=passed||jsonb_build_array('paid_eligible_receipt_allows_create');
    execute 'reset role';
    for c in select * from(values
      ('revoked','revoked=true'),
      ('expired','valid_until=clock_timestamp()-interval ''1 second'''),
      ('not_started','valid_from=clock_timestamp()+interval ''1 hour'',valid_until=clock_timestamp()+interval ''2 hours'''),
      ('wrong_product','product=''inventory'''),
      ('wrong_register','register_id=gen_random_uuid()'),
      ('wrong_capability','capabilities=array[''core.jobs.create'']'),
      ('wrong_policy','policy_version=''unsupported-policy'''),
      ('wrong_mode','livemode=false'),
      ('wrong_origin','origin=''manual_grant'''),
      ('inactive_state','state=''cancelled'''),
      ('wrong_company',format('company_id=%L',foreign_company))
    ) cases(label,mutation) loop
      update public.company_module_entitlements set company_id=company,product='diriqo_core',register_id=null,
        policy_version='diriqo-capabilities-v0.1',origin='paid',state='active',revoked=false,livemode=true,
        valid_from=now()-interval '1 hour',valid_until=now()+interval '1 hour',capabilities=array['core.calendar.manage']
        where id=receipt;
      execute 'update public.company_module_entitlements set '||c.mutation||' where id=$1' using receipt;
      execute 'set local role authenticated'; problem:=null;
      begin perform public.update_calendar_event_atomic(company,event_id,(original->'event'->>'revision')::bigint,
          input||jsonb_build_object('title','Must remain unchanged'));
        exception when others then get stacked diagnostics problem=message_text; end;
      assert problem='CALENDAR_MODULE_REQUIRED','paid_'||c.label||'_denied';
      result:=public.get_calendar_event_snapshot(company,event_id);
      assert result=original,'paid_'||c.label||'_preserves_readable_history';
      passed:=passed||jsonb_build_array('paid_'||c.label||'_denied_and_history_unchanged');
      execute 'reset role';
    end loop;
    raise exception 'rollback local paid fixture' using errcode='PT001';
  exception when sqlstate 'PT001' then null; end;
  assert not exists(select 1 from public.company_module_entitlements where id=receipt),'local_receipt_fixture_rolled_back';
  assert not exists(select 1 from public.companies where id in(company,foreign_company)),'local_paid_companies_rolled_back';
  perform set_config('diriqo.calendar_local_paid_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),
    'fixtures','rolled_back','cleanup_assertions',2,'boundary','simplified_local_receipt_schema_not_provider_provenance')::text,true);
end;
$test$;
select current_setting('diriqo.calendar_local_paid_result')::jsonb as result;
