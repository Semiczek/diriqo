-- Owner-run, rollback-only assertions over the real migration and public RPC.
-- Fault injection proves atomic rollback/rechecks, not hosted multi-session races.
do $test$
declare
 ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); ua uuid:=gen_random_uuid(); um uuid:=gen_random_uuid(); uw uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid();
 pa uuid:=gen_random_uuid(); pm uuid:=gen_random_uuid(); pw uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid();
 customer_a uuid:=gen_random_uuid(); customer_b uuid:=gen_random_uuid(); customer_second uuid:=gen_random_uuid();
 qa uuid:=gen_random_uuid(); ql uuid:=gen_random_uuid(); qf uuid:=gen_random_uuid(); qb uuid:=gen_random_uuid(); q uuid; qx uuid;
 result jsonb; repeated jsonb; expected jsonb; saved jsonb; saved_at timestamptz; before_row jsonb;
 c record; actor uuid; problem text; code text; affected_rows bigint; grant_id uuid; short_end timestamptz;
 passed jsonb:='[]'; marker text:='QuoteCustomerTest'||replace(gen_random_uuid()::text,'-','');
begin
 begin
  insert into auth.users(id,email,raw_user_meta_data) values
   (ua,marker||'a@example.invalid','{}'),(um,marker||'m@example.invalid','{}'),(uw,marker||'w@example.invalid','{}'),(ub,marker||'b@example.invalid','{}');
  insert into public.profiles(id,auth_user_id,user_id,full_name,is_active) values
   (pa,ua,ua,'Synthetic admin',true),(pm,um,um,'Synthetic manager',true),(pw,uw,uw,'Synthetic worker',true),(pb,ub,ub,'Foreign admin',true);
  insert into public.companies(id,name) values(ca,'Synthetic customer snapshot A'),(cb,'Synthetic customer snapshot B');
  insert into public.company_members(company_id,profile_id,role,is_active) values
   (ca,pa,'company_admin',true),(ca,pm,'manager',true),(ca,pw,'worker',true),(cb,pb,'company_admin',true);
  insert into public.company_modules(company_id,module_key,is_enabled) values(ca,'quotes',true),(cb,'quotes',true);
  insert into public.customers(id,company_id,name,billing_name,company_number,vat_number,billing_street,billing_city,billing_postal_code,billing_country,email,phone)
   values(customer_a,ca,'Original name','Original billing','12345678',null,'Original street','Original city','10000','CZ','original@example.invalid',null),
   (customer_b,cb,'Foreign name',null,null,null,'Foreign street',null,null,null,null,null),
   (customer_second,ca,'Other customer',null,null,null,null,null,null,null,null,null);
  expected:=jsonb_build_object('version',1,'name','Original name','billingName','Original billing','companyNumber','12345678','vatNumber',null,
    'billingStreet','Original street','billingCity','Original city','billingPostalCode','10000','billingCountry','CZ','email','original@example.invalid','phone',null);
  insert into public.quotes(id,company_id,customer_id,title) values
    (qa,ca,customer_a,'Snapshot target'),(qf,ca,customer_a,'Rollback target'),(qb,cb,customer_b,'Foreign target'),(ql,ca,customer_a,'Legacy draft');
  assert exists(select 1 from public.quotes where id=qa and customer_identity_state='draft' and customer_snapshot is null and customer_snapshot_captured_at is null),'new_draft_has_no_snapshot';
  passed:=passed||jsonb_build_array('new_draft_has_no_snapshot');
  -- Only owner fixture setup simulates a row which predates migration. API callers cannot do this.
  alter table public.quotes disable trigger guard_quote_customer_identity;
  update public.quotes set customer_identity_state='legacy_unknown',share_token=repeat('b',48) where id=ql;
  alter table public.quotes enable trigger guard_quote_customer_identity;
  perform set_config('request.jwt.claim.sub',ua::text,true);
  execute 'set local role authenticated';
  result:=public.publish_core_quote_customer_identity(ca,qa);
  assert result->>'quoteId'=qa::text and result->>'state'='captured' and (result->>'shareToken') ~ '^[a-f0-9]{64}$' and result->>'capturedAt' is not null,'publication_result_contract';
  execute 'reset role';
  select customer_snapshot,customer_snapshot_captured_at into saved,saved_at from public.quotes where id=qa;
  assert saved=expected,'full_identity_preserves_nulls';
  assert (select customer_snapshot_captured_by from public.quotes where id=qa)=pa,'publication_actor_preserved';
  passed:=passed||jsonb_build_array('publication_actor_preserved');
  assert exists(select 1 from public.quotes where id=qa and status='draft' and sent_at is null and share_enabled),'publication_does_not_claim_mail_sent';
  passed:=passed||jsonb_build_array('publication_result_contract','full_identity_preserves_nulls','publication_does_not_claim_mail_sent');
  update public.customers set name='Current name',billing_street='Current street',vat_number='CZ999',phone='999' where id=customer_a;
  execute 'set local role authenticated';
  repeated:=public.publish_core_quote_customer_identity(ca,qa);
  assert repeated=result,'retry_preserves_token_and_capture_time';
  execute 'reset role';
  assert (select customer_snapshot from public.quotes where id=qa)=expected,'customer_edit_does_not_rewrite_history';
  execute 'set local role anon';
  assert (select customer_name from public.get_public_offer_by_token(result->>'shareToken'))='Original name','public_rpc_uses_historical_name';
  assert (select customer_name from public.get_public_offer_by_token(repeat('b',48))) is null,'legacy_public_name_has_no_live_fallback';
  execute 'reset role';
  passed:=passed||jsonb_build_array('retry_preserves_token_and_capture_time','customer_edit_does_not_rewrite_history','public_rpc_uses_historical_name','legacy_public_name_has_no_live_fallback');
  execute 'set local role authenticated';
  repeated:=public.publish_core_quote_customer_identity(ca,ql);
  assert repeated->>'state'='legacy_unknown' and repeated->>'capturedAt' is null and repeated->>'shareToken'=repeat('b',48),'legacy_publish_never_backfills_or_rotates_token';
  update public.quotes set status='sent',sent_at=clock_timestamp() where id=qa;
  update public.quotes set status='draft',sent_at=null,accepted_at=null,rejected_at=null,share_token=null,share_enabled=false where id=qa;
  execute 'reset role';
  assert (select customer_snapshot from public.quotes where id=qa)=expected and (select customer_snapshot_captured_at from public.quotes where id=qa)=saved_at,'return_to_draft_cannot_unlock_identity';
  assert exists(select 1 from public.quotes where id=ql and customer_identity_state='legacy_unknown' and customer_snapshot is null),'legacy_stays_unknown';
  passed:=passed||jsonb_build_array('legacy_publish_never_backfills_or_rotates_token','return_to_draft_cannot_unlock_identity','legacy_stays_unknown');
  q:=gen_random_uuid();
  insert into public.quotes(id,company_id,customer_id,title,status) values(q,ca,customer_second,'Ready but unpublished','ready');
  assert exists(select 1 from public.quotes where id=q and customer_identity_state='draft' and customer_snapshot is null),'ready_is_not_publication';
  update public.customers set name='Ready updated name' where id=customer_second;
  execute 'set local role authenticated'; repeated:=public.publish_core_quote_customer_identity(ca,q); execute 'reset role';
  assert exists(select 1 from public.quotes where id=q and customer_snapshot->>'name'='Ready updated name' and customer_snapshot_captured_by=pa),'ready_publishes_current_identity_and_actor';
  passed:=passed||jsonb_build_array('ready_is_not_publication','ready_publishes_current_identity_and_actor');
  -- All existing publication paths, including direct UPDATE and INSERT, cross the same trigger.
  for c in select * from(values
    ('share_token='||quote_literal(repeat('c',64)),'share_token'),
    ('share_enabled=true','share_enabled'),('status=''sent''','sent'),
    ('status=''viewed''','viewed'),('status=''accepted''','accepted'),('status=''rejected''','rejected'),
    ('status=''waiting_followup''','waiting_followup'),('status=''revision_requested''','revision_requested'),
    ('sent_at=clock_timestamp()','sent_at'),('accepted_at=clock_timestamp()','accepted_at'),('rejected_at=clock_timestamp()','rejected_at'),
    ('viewed_at=clock_timestamp()','viewed_at')
  ) x(mutation,label) loop
    q:=gen_random_uuid();
    insert into public.quotes(id,company_id,customer_id,title) values(q,ca,customer_a,'Transition '||c.label);
    execute 'set local role authenticated';
    execute 'update public.quotes set '||c.mutation||' where id=$1' using q;
    execute 'reset role';
    assert exists(select 1 from public.quotes where id=q and customer_identity_state='captured' and customer_snapshot->>'name'='Current name'),'capture_'||c.label;
    passed:=passed||jsonb_build_array('capture_'||c.label);
  end loop;
  q:=gen_random_uuid(); execute 'set local role authenticated';
  insert into public.quotes(id,company_id,customer_id,title,status) values(q,ca,customer_a,'Direct sent insert','sent');
  execute 'reset role';
  assert exists(select 1 from public.quotes where id=q and customer_identity_state='captured'),'insert_publication_captured';
  passed:=passed||jsonb_build_array('insert_publication_captured');
  -- Null customer identity remains null after later live data changes; no inferred address.
  qx:=gen_random_uuid(); insert into public.quotes(id,company_id,title) values(qx,ca,'No customer');
  execute 'set local role authenticated'; repeated:=public.publish_core_quote_customer_identity(ca,qx); execute 'reset role';
  assert exists(select 1 from public.quotes where id=qx and customer_identity_state='captured' and customer_snapshot->'name'='null'::jsonb
    and customer_snapshot ? 'billingStreet' and customer_snapshot->'billingStreet'='null'::jsonb),'no_customer_has_explicit_null_identity';
  passed:=passed||jsonb_build_array('no_customer_has_explicit_null_identity');
  for c in select * from(values
   (format('update public.quotes set customer_snapshot_captured_by=%L where id=%L',pm,qa),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('insert into public.quotes(company_id,title,customer_snapshot_captured_by) values(%L,''Forged actor'',%L)',ca,pm),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('update public.quotes set customer_snapshot=''{}'' where id=%L',qa),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('update public.quotes set customer_identity_state=''draft'' where id=%L',qa),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('update public.quotes set customer_snapshot_captured_at=clock_timestamp() where id=%L',qa),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('update public.quotes set customer_snapshot=%L,customer_identity_state=''captured'',customer_snapshot_captured_at=now() where id=%L',expected,qf),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('insert into public.quotes(company_id,title,customer_identity_state) values(%L,''Forged legacy'',''legacy_unknown'')',ca),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('insert into public.quotes(company_id,title,customer_snapshot) values(%L,''Forged snapshot'',''{}'')',ca),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('update public.quotes set customer_id=%L where id=%L',customer_second,qa),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('update public.quotes set customer_id=null where id=%L',qa),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('update public.quotes set company_id=%L where id=%L',cb,qa),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('update public.quotes set customer_identity_state=''draft'' where id=%L',ql),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('update public.quotes set customer_id=%L where id=%L',customer_second,ql),'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE','23514'),
   (format('select public.publish_core_quote_customer_identity(%L,%L)',cb,qb),'QUOTE_CUSTOMER_FORBIDDEN','42501'),
   (format('select public.publish_core_quote_customer_identity(%L,%L)',ca,qb),'QUOTE_CUSTOMER_NOT_FOUND','P0002'),
   (format('select public.publish_core_quote_customer_identity(null,%L)',qa),'QUOTE_CUSTOMER_INPUT_INVALID','22023'),
   (format('update public.quotes set customer_id=%L,status=''sent'' where id=%L',customer_b,qf),'QUOTE_CUSTOMER_SCOPE_INVALID','23514')
  ) x(query,expected,expected_code) loop
   execute 'set local role authenticated'; problem:=null; code:=null;
   begin execute c.query; exception when others then get stacked diagnostics problem=message_text,code=returned_sqlstate; end;
   assert problem=c.expected and code=c.expected_code,'negative_'||c.expected||'_got_'||coalesce(problem,'NO_ERROR');
   execute 'reset role'; passed:=passed||jsonb_build_array(c.expected);
  end loop;
  select to_jsonb(x) into before_row from public.quotes x where id=qf;
  assert before_row is not null,'worker_target_exists_before_denial';
  perform set_config('request.jwt.claim.sub',uw::text,true); execute 'set local role authenticated';
  problem:=null; code:=null; affected_rows:=null;
  begin
    update public.quotes set status='sent' where id=qf;
    get diagnostics affected_rows=row_count;
  exception when others then get stacked diagnostics problem=message_text,code=returned_sqlstate; end;
  execute 'reset role';
  -- Hosted RLS may hide the row before the BEFORE trigger can reject the write.
  -- Accept exactly that zero-row result or the exact trigger denial, never a write.
  assert ((problem='QUOTE_CUSTOMER_FORBIDDEN' and code='42501' and affected_rows is null)
    or (problem is null and code is null and affected_rows=0)) is true,'direct_worker_publication_denied';
  assert (select to_jsonb(x) from public.quotes x where id=qf)=before_row,'direct_worker_entire_quote_unchanged';
  passed:=passed||jsonb_build_array('direct_worker_publication_denied');
  perform set_config('request.jwt.claim.sub','',true); problem:=null;
  begin update public.quotes set status='sent' where id=qf; exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='QUOTE_CUSTOMER_FORBIDDEN','direct_unauthenticated_publication_denied';
  passed:=passed||jsonb_build_array('direct_unauthenticated_publication_denied');
  perform set_config('request.jwt.claim.sub',ua::text,true);
  assert exists(select 1 from public.quotes where id=qf and customer_id=customer_a and customer_identity_state='draft' and status='draft'),'cross_tenant_failure_rolls_back';
  passed:=passed||jsonb_build_array('cross_tenant_failure_rolls_back');
  -- Manager has the same supported publication role as the server action; worker and foreign actor do not.
  perform set_config('request.jwt.claim.sub',um::text,true); execute 'set local role authenticated';
  repeated:=public.publish_core_quote_customer_identity(ca,qf); execute 'reset role';
  assert repeated->>'state'='captured','manager_can_publish'; passed:=passed||jsonb_build_array('manager_can_publish');
  for actor in select unnest(array[uw,ub]) loop
   perform set_config('request.jwt.claim.sub',actor::text,true); execute 'set local role authenticated'; problem:=null;
   begin perform public.publish_core_quote_customer_identity(ca,qa); exception when others then get stacked diagnostics problem=message_text; end;
   assert problem='QUOTE_CUSTOMER_FORBIDDEN','worker_or_foreign_denied'; execute 'reset role'; passed:=passed||jsonb_build_array('worker_or_foreign_denied');
  end loop;
  perform set_config('request.jwt.claim.sub',ua::text,true);
  for c in select * from(values
   ('update public.profiles set is_active=false where id=$1','update public.profiles set is_active=true where id=$1'),
   ('update public.company_members set is_active=false where profile_id=$1','update public.company_members set is_active=true where profile_id=$1')
  ) x(disable,enable) loop
   execute c.disable using pa; execute 'set local role authenticated'; problem:=null;
   begin perform public.publish_core_quote_customer_identity(ca,qa); exception when others then get stacked diagnostics problem=message_text; end;
   assert problem='QUOTE_CUSTOMER_FORBIDDEN','revoked_actor_cannot_retry'; execute 'reset role'; execute c.enable using pa;
   passed:=passed||jsonb_build_array('revoked_actor_cannot_retry');
  end loop;
  update public.company_modules set is_enabled=false where company_id=ca and module_key='quotes';
  execute 'set local role authenticated'; problem:=null;
  begin perform public.publish_core_quote_customer_identity(ca,qa); exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='QUOTE_CUSTOMER_MODULE_REQUIRED','disabled_quotes_denied'; execute 'reset role';
  update public.company_modules set is_enabled=true where company_id=ca and module_key='quotes';
  passed:=passed||jsonb_build_array('disabled_quotes_denied');
  for c in select unnest(array['anon','service_role']) role_name loop
   execute format('set local role %I',c.role_name); problem:=null;
   begin perform public.publish_core_quote_customer_identity(ca,qa); exception when insufficient_privilege then problem:='denied'; end;
   assert problem='denied','rpc_acl_denied'; execute 'reset role'; passed:=passed||jsonb_build_array(c.role_name||'_rpc_denied');
  end loop;
  execute 'set local role authenticated'; problem:=null;
  begin perform private.assert_quote_customer_publication(ca); exception when insufficient_privilege then problem:='denied'; end;
  assert problem='denied','private_helper_denied'; execute 'reset role'; passed:=passed||jsonb_build_array('private_helper_denied');
  -- Rollback faults happen after the BEFORE trigger has produced the snapshot.
  create function private.quote_customer_test_fault() returns trigger language plpgsql as $fault$
  begin
   if new.title='Injected failure' then raise exception 'INJECTED_PUBLICATION_FAILURE'; end if;
   if new.title='Injected revoke' then update public.company_members set is_active=false where company_id=new.company_id; end if;
   if new.title='Injected expiry' then perform pg_sleep(0.25); end if;
   return new;
  end;
  $fault$;
  create trigger quote_customer_test_fault after update on public.quotes for each row execute function private.quote_customer_test_fault();
  for c in select * from(values('Injected failure','INJECTED_PUBLICATION_FAILURE'),('Injected revoke','QUOTE_CUSTOMER_FORBIDDEN')) x(title,expected) loop
   q:=gen_random_uuid(); insert into public.quotes(id,company_id,customer_id,title) values(q,ca,customer_a,c.title);
   select to_jsonb(x) into before_row from public.quotes x where id=q;
   execute 'set local role authenticated'; problem:=null;
   begin perform public.publish_core_quote_customer_identity(ca,q); exception when others then get stacked diagnostics problem=message_text; end;
   assert problem=c.expected,'injected_'||c.expected; execute 'reset role';
   assert (select to_jsonb(x) from public.quotes x where id=q)=before_row,'snapshot_and_token_rollback';
   assert exists(select 1 from public.company_members where company_id=ca and profile_id=pa and is_active),'late_revoke_rollback';
   passed:=passed||jsonb_build_array(c.expected||'_whole_transaction_rollback');
  end loop;
  insert into private.company_module_rollouts(company_id,product,livemode) values(ca,'diriqo_core',false);
  execute 'set local role authenticated'; problem:=null;
  begin perform public.publish_core_quote_customer_identity(ca,qa); exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='QUOTE_CUSTOMER_MODULE_REQUIRED','enforced_missing_core_denied'; execute 'reset role';
  grant_id:=gen_random_uuid();
  insert into private.company_test_module_grants(id,company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
   values(grant_id,ca,'diriqo_core',marker,'Snapshot test',now()-interval '1 hour',now()+interval '1 hour',now()+interval '1 hour',array['core.quotes.create']);
  execute 'set local role authenticated'; repeated:=public.publish_core_quote_customer_identity(ca,qa); execute 'reset role';
  assert repeated->>'state'='captured','core_quote_capability_allows_retry';
  perform set_config('request.jwt.claim.sub',um::text,true); execute 'set local role authenticated';
  repeated:=public.publish_core_quote_customer_identity(ca,qa); execute 'reset role';
  assert repeated->>'state'='captured','manager_with_core_quote_capability';
  passed:=passed||jsonb_build_array('manager_with_core_quote_capability');
  perform set_config('request.jwt.claim.sub',ua::text,true);
  update private.company_test_module_grants set revoked_at=clock_timestamp(),revocation_reason='Synthetic test revocation' where id=grant_id;
  execute 'set local role authenticated'; problem:=null;
  begin perform public.publish_core_quote_customer_identity(ca,qa); exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='QUOTE_CUSTOMER_MODULE_REQUIRED','revoked_capability_denied'; execute 'reset role';
  passed:=passed||jsonb_build_array('enforced_missing_core_denied','core_quote_capability_allows_retry','revoked_capability_denied');
  q:=gen_random_uuid(); insert into public.quotes(id,company_id,customer_id,title) values(q,ca,customer_a,'Injected expiry');
  short_end:=clock_timestamp()+interval '200 milliseconds';
  insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
   values(ca,'diriqo_core',marker||'-short','Expiry test',short_end-interval '1 hour',short_end,short_end,array['core.quotes.create']);
  select to_jsonb(x) into before_row from public.quotes x where id=q;
  execute 'set local role authenticated'; problem:=null;
  begin perform public.publish_core_quote_customer_identity(ca,q); exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='QUOTE_CUSTOMER_MODULE_REQUIRED','expiry_during_publication_denied'; execute 'reset role';
  assert (select to_jsonb(x) from public.quotes x where id=q)=before_row,'expiry_rolls_back_snapshot_token';
  passed:=passed||jsonb_build_array('expiry_rolls_back_snapshot_token');
  drop trigger quote_customer_test_fault on public.quotes;
  -- Actual FK deletion is allowed and cannot erase captured identity or invent legacy data.
  delete from public.customers where id=customer_a;
  assert exists(select 1 from public.quotes where id=qa and customer_id is null and customer_snapshot=expected),'customer_delete_preserves_snapshot';
  assert exists(select 1 from public.quotes where id=ql and customer_id is null and customer_identity_state='legacy_unknown' and customer_snapshot is null),'customer_delete_preserves_legacy_unknown';
  passed:=passed||jsonb_build_array('customer_delete_preserves_snapshot','customer_delete_preserves_legacy_unknown');
  delete from public.company_members where profile_id=pa;
  delete from public.profiles where id=pa;
  assert (select customer_snapshot_captured_by from public.quotes where id=qa)=pa,'deleted_profile_does_not_rewrite_capture_actor';
  passed:=passed||jsonb_build_array('deleted_profile_does_not_rewrite_capture_actor');
  raise exception 'ROLLBACK_SYNTHETIC' using errcode='PT001';
 exception when sqlstate 'PT001' then null; end;
 assert not exists(select 1 from public.companies where id in(ca,cb)),'companies_removed';
 assert not exists(select 1 from auth.users where id in(ua,um,uw,ub)),'auth_removed';
 assert not exists(select 1 from public.quotes where company_id in(ca,cb)),'quotes_removed';
 perform set_config('diriqo.quote_customer_test_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),'fixtures','rolled_back','cleanup_assertions',3)::text,true);
end;
$test$;
select current_setting('diriqo.quote_customer_test_result')::jsonb as result;
