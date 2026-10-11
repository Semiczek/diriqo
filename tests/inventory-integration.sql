-- Authorized TEST project only, after inventory-fixes follow-up migration.
-- All synthetic Auth/company/domain records roll back. This is not a concurrency stress test.
do $test$
declare
  u uuid:=gen_random_uuid(); worker_user uuid:=gen_random_uuid(); foreign_user uuid:=gen_random_uuid();
  actor uuid:=gen_random_uuid(); worker_profile uuid:=gen_random_uuid(); foreign_profile uuid:=gen_random_uuid();
  company uuid:=gen_random_uuid(); foreign_company uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); job uuid:=gen_random_uuid(); other_job uuid:=gen_random_uuid();
  warehouse uuid; destination uuid; item uuid; cost_item uuid; supplier uuid; order_id uuid; line_id uuid;
  doc uuid; receipt uuid; reservation uuid; old_lot uuid; new_lot uuid; request uuid:=gen_random_uuid();
  result jsonb; body jsonb; base jsonb; failure text; passed jsonb:='[]'; marker text:='Inv'||right(replace(gen_random_uuid()::text,'-',''),16);
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data) values(u,marker||'admin@example.invalid','{}'),(worker_user,marker||'worker@example.invalid','{}'),(foreign_user,marker||'foreign@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values(actor,u,u,'Inventory admin'),(worker_profile,worker_user,worker_user,'Inventory worker'),(foreign_profile,foreign_user,foreign_user,'Foreign admin');
    insert into public.companies(id,name) values(company,'Synthetic inventory company'),(foreign_company,'Synthetic foreign company');
    insert into public.company_members(company_id,profile_id,role,is_active) values(company,actor,'company_admin',true),(company,worker_profile,'worker',true),(foreign_company,foreign_profile,'company_admin',true);
    insert into public.customers(id,company_id,name) values(customer,company,'Synthetic inventory customer');
    insert into public.jobs(id,company_id,customer_id,title,status,work_state,price) values(job,company,customer,'Material use','planned','not_started',0),(other_job,company,customer,'Other material use','planned','not_started',0);
    insert into private.company_module_rollouts(company_id,product,livemode) select c,p,false from unnest(array[company,foreign_company]) cs(c) cross join unnest(array['inventory','diriqo_core']) ps(p);
    insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
      select c,p,marker,'Synthetic inventory regression check',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day',
      case p when 'inventory' then array['inventory.receipt.post','inventory.movement.post','inventory.history.read','inventory.history.export'] else array['core.jobs.create','core.jobs.update','core.costs.record','core.history.read'] end
      from unnest(array[company,foreign_company]) cs(c) cross join unnest(array['inventory','diriqo_core']) ps(p);
    perform set_config('request.jwt.claim.sub',u::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    result:=public.inventory_write(company,'warehouse',jsonb_build_object('name','Source'),gen_random_uuid()); warehouse:=(result->>'id')::uuid;
    result:=public.inventory_write(company,'warehouse',jsonb_build_object('name','Destination'),gen_random_uuid()); destination:=(result->>'id')::uuid;
    result:=public.inventory_write(company,'item',jsonb_build_object('name','Ordered material','sku',marker||'1'),gen_random_uuid()); item:=(result->>'id')::uuid;
    result:=public.inventory_write(company,'item',jsonb_build_object('name','Costed material','sku',marker||'2'),gen_random_uuid()); cost_item:=(result->>'id')::uuid;
    result:=public.inventory_write(company,'supplier',jsonb_build_object('customer_id',customer),gen_random_uuid()); supplier:=(result->>'id')::uuid;
    base:=jsonb_build_object('warehouse_id',warehouse,'supplier_id',supplier,'title','Ten units');
    failure:=null; begin perform public.inventory_write(company,'order',base,gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='INVENTORY_INVALID','missing lines must not create empty order'; passed:=passed||jsonb_build_array('missing order lines denied');
    body:=base||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('item_id',item,'quantity',10,'unit_cost_minor',10000)));
    result:=public.inventory_write(company,'order',body,gen_random_uuid()); order_id:=(result->>'id')::uuid;
    select id into line_id from public.inventory_order_lines where inventory_order_lines.order_id=(result->>'id')::uuid;
    result:=public.inventory_write(company,'order_status',jsonb_build_object('id',order_id,'version',1,'status','approved'),gen_random_uuid());
    body:=jsonb_build_object('id',order_id,'version',2,'lines',jsonb_build_array(jsonb_build_object('line_id',line_id,'quantity',6)));
    result:=public.inventory_write(company,'receive_order',body,request); receipt:=(result->>'id')::uuid;
    assert public.inventory_write(company,'receive_order',body,request)=result,'same receipt retry result';
    assert (select received=6 from public.inventory_order_lines where id=line_id) and (select status='partial' from public.inventory_orders where id=order_id)
      and (select sum(remaining)=6 from public.gastro_stock_lots where item_id=item),'M01-01 six received, four outstanding, retry adds zero';
    passed:=passed||jsonb_build_array('M01-01 partial receipt and idempotent retry');
    failure:=null; begin perform public.inventory_write(company,'receive_order',body-'version',gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='INVENTORY_CONFLICT','missing receipt version denied'; passed:=passed||jsonb_build_array('NULL version denied');
    failure:=null; begin perform public.inventory_write(company,'receive_order',jsonb_build_object('id',order_id,'version',3,'lines',jsonb_build_array(jsonb_build_object('line_id',lower(line_id::text),'quantity',1),jsonb_build_object('line_id',upper(line_id::text),'quantity',1))),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='INVENTORY_DUPLICATE_ITEM' and (select received=6 from public.inventory_order_lines where id=line_id),'case alias cannot double-increment received';
    passed:=passed||jsonb_build_array('canonical line UUID duplicates denied');
    failure:=null; begin perform public.inventory_write(company,'document',jsonb_build_object('kind','receipt','warehouse_id',warehouse,'lines',jsonb_build_array(jsonb_build_object('item_id',lower(item::text),'quantity',1),jsonb_build_object('item_id',upper(item::text),'quantity',1))),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='INVENTORY_DUPLICATE_ITEM','case alias duplicate document denied'; passed:=passed||jsonb_build_array('canonical item UUID duplicates denied');
    failure:=null; begin perform public.inventory_write(company,'document',jsonb_build_object('kind','receipt','warehouse_id',warehouse,'lines',jsonb_build_array(jsonb_build_object('item_id',item,'quantity',0))),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='INVENTORY_INVALID','zero receipt denied'; passed:=passed||jsonb_build_array('zero movement denied');

    -- M01-02: ten at 100 CZK; three used; later cost 110 CZK affects only derived delta.
    result:=public.inventory_write(company,'document',jsonb_build_object('kind','receipt','warehouse_id',warehouse,'lines',jsonb_build_array(jsonb_build_object('item_id',cost_item,'quantity',10,'unit_cost_minor',10000))),gen_random_uuid()); doc:=(result->>'id')::uuid;
    result:=public.inventory_write(company,'post',jsonb_build_object('id',doc,'version',1),gen_random_uuid());
    select id into old_lot from public.gastro_stock_lots where company_id=company and item_id=cost_item;
    result:=public.inventory_write(company,'document',jsonb_build_object('kind','issue','warehouse_id',warehouse,'job_id',job,'lines',jsonb_build_array(jsonb_build_object('item_id',cost_item,'quantity',3))),gen_random_uuid()); doc:=(result->>'id')::uuid;
    result:=public.inventory_write(company,'post',jsonb_build_object('id',doc,'version',1),gen_random_uuid());
    result:=public.inventory_write(company,'revalue',jsonb_build_object('lot_id',old_lot,'unit_cost_minor',11000,'expected_unit_cost_minor',10000,'reason','Supplier invoice'),gen_random_uuid());
    assert (select sum(c.quantity*l.unit_cost_minor)=33000 from public.inventory_consumptions c join public.gastro_stock_lots l on l.id=c.lot_id where c.job_id=job)
      and (select sum(remaining*unit_cost_minor)=77000 from public.gastro_stock_lots where item_id=cost_item),'M01-02 330 job cost and 770 remaining stock';
    passed:=passed||jsonb_build_array('M01-02 provenance revaluation');
    assert (select inventory_amount=330 and total_amount=330 from public.job_module_cost_totals(company,array[job])),
      'job economics includes corrected materials exactly once';
    passed:=passed||jsonb_build_array('job economics cost bridge');
    failure:=null; begin perform public.inventory_write(company,'revalue',jsonb_build_object('lot_id',old_lot,'unit_cost_minor',12000,'expected_unit_cost_minor',10000,'reason','Stale invoice'),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='INVENTORY_CONFLICT','stale price revaluation denied'; passed:=passed||jsonb_build_array('revalue optimistic concurrency');

    result:=public.inventory_write(company,'reserve',jsonb_build_object('warehouse_id',warehouse,'item_id',cost_item,'job_id',job,'quantity',6),gen_random_uuid()); reservation:=(result->>'id')::uuid;
    result:=public.inventory_write(company,'document',jsonb_build_object('kind','issue','warehouse_id',warehouse,'job_id',job,'lines',jsonb_build_array(jsonb_build_object('item_id',cost_item,'quantity',2))),gen_random_uuid()); doc:=(result->>'id')::uuid;
    result:=public.inventory_write(company,'post',jsonb_build_object('id',doc,'version',1),gen_random_uuid());
    assert (select quantity=4 and released_at is null from public.inventory_reservations where id=reservation),'partial issue leaves remaining reservation'; passed:=passed||jsonb_build_array('partial reservation preserved');
    result:=public.inventory_write(company,'document',jsonb_build_object('kind','issue','warehouse_id',warehouse,'job_id',other_job,'lines',jsonb_build_array(jsonb_build_object('item_id',cost_item,'quantity',2))),gen_random_uuid()); doc:=(result->>'id')::uuid;
    failure:=null; begin perform public.inventory_write(company,'post',jsonb_build_object('id',doc,'version',1),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='INVENTORY_RESERVED','other job cannot consume remainder'; passed:=passed||jsonb_build_array('remaining reservation protects stock');
    result:=public.inventory_write(company,'release',jsonb_build_object('id',reservation),gen_random_uuid());

    result:=public.inventory_write(company,'document',jsonb_build_object('kind','receipt','warehouse_id',warehouse,'lines',jsonb_build_array(jsonb_build_object('item_id',cost_item,'quantity',4,'unit_cost_minor',20000))),gen_random_uuid()); doc:=(result->>'id')::uuid;
    result:=public.inventory_write(company,'post',jsonb_build_object('id',doc,'version',1),gen_random_uuid());
    select id into new_lot from public.gastro_stock_lots where company_id=company and item_id=cost_item and id<>old_lot;
    execute 'reset role';
    update public.gastro_stock_lots set created_at='2026-01-01T00:00:00Z' where id=old_lot;
    update public.gastro_stock_lots set created_at='2026-01-02T00:00:00Z' where id=new_lot;
    execute 'set local role authenticated';
    result:=public.inventory_write(company,'document',jsonb_build_object('kind','transfer','warehouse_id',warehouse,'destination_id',destination,'lines',jsonb_build_array(jsonb_build_object('item_id',cost_item,'quantity',7))),gen_random_uuid()); doc:=(result->>'id')::uuid;
    result:=public.inventory_write(company,'post',jsonb_build_object('id',doc,'version',1),gen_random_uuid());
    assert (select count(*)=2 from public.gastro_stock_lots where warehouse_id=destination)
      and (select sum(remaining)=7 from public.gastro_stock_lots where warehouse_id=destination)
      and (select bool_and(created_at=case when origin_id=old_lot then '2026-01-01T00:00:00Z'::timestamptz else '2026-01-02T00:00:00Z'::timestamptz end) from public.gastro_stock_lots where warehouse_id=destination),'transfer retains both original FIFO dates';
    passed:=passed||jsonb_build_array('transfer preserves FIFO origins');
    result:=public.inventory_write(company,'document',jsonb_build_object('kind','issue','warehouse_id',destination,'job_id',other_job,'lines',jsonb_build_array(jsonb_build_object('item_id',cost_item,'quantity',6))),gen_random_uuid()); doc:=(result->>'id')::uuid;
    result:=public.inventory_write(company,'post',jsonb_build_object('id',doc,'version',1),gen_random_uuid());
    assert (select sum(c.quantity*l.unit_cost_minor)=75000 from public.inventory_consumptions c join public.gastro_stock_lots l on l.id=c.lot_id join public.gastro_stock_movements m on m.id=c.movement_id where m.document_id=doc),'destination consumes old five before new one'; passed:=passed||jsonb_build_array('destination FIFO cost ordering');
    result:=public.inventory_write(company,'document',jsonb_build_object('kind','count','warehouse_id',destination,'reason','Annual count','lines',jsonb_build_array(jsonb_build_object('item_id',cost_item,'quantity',1,'unit_cost_minor',20000))),gen_random_uuid()); doc:=(result->>'id')::uuid;
    result:=public.inventory_write(company,'revalue',jsonb_build_object('lot_id',new_lot,'unit_cost_minor',21000,'expected_unit_cost_minor',20000,'reason','Price correction'),gen_random_uuid());
    failure:=null; begin perform public.inventory_write(company,'post',jsonb_build_object('id',doc,'version',1),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='INVENTORY_COUNT_CONFLICT','revalue invalidates preexisting count'; passed:=passed||jsonb_build_array('valuation changes invalidate stale counts');

    execute 'reset role';
    update private.company_test_module_grants set revoked_at=now(),revocation_reason='Synthetic test revocation' where company_id=company and product='inventory';
    execute 'set local role authenticated';
    assert public.get_module_workspace_access(company,'inventory')->>'can_write'='false'
      and public.get_module_workspace_access(company,'inventory')->>'can_export'='false','revoked module cannot write or export';
    assert (select inventory_amount=550 from public.job_module_cost_totals(company,array[job])),'materials stay in job economics after revocation';
    passed:=passed||jsonb_build_array('economics survives module revocation');
    execute 'reset role';
    insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
      values(company,'inventory',marker||'-read','Synthetic grant without export',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day',array['inventory.history.read','inventory.movement.post','inventory.receipt.post']);
    execute 'set local role authenticated';
    assert public.get_module_workspace_access(company,'inventory')->>'can_export'='false','history read does not grant export';
    passed:=passed||jsonb_build_array('read-only grant cannot export');
    execute 'reset role';
    perform set_config('request.jwt.claim.sub',worker_user::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',worker_user,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    assert jsonb_array_length(public.inventory_availability(company))>0 and (select count(*)=0 from public.gastro_stock_lots where company_id=company),'worker availability has no cost rows';
    failure:=null; begin perform public.inventory_write(company,'warehouse',jsonb_build_object('name','Denied'),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='MODULE_FORBIDDEN','worker write denied'; passed:=passed||jsonb_build_array('availability-only worker cannot read costs or write');
    execute 'reset role';
    perform set_config('request.jwt.claim.sub',foreign_user::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',foreign_user,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    assert (select count(*)=0 from public.gastro_stock_lots where company_id=company),'foreign tenant rows hidden';
    failure:=null; begin perform public.inventory_write(company,'warehouse',jsonb_build_object('name','Denied'),gen_random_uuid()); exception when others then failure:=sqlerrm; end;
    assert failure='MODULE_FORBIDDEN','foreign tenant write denied'; passed:=passed||jsonb_build_array('tenant isolation');
    execute 'reset role';
    raise exception 'rollback inventory synthetic fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from public.companies where id in (company,foreign_company)),'fixtures rolled back';
  perform set_config('diriqo.inventory_test_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),'fixtures','rolled_back','concurrency','not tested in single session')::text,true);
end $test$;
select current_setting('diriqo.inventory_test_result')::jsonb as result;
