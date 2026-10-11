-- Authorized TEST project only. All fixtures are synthetic and roll back.
-- Requires the POS + inventory integrity migrations. No Core grant is created.
-- One-session correctness suite; does not claim concurrent-session timing proof.
do $test$
declare
  company uuid:=gen_random_uuid(); foreign_company uuid:=gen_random_uuid(); reg uuid:=gen_random_uuid();
  admin_user uuid:=gen_random_uuid(); worker_user uuid:=gen_random_uuid(); foreign_user uuid:=gen_random_uuid();
  admin_profile uuid:=gen_random_uuid(); worker_profile uuid:=gen_random_uuid(); foreign_profile uuid:=gen_random_uuid();
  browser uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); job uuid:=gen_random_uuid(); reservation uuid;
  warehouse uuid; item uuid; sh uuid; sale uuid; source_line uuid; doc uuid; first_lot uuid; second_lot uuid;
  first_origin uuid; second_origin uuid; ret uuid; ret_line uuid; event uuid; sale_event uuid;
  body jsonb; sale_body jsonb; result jsonb; replay jsonb; failure text; passed jsonb:='[]';
  marker text:='PosStock'||right(replace(gen_random_uuid()::text,'-',''),12);
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data) values(admin_user,marker||'admin@example.invalid','{}'),(worker_user,marker||'worker@example.invalid','{}'),(foreign_user,marker||'foreign@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values(admin_profile,admin_user,admin_user,'POS stock admin'),(worker_profile,worker_user,worker_user,'POS stock worker'),(foreign_profile,foreign_user,foreign_user,'POS stock foreign');
    insert into public.companies(id,name,country_code,billing_country) values(company,'Synthetic POS stock company','CZ','CZ'),(foreign_company,'Synthetic foreign POS company','CZ','CZ');
    insert into public.company_members(company_id,profile_id,role,is_active) values(company,admin_profile,'company_admin',true),(company,worker_profile,'worker',true),(foreign_company,foreign_profile,'company_admin',true);
    insert into private.company_module_rollouts(company_id,product,livemode) values(company,'pos',false),(company,'inventory',false);
    insert into private.company_test_module_grants(company_id,product,register_id,source_ref,reason,valid_from,valid_until,history_until,capabilities)
      values(company,'pos',reg,marker,'Synthetic stock POS rollback',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day',array['pos.sale.create','pos.catalog.manage','pos.history.read','pos.history.export']),
        (company,'inventory',null,marker,'Synthetic stock POS rollback',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day',array['inventory.receipt.post','inventory.movement.post','inventory.history.read','inventory.history.export']);
    perform set_config('request.jwt.claim.sub',admin_user::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_user,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    result:=public.inventory_write(company,'warehouse',jsonb_build_object('name','POS source'),gen_random_uuid()); warehouse:=(result->>'id')::uuid;
    perform public.pos_command(company,reg,gen_random_uuid(),'register_save',jsonb_build_object('name','Stock register','warehouse_id',warehouse));
    result:=public.pos_command(company,reg,gen_random_uuid(),'catalog_save',jsonb_build_object('name','FIFO item','sku',marker,'unit','kg','kind','stock','price_minor',1000,'tax_rate',21)); item:=(result->>'item_id')::uuid;
    result:=public.inventory_write(company,'document',jsonb_build_object('kind','receipt','warehouse_id',warehouse,'lines',jsonb_build_array(jsonb_build_object('item_id',item,'quantity',2,'unit_cost_minor',100))),gen_random_uuid()); doc:=(result->>'id')::uuid;
    perform public.inventory_write(company,'post',jsonb_build_object('id',doc,'version',1),gen_random_uuid());
    select id,origin_id into first_lot,first_origin from public.gastro_stock_lots where company_id=company and item_id=item;
    result:=public.inventory_write(company,'document',jsonb_build_object('kind','receipt','warehouse_id',warehouse,'lines',jsonb_build_array(jsonb_build_object('item_id',item,'quantity',3,'unit_cost_minor',200))),gen_random_uuid()); doc:=(result->>'id')::uuid;
    perform public.inventory_write(company,'post',jsonb_build_object('id',doc,'version',1),gen_random_uuid());
    select id,origin_id into second_lot,second_origin from public.gastro_stock_lots where company_id=company and item_id=item and id<>first_lot;
    execute 'reset role';
    update public.gastro_stock_lots set created_at='2026-01-01T00:00:00Z' where id=first_lot;
    update public.gastro_stock_lots set created_at='2026-01-02T00:00:00Z' where id=second_lot;
    -- A retained job reservation must still protect its stock even without Core.
    insert into public.customers(id,company_id,name) values(customer,company,'Synthetic reserved customer');
    insert into public.jobs(id,company_id,customer_id,title,status,work_state,price) values(job,company,customer,'Synthetic reservation','planned','not_started',0);
    insert into public.inventory_reservations(company_id,warehouse_id,item_id,job_id,quantity) values(company,warehouse,item,job,2) returning id into reservation;
    execute 'set local role authenticated';
    perform public.pos_command(company,reg,gen_random_uuid(),'operator_save',jsonb_build_object('profile_id',worker_profile,'role','cashier','active',true));
    result:=public.pos_command(company,reg,gen_random_uuid(),'shift_open',jsonb_build_object('browser_id',browser,'opening_minor',0)); sh:=(result->>'shift_id')::uuid;
    perform set_config('request.jwt.claim.sub',worker_user::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',worker_user,'role','authenticated')::text,true);
    sale_body:=jsonb_build_object('shift_id',sh,'browser_id',browser,'payment_method','external','lines',jsonb_build_array(jsonb_build_object('item_id',item,'version',1,'quantity',4)));
    failure:=null; begin perform public.pos_command(company,reg,gen_random_uuid(),'sale',sale_body); exception when others then failure:=sqlerrm; end;
    assert failure='INVENTORY_RESERVED','cashier cannot consume reserved stock';
    assert (public.pos_read(company,reg,'history','{}')->'totals'->>'count')::int=0,'failed stock issue must roll back the sale';
    passed:=passed||jsonb_build_array('reserved stock rolls back whole sale');
    execute 'reset role';
    assert (select sum(remaining)=5 from public.gastro_stock_lots where company_id=company and item_id=item),'failed sale changed lots';
    update public.inventory_reservations set released_at=now() where id=reservation;
    execute 'set local role authenticated';
    sale_event:=gen_random_uuid(); result:=public.pos_command(company,reg,sale_event,'sale',sale_body); sale:=(result->>'sale_id')::uuid;
    replay:=public.pos_command(company,reg,sale_event,'sale',sale_body);
    assert replay->>'sale_id'=sale::text and (replay->>'replayed')::boolean,'sale replay must keep original receipt';
    result:=public.pos_read(company,reg,'receipt',jsonb_build_object('id',sale)); source_line:=(result->'lines'->0->>'id')::uuid;
    assert (select count(*)=0 from public.gastro_stock_lots where company_id=company),'cashier must not read purchase costs';
    execute 'reset role';
    assert (select sum(remaining)=1 from public.gastro_stock_lots where company_id=company and item_id=item)
      and (select count(*)=1 and sum(quantity)=-4 and sum(quantity*unit_cost_minor)=-600 from public.gastro_stock_movements where company_id=company and reference_kind='pos_sale'), 'exactly one FIFO issue';
    assert (select count(*)=2 and sum(co.quantity)=4 from public.inventory_consumptions co join public.gastro_stock_movements m on m.id=co.movement_id where m.company_id=company and m.reference_kind='pos_sale'),'both FIFO origins consumed';
    passed:=passed||jsonb_build_array('worker sale with POS plus Inventory, no Core','replay has one stock effect','cashier cannot read purchase costs','FIFO issue consumes two origin lots');
    perform set_config('request.jwt.claim.sub',admin_user::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_user,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    perform public.inventory_write(company,'revalue',jsonb_build_object('lot_id',first_lot,'unit_cost_minor',120,'expected_unit_cost_minor',100,'reason','Synthetic cost correction'),gen_random_uuid());
    perform public.pos_command(company,reg,gen_random_uuid(),'operator_save',jsonb_build_object('profile_id',worker_profile,'role','supervisor','active',true));
    -- Commercial revocation and archival deny new operations. A separate audited
    -- history-only grant retains bounded settlement; this does NOT simulate time expiry.
    execute 'reset role';
    update private.company_test_module_grants set revoked_at=now(),revocation_reason='Synthetic commercial Inventory revocation' where company_id=company and product='inventory';
    execute 'set local role authenticated';
    failure:=null; begin perform public.pos_command(company,reg,gen_random_uuid(),'sale',sale_body||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('item_id',item,'version',1,'quantity',1)))); exception when others then failure:=sqlerrm; end;
    assert failure in ('MODULE_REQUIRED','INVENTORY_MODULE_REQUIRED'),'linked sale requires current Inventory licence';
    passed:=passed||jsonb_build_array('Inventory commercial revocation denies new linked stock sale');
    execute 'reset role';
    update public.gastro_items set archived=true,kind='service',version=version+1 where id=item;
    update public.gastro_warehouses set archived=true,version=version+1 where id=warehouse;
    update private.company_test_module_grants set revoked_at=now(),revocation_reason='Synthetic commercial POS revocation' where company_id=company and product='pos';
    insert into private.company_test_module_grants(company_id,product,register_id,source_ref,reason,valid_from,valid_until,history_until,capabilities)
      values(company,'pos',reg,marker||'-history','Synthetic audited history-only settlement',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day',array['pos.history.read','pos.history.export']);
    perform set_config('request.jwt.claim.sub',worker_user::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',worker_user,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    failure:=null; begin perform public.pos_command(company,reg,gen_random_uuid(),'sale',sale_body); exception when others then failure:=sqlerrm; end;
    assert failure='MODULE_REQUIRED','history-only POS grant must not permit new sale';
    passed:=passed||jsonb_build_array('history-only POS grant denies new sale');
    body:=jsonb_build_object('sale_id',sale,'shift_id',sh,'browser_id',browser,'reason','History-only grant settlement','lines',jsonb_build_array(jsonb_build_object('line_id',source_line,'quantity',2.5)));
    event:=gen_random_uuid(); result:=public.pos_command(company,reg,event,'return',body); ret:=(result->>'return_id')::uuid;
    replay:=public.pos_command(company,reg,event,'return',body);
    assert replay->>'return_id'=ret::text and (replay->>'replayed')::boolean,'return replay must keep original correction';
    result:=public.pos_read(company,reg,'receipt',jsonb_build_object('id',ret,'kind','return')); ret_line:=(result->'lines'->0->>'id')::uuid;
    execute 'reset role';
    assert (select quantity=2.5 and unit_cost_minor=136 from public.gastro_stock_movements where company_id=company and reference_kind='pos_return' and reference_id=ret_line),'return uses two at 120 plus half at 200';
    assert (select count(*)=2 and sum(a.quantity)=2.5 from private.pos_stock_return_allocations a where a.company_id=company and a.return_line_id=ret_line),'return has bounded provenance allocations';
    assert (select sum(remaining)=3.5 from public.gastro_stock_lots where company_id=company and item_id=item),'partial return/replay quantity';
    assert (select bool_and(l.created_at=case when l.origin_id=first_origin then '2026-01-01T00:00:00Z'::timestamptz else '2026-01-02T00:00:00Z'::timestamptz end)
      from public.gastro_stock_lots l join public.gastro_stock_movements m on m.id=l.receipt_id where m.reference_kind='pos_return' and m.company_id=company),'return preserves FIFO dates';
    passed:=passed||jsonb_build_array('return after commercial revocation with history-only grant plus archive/kind change','return uses original consumption origins and corrected purchase costs','return replay has one stock effect','return preserves original FIFO dates');
    execute 'set local role authenticated';
    failure:=null; begin perform public.pos_command(company,reg,gen_random_uuid(),'return',body||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',source_line,'quantity',2)))); exception when others then failure:=sqlerrm; end;
    assert failure='POS_RETURN_EXCEEDED','cannot return more than source remainder'; passed:=passed||jsonb_build_array('partial over-return rejected');
    result:=public.pos_command(company,reg,gen_random_uuid(),'return',body||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',source_line,'quantity',1.5))));
    assert (public.pos_read(company,reg,'history','{}')->'totals'->>'paid_minor')::bigint=0,'sale and refunds conserve money';
    assert (public.pos_read(company,reg,'export','{}')->'totals'->>'count')::int=3,'history-only grant permits export';
    failure:=null; begin perform private.pos_stock_move(company,warehouse,item,1,'pos_return',ret_line); exception when others then failure:=sqlstate; end;
    assert failure='42501','direct authenticated stock hook denied'; passed:=passed||jsonb_build_array('private hook not callable by cashier','history-only grant permits export');
    execute 'reset role';
    assert (select sum(remaining)=5 and sum(remaining*unit_cost_minor)=840 from public.gastro_stock_lots where company_id=company and item_id=item),'all quantities and current costs restored';
    assert (select sum(quantity)=4 from private.pos_stock_return_allocations where company_id=company),'no new arbitrary receipts';
    passed:=passed||jsonb_build_array('complete partial settlement restores quantity and valuation');
    perform set_config('request.jwt.claim.sub',foreign_user::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',foreign_user,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    failure:=null; begin perform public.pos_read(company,reg,'receipt',jsonb_build_object('id',sale)); exception when others then failure:=sqlstate; end;
    assert failure='42501','foreign tenant cannot see original sale';
    failure:=null; begin perform public.pos_command(company,reg,gen_random_uuid(),'return',body); exception when others then failure:=sqlstate; end;
    assert failure='42501','foreign tenant cannot settle another company'; passed:=passed||jsonb_build_array('foreign tenant cannot read or return');
    execute 'reset role';
    raise exception 'rollback POS stock fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from public.companies where id in (company,foreign_company)),'fixtures rolled back';
  perform set_config('diriqo.pos_stock_test_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),'fixtures','rolled_back','concurrency','not tested in single session')::text,true);
end $test$;
select current_setting('diriqo.pos_stock_test_result')::jsonb as result;
