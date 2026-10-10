-- Run only against the explicitly authorized Diriqo test environment.
-- Every synthetic row (including trigger-generated data) is rolled back by the inner exception.
do $test$
declare
  u_admin uuid := gen_random_uuid(); u_worker uuid := gen_random_uuid();
  u_platform uuid := gen_random_uuid(); u_other uuid := gen_random_uuid(); u_new uuid := gen_random_uuid();
  p_admin uuid := gen_random_uuid(); p_worker uuid := gen_random_uuid();
  p_other uuid := gen_random_uuid(); p_email uuid := gen_random_uuid();
  c_admin uuid := gen_random_uuid(); c_other uuid := gen_random_uuid();
  m_admin uuid := gen_random_uuid(); m_worker uuid := gen_random_uuid();
  audit_event uuid := gen_random_uuid();
  new_company uuid; new_profile uuid; denied boolean; passed jsonb := '[]';
begin
  begin

    insert into auth.users(id, email, raw_user_meta_data) values
      (u_admin, 'admin-' || u_admin::text || '@example.invalid', '{"is_super_admin":true,"platform_role":"admin"}'),
      (u_worker, 'worker-' || u_worker::text || '@example.invalid', '{}'),
      (u_platform, 'platform-' || u_platform::text || '@example.invalid', '{}'),
      (u_other, 'other-' || u_other::text || '@example.invalid', '{}'),
      (u_new, 'new-' || u_new::text || '@example.invalid', '{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name,email) values
      (p_admin,u_admin,u_admin,'Synthetic admin',null),
      (p_worker,u_worker,u_worker,'Synthetic worker',null),
      (p_other,u_other,u_other,'Synthetic other',null),
      (p_email,null,null,'Synthetic unlinked email', 'new-' || u_new::text || '@example.invalid');
    insert into public.companies(id,name) values (c_admin,'Synthetic boundary A'), (c_other,'Synthetic boundary B');
    insert into public.company_members(id,company_id,profile_id,role,is_active) values
      (m_admin,c_admin,p_admin,'company_admin',true),
      (m_worker,c_admin,p_worker,'worker',true),
      (gen_random_uuid(),c_other,p_other,'company_admin',true);
    insert into private.platform_admin_grants(auth_user_id,reason)
      values (u_platform,'Synthetic rollback-only verification');
    insert into public.superadmin_audit_log(id,actor_auth_user_id,action)
      values(audit_event,u_platform,'synthetic_seeded_event');

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    assert not public.is_super_admin(), 'tenant admin and metadata must not grant platform';
    passed := passed || jsonb_build_array('tenant_admin_and_user_metadata_denied');
denied := false;
begin
  update public.company_members set role='super_admin' where id=m_admin;
exception when insufficient_privilege then denied := true;
end;
assert denied, 'membership_update_to_super_admin_denied';
passed := passed || jsonb_build_array('membership_update_to_super_admin_denied');
denied := false;
begin
  insert into public.company_members(company_id,profile_id,role) values(c_admin,p_email,'super_admin');
exception when insufficient_privilege then denied := true;
end;
assert denied, 'membership_insert_super_admin_denied';
passed := passed || jsonb_build_array('membership_insert_super_admin_denied');
denied := false;
begin
  update public.company_members set profile_id=p_other where id=m_worker;
exception when insufficient_privilege then denied := true;
end;
assert denied, 'membership_identity_rewrite_denied';
passed := passed || jsonb_build_array('membership_identity_rewrite_denied');
denied := false;
begin
  update public.profiles set auth_user_id=u_platform where id=p_admin;
exception when insufficient_privilege then denied := true;
end;
assert denied, 'own_profile_auth_relink_denied';
passed := passed || jsonb_build_array('own_profile_auth_relink_denied');
denied := false;
begin
  update public.profiles set user_id=u_admin where id=p_worker;
exception when insufficient_privilege then denied := true;
end;
assert denied, 'coworker_profile_auth_relink_denied';
passed := passed || jsonb_build_array('coworker_profile_auth_relink_denied');
denied := false;
begin
  insert into public.profiles(auth_user_id,user_id,full_name) values(u_admin,u_platform,'Synthetic mismatch');
exception when insufficient_privilege then denied := true;
end;
assert denied, 'profile_identity_insert_denied';
passed := passed || jsonb_build_array('profile_identity_insert_denied');
insert into public.company_members(company_id,profile_id,role) values(c_admin,p_other,'worker');
denied := false;
begin
  update public.profiles set auth_user_id=u_admin,user_id=u_admin where id=p_other;
exception when insufficient_privilege then denied := true;
end;
assert denied, 'foreign_profile_attached_to_own_company_cannot_be_relinked';
passed := passed || jsonb_build_array('foreign_profile_attached_to_own_company_cannot_be_relinked');
denied := false;
begin
  insert into private.platform_admin_grants(auth_user_id,reason) values(u_admin,'Synthetic unauthorized');
exception when insufficient_privilege then denied := true;
end;
assert denied, 'private_grant_insert_denied';
passed := passed || jsonb_build_array('private_grant_insert_denied');
denied := false;
begin
  perform * from private.platform_admin_grants;
exception when insufficient_privilege then denied := true;
end;
assert denied, 'private_grant_read_denied';
passed := passed || jsonb_build_array('private_grant_read_denied');
denied := false;
begin
  insert into public.superadmin_audit_log(actor_auth_user_id,action) values(u_admin,'synthetic_denied');
exception when insufficient_privilege then denied := true;
end;
assert denied, 'tenant_cannot_write_platform_log';
passed := passed || jsonb_build_array('tenant_cannot_write_platform_log');
    assert not exists(select 1 from public.superadmin_audit_log where id=audit_event), 'tenant read platform log';
    passed := passed || jsonb_build_array('tenant_cannot_read_platform_log');

    update public.profiles set full_name='Synthetic legitimate edit' where id=p_admin;
    assert found, 'legitimate own profile edit';
    update public.profiles set phone='+420000000000' where id=p_worker;
    assert found, 'legitimate worker profile edit';
    passed := passed || jsonb_build_array('legitimate_profile_edits');
    new_profile := public.create_worker_profile_for_invite(c_admin,'Synthetic invited worker',null,'+420000000001','employee',0,'hourly');
    assert new_profile is not null, 'worker provision failed';
    assert exists(select 1 from public.company_members where profile_id=new_profile and company_id=c_admin and role='worker'), 'worker membership failed';
    passed := passed || jsonb_build_array('worker_invite_provisioning');
    execute 'reset role';

    -- A legacy tenant super_admin label deliberately planted by the fixture is still powerless.
    update public.company_members set role='super_admin' where id=m_admin;
    execute 'set local role authenticated';
    assert not public.is_super_admin(), 'legacy role must not grant platform';
    passed := passed || jsonb_build_array('legacy_super_admin_label_denied');
    execute 'reset role';

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_worker,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_worker::text,true);
    execute 'set local role authenticated';
    assert not public.is_super_admin(), 'worker platform access';
    update public.company_members set role='company_admin' where id=m_worker;
    assert not found, 'worker edited membership';
    update public.profiles set full_name='Synthetic worker self-edit' where id=p_worker;
    assert found, 'worker self edit';
    passed := passed || jsonb_build_array('worker_role_and_self_edit');
    execute 'reset role';

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_platform,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_platform::text,true);
    execute 'set local role authenticated';
    assert public.is_super_admin(), 'independent operator needs no profile or company';
    assert exists(select 1 from public.superadmin_audit_log where id=audit_event), 'platform cannot read audit';
    insert into public.superadmin_audit_log(actor_auth_user_id,action) values(u_platform,'synthetic_platform_event');
    passed := passed || jsonb_build_array('platform_without_membership_and_auth_actor_audit');
denied := false;
begin
  insert into public.superadmin_audit_log(actor_auth_user_id,action) values(u_admin,'synthetic_forged_actor');
exception when insufficient_privilege then denied := true;
end;
assert denied, 'platform_cannot_forge_audit_actor';
passed := passed || jsonb_build_array('platform_cannot_forge_audit_actor');

    execute 'reset role';
    update private.platform_admin_grants set is_active=false where auth_user_id=u_platform;
    execute 'set local role authenticated';
    assert not public.is_super_admin(), 'revocation must be immediate';
    assert not exists(select 1 from public.superadmin_audit_log where id=audit_event), 'revoked operator read audit';
    passed := passed || jsonb_build_array('platform_revocation');
    execute 'reset role';
    assert (select count(*) from private.platform_admin_grant_events where subject_auth_user_id=u_platform) = 2, 'grant audit missing';
    passed := passed || jsonb_build_array('grant_change_audit');

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_new,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_new::text,true);
    execute 'set local role authenticated';
    new_company := public.create_onboarding_company('Synthetic onboarding','CZ','cs','CZK');
    new_profile := public.current_profile_id();
    assert new_profile is not null and new_profile <> p_email, 'onboarding email stole profile';
    assert exists(select 1 from public.company_members where company_id=new_company and profile_id=new_profile and role='company_admin'), 'onboarding admin failed';
    passed := passed || jsonb_build_array('onboarding_does_not_claim_email_profile');
    assert (select count(*) from public.company_modules where company_id=new_company) = 17, 'onboarding module defaults missing';
    assert exists(select 1 from public.company_modules where company_id=new_company and module_key='public_leads' and not is_enabled), 'public lead default changed';
    passed := passed || jsonb_build_array('all_onboarding_module_defaults');
    new_company := public.create_onboarding_company('Synthetic PL defaults','PL','','');
    assert exists(select 1 from public.companies where id=new_company and country_code='PL' and default_language='pl' and default_currency='PLN'), 'PL defaults changed';
    passed := passed || jsonb_build_array('onboarding_country_defaults');
    new_company := public.create_onboarding_company('Synthetic CZ defaults','CZ',null,null);
    assert exists(select 1 from public.companies where id=new_company and default_language='cs' and default_currency='CZK'), 'CZ null defaults changed';
    passed := passed || jsonb_build_array('onboarding_null_defaults');
    denied := false;
    begin
      perform public.create_onboarding_company('Synthetic invalid country','','cs','CZK');
    exception when raise_exception then
      if sqlerrm <> 'country_required' then raise; end if;
      denied := true;
    end;
    assert denied, 'blank country accepted';
    passed := passed || jsonb_build_array('onboarding_country_validation');
    denied := false;
    begin
      perform public.create_onboarding_company('Synthetic invalid currency','CZ','cs','INVALID');
    exception when raise_exception then
      if sqlerrm <> 'currency_required' then raise; end if;
      denied := true;
    end;
    assert denied, 'invalid currency accepted';
    passed := passed || jsonb_build_array('onboarding_currency_validation');
    new_company := public.create_trial_company('Synthetic legacy trial');
    assert exists(select 1 from public.company_members where company_id=new_company and profile_id=new_profile and role='company_admin'), 'legacy trial admin failed';
    passed := passed || jsonb_build_array('legacy_trial_same_auth_profile');
    execute 'reset role';
    assert (select auth_user_id is null and user_id is null from public.profiles where id=p_email), 'unlinked identity changed';

    -- Both trusted RPCs reject a pre-existing conflicting identity rather than merging it.
    update public.profiles set user_id=u_other where id=new_profile;
    execute 'set local role authenticated';
denied := false;
begin
  perform public.create_onboarding_company('Synthetic conflicting onboarding','CZ','cs','CZK');
exception when insufficient_privilege then denied := true;
end;
assert denied, 'onboarding_conflicting_identity_denied';
passed := passed || jsonb_build_array('onboarding_conflicting_identity_denied');
denied := false;
begin
  perform public.create_trial_company('Synthetic conflicting trial');
exception when insufficient_privilege then denied := true;
end;
assert denied, 'trial_conflicting_identity_denied';
passed := passed || jsonb_build_array('trial_conflicting_identity_denied');

    execute 'reset role';
    perform set_config('request.jwt.claims','{}',true);
    perform set_config('request.jwt.claim.sub','',true);
    execute 'set local role anon';
denied := false;
begin
  perform public.is_super_admin();
exception when insufficient_privilege then denied := true;
end;
assert denied, 'anonymous_platform_rpc_denied';
passed := passed || jsonb_build_array('anonymous_platform_rpc_denied');
denied := false;
begin
  perform public.create_onboarding_company('Synthetic anonymous','CZ','cs','CZK');
exception when insufficient_privilege then denied := true;
end;
assert denied, 'anonymous_onboarding_rpc_denied';
passed := passed || jsonb_build_array('anonymous_onboarding_rpc_denied');
execute 'reset role';
    raise exception 'rollback synthetic fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from auth.users where id in(u_admin,u_worker,u_platform,u_other,u_new)), 'fixture cleanup failed';
  assert not exists(select 1 from public.companies where id in(c_admin,c_other,new_company)), 'company cleanup failed';
  assert not exists(select 1 from private.platform_admin_grant_events where subject_auth_user_id=u_platform), 'grant audit cleanup failed';
  perform set_config('diriqo.boundary_test_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),'fixtures','rolled_back')::text,true);
end;
$test$;
select current_setting('diriqo.boundary_test_result')::jsonb as result;
