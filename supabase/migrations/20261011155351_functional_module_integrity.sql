-- Retained history respects exact export capabilities, independently of new-operation access.
create or replace function private.module_raw_entitlement(c uuid,p text,cap text default null,r uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists (
 select 1 from (
 select product,register_id,valid_from,valid_until,history_until,capabilities,livemode
 from public.company_module_entitlements where company_id=c and not revoked and state='active'
 and origin='paid' and policy_version='diriqo-capabilities-v0.1'
 union all
 select product,register_id,valid_from,valid_until,history_until,capabilities,livemode
 from private.company_test_module_grants where company_id=c and revoked_at is null and state='active'
 and policy_version='diriqo-capabilities-v0.1'
 ) e where e.product=p and e.valid_from<=statement_timestamp()
 and e.livemode=coalesce((select livemode from private.company_module_rollouts where company_id=c and product=p),true)
 and (case when p='pos' then (r is not null and e.register_id=r) or (r is null and cap is null) else e.register_id is null end)
 and case when cap is null then statement_timestamp()<e.history_until
 and (case when p='diriqo_core' then 'core' else p end)||'.history.read'=any(e.capabilities)
 else statement_timestamp() < case when cap in (
   (case when p='diriqo_core' then 'core' else p end)||'.history.read',
   (case when p='diriqo_core' then 'core' else p end)||'.history.export'
 ) then e.history_until else e.valid_until end
 and cap=any(e.capabilities)
 and private.module_offer_configuration_valid(p,array[cap],'diriqo-capabilities-v0.1') end);
$$;

create or replace function private.module_has_entitlement(c uuid,p text,cap text default null,r uuid default null)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if not private.module_raw_entitlement(c,p,cap,r) then return false; end if;
 if cap is null or cap in ((case when p='diriqo_core' then 'core' else p end)||'.history.read',
   (case when p='diriqo_core' then 'core' else p end)||'.history.export') or p in ('diriqo_core','pos') then return true; end if;
 if private.module_raw_entitlement(c,'diriqo_core','core.jobs.create',null) then return true; end if;
 if p in ('inventory','invoicing','ai_assistant') then
 return exists(select 1 from (
 select register_id from public.company_module_entitlements where company_id=c and product='pos'
 union select register_id from private.company_test_module_grants where company_id=c and product='pos'
 ) b where private.module_raw_entitlement(c,'pos','pos.sale.create',b.register_id));
 end if;
 return false;
end $$;

create or replace function private.module_is_active(c uuid,p text)
returns boolean language sql stable security definer set search_path='' as $$
 select case when p='pos' then exists(select 1 from (
 select register_id from public.company_module_entitlements where company_id=c and product='pos'
 union select register_id from private.company_test_module_grants where company_id=c and product='pos'
 ) b where private.module_raw_entitlement(c,'pos','pos.sale.create',b.register_id))
 when p in ('diriqo_core','inventory','invoicing','fleet','smart_quotes','ai_assistant') then
 private.module_has_entitlement(c,p,case p when 'diriqo_core' then 'core.jobs.create'
 when 'inventory' then 'inventory.movement.post' when 'invoicing' then 'invoicing.invoice.issue'
 when 'fleet' then 'fleet.vehicle.manage' when 'smart_quotes' then 'smart_quotes.template.manage'
 when 'ai_assistant' then 'ai_assistant.conversation.run' end,null) else false end;
$$;

create or replace function private.get_module_workspace_access(c uuid,p text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_company_role(c,array['super_admin','company_admin','manager','worker']) then
 raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('company_id',c,'product',p,'can_read',private.module_can_read(c,p),
 'can_write',private.module_can_read(c,p) and private.module_is_active(c,p),
 'can_export',private.module_can_read(c,p) and private.module_has_entitlement(c,p,
 (case when p='diriqo_core' then 'core' else p end)||'.history.export'));
end $$;

create function private.module_navigation(c uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_company_role(c,array['super_admin','company_admin','manager','worker']) then
 raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(p) from unnest(array['inventory','fleet','smart_quotes','ai_assistant','pos']) p
 where private.module_can_read(c,p,p not in ('fleet','ai_assistant','pos'))),'[]'::jsonb);
end $$;
revoke all on function private.module_navigation(uuid) from public,anon,authenticated,service_role;
grant execute on function private.module_navigation(uuid) to authenticated;
create function public.module_navigation(company uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.module_navigation(company); $$;
revoke all on function public.module_navigation(uuid) from public,anon,authenticated,service_role;
grant execute on function public.module_navigation(uuid) to authenticated;

-- Follow-up only: fixes nullable concurrency guards, canonical IDs, FIFO provenance and partial reservations.
-- Existing functions and privileges retained; no product, licence or business record is created.

create index inventory_lots_fifo_origin_idx on public.gastro_stock_lots(company_id,warehouse_id,item_id,created_at,origin_id,id) where remaining>0;

create or replace function private.inventory_move(c uuid,w uuid,i uuid,q numeric,cost numeric,kind text,ref uuid,
 actor uuid,doc uuid default null,job uuid default null,origin uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare movement uuid; lot record; remaining_qty numeric:=abs(q); take_qty numeric; lotid uuid; origin_time timestamptz; total_cost numeric:=0; old_movement public.gastro_stock_movements;
begin
 if q is null or q=0 or abs(q)>1000000000 or q<>round(q,3) or cost is null or cost<0 or cost>100000000000 or cost<>round(cost,4) then
   raise exception 'INVENTORY_INVALID'; end if;
 if not exists(select 1 from public.gastro_items gi where gi.company_id=c and gi.id=i and gi.kind='stock' and not gi.archived)
 or not exists(select 1 from public.gastro_warehouses where company_id=c and id=w and not archived) then
   raise exception 'INVENTORY_NOT_FOUND'; end if;
 select * into old_movement from public.gastro_stock_movements where company_id=c and reference_kind=kind
   and reference_id=ref and item_id=i and warehouse_id=w;
 if found then
   if old_movement.quantity is distinct from q or old_movement.document_id is distinct from doc
     or old_movement.job_id is distinct from job or (q>0 and old_movement.unit_cost_minor is distinct from cost)
     then raise exception 'INVENTORY_RETRY_CONFLICT'; end if;
   return old_movement.id;
 end if;
 if q<0 and coalesce((select sum(remaining) from public.gastro_stock_lots where company_id=c and warehouse_id=w and item_id=i),0)<-q then
   raise exception 'INVENTORY_INSUFFICIENT'; end if;
 insert into public.gastro_stock_movements(company_id,item_id,warehouse_id,quantity,unit_cost_minor,document_id,reference_kind,reference_id,job_id,actor_id)
 values(c,i,w,q,cost,doc,kind,ref,job,actor) returning id into movement;
 if q>0 then
   lotid:=gen_random_uuid();
   if origin is not null then
     select min(created_at) into origin_time from public.gastro_stock_lots where company_id=c and item_id=i and origin_id=origin;
     if origin_time is null then raise exception 'INVENTORY_NOT_FOUND'; end if;
   end if;
   insert into public.gastro_stock_lots(id,company_id,item_id,warehouse_id,origin_id,receipt_id,quantity,remaining,unit_cost_minor,created_at)
   values(lotid,c,i,w,coalesce(origin,lotid),movement,q,q,cost,coalesce(origin_time,clock_timestamp()));
 else
   for lot in select * from public.gastro_stock_lots where company_id=c and warehouse_id=w and item_id=i and remaining>0 order by created_at,origin_id,id for update loop
     take_qty:=least(lot.remaining,remaining_qty);
     update public.gastro_stock_lots set remaining=remaining-take_qty where id=lot.id;
     insert into public.inventory_consumptions(company_id,movement_id,lot_id,quantity,job_id) values(c,movement,lot.id,take_qty,job);
     remaining_qty:=remaining_qty-take_qty;
     total_cost:=total_cost+take_qty*lot.unit_cost_minor;
     exit when remaining_qty=0;
   end loop;
   if remaining_qty<>0 then raise exception 'INVENTORY_INSUFFICIENT'; end if;
   update public.gastro_stock_movements set unit_cost_minor=round(total_cost/abs(q),4) where id=movement;
 end if;
 update public.gastro_warehouses set version=version+1 where company_id=c and id=w;
 return movement;
end $$;

create or replace function private.inventory_write(c uuid,op text,p jsonb,request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; old_cmd record; result jsonb; obj uuid; rowdata record; l jsonb; wh uuid; dest uuid; item uuid; job uuid;
 doc public.inventory_documents; ord public.inventory_orders; qty numeric; price numeric; movement uuid; con record; remaining_reservation numeric; consumed_reservation numeric;
begin
 actor:=private.require_module_access(c,'inventory',case when op='receive_order' then 'inventory.receipt.post' else 'inventory.movement.post' end);
 if op is null or request_id is null or p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>100000 then raise exception 'INVENTORY_INVALID'; end if;
 perform 1 from public.companies where id=c for update;
 select * into old_cmd from private.inventory_commands where company_id=c and inventory_commands.request_id=inventory_write.request_id;
 if found then
   if old_cmd.operation<>op or old_cmd.payload<>p then raise exception 'INVENTORY_RETRY_CONFLICT'; end if;
   return old_cmd.result;
 end if;
 if op='item' then
   obj:=nullif(p->>'id','')::uuid;
   if obj is null then
     insert into public.gastro_items(company_id,name,sku,unit,kind,sale_price_minor,tax_rate)
     values(c,btrim(p->>'name'),btrim(coalesce(p->>'sku','')),coalesce(nullif(p->>'unit',''),'ks'),coalesce(p->>'kind','stock'),
       coalesce((p->>'sale_price_minor')::bigint,0),coalesce((p->>'tax_rate')::numeric,21)) returning id into obj;
   else
     update public.gastro_items set name=btrim(p->>'name'),sku=btrim(coalesce(p->>'sku','')),sale_price_minor=(p->>'sale_price_minor')::bigint,
       tax_rate=(p->>'tax_rate')::numeric,archived=coalesce((p->>'archived')::boolean,false),version=version+1
       where company_id=c and id=obj and version=(p->>'version')::integer;
     if not found then raise exception 'INVENTORY_CONFLICT'; end if;
   end if;
 elsif op='warehouse' then
   if (select count(*) from public.gastro_warehouses where company_id=c and not archived)>=3 then raise exception 'INVENTORY_WAREHOUSE_LIMIT'; end if;
   insert into public.gastro_warehouses(company_id,name) values(c,btrim(p->>'name')) returning id into obj;
 elsif op='supplier' then
   obj:=nullif(p->>'customer_id','')::uuid;
   if obj is null then
     insert into public.customers(company_id,name,email,phone,address) values(c,btrim(p->>'name'),nullif(p->>'email',''),nullif(p->>'phone',''),nullif(p->>'address','')) returning id into obj;
   elsif not exists(select 1 from public.customers where company_id=c and id=obj) then raise exception 'INVENTORY_NOT_FOUND'; end if;
   insert into public.inventory_suppliers(company_id,customer_id) values(c,obj)
   on conflict(company_id,customer_id) do update set archived=false returning id into obj;
 elsif op='order' then
   wh:=(p->>'warehouse_id')::uuid;
   if not exists(select 1 from public.gastro_warehouses where company_id=c and id=wh and not archived)
     or not exists(select 1 from public.inventory_suppliers where company_id=c and id=(p->>'supplier_id')::uuid and not archived) then raise exception 'INVENTORY_NOT_FOUND'; end if;
   insert into public.inventory_orders(company_id,supplier_id,warehouse_id,title) values(c,(p->>'supplier_id')::uuid,wh,btrim(p->>'title')) returning id into obj;
   if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 100 then raise exception 'INVENTORY_INVALID'; end if;
   for l in select value from jsonb_array_elements(p->'lines') loop
     qty:=(l->>'quantity')::numeric; price:=(l->>'unit_cost_minor')::numeric;
     if qty is null or qty<=0 or qty>1000000000 or qty<>round(qty,3) or price is null or price<0 or price>100000000000 or price<>round(price,4)
       or not exists(select 1 from public.gastro_items where company_id=c and id=(l->>'item_id')::uuid and kind='stock' and not archived) then raise exception 'INVENTORY_INVALID'; end if;
     insert into public.inventory_order_lines(company_id,order_id,item_id,quantity,unit_cost_minor)
     values(c,obj,(l->>'item_id')::uuid,(l->>'quantity')::numeric,(l->>'unit_cost_minor')::numeric);
   end loop;
 elsif op='order_status' then
   select * into ord from public.inventory_orders where company_id=c and id=(p->>'id')::uuid for update;
   if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
   if ord.version is distinct from (p->>'version')::integer then raise exception 'INVENTORY_CONFLICT'; end if;
   if p->>'status' is null or not ((ord.status='draft' and p->>'status' in ('approved','cancelled')) or (ord.status='approved' and p->>'status' in ('sent','cancelled'))
     or (ord.status in ('sent','partial','received') and p->>'status'='closed')) then raise exception 'INVENTORY_STATE'; end if;
   obj:=ord.id; update public.inventory_orders set status=p->>'status',version=version+1 where id=obj;
 elsif op='document' then
   wh:=(p->>'warehouse_id')::uuid;dest:=nullif(p->>'destination_id','')::uuid;job:=nullif(p->>'job_id','')::uuid;
   if job is not null then
     perform private.require_module_access(c,'diriqo_core','core.costs.record');
     if not exists(select 1 from public.jobs where company_id=c and id=job) then raise exception 'INVENTORY_NOT_FOUND'; end if;
   end if;
   if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 100 then raise exception 'INVENTORY_INVALID'; end if;
   if (p->>'kind' in ('correction','count') and length(btrim(coalesce(p->>'reason','')))<3) or (p->>'kind'='transfer' and (dest is null or dest=wh)) then raise exception 'INVENTORY_INVALID'; end if;
   if p->>'kind'='transfer' and not exists(select 1 from public.gastro_warehouses where company_id=c and id=dest and not archived) then raise exception 'INVENTORY_NOT_FOUND'; end if;
   for l in select value from jsonb_array_elements(p->'lines') loop
     qty:=(l->>'quantity')::numeric; price:=coalesce((l->>'unit_cost_minor')::numeric,0);
     if qty is null or qty<0 or qty>1000000000 or qty<>round(qty,3) or (p->>'kind'<>'count' and qty=0)
       or price<0 or price>100000000000 or price<>round(price,4)
       or (p->>'kind'='correction' and coalesce(l->>'direction','in') not in ('in','out')) then raise exception 'INVENTORY_INVALID'; end if;
     if not exists(select 1 from public.gastro_items where company_id=c and id=(l->>'item_id')::uuid and kind='stock' and not archived)
       or (l->>'quantity')::numeric is null or (l->>'quantity')::numeric<0 then raise exception 'INVENTORY_INVALID'; end if;
   end loop;
   if (select count(distinct (value->>'item_id')::uuid) from jsonb_array_elements(p->'lines'))<>jsonb_array_length(p->'lines') then raise exception 'INVENTORY_DUPLICATE_ITEM'; end if;
   insert into public.inventory_documents(company_id,kind,warehouse_id,destination_id,job_id,reason,lines,expected_warehouse_version,created_by)
   select c,p->>'kind',wh,dest,job,coalesce(p->>'reason',''),p->'lines',version,actor from public.gastro_warehouses where company_id=c and id=wh and not archived returning id into obj;
   if obj is null then raise exception 'INVENTORY_NOT_FOUND'; end if;
 elsif op='post' then
   select * into doc from public.inventory_documents where company_id=c and id=(p->>'id')::uuid for update;
   if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
   obj:=doc.id;
   if doc.status='posted' then return jsonb_build_object('id',obj); end if;
   if doc.status<>'draft' then raise exception 'INVENTORY_STATE'; end if;
   if doc.version is distinct from (p->>'version')::integer then raise exception 'INVENTORY_CONFLICT'; end if;
   if doc.kind='count' and doc.expected_warehouse_version is distinct from (select version from public.gastro_warehouses where company_id=c and id=doc.warehouse_id) then raise exception 'INVENTORY_COUNT_CONFLICT'; end if;
   if doc.kind='receipt' then perform private.require_module_access(c,'inventory','inventory.receipt.post'); end if;
   if doc.job_id is not null then perform private.require_module_access(c,'diriqo_core','core.costs.record'); end if;
   for l in select value from jsonb_array_elements(doc.lines) loop
     item:=(l->>'item_id')::uuid;qty:=(l->>'quantity')::numeric;price:=coalesce((l->>'unit_cost_minor')::numeric,0);
     if doc.kind='count' then qty:=qty-coalesce((select sum(remaining) from public.gastro_stock_lots where company_id=c and item_id=item and warehouse_id=doc.warehouse_id),0);
     elsif doc.kind in ('issue','transfer') then qty:=-qty;
     elsif doc.kind='correction' and coalesce(l->>'direction','in')='out' then qty:=-qty; end if;
     if qty<>0 then
       if qty<0 and doc.kind<>'count' and -qty > coalesce((select sum(remaining) from public.gastro_stock_lots where company_id=c and item_id=item and warehouse_id=doc.warehouse_id),0)
         -coalesce((select sum(quantity) from public.inventory_reservations where company_id=c and item_id=item and warehouse_id=doc.warehouse_id and released_at is null and job_id is distinct from doc.job_id),0)
         then raise exception 'INVENTORY_RESERVED'; end if;
       movement:=private.inventory_move(c,doc.warehouse_id,item,qty,price,'document',doc.id,actor,doc.id,case when qty<0 and doc.kind='issue' then doc.job_id end);
       if doc.kind='transfer' then
         for con in select co.quantity,lo.unit_cost_minor,lo.origin_id,co.id from public.inventory_consumptions co join public.gastro_stock_lots lo on lo.id=co.lot_id where co.movement_id=movement loop
           perform private.inventory_move(c,doc.destination_id,item,con.quantity,con.unit_cost_minor,'transfer',con.id,actor,doc.id,null,con.origin_id);
         end loop;
       end if;
       if doc.kind='issue' and doc.job_id is not null then
         remaining_reservation:=-qty;
         for con in select id,quantity from public.inventory_reservations where company_id=c and warehouse_id=doc.warehouse_id and item_id=item and job_id=doc.job_id and released_at is null order by created_at,id for update loop
           consumed_reservation:=least(con.quantity,remaining_reservation);
           if consumed_reservation=con.quantity then
             update public.inventory_reservations set released_at=now() where id=con.id;
           else
             update public.inventory_reservations set quantity=quantity-consumed_reservation where id=con.id;
           end if;
           remaining_reservation:=remaining_reservation-consumed_reservation;
           exit when remaining_reservation=0;
         end loop;
       end if;
     end if;
   end loop;
   update public.inventory_documents set status='posted',posted_at=now(),version=version+1 where id=doc.id;
 elsif op='receive_order' then
   select * into ord from public.inventory_orders where company_id=c and id=(p->>'id')::uuid for update;
   if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
   if ord.version is distinct from (p->>'version')::integer then raise exception 'INVENTORY_CONFLICT'; end if;
   if ord.status not in ('approved','sent','partial') then raise exception 'INVENTORY_STATE'; end if;
   if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 100 then raise exception 'INVENTORY_INVALID'; end if;
   if (select count(distinct (value->>'line_id')::uuid) from jsonb_array_elements(p->'lines'))<>jsonb_array_length(p->'lines') then raise exception 'INVENTORY_DUPLICATE_ITEM'; end if;
   insert into public.inventory_documents(company_id,kind,warehouse_id,order_id,lines,status,posted_at,created_by)
   values(c,'receipt',ord.warehouse_id,ord.id,p->'lines','posted',now(),actor) returning id into obj;
   for l in select value from jsonb_array_elements(p->'lines') loop
     select * into rowdata from public.inventory_order_lines where company_id=c and order_id=ord.id and id=(l->>'line_id')::uuid for update;
     qty:=(l->>'quantity')::numeric;
     if not found or qty is null or qty<=0 or qty>rowdata.quantity-rowdata.received then raise exception 'INVENTORY_RECEIPT_QUANTITY'; end if;
     perform private.inventory_move(c,ord.warehouse_id,rowdata.item_id,qty,rowdata.unit_cost_minor,'order_receipt',obj,actor,obj);
     update public.inventory_order_lines set received=received+qty where id=rowdata.id;
   end loop;
   update public.inventory_orders set status=case when exists(select 1 from public.inventory_order_lines where order_id=ord.id and received<quantity) then 'partial' else 'received' end,version=version+1 where id=ord.id;
 elsif op='reserve' then
   wh:=(p->>'warehouse_id')::uuid;item:=(p->>'item_id')::uuid;job:=(p->>'job_id')::uuid;qty:=(p->>'quantity')::numeric;
   perform private.require_module_access(c,'diriqo_core','core.jobs.update');
   if not exists(select 1 from public.jobs where company_id=c and id=job) then raise exception 'INVENTORY_NOT_FOUND'; end if;
   if not exists(select 1 from public.gastro_items where company_id=c and id=item and kind='stock' and not archived)
     or not exists(select 1 from public.gastro_warehouses where company_id=c and id=wh and not archived) then raise exception 'INVENTORY_NOT_FOUND'; end if;
   if qty is null or qty<=0 or qty>1000000000 or qty<>round(qty,3) or qty>coalesce((select sum(remaining) from public.gastro_stock_lots where company_id=c and warehouse_id=wh and item_id=item),0)
    -coalesce((select sum(quantity) from public.inventory_reservations where company_id=c and warehouse_id=wh and item_id=item and released_at is null),0) then raise exception 'INVENTORY_INSUFFICIENT'; end if;
   insert into public.inventory_reservations(company_id,warehouse_id,item_id,job_id,quantity) values(c,wh,item,job,qty) returning id into obj;
 elsif op='release' then
   perform private.require_module_access(c,'diriqo_core','core.jobs.update');
   update public.inventory_reservations set released_at=now() where company_id=c and id=(p->>'id')::uuid returning id into obj;
   if obj is null then raise exception 'INVENTORY_NOT_FOUND'; end if;
 elsif op='revalue' then
   obj:=(p->>'lot_id')::uuid;price:=(p->>'unit_cost_minor')::numeric;
   select * into rowdata from public.gastro_stock_lots where company_id=c and id=obj for update;
   if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
   if price is null or price<0 or price>100000000000 or price<>round(price,4) or length(btrim(coalesce(p->>'reason','')))<3 then raise exception 'INVENTORY_INVALID'; end if;
   if rowdata.unit_cost_minor is distinct from (p->>'expected_unit_cost_minor')::numeric then raise exception 'INVENTORY_CONFLICT'; end if;
   -- Mark every affected warehouse changed: an older count must be reviewed again.
   update public.gastro_warehouses set version=version+1 where company_id=c and id in
     (select warehouse_id from public.gastro_stock_lots where company_id=c and origin_id=rowdata.origin_id);
   update public.gastro_stock_lots set unit_cost_minor=price where company_id=c and origin_id=rowdata.origin_id;
   insert into public.inventory_audit(company_id,actor_id,operation,entity_id,payload)
     values(c,actor,'revalue_delta',obj,jsonb_build_object('origin_id',rowdata.origin_id,'old_unit_cost_minor',rowdata.unit_cost_minor,'new_unit_cost_minor',price,'reason',p->>'reason'));
 else raise exception 'INVENTORY_OPERATION'; end if;
 result:=jsonb_build_object('id',obj);
 insert into public.inventory_audit(company_id,actor_id,operation,entity_id,payload) values(c,actor,op,obj,p);
 insert into private.inventory_commands values(c,request_id,op,p,result,now());
 return result;
end $$;
