-- Authorized test project only. Synthetic rows and changes roll back as one subtransaction.
do $test$
declare
 u uuid:=gen_random_uuid(); worker_user uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid();
 c uuid:=gen_random_uuid(); foreign_c uuid:=gen_random_uuid(); job uuid:=gen_random_uuid(); foreign_job uuid:=gen_random_uuid();
 main uuid; mobile uuid; site uuid; item uuid; doc uuid; expected_version integer; req uuid:=gen_random_uuid(); p jsonb; result jsonb; failure text; cases jsonb:='[]';
begin
 begin
  insert into auth.users(id,email,raw_user_meta_data) values(u,'warehouse-'||u||'@example.invalid','{}'),(worker_user,'warehouse-'||worker_user||'@example.invalid','{}');
  insert into public.profiles(id,auth_user_id,user_id,full_name) values(actor,u,u,'Synthetic warehouse admin'),(worker,worker_user,worker_user,'Synthetic warehouse worker');
  insert into public.companies(id,name) values(c,'Synthetic warehouse workspace'),(foreign_c,'Synthetic warehouse foreign');
  insert into public.company_members(company_id,profile_id,role,is_active) values(c,actor,'company_admin',true),(c,worker,'worker',true);
  insert into public.jobs(id,company_id,title,status,work_state,price) values(job,c,'Synthetic site','planned','not_started',0),(foreign_job,foreign_c,'Foreign site','planned','not_started',0);
  insert into private.company_module_rollouts(company_id,product,livemode) values(c,'inventory',false),(c,'diriqo_core',false);
  insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
   values(c,'inventory','warehouse-'||c,'Synthetic warehouse regression',now()-interval '1 hour',now()+interval '1 hour',now()+interval '1 hour',array['inventory.receipt.post','inventory.movement.post','inventory.history.read','inventory.history.export']),
   (c,'diriqo_core','warehouse-'||c,'Synthetic warehouse regression',now()-interval '1 hour',now()+interval '1 hour',now()+interval '1 hour',array['core.jobs.create','core.jobs.update','core.costs.record','core.history.read']);
  perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);execute 'set local role authenticated';
  p:=jsonb_build_object('id',null,'name','Main','warehouse_kind','main','job_id',null,'location','Base','notes','Test','archived',false);
  result:=public.inventory_warehouse_write(c,p,req);main:=(result->>'id')::uuid;
  assert (select warehouse_kind='main' and location='Base' from public.gastro_warehouses where id=main),'main metadata persisted';cases:=cases||jsonb_build_array('main create');
  assert public.inventory_warehouse_write(c,p,req)=result,'exact retry must return same id';cases:=cases||jsonb_build_array('idempotent retry');
  failure:=null;begin perform public.inventory_warehouse_write(c,p||jsonb_build_object('name','Changed'),req);exception when others then failure:=sqlerrm;end;
  assert failure='INVENTORY_RETRY_CONFLICT','changed retry denied';cases:=cases||jsonb_build_array('changed retry denied');
  result:=public.inventory_warehouse_write(c,p||jsonb_build_object('name','Site','warehouse_kind','job','job_id',job),gen_random_uuid());site:=(result->>'id')::uuid;
  assert (select job_id=job from public.gastro_warehouses where id=site),'site linked to same-company job';cases:=cases||jsonb_build_array('job warehouse create');
  result:=public.inventory_warehouse_write(c,p||jsonb_build_object('name','Mobile','warehouse_kind','mobile','location','Van 1AB2345'),gen_random_uuid());mobile:=(result->>'id')::uuid;
  assert (select warehouse_kind='mobile' and location='Van 1AB2345' from public.gastro_warehouses where id=mobile),'mobile location persisted';cases:=cases||jsonb_build_array('mobile create');
  failure:=null;begin perform public.inventory_warehouse_write(c,p||jsonb_build_object('name','Fourth','warehouse_kind','other'),gen_random_uuid());exception when others then failure:=sqlerrm;end;
  assert failure='INVENTORY_WAREHOUSE_LIMIT','active warehouse cap';cases:=cases||jsonb_build_array('license warehouse cap');
  failure:=null;begin perform public.inventory_warehouse_write(c,p||jsonb_build_object('id',site,'version',1,'name','Site','warehouse_kind','job','job_id',foreign_job),gen_random_uuid());exception when others then failure:=sqlerrm;end;
  assert failure='INVENTORY_WAREHOUSE_JOB','cross-company job denied';cases:=cases||jsonb_build_array('foreign job denied');
  failure:=null;begin perform public.inventory_warehouse_write(c,p||jsonb_build_object('id',mobile,'version',1),gen_random_uuid());exception when others then failure:=sqlerrm;end;
  assert failure='INVENTORY_WAREHOUSE_MAIN','second main warehouse denied';cases:=cases||jsonb_build_array('single main');
  result:=public.inventory_warehouse_write(c,p||jsonb_build_object('id',main,'version',1,'name','Main updated'),gen_random_uuid());
  assert (select name='Main updated' and version=2 from public.gastro_warehouses where id=main),'versioned settings update';cases:=cases||jsonb_build_array('settings update');
  failure:=null;begin perform public.inventory_warehouse_write(c,p||jsonb_build_object('id',main,'version',1),gen_random_uuid());exception when others then failure:=sqlerrm;end;
  assert failure='INVENTORY_CONFLICT','stale update denied';cases:=cases||jsonb_build_array('stale revision');
  result:=public.inventory_warehouse_write(c,p||jsonb_build_object('id',mobile,'version',1,'name','Mobile','warehouse_kind','mobile','archived',true),gen_random_uuid());
  assert (select archived and version=2 from public.gastro_warehouses where id=mobile),'archive keeps row';cases:=cases||jsonb_build_array('empty archive keeps history');
  result:=public.inventory_warehouse_write(c,p||jsonb_build_object('id',mobile,'version',2,'name','Mobile','warehouse_kind','mobile','archived',false),gen_random_uuid());
  assert (select not archived and version=3 from public.gastro_warehouses where id=mobile),'restore row';cases:=cases||jsonb_build_array('restore');
  result:=public.inventory_write(c,'item',jsonb_build_object('name','Synthetic stock'),gen_random_uuid());item:=(result->>'id')::uuid;
  result:=public.inventory_write(c,'document',jsonb_build_object('kind','receipt','warehouse_id',site,'lines',jsonb_build_array(jsonb_build_object('item_id',item,'quantity',2,'unit_cost_minor',15000))),gen_random_uuid());doc:=(result->>'id')::uuid;
  failure:=null;begin perform public.inventory_warehouse_write(c,p||jsonb_build_object('id',site,'version',1,'name','Site','warehouse_kind','job','job_id',job,'archived',true),gen_random_uuid());exception when others then failure:=sqlerrm;end;
  assert failure='INVENTORY_WAREHOUSE_BUSY','draft receipt blocks archival';cases:=cases||jsonb_build_array('draft blocks archive');
  perform public.inventory_write(c,'post',jsonb_build_object('id',doc,'version',1),gen_random_uuid());select w.version into expected_version from public.gastro_warehouses w where id=site;
  failure:=null;begin perform public.inventory_warehouse_write(c,p||jsonb_build_object('id',site,'version',expected_version,'name','Site','warehouse_kind','job','job_id',job,'archived',true),gen_random_uuid());exception when others then failure:=sqlerrm;end;
  assert failure='INVENTORY_WAREHOUSE_BUSY','stock blocks archival';cases:=cases||jsonb_build_array('stock blocks archive');
  failure:=null;begin update public.gastro_warehouses set notes='bypass' where id=site;exception when others then failure:=sqlstate;end;
  assert failure='42501','direct write denied';cases:=cases||jsonb_build_array('direct mutation denied');
  perform set_config('request.jwt.claim.sub',worker_user::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',worker_user,'role','authenticated')::text,true);
  failure:=null;begin perform public.inventory_warehouse_write(c,p,gen_random_uuid());exception when others then failure:=sqlstate;end;
  assert failure='42501','worker denied';cases:=cases||jsonb_build_array('worker denied');
  perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  failure:=null;begin perform public.inventory_warehouse_write(foreign_c,p,gen_random_uuid());exception when others then failure:=sqlstate;end;
  assert failure='42501','foreign company denied';cases:=cases||jsonb_build_array('foreign company denied');
  execute 'reset role';update public.profiles set is_active=false where id=actor;execute 'set local role authenticated';
  failure:=null;begin perform public.inventory_warehouse_write(c,p,gen_random_uuid());exception when others then failure:=sqlstate;end;
  assert failure='42501','inactive profile denied';cases:=cases||jsonb_build_array('inactive profile denied');
  execute 'reset role';update public.profiles set is_active=true where id=actor;update private.company_test_module_grants set revoked_at=now(),revocation_reason='Synthetic test' where company_id=c and product='inventory';execute 'set local role authenticated';
  failure:=null;begin perform public.inventory_warehouse_write(c,p,gen_random_uuid());exception when others then failure:=sqlstate;end;
  assert failure='42501','revoked module denied';cases:=cases||jsonb_build_array('revoked module denied');
  raise exception using errcode='PT001',message='ROLLBACK_SYNTHETIC';
 exception when sqlstate 'PT001' then null;
 end;
 assert not exists(select 1 from public.companies where id in (c,foreign_c)),'fixture companies rolled back';
 assert not exists(select 1 from auth.users where id in (u,worker_user)),'fixture auth rolled back';
 perform set_config('test.inventory_workspace_report',jsonb_build_object('fixtures','rolled_back','cases',cases,'count',jsonb_array_length(cases),'cleanup_assertions',2)::text,true);
end $test$;
select current_setting('test.inventory_workspace_report')::jsonb as result;