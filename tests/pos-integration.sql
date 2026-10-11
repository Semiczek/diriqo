begin;
do $fixture$
declare c uuid:=gen_random_uuid(); foreign_c uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); ap uuid:=gen_random_uuid(); wp uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,raw_user_meta_data) values(a,a::text||'@example.invalid','{}'),(w,w::text||'@example.invalid','{}');
 insert into public.profiles(id,auth_user_id,user_id,full_name) values(ap,a,a,'Synthetic POS admin'),(wp,w,w,'Synthetic cashier');
 insert into public.companies(id,name,country_code) values(c,'Synthetic POS-only company','CZ'),(foreign_c,'Synthetic foreign company','CZ');
 insert into public.company_members(company_id,profile_id,role,is_active) values(c,ap,'company_admin',true),(c,wp,'worker',true);
 insert into private.company_module_rollouts(company_id,product,livemode) values(c,'pos',false);
 insert into private.company_test_module_grants(company_id,product,register_id,source_ref,reason,valid_from,valid_until,history_until,capabilities)
 values(c,'pos',r,'synthetic-'||c,'Synthetic rollback verification',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day',
 array['pos.sale.create','pos.catalog.manage','pos.history.read','pos.history.export']);
 perform set_config('test.pos_company',c::text,true);
 perform set_config('test.pos_register',r::text,true);
 perform set_config('test.pos_foreign_company',foreign_c::text,true);
 perform set_config('test.pos_auth_user',a::text,true);
 perform set_config('test.pos_worker_auth_user',w::text,true);
 perform set_config('test.pos_worker_profile',wp::text,true);
end $fixture$;

-- Run on TEST DB only AFTER pos-module.sql, within one BEGIN/ROLLBACK.
-- Root provides synthetic company A with an authenticated admin, POS-only grant
-- (NO core/inventory), and a second inaccessible company B. The POS grant uses
-- exact test.pos_register and includes sale.create/catalog.manage/history.read.
-- Set these session values before this script (never a real customer fixture):
-- test.pos_company, test.pos_register, test.pos_foreign_company, test.pos_auth_user.
-- Also test.pos_worker_auth_user + test.pos_worker_profile: a distinct active
-- worker member of company A, initially without a register assignment.
-- No fixture is committed by this script. Assertions use only the public RPCs.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.pos_auth_user'),'role','authenticated')::text,true);
set local role authenticated;
do $test$
declare c uuid:=current_setting('test.pos_company')::uuid; r uuid:=current_setting('test.pos_register')::uuid;
  foreign_company uuid:=current_setting('test.pos_foreign_company')::uuid;
  browser uuid:=gen_random_uuid(); item uuid; sh uuid; sale uuid; cash_sale uuid;
  event uuid:=gen_random_uuid(); payload jsonb; response jsonb; original jsonb;
  line uuid; part1 jsonb; part2 jsonb; caught boolean; random_sku text:=gen_random_uuid()::text;
  worker_profile uuid:=current_setting('test.pos_worker_profile')::uuid;
  worker_auth uuid:=current_setting('test.pos_worker_auth_user')::uuid;
begin
  perform public.pos_command(c,r,gen_random_uuid(),'register_save',jsonb_build_object('name','Synthetic POS verification','warehouse_id',null));
  response:=public.pos_command(c,r,gen_random_uuid(),'catalog_save',jsonb_build_object('name','Synthetic fractional item','sku',random_sku,'unit','kg','kind','nonstock','price_minor',3333,'tax_rate',21));
  item:=(response->>'item_id')::uuid;
  response:=public.pos_command(c,r,gen_random_uuid(),'shift_open',jsonb_build_object('browser_id',browser,'opening_minor',1000));
  sh:=(response->>'shift_id')::uuid;
  caught:=false;
  begin
    perform public.pos_command(c,r,gen_random_uuid(),'shift_open',jsonb_build_object('browser_id',gen_random_uuid(),'opening_minor',0));
  exception when unique_violation then caught:=true; end;
  if not caught then raise exception 'ASSERT: duplicate open shift accepted'; end if;

  payload:=jsonb_build_object('shift_id',sh,'browser_id',browser,'payment_method','external','payment_note','synthetic manual confirmation','lines',jsonb_build_array(jsonb_build_object('item_id',item,'version',1,'quantity',0.003)));
  original:=public.pos_command(c,r,event,'sale',payload); sale:=(original->>'sale_id')::uuid;
  response:=public.pos_command(c,r,event,'sale',payload);
  if response->>'sale_id'<>sale::text or not (response->>'replayed')::boolean then raise exception 'ASSERT: first retry duplicated sale'; end if;
  response:=public.pos_command(c,r,event,'sale',payload);
  if response->>'sale_id'<>sale::text then raise exception 'ASSERT: second retry duplicated sale'; end if;
  response:=public.pos_read(c,r,'history','{}');
  if (response->'totals'->>'count')::int<>1 then raise exception 'ASSERT: more than one financial sale'; end if;
  caught:=false;
  begin perform public.pos_command(c,r,event,'sale',payload||jsonb_build_object('payment_note','changed'));
  exception when unique_violation then caught:=true; end;
  if not caught then raise exception 'ASSERT: same ID different payload accepted'; end if;
  caught:=false;
  begin perform public.pos_command(c,r,gen_random_uuid(),'sale',payload||jsonb_build_object('browser_id',gen_random_uuid()));
  exception when insufficient_privilege then caught:=true; end;
  if not caught then raise exception 'ASSERT: second device sold into the active shift'; end if;

  response:=public.pos_read(c,r,'receipt',jsonb_build_object('id',sale));
  line:=(response->'lines'->0->>'id')::uuid;
  if (response->'document'->>'total_minor')::int<>10 then raise exception 'ASSERT: price rounding differs'; end if;
  payload:=jsonb_build_object('sale_id',sale,'shift_id',sh,'browser_id',browser,'reason','Synthetic partial return','lines',jsonb_build_array(jsonb_build_object('line_id',line,'quantity',0.001)));
  event:=gen_random_uuid(); part1:=public.pos_command(c,r,event,'return',payload);
  response:=public.pos_command(c,r,event,'return',payload);
  if response->>'return_id'<>part1->>'return_id' or (part1->>'refund_minor')::int<>3 then raise exception 'ASSERT: partial refund replay/rounding'; end if;
  part2:=public.pos_command(c,r,gen_random_uuid(),'return',payload);
  if (part2->>'refund_minor')::int<>4 then raise exception 'ASSERT: cumulative allocation did not conserve cents'; end if;
  caught:=false;
  begin perform public.pos_command(c,r,gen_random_uuid(),'return',payload||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',line,'quantity',0.002))));
  exception when invalid_parameter_value then caught:=true; end;
  if not caught then raise exception 'ASSERT: over-return accepted'; end if;
  response:=public.pos_command(c,r,gen_random_uuid(),'return',payload);
  if (response->>'refund_minor')::int<>3 then raise exception 'ASSERT: final cumulative allocation'; end if;
  response:=public.pos_read(c,r,'history','{}');
  if (response->'totals'->>'paid_minor')::int<>0 or (response->'totals'->>'count')::int<>4 then raise exception 'ASSERT: returned sale totals'; end if;

  -- Active-company / foreign-register and direct table access must not bypass RPC guards.
  caught:=false;
  begin perform public.pos_read(foreign_company,r,'receipt',jsonb_build_object('id',sale));
  exception when insufficient_privilege then caught:=true; end;
  if not caught then raise exception 'ASSERT: foreign company read accepted'; end if;
  caught:=false;
  begin perform public.pos_command(c,gen_random_uuid(),gen_random_uuid(),'register_save',jsonb_build_object('name','Unlicensed register'));
  exception when insufficient_privilege then caught:=true; end;
  if not caught then raise exception 'ASSERT: foreign/unlicensed register accepted'; end if;
  caught:=false;
  begin update public.pos_sales set total_minor=1 where id=sale;
  exception when insufficient_privilege then caught:=true; end;
  if not caught then raise exception 'ASSERT: receipt direct modification accepted'; end if;

  -- Changing the shared price invalidates a stale cart; no silent repricing.
  perform public.pos_command(c,r,gen_random_uuid(),'catalog_save',jsonb_build_object('id',item,'version',1,'name','Synthetic cash item','sku',random_sku,'unit','ks','kind','nonstock','price_minor',149,'tax_rate',21));
  payload:=jsonb_build_object('shift_id',sh,'browser_id',browser,'payment_method','cash','tendered_minor',200,'lines',jsonb_build_array(jsonb_build_object('item_id',item,'version',1,'quantity',1)));
  caught:=false;
  begin perform public.pos_command(c,r,gen_random_uuid(),'sale',payload);
  exception when serialization_failure then caught:=true; end;
  if not caught then raise exception 'ASSERT: stale price accepted'; end if;
  payload:=payload||jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('item_id',item,'version',2,'quantity',1)));
  response:=public.pos_command(c,r,gen_random_uuid(),'sale',payload); cash_sale:=(response->>'sale_id')::uuid;
  if (response->>'paid_minor')::int<>100 or (response->>'change_minor')::int<>100 then raise exception 'ASSERT: cash rounding/change'; end if;
  response:=public.pos_read(c,r,'receipt',jsonb_build_object('id',cash_sale)); line:=(response->'lines'->0->>'id')::uuid;
  response:=public.pos_command(c,r,gen_random_uuid(),'return',jsonb_build_object('sale_id',cash_sale,'shift_id',sh,'browser_id',browser,'reason','Synthetic cash return','lines',jsonb_build_array(jsonb_build_object('line_id',line,'quantity',1))));
  if (response->>'refund_minor')::int<>100 then raise exception 'ASSERT: cash over-refund'; end if;
  response:=public.pos_command(c,r,gen_random_uuid(),'shift_close',jsonb_build_object('shift_id',sh,'counted_minor',1000));
  if (response->>'difference_minor')::int<>0 then raise exception 'ASSERT: closure counted sales/returns twice'; end if;
  caught:=false;
  begin perform public.pos_command(c,r,gen_random_uuid(),'sale',payload);
  exception when invalid_parameter_value then caught:=true; end;
  if not caught then raise exception 'ASSERT: closed shift accepted new sale'; end if;
  -- Worker roles are scoped to this exact register; entitlement alone is not a role.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',worker_auth,'role','authenticated')::text,true);
  caught:=false;
  begin perform public.pos_read(c,r,'workspace','{}');
  exception when insufficient_privilege then caught:=true; end;
  if not caught then raise exception 'ASSERT: unassigned worker accessed register'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.pos_auth_user'),'role','authenticated')::text,true);
  perform public.pos_command(c,r,gen_random_uuid(),'operator_save',jsonb_build_object('profile_id',worker_profile,'role','cashier','active',true));
  response:=public.pos_command(c,r,gen_random_uuid(),'shift_open',jsonb_build_object('browser_id',browser,'opening_minor',0));
  sh:=(response->>'shift_id')::uuid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',worker_auth,'role','authenticated')::text,true);
  response:=public.pos_read(c,r,'workspace',jsonb_build_object('browser_id',browser));
  if (response->>'can_manage')::boolean or (response->>'can_refund')::boolean or not (response->>'can_sell')::boolean then raise exception 'ASSERT: cashier role flags'; end if;
  caught:=false;
  begin perform public.pos_command(c,r,gen_random_uuid(),'catalog_save',jsonb_build_object('name','Forbidden worker item','sku','','unit','ks','kind','service','price_minor',100,'tax_rate',21));
  exception when insufficient_privilege then caught:=true; end;
  if not caught then raise exception 'ASSERT: cashier changed catalog'; end if;
  payload:=jsonb_build_object('shift_id',sh,'browser_id',browser,'payment_method','external','lines',jsonb_build_array(jsonb_build_object('item_id',item,'version',2,'quantity',1)));
  event:=gen_random_uuid(); response:=public.pos_command(c,r,event,'sale',payload); sale:=(response->>'sale_id')::uuid;
  response:=public.pos_read(c,r,'receipt',jsonb_build_object('id',sale)); line:=(response->'lines'->0->>'id')::uuid;
  if (response->'document'->>'total_minor')::int<>149 then raise exception 'ASSERT: worker sale did not use shared catalog'; end if;
  caught:=false;
  begin perform public.pos_command(c,r,gen_random_uuid(),'return',jsonb_build_object('sale_id',sale,'shift_id',sh,'browser_id',browser,'reason','Forbidden cashier return','lines',jsonb_build_array(jsonb_build_object('line_id',line,'quantity',1))));
  exception when insufficient_privilege then caught:=true; end;
  if not caught then raise exception 'ASSERT: cashier returned without supervisor role'; end if;
  caught:=false;
  begin perform public.pos_read(foreign_company,r,'receipt',jsonb_build_object('id',sale));
  exception when insufficient_privilege then caught:=true; end;
  if not caught then raise exception 'ASSERT: assigned worker accessed foreign company'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.pos_auth_user'),'role','authenticated')::text,true);
  perform public.pos_command(c,r,gen_random_uuid(),'operator_save',jsonb_build_object('profile_id',worker_profile,'role','supervisor','active',true));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',worker_auth,'role','authenticated')::text,true);
  response:=public.pos_command(c,r,gen_random_uuid(),'return',jsonb_build_object('sale_id',sale,'shift_id',sh,'browser_id',browser,'reason','Authorized supervisor return','lines',jsonb_build_array(jsonb_build_object('line_id',line,'quantity',1))));
  if (response->>'refund_minor')::int<>149 then raise exception 'ASSERT: supervisor return failed'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.pos_auth_user'),'role','authenticated')::text,true);
  perform public.pos_command(c,r,gen_random_uuid(),'operator_save',jsonb_build_object('profile_id',worker_profile,'role','supervisor','active',false));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',worker_auth,'role','authenticated')::text,true);
  caught:=false;
  begin perform public.pos_read(c,r,'history','{}');
  exception when insufficient_privilege then caught:=true; end;
  if not caught then raise exception 'ASSERT: revoked worker read history'; end if;
  caught:=false;
  begin perform public.pos_command(c,r,event,'sale',payload);
  exception when insufficient_privilege then caught:=true; end;
  if not caught then raise exception 'ASSERT: revoked worker replayed a historical event'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.pos_auth_user'),'role','authenticated')::text,true);
  response:=public.pos_command(c,r,gen_random_uuid(),'shift_close',jsonb_build_object('shift_id',sh,'counted_minor',0));
  if (response->>'difference_minor')::int<>0 then raise exception 'ASSERT: worker settlement changed cash drawer'; end if;
  raise notice 'POS assertions passed: core-independent catalog/sale, retry/conflict, partial returns/rounding, foreign tenant/register, direct write denial, price conflict, closure, worker cashier/supervisor/revocation';
end $test$;
rollback;

-- Additional two-session verification: same company/register/event + identical
-- payload must block at the event advisory lock and return the same receipt after
-- session A commits. A different event returning the last available quantity must
-- block at the register/source locks and fail POS_RETURN_EXCEEDED after A commits.
-- Run only with isolated disposable committed fixtures; do not claim concurrency
-- timing was proved by the single-session rollback suite above.

select 'POS-only rollback assertions passed' as result;