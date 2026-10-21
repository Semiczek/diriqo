-- Owner-run, rollback-only real-RPC coverage. Fault injection proves rollback and
-- authorization rechecks, not simultaneous HTTP requests (separate harness).
do $test$
declare
 ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); ua uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid();
 uw uuid:=gen_random_uuid(); um uuid:=gen_random_uuid(); us uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid();
 pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid(); pw uuid:=gen_random_uuid(); pm uuid:=gen_random_uuid(); ps uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid();
 customer_a uuid:=gen_random_uuid(); customer_b uuid:=gen_random_uuid(); op uuid:=gen_random_uuid(); update_op uuid:=gen_random_uuid();
 calculation uuid; known_version uuid; known_version_item uuid; legacy uuid:=gen_random_uuid(); grant_id uuid:=gen_random_uuid(); result jsonb; replay jsonb;
 input jsonb; updated jsonb; item jsonb; bad jsonb; before_state jsonb; after_state jsonb; preimage jsonb; preitems jsonb;
 customer_before jsonb; passed jsonb:='[]'; actor uuid; c record; problem text; code text; tab text;
 marker text:='CoreCalculationTest'||replace(gen_random_uuid()::text,'-','');
 state_sql constant text:=$q$select jsonb_build_object(
 'headers',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.calculations x where company_id=$1),
 'items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.calculation_items x join public.calculations c on c.id=x.calculation_id where c.company_id=$1),
 'versions',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.calculation_versions x where company_id=$1),
 'version_items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.calculation_version_items x join public.calculation_versions v on v.id=x.calculation_version_id where v.company_id=$1),
 'requests',(select coalesce(jsonb_agg(to_jsonb(x) order by operation_id),'[]') from private.core_calculation_save_requests x where company_id=$1))$q$;
begin
 begin
  insert into auth.users(id,email,raw_user_meta_data) values
   (ua,marker||'a@example.invalid','{}'),(ub,marker||'b@example.invalid','{}'),
   (uw,marker||'w@example.invalid','{}'),(um,marker||'m@example.invalid','{}'),
   (us,marker||'s@example.invalid','{}'),(u2,marker||'2@example.invalid','{}');
  insert into public.profiles(id,auth_user_id,user_id,full_name,is_active) values
   (pa,ua,ua,'Calculation admin',true),(pb,ub,ub,'Foreign admin',true),(pw,uw,uw,'Worker',true),
   (pm,um,um,'Manager',true),(ps,us,us,'Super admin',true),(p2,u2,u2,'Second admin',true);
  insert into public.companies(id,name) values(ca,marker||' A'),(cb,marker||' B');
  insert into public.company_members(company_id,profile_id,role,is_active) values
   (ca,pa,'company_admin',true),(cb,pb,'company_admin',true),(ca,pw,'worker',true),
   (ca,pm,'manager',true),(ca,ps,'super_admin',true),(ca,p2,'company_admin',true);
  insert into public.company_modules(company_id,module_key,is_enabled) values
   (ca,'quotes',true),(ca,'jobs',false);
  insert into public.customers(id,company_id,name) values(customer_a,ca,'Original customer'),(customer_b,cb,'Foreign customer');
  select to_jsonb(x) into customer_before from public.customers x where id=customer_a;
  item:=jsonb_build_object('item_type','customer','name',' Zero selling price ','description',null,'quantity','1',
   'unit','ks','unit_cost','0','unit_price','0','vat_rate','0','note',null);
  input:=jsonb_build_object('customer_id',customer_a,'title',' Atomic calculation ','description',null,'status','draft',
   'calculation_date','2026-10-21','internal_note',' Private note ','currency','CZK',
   'items',jsonb_build_array(item,item||'{"item_type":"material","name":"Internal cost one","unit_cost":"1"}'));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',ua::text,true);
  execute 'set local role authenticated';
  result:=public.create_core_calculation_atomic(ca,op,input);
  calculation:=(result->>'calculationId')::uuid;
  assert result=jsonb_build_object('companyId',ca,'operationId',op,'calculationId',calculation,'revision','1','replayed',false),'create_result';
  assert (select count(*) from public.calculation_items where calculation_id=calculation)=2,'admin_can_read_items';
  assert exists(select 1 from public.calculations where id=calculation and subtotal_cost=1 and subtotal_price=0 and margin_amount=-1
   and total_price=0 and revision=1 and title='Atomic calculation' and internal_note='Private note' and created_by=pa),'zero_price_cost_one';
  execute 'reset role';
  assert (select to_jsonb(x) from public.customers x where id=customer_a)=customer_before,'customer_unchanged';
  assert not exists(select 1 from public.calculation_versions where calculation_id=calculation),'create_no_fake_history';
  -- Add-ons are licensed products, not company_modules navigation keys.
  assert not exists(select 1 from public.company_module_entitlements where company_id=ca and product<>'diriqo_core')
   and not exists(select 1 from private.company_test_module_grants where company_id=ca and product<>'diriqo_core'),'core_save_has_no_addon_licences';
  passed:=passed||jsonb_build_array('create_result','admin_can_read_items','zero_price_cost_one','customer_unchanged','create_no_fake_history','core_without_addons');
  select to_jsonb(x) into preimage from public.calculations x where id=calculation;
  select jsonb_agg(to_jsonb(x) order by sort_order) into preitems from public.calculation_items x where calculation_id=calculation;
  updated:=input||jsonb_build_object('title','Updated calculation','status','ready','items',jsonb_build_array(item||'{"unit_price":"4"}',item||'{"item_type":"labor","name":"Work","unit_cost":"2"}'));
  execute 'set local role authenticated';
  result:=public.update_core_calculation_atomic(ca,calculation,1,update_op,updated);
  assert result=jsonb_build_object('companyId',ca,'operationId',update_op,'calculationId',calculation,'revision','2','replayed',false),'update_result';
  assert exists(select 1 from public.calculations where id=calculation and revision=2 and total_price=4 and subtotal_cost=2 and margin_amount=2 and status='ready'),'update_authoritative_totals';
  assert (select count(*) from public.calculation_versions where calculation_id=calculation)=1,'history_visible_to_admin';
  assert (select count(*) from public.calculation_version_items where calculation_version_id in(select id from public.calculation_versions where calculation_id=calculation))=2,'history_items_visible_to_admin';
  execute 'reset role';
  assert exists(select 1 from public.calculation_versions where calculation_id=calculation and source_snapshot=preimage and source_revision=1
   and version_number=1 and total_price=0 and subtotal_cost=1 and margin_amount=-1 and saved_by=pa),'full_preimage_header';
  assert (select jsonb_agg(jsonb_build_object('id',v.source_item_id,'calculation_id',calculation,'sort_order',v.sort_order,
   'item_type',v.item_type,'name',v.name,'description',v.description,'quantity',v.quantity,'unit',v.unit,
   'unit_cost',v.unit_cost,'unit_price',v.unit_price,'vat_rate',v.vat_rate,'total_cost',v.total_cost,'total_price',v.total_price,
   'note',v.note,'created_at',v.source_created_at) order by v.sort_order) from public.calculation_version_items v
   where calculation_version_id in(select id from public.calculation_versions where calculation_id=calculation))=preitems,'full_preimage_items';
  passed:=passed||jsonb_build_array('update_result','update_authoritative_totals','history_visible_to_admin','history_items_visible_to_admin','full_preimage_header','full_preimage_items');
  select id into known_version from public.calculation_versions where calculation_id=calculation and version_number=1;
  select id into known_version_item from public.calculation_version_items where calculation_version_id=known_version and source_item_id=(preitems->0->>'id')::uuid;
  assert known_version is not null and known_version_item is not null,'known_history_ids_exist';
  execute state_sql into before_state using ca;
  execute 'set local role authenticated';
  assert exists(select 1 from public.calculation_version_items where id=known_version_item),'admin_reads_known_history_item';
  replay:=public.create_core_calculation_atomic(ca,op,input||jsonb_build_object('title','Atomic calculation',
   'items',jsonb_build_array(item||'{"quantity":"01.00","unit_price":"0.00"}',item||'{"item_type":"material","name":"Internal cost one","unit_cost":"1.00"}')));
  assert replay->>'revision'='1' and replay->>'replayed'='true' and(replay->>'calculationId')::uuid=calculation,'normalized_create_replay_after_update';
  replay:=public.update_core_calculation_atomic(ca,calculation,1,update_op,updated);
  assert replay=result||'{"replayed":true}','update_replay';
  execute 'reset role'; execute state_sql into after_state using ca;
  assert after_state=before_state,'replay_no_version_or_item_mutation';
  passed:=passed||jsonb_build_array('normalized_create_replay_after_update','update_replay','replay_no_version_or_item_mutation');

  execute 'set local role authenticated';
  for c in select * from(values
   (format('select public.create_core_calculation_atomic(%L,%L,%L)',ca,op,input||'{"title":"Different"}'),'CALCULATION_OPERATION_CONFLICT','PT409'),
   (format('select public.update_core_calculation_atomic(%L,%L,1,%L,%L)',ca,calculation,gen_random_uuid(),updated),'CALCULATION_REVISION_CONFLICT','PT409'),
   (format('select public.update_core_calculation_atomic(%L,%L,2,%L,%L)',ca,calculation,update_op,updated),'CALCULATION_OPERATION_CONFLICT','PT409'),
   (format('select public.update_core_calculation_atomic(%L,%L,1,%L,%L)',ca,calculation,op,updated),'CALCULATION_OPERATION_CONFLICT','PT409'),
   (format('select public.update_core_calculation_atomic(%L,%L,1,%L,%L)',ca,gen_random_uuid(),gen_random_uuid(),updated),'CALCULATION_NOT_FOUND','P0002'),
   (format('select public.create_core_calculation_atomic(%L,%L,%L)',cb,gen_random_uuid(),input),'CALCULATION_FORBIDDEN','42501'),
   (format('select public.create_core_calculation_atomic(%L,%L,%L)',ca,gen_random_uuid(),input||jsonb_build_object('customer_id',customer_b)),'CALCULATION_CUSTOMER_NOT_FOUND','P0002'),
   (format('select public.update_core_calculation_atomic(%L,%L,2,%L,%L)',ca,calculation,gen_random_uuid(),updated||jsonb_build_object('customer_id',customer_b)),'CALCULATION_CUSTOMER_NOT_FOUND','P0002'),
   (format('select public.create_core_calculation_atomic(%L,null,%L)',ca,input),'CALCULATION_INVALID_INPUT','22023'),
   (format('select public.update_core_calculation_atomic(%L,%L,null,%L,%L)',ca,calculation,gen_random_uuid(),updated),'CALCULATION_INVALID_INPUT','22023'),
   (format('select public.update_core_calculation_atomic(%L,%L,0,%L,%L)',ca,calculation,gen_random_uuid(),updated),'CALCULATION_INVALID_INPUT','22023')
  ) x(query,expected,expected_code) loop
   problem:=null;code:=null;
   begin execute c.query; exception when others then get stacked diagnostics problem=message_text,code=returned_sqlstate; end;
   assert problem=c.expected and code=c.expected_code,'rejected_'||c.expected||'_got_'||coalesce(problem,'NO_ERROR');
   execute 'reset role'; execute state_sql into after_state using ca; assert after_state=before_state,'rejection_no_partial_write';
   execute 'set local role authenticated'; passed:=passed||jsonb_build_array(c.expected||'_unchanged');
  end loop;
  for bad in select x from(values
   (input-'title'),(input||'{"title":""}'),(input||jsonb_build_object('title',repeat('x',301))),
   (input||'{"status":"sent"}'),(input||'{"currency":"EUR"}'),(input||'{"calculation_date":null}'),
   (input||'{"calculation_date":"2026-02-30"}'),(input||'{"calculation_date":"0000-01-01"}'),
   (input||'{"calculation_date":"2026-1-01"}'),(input||'{"items":[]}'),(input||'{"total_price":100}'),
   (input||'{"customer_id":"not-a-uuid"}'),(input||'{"description":42}'),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"quantity":"1.001"}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"quantity":"0"}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"quantity":1}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"quantity":"1,25"}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"unit_price":"1.001"}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"unit_cost":"-1"}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"unit_cost":"1"}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"item_type":"material","unit_price":"1"}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"vat_rate":null}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"vat_rate":"100.01"}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"vat_rate":"0.001"}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"item_type":null}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"sort_order":50}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||'{"name":""}'))),
   (input||jsonb_build_object('items',jsonb_build_array(item||jsonb_build_object('unit',repeat('x',51))))),
   (input||jsonb_build_object('items',(select jsonb_agg(item) from generate_series(1,501))))
  ) v(x) loop
   problem:=null;code:=null;
   begin perform public.create_core_calculation_atomic(ca,gen_random_uuid(),bad);
   exception when others then get stacked diagnostics problem=message_text,code=returned_sqlstate; end;
   assert problem='CALCULATION_INVALID_INPUT' and code='22023','invalid_input_'||coalesce(problem,'NO_ERROR');
   execute 'reset role';execute state_sql into after_state using ca;assert after_state=before_state,'invalid_input_no_mutation';
   execute 'set local role authenticated';passed:=passed||jsonb_build_array('strict_input_rejected_unchanged');
  end loop;
  problem:=null;
  begin perform public.create_core_calculation_atomic(ca,gen_random_uuid(),input||jsonb_build_object('items',jsonb_build_array(item||'{"quantity":"9999999999.99","unit_price":"2"}')));
  exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='CALCULATION_NUMERIC_OVERFLOW','overflow_before_write';
  execute 'reset role';execute state_sql into after_state using ca;assert after_state=before_state,'overflow_no_mutation';
  passed:=passed||jsonb_build_array('overflow_before_write');
  execute 'set local role authenticated';
  result:=public.create_core_calculation_atomic(ca,gen_random_uuid(),input||jsonb_build_object('customer_id',null,'title','Rounding',
   'items',jsonb_build_array(item||'{"quantity":"0.05","unit_price":"0.10"}',item||'{"quantity":"0.05","unit_price":"0.10"}')));
  assert exists(select 1 from public.calculations where id=(result->>'calculationId')::uuid and customer_id is null and total_price=0.02),'round_lines_before_summing_standalone';
  execute 'reset role';passed:=passed||jsonb_build_array('round_lines_before_summing_standalone');
  execute 'set local role authenticated';
  result:=public.create_core_calculation_atomic(ca,gen_random_uuid(),input||jsonb_build_object('items',
   (select jsonb_agg(item||jsonb_build_object('item_type',t,'name',t,'unit_cost','1') order by t)
    from unnest(array['labor','material','rental','transport','accommodation']) t)));
  assert exists(select 1 from public.calculations where id=(result->>'calculationId')::uuid and subtotal_cost=5 and total_price=0 and margin_amount=-5),'all_internal_types';
  result:=public.create_core_calculation_atomic(ca,gen_random_uuid(),input||jsonb_build_object('title','Maximum items',
   'items',(select jsonb_agg(item) from generate_series(1,500))));
  assert(select count(*) from public.calculation_items where calculation_id=(result->>'calculationId')::uuid)=500,'maximum_items_preserved';
  execute 'reset role';passed:=passed||jsonb_build_array('all_internal_types','maximum_items_preserved');

  -- Legacy unknown values and non-contiguous version numbering are preserved.
  insert into public.calculations(id,company_id,customer_id,title,calculation_date,subtotal_cost,subtotal_price,margin_amount,total_price)
   values(legacy,ca,customer_a,'Unknown legacy',date '2020-01-01',7,3,-4,3);
  insert into public.calculation_items(calculation_id,item_type,name,quantity,unit_cost,unit_price,vat_rate,total_cost,total_price,note)
   values(legacy,null,'Legacy unknown type and VAT',1,7,3,null,7,3,null);
  insert into public.calculation_versions(calculation_id,company_id,version_number,title,status,calculation_date)
   values(legacy,ca,12,'Old history','draft',date '2019-01-01');
  select to_jsonb(x) into preimage from public.calculations x where id=legacy;
  execute 'set local role authenticated';result:=public.update_core_calculation_atomic(ca,legacy,1,gen_random_uuid(),updated);execute 'reset role';
  assert exists(select 1 from public.calculation_versions where calculation_id=legacy and version_number=13 and source_snapshot=preimage),'legacy_version_number_and_header';
  assert exists(select 1 from public.calculation_version_items i join public.calculation_versions v on v.id=i.calculation_version_id
   where v.calculation_id=legacy and v.version_number=13 and i.item_type is null and i.vat_rate is null and i.unit_cost=7 and i.unit_price=3 and i.note is null),'legacy_nulls_not_guessed';
  passed:=passed||jsonb_build_array('legacy_version_number_and_header','legacy_nulls_not_guessed');

  update public.calculations set currency='EUR' where id=legacy;
  execute state_sql into before_state using ca;
  execute 'set local role authenticated';problem:=null;
  begin perform public.update_core_calculation_atomic(ca,legacy,2,gen_random_uuid(),updated);
  exception when others then get stacked diagnostics problem=message_text;end;
  assert problem='CALCULATION_INVALID_INPUT','foreign_currency_never_relabelled';
  execute 'reset role';execute state_sql into after_state using ca;
  assert before_state=after_state,'foreign_currency_header_items_history_unchanged';
  passed:=passed||jsonb_build_array('foreign_currency_header_items_history_unchanged');
  execute 'set local role authenticated';
  result:=public.create_core_calculation_atomic(ca,gen_random_uuid(),input||jsonb_build_object(
   'title',chr(160)||chr(65279)||'v'||chr(8192),'description',chr(160),'items',jsonb_build_array(item||'{"name":"v"}')));
  assert exists(select 1 from public.calculations where id=(result->>'calculationId')::uuid and title='v' and description is null),'ecmascript_whitespace_and_letter_v';
  execute 'reset role';passed:=passed||jsonb_build_array('ecmascript_whitespace_and_letter_v');
  execute state_sql into before_state using ca;execute 'set local role authenticated';problem:=null;
  begin perform public.create_core_calculation_atomic(ca,gen_random_uuid(),input||jsonb_build_object('items',
   (select jsonb_agg(item||jsonb_build_object('description',repeat('x',4000))) from generate_series(1,300))));
  exception when others then get stacked diagnostics problem=message_text;end;
  assert problem='CALCULATION_INVALID_INPUT','canonical_payload_limit';
  execute 'reset role';execute state_sql into after_state using ca;assert before_state=after_state,'oversize_no_partial_rows';
  passed:=passed||jsonb_build_array('canonical_payload_limit');

  -- ACL must close direct rows, history, TRUNCATE and column-level bypasses.
  foreach tab in array array['calculations','calculation_items','calculation_versions','calculation_version_items'] loop
   assert not has_table_privilege('authenticated','public.'||tab,'INSERT')
    and not has_table_privilege('authenticated','public.'||tab,'UPDATE')
    and not has_table_privilege('authenticated','public.'||tab,'TRUNCATE')
    and not has_table_privilege('authenticated','public.'||tab,'REFERENCES')
    and not has_table_privilege('authenticated','public.'||tab,'TRIGGER'),'unsafe_privileges_revoked_'||tab;
   assert not has_table_privilege('anon','public.'||tab,'SELECT')
    and not has_table_privilege('service_role','public.'||tab,'TRUNCATE'),'anonymous_service_acl_'||tab;
   passed:=passed||jsonb_build_array('unsafe_privileges_revoked_'||tab);
  end loop;
  assert not has_column_privilege('authenticated','public.calculations','title','UPDATE')
    and not has_column_privilege('authenticated','public.calculations','title','INSERT'),'column_grants_revoked';
  assert not has_table_privilege('authenticated','private.core_calculation_save_requests','SELECT')
    and not has_table_privilege('authenticated','private.core_calculation_save_requests','INSERT'),'private_receipt_not_exposed';
  assert not has_function_privilege('authenticated','private.save_core_calculation_atomic(uuid,uuid,bigint,uuid,jsonb,text)','EXECUTE'),'internal_dispatch_not_callable';
  assert not has_function_privilege('anon','public.create_core_calculation_atomic(uuid,uuid,jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.update_core_calculation_atomic(uuid,uuid,bigint,uuid,jsonb)','EXECUTE'),'rpc_acl';
  passed:=passed||jsonb_build_array('column_grants_revoked','private_receipt_not_exposed','internal_dispatch_not_callable','rpc_acl');
  execute state_sql into before_state using ca;
  execute 'set local role authenticated';
  for c in select query from(values
   (format('insert into public.calculations(company_id,title) values(%L,''Old client'')',ca)),
   (format('update public.calculations set title=''Old client'' where id=%L',calculation)),
   (format('delete from public.calculation_items where calculation_id=%L',calculation)),
   (format('delete from public.calculation_versions where calculation_id=%L',calculation)),
   ('truncate public.calculation_items')
  ) v(query) loop
   problem:=null; begin execute c.query; exception when insufficient_privilege then problem:='denied'; end;
   assert problem='denied','direct_write_denied';passed:=passed||jsonb_build_array('direct_write_denied');
  end loop;
  execute 'reset role';execute state_sql into after_state using ca;assert after_state=before_state,'direct_rejections_no_mutation';
  for actor in select unnest(array[uw,um,ub]) loop
   perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
   perform set_config('request.jwt.claim.sub',actor::text,true);execute 'set local role authenticated';
   problem:=null;begin perform public.create_core_calculation_atomic(ca,gen_random_uuid(),input);exception when others then get stacked diagnostics problem=message_text;end;
   assert problem='CALCULATION_FORBIDDEN','worker_manager_foreign_admin_write_denied';
   assert not exists(select 1 from public.calculations where company_id=ca)
    and not exists(select 1 from public.calculation_items where calculation_id=calculation)
    and not exists(select 1 from public.calculation_versions where id=known_version)
    and not exists(select 1 from public.calculation_version_items where id=known_version_item),'internal_costs_not_visible';
   execute 'reset role';passed:=passed||jsonb_build_array('role_write_denied_and_costs_hidden');
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u2,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',u2::text,true);execute 'set local role authenticated';
  problem:=null;begin perform public.create_core_calculation_atomic(ca,op,input);exception when others then get stacked diagnostics problem=message_text;end;
  assert problem='CALCULATION_OPERATION_CONFLICT','different_actor_cannot_claim_receipt';
  execute 'reset role';passed:=passed||jsonb_build_array('different_actor_cannot_claim_receipt');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',us,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',us::text,true);execute 'set local role authenticated';
  result:=public.create_core_calculation_atomic(ca,gen_random_uuid(),input);execute 'reset role';
  assert exists(select 1 from public.calculations where id=(result->>'calculationId')::uuid and created_by=ps),'super_admin_supported';
  passed:=passed||jsonb_build_array('super_admin_supported');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',ua::text,true);
  for c in select * from(values
   ('update public.profiles set is_active=false where id=$1','update public.profiles set is_active=true where id=$1'),
   ('update public.company_members set is_active=false where profile_id=$1','update public.company_members set is_active=true where profile_id=$1'),
   ('update public.profiles set user_id=gen_random_uuid() where id=$1','update public.profiles set user_id=auth_user_id where id=$1')
  ) v(disable,enable) loop
   -- A valid existing auth user keeps the fixture compatible with the real FK.
   if c.disable like '%gen_random_uuid%' then update public.profiles set user_id=ub where id=pa;else execute c.disable using pa;end if;
   execute 'set local role authenticated';problem:=null;
   begin perform public.create_core_calculation_atomic(ca,op,input);exception when others then get stacked diagnostics problem=message_text;end;
   assert problem='CALCULATION_FORBIDDEN','inactive_or_ambiguous_actor_replay_denied';
   assert not exists(select 1 from public.calculations where company_id=ca),'inactive_actor_read_denied';
   execute 'reset role';execute c.enable using pa;passed:=passed||jsonb_build_array('inactive_or_ambiguous_actor_replay_denied');
  end loop;
  update public.company_modules set is_enabled=false where company_id=ca and module_key='quotes';
  execute 'set local role authenticated';problem:=null;
  begin perform public.create_core_calculation_atomic(ca,op,input);exception when others then get stacked diagnostics problem=message_text;end;
  assert problem='CALCULATION_MODULE_REQUIRED','disabled_quotes_replay_denied';
  assert exists(select 1 from public.calculations where id=calculation),'disabled_module_history_retained';
  execute 'reset role';update public.company_modules set is_enabled=true where company_id=ca and module_key='quotes';
  passed:=passed||jsonb_build_array('disabled_quotes_replay_denied','disabled_module_history_retained');
  insert into private.company_module_rollouts(company_id,product,livemode) values(ca,'diriqo_core',false);
  execute 'set local role authenticated';problem:=null;
  begin perform public.create_core_calculation_atomic(ca,op,input);exception when others then get stacked diagnostics problem=message_text;end;
  assert problem='CALCULATION_MODULE_REQUIRED','missing_core_licence_replay_denied';
  assert exists(select 1 from public.calculation_items where calculation_id=calculation),'expired_or_missing_licence_history_retained';
  execute 'reset role';passed:=passed||jsonb_build_array('missing_core_licence_replay_denied','expired_or_missing_licence_history_retained');
  insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
   values(ca,'diriqo_core',marker||'-wrong','SQL test wrong capability',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day',array['core.jobs.create']);
  execute 'set local role authenticated';problem:=null;
  begin perform public.create_core_calculation_atomic(ca,op,input);exception when others then get stacked diagnostics problem=message_text;end;
  assert problem='CALCULATION_MODULE_REQUIRED','wrong_capability_denied';
  execute 'reset role';passed:=passed||jsonb_build_array('wrong_capability_denied');
  insert into private.company_test_module_grants(id,company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
   values(grant_id,ca,'diriqo_core',marker||'-valid','SQL test core only',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day',array['core.quotes.create']);
  execute 'set local role authenticated';replay:=public.create_core_calculation_atomic(ca,op,input);execute 'reset role';
  assert replay->>'replayed'='true','test_core_grant_replay';
  -- Also perform a new save with enforced Core-only licensing, not only a replay.
  execute 'set local role authenticated';result:=public.create_core_calculation_atomic(ca,gen_random_uuid(),input);execute 'reset role';
  assert result->>'replayed'='false'
   and not exists(select 1 from public.company_module_entitlements where company_id=ca and product<>'diriqo_core')
   and not exists(select 1 from private.company_test_module_grants where company_id=ca and product<>'diriqo_core'),'enforced_core_only_create_without_addons';
  passed:=passed||jsonb_build_array('test_core_grant_replay');

  -- A trigger fault after header/history writes must roll every table back.
  create function private.core_calculation_test_fault() returns trigger language plpgsql security definer set search_path='' as $fault$
  begin
   if new.name='FAULT ITEM' then raise exception 'INJECTED_ITEM_FAILURE';end if;
   if new.name='REVOKE ACTOR' then
    update public.company_members set is_active=false where company_id=(select company_id from public.calculations where id=new.calculation_id)
      and profile_id=(select created_by from public.calculations where id=new.calculation_id);
   end if;
   return new;
  end;
  $fault$;
  create trigger core_calculation_test_fault after insert on public.calculation_items for each row execute function private.core_calculation_test_fault();
  execute state_sql into before_state using ca;
  for c in select * from(values('create','FAULT ITEM','INJECTED_ITEM_FAILURE'),('update','FAULT ITEM','INJECTED_ITEM_FAILURE'),('create','REVOKE ACTOR','CALCULATION_FORBIDDEN'),('update','REVOKE ACTOR','CALCULATION_FORBIDDEN')) v(kind,item_name,expected) loop
   bad:=updated||jsonb_build_object('items',jsonb_build_array(item||jsonb_build_object('name',c.item_name)));
   execute 'set local role authenticated';problem:=null;
   begin
    if c.kind='create' then perform public.create_core_calculation_atomic(ca,gen_random_uuid(),bad);
    else perform public.update_core_calculation_atomic(ca,calculation,2,gen_random_uuid(),bad);end if;
   exception when others then get stacked diagnostics problem=message_text;end;
   assert problem=c.expected,'fault_'||c.kind||'_got_'||coalesce(problem,'NO_ERROR');
   execute 'reset role';execute state_sql into after_state using ca;assert after_state=before_state,'fault_all_rows_rolled_back';
   assert exists(select 1 from public.company_members where company_id=ca and profile_id=pa and is_active),'revocation_fixture_rolled_back';
   passed:=passed||jsonb_build_array('atomic_'||c.kind||'_'||c.expected);
  end loop;
  drop trigger core_calculation_test_fault on public.calculation_items;
  drop function private.core_calculation_test_fault();
  update private.company_test_module_grants set revoked_at=clock_timestamp(),revocation_reason='Test revoke' where id=grant_id;
  execute 'set local role authenticated';problem:=null;
  begin perform public.update_core_calculation_atomic(ca,calculation,1,update_op,updated);exception when others then get stacked diagnostics problem=message_text;end;
  assert problem='CALCULATION_MODULE_REQUIRED','revoked_grant_update_replay_denied';
  execute 'reset role';passed:=passed||jsonb_build_array('revoked_grant_update_replay_denied');
  -- Real wall-clock expiry after authorization and after both header/item writes.
  -- Each subtransaction rolls its short-lived grant/trigger and failed save back.
  for c in select unnest(array['create','update']) kind loop
   begin
    insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
    select ca,'diriqo_core',marker||'-expiry-'||c.kind,'Expiry during DML test',t-interval '1 minute',t+interval '1 second',t+interval '1 second',array['core.quotes.create']
     from(select clock_timestamp() t) times;
    create function private.core_calculation_test_expiry() returns trigger language plpgsql as $fault$
    begin if new.name='EXPIRE WHILE SAVING' then perform pg_sleep(1.1);end if;return new;end;
    $fault$;
    create trigger core_calculation_test_expiry after insert on public.calculation_items for each row execute function private.core_calculation_test_expiry();
    execute state_sql into before_state using ca;
    bad:=updated||jsonb_build_object('items',jsonb_build_array(item||'{"name":"EXPIRE WHILE SAVING"}'));
    execute 'set local role authenticated';problem:=null;
    begin
     if c.kind='create' then perform public.create_core_calculation_atomic(ca,gen_random_uuid(),bad);
     else perform public.update_core_calculation_atomic(ca,calculation,2,gen_random_uuid(),bad);end if;
    exception when others then get stacked diagnostics problem=message_text;end;
    assert problem='CALCULATION_MODULE_REQUIRED','expiry_during_'||c.kind;
    execute 'reset role';execute state_sql into after_state using ca;assert before_state=after_state,'expiry_rolls_back_all_rows';
    passed:=passed||jsonb_build_array('expiry_during_'||c.kind||'_complete_rollback');
    raise exception 'ROLLBACK_SHORT_GRANT' using errcode='PT002';
   exception when sqlstate 'PT002' then null;end;
  end loop;
  delete from private.company_module_rollouts where company_id=ca;
  execute 'set local role authenticated';delete from public.calculations where id=calculation;execute 'reset role';
  assert not exists(select 1 from public.calculation_items where calculation_id=calculation)
   and not exists(select 1 from public.calculation_versions where calculation_id=calculation),'parent_delete_cascades_without_child_delete_grant';
  assert exists(select 1 from private.core_calculation_save_requests where company_id=ca and operation_id=op),'delete_keeps_tombstone';
  execute 'set local role authenticated';problem:=null;
  begin perform public.create_core_calculation_atomic(ca,op,input);exception when others then get stacked diagnostics problem=message_text;end;
  assert problem='CALCULATION_RESULT_MISSING','deleted_result_cannot_recreate';
  execute 'reset role';passed:=passed||jsonb_build_array('parent_delete_cascades_without_child_delete_grant','delete_keeps_tombstone','deleted_result_cannot_recreate');
  for c in select unnest(array['anon','service_role']) role_name loop
   execute format('set local role %I',c.role_name);problem:=null;
   begin perform public.create_core_calculation_atomic(ca,gen_random_uuid(),input);exception when insufficient_privilege then problem:='denied';end;
   assert problem='denied','non_user_role_denied';execute 'reset role';passed:=passed||jsonb_build_array('non_user_role_denied');
  end loop;
  perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
  execute 'set local role authenticated';problem:=null;
  begin perform public.create_core_calculation_atomic(ca,gen_random_uuid(),input);exception when others then get stacked diagnostics problem=message_text;end;
  assert problem='CALCULATION_FORBIDDEN','missing_auth_denied';execute 'reset role';passed:=passed||jsonb_build_array('missing_auth_denied');
  raise exception 'ROLLBACK_CALCULATION_FIXTURES' using errcode='PT001';
 exception when sqlstate 'PT001' then null;end;
 execute 'reset role';
 assert not exists(select 1 from public.companies where id in(ca,cb)),'cleanup_companies';
 assert not exists(select 1 from public.profiles where id in(pa,pb,pw,pm,ps,p2)),'cleanup_profiles';
 assert not exists(select 1 from auth.users where id in(ua,ub,uw,um,us,u2)),'cleanup_auth';
 assert not exists(select 1 from private.core_calculation_save_requests where company_id in(ca,cb)),'cleanup_receipts';
 assert not exists(select 1 from public.calculations where company_id in(ca,cb))
  and not exists(select 1 from public.calculation_versions where company_id in(ca,cb))
  and not exists(select 1 from private.company_test_module_grants where company_id in(ca,cb)),'cleanup_data_and_grants';
 perform set_config('diriqo.core_calculation_test_result',jsonb_build_object('fixtures','rolled_back',
   'count',jsonb_array_length(passed),'cleanup_assertions',5,'passed',passed)::text,false);
end;
$test$;
select current_setting('diriqo.core_calculation_test_result')::jsonb as result;
