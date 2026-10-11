-- Inventory: FIFO quantities, exact decimal costs, immutable movement history.
create table public.inventory_suppliers (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 customer_id uuid not null references public.customers(id),archived boolean not null default false,
 unique(company_id,customer_id),unique(company_id,id)
);
create table public.inventory_orders (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 supplier_id uuid not null,warehouse_id uuid not null,title text not null check(length(btrim(title)) between 1 and 200),
 status text not null default 'draft' check(status in ('draft','approved','sent','partial','received','closed','cancelled')),
 version integer not null default 1,created_at timestamptz not null default now(),
 foreign key(company_id,supplier_id) references public.inventory_suppliers(company_id,id),
 foreign key(company_id,warehouse_id) references public.gastro_warehouses(company_id,id),unique(company_id,id)
);
create table public.inventory_order_lines (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,order_id uuid not null,item_id uuid not null,
 quantity numeric(14,3) not null check(quantity>0),received numeric(14,3) not null default 0 check(received>=0 and received<=quantity),
 unit_cost_minor numeric(18,4) not null check(unit_cost_minor>=0),
 foreign key(company_id,order_id) references public.inventory_orders(company_id,id),
 foreign key(company_id,item_id) references public.gastro_items(company_id,id),unique(company_id,id),unique(order_id,item_id)
);
create table public.inventory_documents (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 kind text not null check(kind in ('receipt','issue','transfer','count','correction')),warehouse_id uuid not null,
 destination_id uuid,job_id uuid references public.jobs(id),order_id uuid,reason text not null default '',
 status text not null default 'draft' check(status in ('draft','posted','cancelled')),lines jsonb not null,
 expected_warehouse_version integer,version integer not null default 1,created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),posted_at timestamptz,
 foreign key(company_id,warehouse_id) references public.gastro_warehouses(company_id,id),
 foreign key(company_id,destination_id) references public.gastro_warehouses(company_id,id),
 foreign key(company_id,order_id) references public.inventory_orders(company_id,id),unique(company_id,id)
);
create table public.gastro_stock_movements (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,item_id uuid not null,warehouse_id uuid not null,
 quantity numeric(14,3) not null,unit_cost_minor numeric(18,4) not null default 0,document_id uuid,
 reference_kind text not null,reference_id uuid not null,job_id uuid references public.jobs(id),
 actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 foreign key(company_id,item_id) references public.gastro_items(company_id,id),
 foreign key(company_id,warehouse_id) references public.gastro_warehouses(company_id,id),
 foreign key(company_id,document_id) references public.inventory_documents(company_id,id),
 unique(company_id,reference_kind,reference_id,item_id,warehouse_id),unique(company_id,id)
);
create table public.gastro_stock_lots (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,item_id uuid not null,warehouse_id uuid not null,
 origin_id uuid not null,receipt_id uuid not null,quantity numeric(14,3) not null check(quantity>0),
 remaining numeric(14,3) not null check(remaining>=0 and remaining<=quantity),unit_cost_minor numeric(18,4) not null check(unit_cost_minor>=0),
 created_at timestamptz not null default now(),
 foreign key(company_id,item_id) references public.gastro_items(company_id,id),
 foreign key(company_id,warehouse_id) references public.gastro_warehouses(company_id,id),
 foreign key(company_id,receipt_id) references public.gastro_stock_movements(company_id,id),unique(company_id,id)
);
create table public.inventory_consumptions (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,movement_id uuid not null,lot_id uuid not null,
 quantity numeric(14,3) not null check(quantity>0),job_id uuid references public.jobs(id),
 foreign key(company_id,movement_id) references public.gastro_stock_movements(company_id,id),
 foreign key(company_id,lot_id) references public.gastro_stock_lots(company_id,id),unique(movement_id,lot_id)
);
create table public.inventory_reservations (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,warehouse_id uuid not null,item_id uuid not null,
 job_id uuid not null references public.jobs(id),quantity numeric(14,3) not null check(quantity>0),released_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(company_id,warehouse_id) references public.gastro_warehouses(company_id,id),
 foreign key(company_id,item_id) references public.gastro_items(company_id,id)
);
create table public.inventory_audit (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 actor_id uuid not null references public.profiles(id),operation text not null,entity_id uuid,
 payload jsonb not null,created_at timestamptz not null default now()
);
create table private.inventory_commands (
 company_id uuid not null references public.companies(id),request_id uuid not null,operation text not null,payload jsonb not null,
 result jsonb not null,created_at timestamptz not null default now(),primary key(company_id,request_id)
);
alter table private.inventory_commands enable row level security;
revoke all on private.inventory_commands from public,anon,authenticated,service_role;
do $$ declare t text; begin
 foreach t in array array['inventory_suppliers','inventory_orders','inventory_order_lines','inventory_documents','gastro_stock_movements',
 'gastro_stock_lots','inventory_consumptions','inventory_reservations','inventory_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy module_read on public.%I for select to authenticated using(private.module_can_read(company_id,''inventory''))',t);
 execute format('create index %I on public.%I(company_id)',t||'_company_idx',t);
 end loop;
end $$;
create index inventory_lots_fifo_idx on public.gastro_stock_lots(company_id,warehouse_id,item_id,created_at,id) where remaining>0;
create index inventory_movement_time_idx on public.gastro_stock_movements(company_id,created_at desc);

create view public.gastro_stock_balances with(security_invoker=true) as
 select l.company_id,l.warehouse_id,l.item_id,sum(l.remaining) as quantity,
 sum(l.remaining*l.unit_cost_minor) as value_minor,
 coalesce((select sum(r.quantity) from public.inventory_reservations r where r.company_id=l.company_id
 and r.warehouse_id=l.warehouse_id and r.item_id=l.item_id and r.released_at is null),0) as reserved
 from public.gastro_stock_lots l group by l.company_id,l.warehouse_id,l.item_id;
revoke all on public.gastro_stock_balances from public,anon,authenticated,service_role;
grant select on public.gastro_stock_balances to authenticated;

-- Private hook runs only inside checked domain commands. All stock commands lock the company first.
create function private.inventory_move(c uuid,w uuid,i uuid,q numeric,cost numeric,kind text,ref uuid,
 actor uuid,doc uuid default null,job uuid default null,origin uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare movement uuid; lot record; remaining_qty numeric:=abs(q); take_qty numeric; lotid uuid;
begin
 if q is null or q=0 or abs(q)>1000000000 or q<>round(q,3) or cost is null or cost<0 or cost>100000000000 then
   raise exception 'INVENTORY_INVALID'; end if;
 if not exists(select 1 from public.gastro_items where company_id=c and id=i and kind='stock' and not archived)
 or not exists(select 1 from public.gastro_warehouses where company_id=c and id=w and not archived) then
   raise exception 'INVENTORY_NOT_FOUND'; end if;
 select id into movement from public.gastro_stock_movements where company_id=c and reference_kind=kind
   and reference_id=ref and item_id=i and warehouse_id=w;
 if found then return movement; end if;
 if q<0 and coalesce((select sum(remaining) from public.gastro_stock_lots where company_id=c and warehouse_id=w and item_id=i),0)<-q then
   raise exception 'INVENTORY_INSUFFICIENT'; end if;
 insert into public.gastro_stock_movements(company_id,item_id,warehouse_id,quantity,unit_cost_minor,document_id,reference_kind,reference_id,job_id,actor_id)
 values(c,i,w,q,cost,doc,kind,ref,job,actor) returning id into movement;
 if q>0 then
   lotid:=gen_random_uuid();
   insert into public.gastro_stock_lots(id,company_id,item_id,warehouse_id,origin_id,receipt_id,quantity,remaining,unit_cost_minor)
   values(lotid,c,i,w,coalesce(origin,lotid),movement,q,q,cost);
 else
   for lot in select * from public.gastro_stock_lots where company_id=c and warehouse_id=w and item_id=i and remaining>0 order by created_at,id for update loop
     take_qty:=least(lot.remaining,remaining_qty);
     update public.gastro_stock_lots set remaining=remaining-take_qty where id=lot.id;
     insert into public.inventory_consumptions(company_id,movement_id,lot_id,quantity,job_id) values(c,movement,lot.id,take_qty,job);
     remaining_qty:=remaining_qty-take_qty;
     exit when remaining_qty=0;
   end loop;
 end if;
 update public.gastro_warehouses set version=version+1 where company_id=c and id=w;
 return movement;
end $$;
revoke all on function private.inventory_move(uuid,uuid,uuid,numeric,numeric,text,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.inventory_write(c uuid,op text,p jsonb,request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; old_cmd record; result jsonb; obj uuid; rowdata record; l jsonb; wh uuid; dest uuid; item uuid; job uuid;
 doc public.inventory_documents; ord public.inventory_orders; qty numeric; price numeric; movement uuid; con record;
begin
 actor:=private.require_module_access(c,'inventory',case when op='receive_order' then 'inventory.receipt.post' else 'inventory.movement.post' end);
 if request_id is null or p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>100000 then raise exception 'INVENTORY_INVALID'; end if;
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
   insert into public.inventory_orders(company_id,supplier_id,warehouse_id,title) values(c,(p->>'supplier_id')::uuid,wh,btrim(p->>'title')) returning id into obj;
   if jsonb_typeof(p->'lines')<>'array' or jsonb_array_length(p->'lines') not between 1 and 100 then raise exception 'INVENTORY_INVALID'; end if;
   for l in select value from jsonb_array_elements(p->'lines') loop
     insert into public.inventory_order_lines(company_id,order_id,item_id,quantity,unit_cost_minor)
     values(c,obj,(l->>'item_id')::uuid,(l->>'quantity')::numeric,(l->>'unit_cost_minor')::numeric);
   end loop;
 elsif op='order_status' then
   select * into ord from public.inventory_orders where company_id=c and id=(p->>'id')::uuid for update;
   if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
   if ord.version<>(p->>'version')::integer then raise exception 'INVENTORY_CONFLICT'; end if;
   if not ((ord.status='draft' and p->>'status' in ('approved','cancelled')) or (ord.status='approved' and p->>'status' in ('sent','cancelled'))
     or (ord.status in ('sent','partial','received') and p->>'status'='closed')) then raise exception 'INVENTORY_STATE'; end if;
   obj:=ord.id; update public.inventory_orders set status=p->>'status',version=version+1 where id=obj;
 elsif op='document' then
   wh:=(p->>'warehouse_id')::uuid;dest:=nullif(p->>'destination_id','')::uuid;job:=nullif(p->>'job_id','')::uuid;
   if job is not null then
     perform private.require_module_access(c,'diriqo_core','core.costs.record');
     if not exists(select 1 from public.jobs where company_id=c and id=job) then raise exception 'INVENTORY_NOT_FOUND'; end if;
   end if;
   if jsonb_typeof(p->'lines')<>'array' or jsonb_array_length(p->'lines') not between 1 and 100 then raise exception 'INVENTORY_INVALID'; end if;
   if (p->>'kind' in ('correction','count') and length(btrim(coalesce(p->>'reason','')))<3) or (p->>'kind'='transfer' and (dest is null or dest=wh)) then raise exception 'INVENTORY_INVALID'; end if;
   for l in select value from jsonb_array_elements(p->'lines') loop
     if not exists(select 1 from public.gastro_items where company_id=c and id=(l->>'item_id')::uuid and kind='stock' and not archived)
       or (l->>'quantity')::numeric is null or (l->>'quantity')::numeric<0 then raise exception 'INVENTORY_INVALID'; end if;
   end loop;
   if (select count(distinct value->>'item_id') from jsonb_array_elements(p->'lines'))<>jsonb_array_length(p->'lines') then raise exception 'INVENTORY_DUPLICATE_ITEM'; end if;
   insert into public.inventory_documents(company_id,kind,warehouse_id,destination_id,job_id,reason,lines,expected_warehouse_version,created_by)
   select c,p->>'kind',wh,dest,job,coalesce(p->>'reason',''),p->'lines',version,actor from public.gastro_warehouses where company_id=c and id=wh and not archived returning id into obj;
   if obj is null then raise exception 'INVENTORY_NOT_FOUND'; end if;
 elsif op='post' then
   select * into doc from public.inventory_documents where company_id=c and id=(p->>'id')::uuid for update;
   if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
   obj:=doc.id;
   if doc.status='posted' then return jsonb_build_object('id',obj); end if;
   if doc.status<>'draft' then raise exception 'INVENTORY_STATE'; end if;
   if doc.version<>(p->>'version')::integer then raise exception 'INVENTORY_CONFLICT'; end if;
   if doc.kind='count' and doc.expected_warehouse_version<>(select version from public.gastro_warehouses where id=doc.warehouse_id) then raise exception 'INVENTORY_COUNT_CONFLICT'; end if;
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
         update public.inventory_reservations set released_at=now() where company_id=c and warehouse_id=doc.warehouse_id and item_id=item and job_id=doc.job_id and released_at is null;
       end if;
     end if;
   end loop;
   update public.inventory_documents set status='posted',posted_at=now(),version=version+1 where id=doc.id;
 elsif op='receive_order' then
   select * into ord from public.inventory_orders where company_id=c and id=(p->>'id')::uuid for update;
   if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
   if ord.version<>(p->>'version')::integer then raise exception 'INVENTORY_CONFLICT'; end if;
   if ord.status not in ('approved','sent','partial') then raise exception 'INVENTORY_STATE'; end if;
   if jsonb_typeof(p->'lines')<>'array' or jsonb_array_length(p->'lines') not between 1 and 100 then raise exception 'INVENTORY_INVALID'; end if;
   if (select count(distinct value->>'line_id') from jsonb_array_elements(p->'lines'))<>jsonb_array_length(p->'lines') then raise exception 'INVENTORY_DUPLICATE_ITEM'; end if;
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
   if qty<=0 or qty>coalesce((select sum(remaining) from public.gastro_stock_lots where company_id=c and warehouse_id=wh and item_id=item),0)
    -coalesce((select sum(quantity) from public.inventory_reservations where company_id=c and warehouse_id=wh and item_id=item and released_at is null),0) then raise exception 'INVENTORY_INSUFFICIENT'; end if;
   insert into public.inventory_reservations(company_id,warehouse_id,item_id,job_id,quantity) values(c,wh,item,job,qty) returning id into obj;
 elsif op='release' then
   update public.inventory_reservations set released_at=now() where company_id=c and id=(p->>'id')::uuid returning id into obj;
   if obj is null then raise exception 'INVENTORY_NOT_FOUND'; end if;
 elsif op='revalue' then
   obj:=(p->>'lot_id')::uuid;price:=(p->>'unit_cost_minor')::numeric;
   select * into rowdata from public.gastro_stock_lots where company_id=c and id=obj for update;
   if not found then raise exception 'INVENTORY_NOT_FOUND'; end if;
   if price is null or price<0 or price>100000000000 or length(btrim(coalesce(p->>'reason','')))<3 then raise exception 'INVENTORY_INVALID'; end if;
   update public.gastro_stock_lots set unit_cost_minor=price where company_id=c and origin_id=rowdata.origin_id;
 else raise exception 'INVENTORY_OPERATION'; end if;
 result:=jsonb_build_object('id',obj);
 insert into public.inventory_audit(company_id,actor_id,operation,entity_id,payload) values(c,actor,op,obj,p);
 insert into private.inventory_commands values(c,request_id,op,p,result,now());
 return result;
end $$;
revoke all on function private.inventory_write(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.inventory_write(uuid,text,jsonb,uuid) to authenticated;
create function public.inventory_write(company uuid,operation text,payload jsonb,request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.inventory_write(company,operation,payload,request_id); $$;
revoke all on function public.inventory_write(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inventory_write(uuid,text,jsonb,uuid) to authenticated;

create function private.inventory_availability(c uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.module_can_read(c,'inventory',false) then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('item_id',x.item_id,'warehouse_id',x.warehouse_id,'name',x.name,'unit',x.unit,'quantity',x.quantity,'reserved',x.reserved))
 from (select b.item_id,b.warehouse_id,i.name,i.unit,b.quantity,b.reserved from public.gastro_stock_balances b join public.gastro_items i on i.id=b.item_id where b.company_id=c order by i.name limit 500) x),'[]'::jsonb);
end $$;
revoke all on function private.inventory_availability(uuid) from public,anon,authenticated,service_role;
grant execute on function private.inventory_availability(uuid) to authenticated;
create function public.inventory_availability(company uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.inventory_availability(company); $$;
revoke all on function public.inventory_availability(uuid) from public,anon,authenticated,service_role;
grant execute on function public.inventory_availability(uuid) to authenticated;
