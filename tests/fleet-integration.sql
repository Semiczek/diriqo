-- Run only on the authorized TEST project after the fleet migration.
-- Real authenticated roles/RPCs. All synthetic records roll back, including audit.
do $test$
declare
  user_admin uuid:=gen_random_uuid(); user_driver uuid:=gen_random_uuid(); user_other uuid:=gen_random_uuid();
  admin_id uuid:=gen_random_uuid(); driver_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  company uuid:=gen_random_uuid(); other_company uuid:=gen_random_uuid(); car uuid; second_car uuid; trip uuid; cost uuid;
  req uuid:=gen_random_uuid(); body jsonb; trip_body jsonb; result uuid; failure text; marker text:='Fleet'||right(replace(gen_random_uuid()::text,'-',''),16);
  passed integer:=0; index integer;
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data) values(user_admin,marker||'admin@example.invalid','{}'),(user_driver,marker||'driver@example.invalid','{}'),(user_other,marker||'other@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values(admin_id,user_admin,user_admin,'Fleet test admin'),(driver_id,user_driver,user_driver,'Fleet test driver'),(other_id,user_other,user_other,'Fleet other admin');
    insert into public.companies(id,name) values(company,'Fleet test'),(other_company,'Fleet other');
    insert into public.company_members(company_id,profile_id,role,is_active) values(company,admin_id,'company_admin',true),(company,driver_id,'worker',true),(other_company,other_id,'company_admin',true);
    insert into private.company_module_rollouts(company_id,product,livemode) values(company,'diriqo_core',false),(company,'fleet',false),(other_company,'diriqo_core',false),(other_company,'fleet',false);
    insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
      select c,p,marker,'Synthetic fleet rollback check',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day',
        case p when 'fleet' then array['fleet.vehicle.manage','fleet.trip.record','fleet.history.read','fleet.history.export'] else array['core.jobs.create','core.history.read'] end
      from unnest(array[company,other_company]) companies(c) cross join unnest(array['diriqo_core','fleet']) products(p);
    perform set_config('request.jwt.claim.sub',user_admin::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',user_admin,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    body:=jsonb_build_object('name','Test car','plate',marker,'status','active','initial_odometer',1000,'driver_id',driver_id,'cost_method','mileage','km_rate',10);
    car:=public.fleet_write(company,'vehicle.save',body,req);
    assert public.fleet_write(company,'vehicle.save',body,req)=car,'idempotent vehicle retry'; passed:=passed+1;
    assert (select count(*)=1 from public.fleet_audit_events where vehicle_id=car),'idempotent audit'; passed:=passed+1;
    failure:=null; begin perform public.fleet_write(company,'vehicle.save',body||jsonb_build_object('name','Changed'),req); exception when others then failure:=sqlerrm; end;
    assert failure='FLEET_CONFLICT','changed idempotency payload denied'; passed:=passed+1;
    trip_body:=jsonb_build_object('vehicle_id',car,'driver_id',driver_id,'started_at','2026-01-01T08:00:00Z','ended_at','2026-01-01T09:00:00Z','origin','Praha','destination','Brno','purpose','Zakázka','odometer_start',1000,'odometer_end',1100);
    trip:=public.fleet_write(company,'trip.save',trip_body,gen_random_uuid());
    assert (select mileage_amount=1000 from public.fleet_trips where id=trip),'100km at 10 includes fuel'; passed:=passed+1;
    failure:=null; begin perform public.fleet_write(company,'trip.save',trip_body,gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='FLEET_TRIP_OVERLAP','overlap denied'; passed:=passed+1;
    failure:=null; begin perform public.fleet_write(company,'trip.save',trip_body||jsonb_build_object('started_at','2026-01-01T10:00:00Z','ended_at','2026-01-01T11:00:00Z','odometer_start',1101,'odometer_end',1200),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='FLEET_ODOMETER_GAP','tachometer gap denied'; passed:=passed+1;
    failure:=null; begin update public.fleet_trips set status='locked' where id=trip; exception when others then failure:=sqlstate; end;
    assert failure='42501','direct DML denied'; passed:=passed+1;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub',user_driver::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',user_driver,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    assert (select count(*)=1 from public.fleet_vehicles where id=car),'assigned driver reads vehicle'; passed:=passed+1;
    result:=public.fleet_write(company,'trip.transition',jsonb_build_object('id',trip,'vehicle_id',car,'version',1,'status','submitted'),gen_random_uuid());
    failure:=null; begin perform public.fleet_write(company,'trip.transition',jsonb_build_object('id',trip,'vehicle_id',car,'version',2,'status','approved'),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='FLEET_INVALID_TRANSITION','driver cannot approve'; passed:=passed+1;
    failure:=null; begin perform public.fleet_write(company,'vehicle.save',body||jsonb_build_object('plate',marker||'X'),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='MODULE_FORBIDDEN','driver cannot manage vehicles'; passed:=passed+1;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub',user_other::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',user_other,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    assert (select count(*)=0 from public.fleet_vehicles where company_id=company),'foreign company RLS'; passed:=passed+1;
    failure:=null; begin perform public.fleet_write(company,'vehicle.save',body,gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='MODULE_FORBIDDEN','foreign company RPC'; passed:=passed+1;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub',user_admin::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',user_admin,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    result:=public.fleet_write(company,'trip.transition',jsonb_build_object('id',trip,'vehicle_id',car,'version',2,'status','approved'),gen_random_uuid());
    result:=public.fleet_write(company,'trip.transition',jsonb_build_object('id',trip,'vehicle_id',car,'version',3,'status','locked'),gen_random_uuid());
    failure:=null; begin perform public.fleet_write(company,'trip.save',trip_body||jsonb_build_object('id',trip,'version',4),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='FLEET_LOCKED','locked trip cannot change'; passed:=passed+1;
    cost:=public.fleet_write(company,'cost.create',jsonb_build_object('vehicle_id',car,'kind','fuel','incurred_on','2026-01-01','description','Palivo','amount',1200,'supplier','Fuel','receipt_ref',marker),gen_random_uuid());
    failure:=null; begin perform public.fleet_write(company,'cost.allocate',jsonb_build_object('vehicle_id',car,'cost_id',cost,'job_id',gen_random_uuid(),'amount',1200),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='FLEET_COST_METHOD','fuel not counted twice'; passed:=passed+1;
    failure:=null; begin perform public.fleet_write(company,'cost.create',jsonb_build_object('vehicle_id',car,'kind','fuel','incurred_on','2026-01-01','description','Palivo','amount',1200,'supplier','Fuel','receipt_ref',marker),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='FLEET_DUPLICATE','duplicate receipt denied'; passed:=passed+1;
    for index in 2..5 loop second_car:=public.fleet_write(company,'vehicle.save',body||jsonb_build_object('plate','T'||index||right(marker,8),'status','service'),gen_random_uuid()); end loop;
    failure:=null; begin perform public.fleet_write(company,'vehicle.save',body||jsonb_build_object('plate','SIX'||right(marker,8)),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='FLEET_CAPACITY','service vehicles count toward five'; passed:=passed+1;
    execute 'reset role';
    update private.company_test_module_grants set revoked_at=now(),revocation_reason='Synthetic base expiry' where company_id=company and product='diriqo_core';
    execute 'set local role authenticated';
    assert (select count(*)=1 from public.fleet_trips where id=trip),'history remains when core is disabled'; passed:=passed+1;
    failure:=null; begin perform public.fleet_write(company,'vehicle.save',body||jsonb_build_object('plate','END'||right(marker,8)),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='MODULE_REQUIRED','base disabled blocks new writes'; passed:=passed+1;
    execute 'reset role';
    raise exception 'rollback fleet synthetic fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from public.companies where id in (company,other_company)),'fixtures rolled back';
  perform set_config('diriqo.fleet_test_result',jsonb_build_object('passed',passed,'fixtures','rolled_back','concurrency','not tested in single session')::text,true);
end $test$;
select current_setting('diriqo.fleet_test_result')::jsonb as result;
