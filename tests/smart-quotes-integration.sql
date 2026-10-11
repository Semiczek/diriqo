-- Authorized TEST project only. Run after smart quote migration + fixes.
-- Real SQL roles, public token APIs, immutable snapshot and conversion checks.
-- Synthetic fixtures always roll back; no e-mail or external payment call.
do $test$
declare
  u_admin uuid:=gen_random_uuid(); u_manager uuid:=gen_random_uuid(); u_worker uuid:=gen_random_uuid(); u_foreign uuid:=gen_random_uuid();
  p_admin uuid:=gen_random_uuid(); p_manager uuid:=gen_random_uuid(); p_worker uuid:=gen_random_uuid(); p_foreign uuid:=gen_random_uuid();
  company uuid:=gen_random_uuid(); foreign_company uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); foreign_customer uuid:=gen_random_uuid();
  quote uuid; second_quote uuid; job uuid; acceptance uuid; template_id uuid; library_id uuid;
  draft jsonb; revised jsonb; base_item jsonb; premium_item jsonb; result jsonb; public_result jsonb; saved_snapshot jsonb;
  token_v1 text; token_v2 text; token_second text; failure text; message text; passed jsonb:='[]'; marker text:='SQ'||right(replace(gen_random_uuid()::text,'-',''),16);
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data) values(u_admin,marker||'admin@example.invalid','{}'),(u_manager,marker||'manager@example.invalid','{}'),(u_worker,marker||'worker@example.invalid','{}'),(u_foreign,marker||'foreign@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values(p_admin,u_admin,u_admin,'Quote admin'),(p_manager,u_manager,u_manager,'Quote manager'),(p_worker,u_worker,u_worker,'Quote worker'),(p_foreign,u_foreign,u_foreign,'Foreign quote admin');
    insert into public.companies(id,name) values(company,'Synthetic quote company'),(foreign_company,'Foreign quote company');
    insert into public.company_members(company_id,profile_id,role,is_active) values(company,p_admin,'company_admin',true),(company,p_manager,'manager',true),(company,p_worker,'worker',true),(foreign_company,p_foreign,'company_admin',true);
    insert into public.customers(id,company_id,name) values(customer,company,'Quote customer'),(foreign_customer,foreign_company,'Foreign customer');
    insert into private.company_module_rollouts(company_id,product,livemode) select c,p,false from unnest(array[company,foreign_company]) cs(c) cross join unnest(array['diriqo_core','smart_quotes']) ps(p);
    insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
      select c,p,marker,'Synthetic smart quote rollback check',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day',
      case p when 'smart_quotes' then array['smart_quotes.template.manage','smart_quotes.history.read','smart_quotes.history.export'] else array['core.jobs.create','core.history.read'] end
      from unnest(array[company,foreign_company]) cs(c) cross join unnest(array['diriqo_core','smart_quotes']) ps(p);
    base_item:=jsonb_build_object('id','basic-item','name','Basic scope','description','Visible scope','unit','ks','quantity',1,'unitPrice',100,'costPrice',95,'vatRate',21,'secret','never-publish','net',0);
    premium_item:=jsonb_build_object('id','premium-item','name','Premium scope','description','Premium visible scope','unit','ks','quantity',1,'unitPrice',200,'costPrice',100,'vatRate',21,'salary','private-payroll');
    draft:=jsonb_build_object('title','Version one title','customerName','Quote customer','customerEmail','customer@example.invalid','validUntil',(current_date+30)::text,'deliveryTerms','Delivery by agreement','terms','Payment after acceptance','privateNote','do-not-leak',
      'variants',jsonb_build_array(jsonb_build_object('id','basic','name','Basic variant','discountPercent',0,'items',jsonb_build_array(base_item)),jsonb_build_object('id','premium','name','Premium variant','discountPercent',0,'items',jsonb_build_array(premium_item))));
    perform set_config('request.jwt.claim.sub',u_manager::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',u_manager,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    result:=public.smart_quotes_command(company,'template_save',jsonb_build_object('name','Test template','draft',draft)); template_id:=(result->>'id')::uuid;
    result:=public.smart_quotes_command(company,'library_save',jsonb_build_object('draft',draft)); library_id:=(result->>'id')::uuid;
    assert template_id is not null and library_id is not null,'manual assets need no AI grant'; passed:=passed||jsonb_build_array('M03-02 manual work without AI');
    failure:=null; begin perform public.smart_quotes_command(company,'save',jsonb_build_object('customerId',foreign_customer,'draft',draft)); exception when others then failure:=sqlerrm; end;
    assert failure like '%aktivní firmy%','foreign customer cannot be bound'; passed:=passed||jsonb_build_array('foreign customer denied');
    result:=public.smart_quotes_command(company,'save',jsonb_build_object('customerId',customer,'draft',draft)); quote:=(result->>'id')::uuid;
    failure:=null; begin perform public.smart_quotes_command(company,'publish',jsonb_build_object('id',quote,'revision',1)); exception when others then failure:=sqlerrm; end;
    assert failure like '%Marže pod 20%','low margin requires explicit approval'; passed:=passed||jsonb_build_array('margin threshold blocks publish');
    failure:=null; begin perform public.smart_quotes_command(company,'approve',jsonb_build_object('id',quote,'revision',1,'reason','Manager attempted override')); exception when others then failure:=sqlstate; end;
    assert failure='42501','manager cannot approve under-margin quote'; passed:=passed||jsonb_build_array('margin approval administrator only');
    execute 'reset role';
    perform set_config('request.jwt.claim.sub',u_admin::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    result:=public.smart_quotes_command(company,'approve',jsonb_build_object('id',quote,'revision',1,'reason','Approved contractual introductory price'));
    result:=public.smart_quotes_command(company,'publish',jsonb_build_object('id',quote,'revision',1)); token_v1:=result->>'token';
    assert result->>'version'='1' and length(token_v1)=64,'publish works without ambiguous revision identifier'; passed:=passed||jsonb_build_array('publish compiles and returns version 1');
    select snapshot into saved_snapshot from public.smart_quote_versions where quote_id=quote and version=1;
    assert (saved_snapshot#>>'{variants,0,total}')::numeric=121 and saved_snapshot::text !~ '"(costPrice|cost|margin|privateNote|secret|salary|internal_snapshot|approved_by|approval_reason)"\s*:', 'public snapshot totals authoritative and private fields absent';
    assert (select (internal_snapshot#>>'{variants,0,cost}')::numeric=95 from public.smart_quote_versions where quote_id=quote and version=1),'internal snapshot retains costs';
    passed:=passed||jsonb_build_array('customer-safe allowlisted snapshot');
    revised:=draft||jsonb_build_object('title','Version two accepted scope');
    result:=public.smart_quotes_command(company,'save',jsonb_build_object('id',quote,'revision',1,'customerId',customer,'draft',revised));
    assert (select approved_revision is null and revision=2 from public.smart_quotes where id=quote),'editing invalidates margin approval';
    failure:=null; begin perform public.smart_quotes_command(company,'publish',jsonb_build_object('id',quote,'revision',2)); exception when others then failure:=sqlerrm; end;
    assert failure like '%Marže pod 20%','old approval cannot publish new revision'; passed:=passed||jsonb_build_array('approval bound to exact revision');
    result:=public.smart_quotes_command(company,'approve',jsonb_build_object('id',quote,'revision',2,'reason','Reviewed amended scope'));
    result:=public.smart_quotes_command(company,'publish',jsonb_build_object('id',quote,'revision',2)); token_v2:=result->>'token';
    assert result->>'version'='2' and (select snapshot=saved_snapshot from public.smart_quote_versions where quote_id=quote and version=1),'old snapshot immutable after new revision'; passed:=passed||jsonb_build_array('published version immutable');
    failure:=null; begin update public.smart_quote_versions set snapshot='{}' where quote_id=quote and version=1; exception when others then failure:=sqlstate; end;
    assert failure='42501','direct client snapshot update denied'; passed:=passed||jsonb_build_array('direct snapshot DML denied');

    execute 'reset role'; perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{"role":"anon"}',true); execute 'set local role anon';
    assert public.smart_quote_public_read(repeat('0',64)) is null and public.smart_quote_public_read('bad') is null,'invalid token has no data';
    public_result:=public.smart_quote_public_read(token_v1);
    assert public_result->>'current'='false' and public_result->>'status'='replaced' and public_result->'snapshot'=saved_snapshot,'old token shows old version and replacement'; passed:=passed||jsonb_build_array('superseded link remains read-only snapshot');
    failure:=null; begin perform public.smart_quote_public_respond(token_v1,1,'basic','Customer Name','customer@example.invalid','accept',true); exception when others then failure:=sqlerrm; end;
    assert failure like '%novější nabídka%','superseded version cannot be accepted';
    failure:=null; begin perform public.smart_quote_public_respond(token_v2,1,'basic','Customer Name','customer@example.invalid','accept',true); exception when others then failure:=sqlerrm; end;
    assert failure like '%novější nabídka%','caller cannot swap target version'; passed:=passed||jsonb_build_array('M03-01 exact token version required');
    failure:=null; begin perform public.smart_quote_public_respond(token_v2,2,'missing','Customer Name','customer@example.invalid','accept',true); exception when others then failure:=sqlerrm; end;
    assert failure like '%existující variantu%','unknown variant denied';
    failure:=null; begin perform public.smart_quote_public_respond(token_v2,2,'premium','Customer Name','customer@example.invalid','accept',false); exception when others then failure:=sqlerrm; end;
    assert failure like '%souhlas%','explicit consent required'; passed:=passed||jsonb_build_array('variant and consent validated');
    result:=public.smart_quote_public_respond(token_v2,2,'premium','Customer Name','customer@example.invalid','accept',true); acceptance:=(result->>'id')::uuid;
    assert (public.smart_quote_public_respond(token_v2,2,'premium','Customer Name','customer@example.invalid','accept',true)->>'id')::uuid=acceptance,'acceptance replay returns same event';
    failure:=null; begin perform public.smart_quote_public_respond(token_v2,2,'basic','Customer Name','customer@example.invalid','accept',true); exception when others then failure:=sqlerrm; end;
    assert failure like '%uzamčená%','accepted variant cannot change'; passed:=passed||jsonb_build_array('acceptance retry does not duplicate or swap variant');
    public_result:=public.smart_quote_public_read(token_v2);
    assert public_result::text !~ '"(costPrice|cost|margin|internal_snapshot|approval_reason)"\s*:' and public_result#>>'{acceptance,variantId}'='premium','accepted public response remains safe';
    failure:=null; begin perform 1 from public.smart_quote_versions limit 1; exception when others then failure:=sqlstate; end;
    assert failure='42501','anon cannot read internal version tables'; passed:=passed||jsonb_build_array('public API cannot expose internal snapshot');

    execute 'reset role';
    perform set_config('request.jwt.claim.sub',u_manager::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',u_manager,'role','authenticated')::text,true); execute 'set local role authenticated';
    failure:=null; begin perform public.smart_quotes_command(company,'save',jsonb_build_object('id',quote,'revision',2,'customerId',customer,'draft',draft)); exception when others then failure:=sqlerrm; end;
    assert failure like '%uzamčený%','accepted scope cannot be overwritten'; passed:=passed||jsonb_build_array('accepted commercial scope locked');
    assert public.smart_quotes_read(company,quote)->>'canConvert'='false','manager UI cannot create Core job';
    failure:=null; begin perform public.smart_quotes_command(company,'convert',jsonb_build_object('id',quote,'startAt',(now()+interval '1 day')::text,'endAt',(now()+interval '1 day 2 hours')::text)); exception when others then failure:=sqlerrm; end;
    assert failure like '%pouze administrátor%','manager cannot create job via conversion'; passed:=passed||jsonb_build_array('Core administrator-only creation preserved');
    execute 'reset role';
    perform set_config('request.jwt.claim.sub',u_admin::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true); execute 'set local role authenticated';
    assert public.smart_quotes_read(company,quote)->>'canConvert'='true','administrator UI can create Core job';
    result:=public.smart_quotes_command(company,'convert',jsonb_build_object('id',quote,'startAt',(now()+interval '1 day')::text,'endAt',(now()+interval '1 day 2 hours')::text,'address','Test site'));
    job:=(result->>'jobId')::uuid;
    assert result->>'created'='true' and (select price=242 and title='Version two accepted scope' and description like '%Premium scope%' and customer_id=customer from public.jobs where id=job),'job uses accepted version and variant only';
    result:=public.smart_quotes_command(company,'convert',jsonb_build_object('id',quote));
    assert result->>'created'='false' and (result->>'jobId')::uuid=job and (select count(*)=1 from public.smart_quote_conversions where quote_id=quote),'conversion retry creates exactly one job';
    assert (select count(*)=0 from public.job_cost_items where job_id=job),'planned material cost is not actual job cost'; passed:=passed||jsonb_build_array('M03-01 conversion idempotent','M03-03 planned costs not booked');

    execute 'reset role';
    perform set_config('request.jwt.claim.sub',u_worker::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',u_worker,'role','authenticated')::text,true); execute 'set local role authenticated';
    assert (select count(*)=0 from public.smart_quotes where company_id=company),'worker cannot read internal quotes';
    failure:=null; begin perform public.smart_quotes_read(company,quote); exception when others then failure:=sqlerrm; end;
    assert failure='MODULE_FORBIDDEN','worker cannot bypass internal read RPC'; passed:=passed||jsonb_build_array('worker denied internal costs');
    execute 'reset role';
    perform set_config('request.jwt.claim.sub',u_foreign::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',u_foreign,'role','authenticated')::text,true); execute 'set local role authenticated';
    assert (select count(*)=0 from public.smart_quotes where company_id=company),'foreign tenant RLS';
    failure:=null; begin perform public.smart_quotes_read(company,quote); exception when others then failure:=sqlerrm; end;
    assert failure='MODULE_FORBIDDEN','foreign company read RPC denied';
    failure:=null; begin perform public.smart_quotes_command(foreign_company,'share',jsonb_build_object('id',quote,'revision',2)); exception when others then failure:=sqlerrm; end;
    assert failure='Nabídka není dostupná.','foreign quote ID unavailable'; passed:=passed||jsonb_build_array('foreign tenant table and RPC isolation');

    -- Core commercial expiry leaves retained quote snapshots readable but stops acceptance and jobs.
    execute 'reset role';
    perform set_config('request.jwt.claim.sub',u_admin::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true); execute 'set local role authenticated';
    result:=public.smart_quotes_command(company,'save',jsonb_build_object('customerId',customer,'draft',draft)); second_quote:=(result->>'id')::uuid;
    result:=public.smart_quotes_command(company,'approve',jsonb_build_object('id',second_quote,'revision',1,'reason','Second contract approval'));
    result:=public.smart_quotes_command(company,'publish',jsonb_build_object('id',second_quote,'revision',1)); token_second:=result->>'token';
    execute 'reset role';
    update private.company_test_module_grants set revoked_at=now(),revocation_reason='Synthetic core off' where company_id=company and product='diriqo_core';
    perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{"role":"anon"}',true); execute 'set local role anon';
    public_result:=public.smart_quote_public_read(token_second);
    assert public_result is not null and public_result->>'active'='false','retained public snapshot survives core commercial off';
    failure:=null; begin perform public.smart_quote_public_respond(token_second,1,'basic','Customer Name','customer@example.invalid','accept',true); exception when others then failure:=sqlerrm; end;
    assert failure like '%není dostupné%','new public acceptance blocked without active base'; passed:=passed||jsonb_build_array('commercial off retains snapshot but blocks new acceptance');
    execute 'reset role';
    raise exception 'rollback smart quote fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from public.companies where id in (company,foreign_company)),'synthetic fixtures rolled back';
  assert not exists(select 1 from public.smart_quote_acceptances where company_id=company),'immutable acceptance rolled back';
  perform set_config('diriqo.smart_quote_test_result',jsonb_build_object('count',jsonb_array_length(passed),'passed',passed,'fixtures','rolled_back','concurrency','not tested in single session')::text,true);
end $test$;
select current_setting('diriqo.smart_quote_test_result')::jsonb as result;
