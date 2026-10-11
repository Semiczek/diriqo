-- DRAFT: apply after the shared gastro_items / gastro_warehouses and module guards.
-- Adapted invariants from Hub POS: immutable source receipt, payload-aware event
-- replay, serialized partial returns and one stock effect per source line.
-- Online web register only. No offline/device lease or terminal integration claim.

create table public.pos_registers (
  id uuid primary key, company_id uuid not null references public.companies(id),
  code bigint not null check(code>0), unique(company_id,code),
  name text not null check(length(btrim(name)) between 1 and 100),
  warehouse_id uuid references public.gastro_warehouses(id),
  next_sequence bigint not null default 1 check(next_sequence>0),
  version integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references public.profiles(id), unique(company_id,id)
);
create table public.pos_register_operators (
  company_id uuid not null, register_id uuid not null, profile_id uuid not null references public.profiles(id),
  role text not null check(role in ('cashier','supervisor')), active boolean not null default true,
  primary key(company_id,register_id,profile_id),
  foreign key(company_id,register_id) references public.pos_registers(company_id,id)
);
create table public.pos_shifts (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, register_id uuid not null,
  opened_by uuid not null references public.profiles(id), browser_id uuid not null,
  opened_at timestamptz not null default clock_timestamp(), closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  opening_minor bigint not null check(opening_minor between 0 and 100000000000),
  expected_minor bigint, counted_minor bigint check(counted_minor between 0 and 100000000000),
  difference_minor bigint, closure_note text,
  unique(company_id,id), foreign key(company_id,register_id) references public.pos_registers(company_id,id),
  check((closed_at is null and closed_by is null and counted_minor is null) or
    (closed_at is not null and closed_by is not null and expected_minor is not null and counted_minor is not null and difference_minor=counted_minor-expected_minor))
);
create unique index pos_one_open_shift on public.pos_shifts(company_id,register_id) where closed_at is null;
create table public.pos_sales (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, register_id uuid not null, shift_id uuid not null,
  sequence_no bigint not null, document_no text not null,
  created_at timestamptz not null default clock_timestamp(), created_by uuid not null references public.profiles(id),
  issuer jsonb not null, payment_method text not null check(payment_method in ('cash','external')),
  payment_note text not null default '', currency text not null default 'CZK' check(currency='CZK'),
  total_minor bigint not null check(total_minor>0), tax_minor bigint not null check(tax_minor>=0),
  paid_minor bigint not null check(paid_minor>=0), tendered_minor bigint not null check(tendered_minor>=paid_minor),
  rounding_minor bigint not null, warehouse_id uuid references public.gastro_warehouses(id),
  unique(company_id,id), unique(company_id,register_id,sequence_no), unique(company_id,document_no),
  foreign key(company_id,register_id) references public.pos_registers(company_id,id),
  foreign key(company_id,shift_id) references public.pos_shifts(company_id,id),
  check(paid_minor=total_minor+rounding_minor)
);
create table public.pos_sale_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, sale_id uuid not null,
  item_id uuid not null references public.gastro_items(id), item_version integer not null,
  name text not null, sku text, unit text not null, kind text not null,
  quantity numeric(14,3) not null check(quantity>0 and quantity<=1000000),
  unit_price_minor bigint not null check(unit_price_minor>=0), tax_rate numeric(5,2) not null,
  total_minor bigint not null check(total_minor>=0), tax_minor bigint not null check(tax_minor>=0),
  unique(company_id,id), unique(sale_id,item_id), foreign key(company_id,sale_id) references public.pos_sales(company_id,id)
);
create table public.pos_returns (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, register_id uuid not null, shift_id uuid not null,
  sale_id uuid not null, sequence_no bigint not null, document_no text not null,
  reason text not null check(length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(), created_by uuid not null references public.profiles(id),
  total_minor bigint not null check(total_minor>=0), tax_minor bigint not null check(tax_minor>=0),
  paid_minor bigint not null check(paid_minor>=0), payment_method text not null check(payment_method in ('cash','external')),
  unique(company_id,id), unique(company_id,register_id,sequence_no), unique(company_id,document_no),
  foreign key(company_id,register_id) references public.pos_registers(company_id,id),
  foreign key(company_id,sale_id) references public.pos_sales(company_id,id),
  foreign key(company_id,shift_id) references public.pos_shifts(company_id,id)
);
create table public.pos_return_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, return_id uuid not null, sale_line_id uuid not null,
  quantity numeric(14,3) not null check(quantity>0), total_minor bigint not null check(total_minor>=0), tax_minor bigint not null check(tax_minor>=0),
  unique(return_id,sale_line_id), foreign key(company_id,return_id) references public.pos_returns(company_id,id),
  foreign key(company_id,sale_line_id) references public.pos_sale_lines(company_id,id)
);
create table public.pos_cash_movements (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, register_id uuid not null, shift_id uuid not null,
  amount_minor bigint not null check(amount_minor<>0 and abs(amount_minor)<=100000000000 and amount_minor%100=0),
  reason text not null check(length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(), created_by uuid not null references public.profiles(id),
  foreign key(company_id,register_id) references public.pos_registers(company_id,id),
  foreign key(company_id,shift_id) references public.pos_shifts(company_id,id)
);
create table private.pos_events (
  company_id uuid not null references public.companies(id), register_id uuid not null, event_id uuid not null,
  command text not null, payload jsonb not null, result jsonb not null,
  actor_id uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp(),
  primary key(company_id,register_id,event_id)
);
create index pos_sales_history on public.pos_sales(company_id,register_id,sequence_no desc);
create index pos_returns_sale on public.pos_returns(company_id,sale_id);
create index pos_return_lines_source on public.pos_return_lines(company_id,sale_line_id);
create index pos_sales_shift on public.pos_sales(company_id,shift_id);
create index pos_returns_shift on public.pos_returns(company_id,shift_id);
create index pos_cash_shift on public.pos_cash_movements(company_id,shift_id);

do $block$ declare n text; begin
  foreach n in array array['pos_registers','pos_register_operators','pos_shifts','pos_sales','pos_sale_lines','pos_returns','pos_return_lines','pos_cash_movements'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
  end loop;
end $block$;
alter table private.pos_events enable row level security;
revoke all on private.pos_events from public,anon,authenticated,service_role;

create function private.pos_immutable() returns trigger language plpgsql set search_path='' as $fn$
begin raise exception 'POS_IMMUTABLE' using errcode='42501'; end $fn$;
revoke all on function private.pos_immutable() from public,anon,authenticated,service_role;
do $block$ declare n text; begin
  foreach n in array array['pos_sales','pos_sale_lines','pos_returns','pos_return_lines','pos_cash_movements'] loop
    execute format('create trigger pos_immutable before update or delete on public.%I for each row execute function private.pos_immutable()',n);
  end loop;
end $block$;
create trigger pos_immutable before update or delete on private.pos_events for each row execute function private.pos_immutable();

create function private.pos_require_access(c uuid,r uuid,cap text,action text)
returns uuid language plpgsql security definer set search_path='' as $fn$
declare actor uuid; company_role text; operator_role text;
begin
  actor:=private.require_module_entitlement(c,'pos',cap,r);
  select cm.role into company_role from public.company_members cm where cm.company_id=c and cm.profile_id=actor and cm.is_active;
  if company_role in ('super_admin','company_admin','manager') then return actor; end if;
  if action in ('manage','catalog') then raise exception 'POS_FORBIDDEN' using errcode='42501'; end if;
  select o.role into operator_role from public.pos_register_operators o where o.company_id=c and o.register_id=r and o.profile_id=actor and o.active;
  if company_role is distinct from 'worker' or operator_role is null or (action in ('refund','cash') and operator_role<>'supervisor') then
    raise exception 'POS_FORBIDDEN' using errcode='42501';
  end if;
  return actor;
end $fn$;
revoke all on function private.pos_require_access(uuid,uuid,text,text) from public,anon,authenticated,service_role;

create function private.pos_expected_cash(c uuid,s uuid) returns bigint language sql security definer set search_path='' as $fn$
  select sh.opening_minor
    +coalesce((select sum(x.paid_minor) from public.pos_sales x where x.company_id=c and x.shift_id=s and x.payment_method='cash'),0)
    -coalesce((select sum(x.paid_minor) from public.pos_returns x where x.company_id=c and x.shift_id=s and x.payment_method='cash'),0)
    +coalesce((select sum(x.amount_minor) from public.pos_cash_movements x where x.company_id=c and x.shift_id=s),0)
  from public.pos_shifts sh where sh.company_id=c and sh.id=s;
$fn$;
revoke all on function private.pos_expected_cash(uuid,uuid) from public,anon,authenticated,service_role;

create function private.pos_command(c uuid,r uuid,e uuid,op text,p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  actor uuid; reg public.pos_registers%rowtype; sh public.pos_shifts%rowtype; previous private.pos_events%rowtype;
  sale public.pos_sales%rowtype; source public.pos_sale_lines%rowtype; item public.gastro_items%rowtype;
  entry jsonb; result jsonb; issuer jsonb; lines jsonb:='[]'; doc uuid; line_id uuid;
  amount bigint:=0; tax bigint:=0; line_amount bigint; line_tax bigint; paid bigint; tendered bigint;
  old_quantity numeric; qty numeric; old_amount bigint; old_paid bigint; new_warehouse uuid;
  expected bigint; counted bigint; document_no text; method text; role_name text;
begin
  if c is null or r is null or e is null or op is null or p is null or jsonb_typeof(p)<>'object' or length(p::text)>100000
    or op not in ('register_save','operator_save','catalog_save','shift_open','cash_move','sale','return','shift_close') then
    raise exception 'POS_INVALID' using errcode='22023';
  end if;
  actor:=private.pos_require_access(c,r,null,case when op in ('register_save','operator_save') then 'manage' when op='catalog_save' then 'catalog' when op='return' then 'refund' when op='cash_move' then 'cash' else 'read' end);
  -- Same key serializes before looking for a prior result, including a lost HTTP ACK.
  perform pg_advisory_xact_lock(hashtextextended('pos:'||c::text||':'||r::text||':'||e::text,0));
  select * into previous from private.pos_events x where x.company_id=c and x.register_id=r and x.event_id=e;
  if found then
    if previous.command<>op or previous.payload<>p then raise exception 'POS_EVENT_CONFLICT' using errcode='23505'; end if;
    return previous.result||jsonb_build_object('replayed',true);
  end if;
  -- Shared stock lock order: grants -> company -> register -> items -> lots.
  perform 1 from public.companies x where x.id=c for update;
  actor:=private.pos_require_access(c,r,null,case when op in ('register_save','operator_save') then 'manage' when op='catalog_save' then 'catalog' when op='return' then 'refund' when op='cash_move' then 'cash' else 'read' end);
  -- One lock order for sale, return, shift close and register changes.
  perform pg_advisory_xact_lock(hashtextextended('pos-register:'||c::text||':'||r::text,0));
  select * into reg from public.pos_registers x where x.company_id=c and x.id=r for update;
  if op<>'register_save' and not found then raise exception 'POS_REGISTER_REQUIRED' using errcode='22023'; end if;

  if op='register_save' then
    perform private.pos_require_access(c,r,'pos.sale.create','manage');
    if reg.id is not null and reg.version is distinct from (p->>'version')::int then raise exception 'POS_REGISTER_CONFLICT' using errcode='40001'; end if;
    if nullif(btrim(p->>'name'),'') is null or length(p->>'name')>100 then raise exception 'POS_INVALID' using errcode='22023'; end if;
    new_warehouse:=nullif(p->>'warehouse_id','')::uuid;
    if new_warehouse is not null then
      perform private.require_module_access(c,'inventory','inventory.movement.post',null);
      if not exists(select 1 from public.gastro_warehouses w where w.id=new_warehouse and w.company_id=c and not w.archived) then raise exception 'POS_INVALID' using errcode='22023'; end if;
    elsif reg.warehouse_id is not null and coalesce((p->>'confirm_without_inventory')::boolean,false) is not true then
      raise exception 'POS_INVENTORY_CONFIRM' using errcode='22023';
    end if;
    if reg.id is not null and exists(select 1 from public.pos_shifts x where x.company_id=c and x.register_id=r and x.closed_at is null) then raise exception 'POS_SHIFT_OPEN' using errcode='23505'; end if;
    insert into public.pos_registers(id,company_id,code,name,warehouse_id,created_by)
      values(r,c,coalesce(reg.code,(select coalesce(max(x.code),0)+1 from public.pos_registers x where x.company_id=c)),btrim(p->>'name'),new_warehouse,actor)
      on conflict(id) do update set name=excluded.name,warehouse_id=excluded.warehouse_id,version=pos_registers.version+1
      where pos_registers.company_id=c;
    if not found then raise exception 'POS_FORBIDDEN' using errcode='42501'; end if;
    result:=jsonb_build_object('register_id',r);

  elsif op='operator_save' then
    perform private.pos_require_access(c,r,'pos.catalog.manage','manage');
    if p->>'role' not in ('cashier','supervisor') or not exists(select 1 from public.company_members cm where cm.company_id=c and cm.profile_id=(p->>'profile_id')::uuid and cm.is_active and cm.role='worker') then raise exception 'POS_INVALID' using errcode='22023'; end if;
    insert into public.pos_register_operators(company_id,register_id,profile_id,role,active)
      values(c,r,(p->>'profile_id')::uuid,p->>'role',coalesce((p->>'active')::boolean,true))
      on conflict(company_id,register_id,profile_id) do update set role=excluded.role,active=excluded.active;
    result:=jsonb_build_object('saved',true);

  elsif op='catalog_save' then
    perform private.pos_require_access(c,r,'pos.catalog.manage','catalog');
    if nullif(btrim(p->>'name'),'') is null or length(p->>'name')>160 or length(coalesce(p->>'sku',''))>80 or length(coalesce(p->>'unit',''))>20
      or coalesce(p->>'kind','') not in ('stock','nonstock','service') or (p->>'price_minor')::numeric not between 0 and 100000000000
      or (p->>'price_minor')::numeric<>trunc((p->>'price_minor')::numeric) or (p->>'tax_rate')::numeric not in (0,12,21)
      or nullif(btrim(p->>'unit'),'') is null then raise exception 'POS_INVALID' using errcode='22023'; end if;
    doc:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid());
    if nullif(p->>'id','') is null then
      insert into public.gastro_items(id,company_id,name,sku,unit,kind,sale_price_minor,currency,tax_rate,archived,version)
        values(doc,c,btrim(p->>'name'),coalesce(btrim(p->>'sku'),''),btrim(p->>'unit'),p->>'kind',(p->>'price_minor')::bigint,'CZK',(p->>'tax_rate')::numeric,coalesce((p->>'archived')::boolean,false),1);
    else
      update public.gastro_items set name=btrim(p->>'name'),sku=coalesce(btrim(p->>'sku'),''),unit=btrim(p->>'unit'),kind=p->>'kind',
        sale_price_minor=(p->>'price_minor')::bigint,tax_rate=(p->>'tax_rate')::numeric,archived=coalesce((p->>'archived')::boolean,false),version=version+1
        where id=doc and company_id=c and version=(p->>'version')::int;
      if not found then raise exception 'POS_ITEM_CONFLICT' using errcode='40001'; end if;
    end if;
    result:=jsonb_build_object('item_id',doc);

  elsif op='shift_open' then
    -- Opening a settlement shift is allowed with retained history; new sales still
    -- require a current sale capability, even within an old open shift.
    if exists(select 1 from public.pos_shifts x where x.company_id=c and x.register_id=r and x.closed_at is null) then raise exception 'POS_SHIFT_OPEN' using errcode='23505'; end if;
    amount:=(p->>'opening_minor')::bigint;
    if amount is null or amount%100<>0 then raise exception 'POS_INVALID' using errcode='22023'; end if;
    insert into public.pos_shifts(company_id,register_id,opened_by,browser_id,opening_minor)
      values(c,r,actor,(p->>'browser_id')::uuid,amount) returning id into doc;
    result:=jsonb_build_object('shift_id',doc);

  else
    select * into sh from public.pos_shifts x where x.company_id=c and x.register_id=r and x.id=(p->>'shift_id')::uuid and x.closed_at is null for update;
    if not found then raise exception 'POS_SHIFT_REQUIRED' using errcode='22023'; end if;
    if op<>'shift_close' and sh.browser_id is distinct from (p->>'browser_id')::uuid then raise exception 'POS_SESSION_CONFLICT' using errcode='42501'; end if;
    if op='shift_close' then
      if sh.opened_by<>actor then perform private.pos_require_access(c,r,null,'refund'); end if;
      expected:=private.pos_expected_cash(c,sh.id); counted:=(p->>'counted_minor')::bigint;
      if counted is null or counted%100<>0 or length(coalesce(p->>'note',''))>500 then raise exception 'POS_INVALID' using errcode='22023'; end if;
      update public.pos_shifts set closed_at=clock_timestamp(),closed_by=actor,expected_minor=expected,counted_minor=counted,
        difference_minor=counted-expected,closure_note=p->>'note' where id=sh.id and company_id=c;
      result:=jsonb_build_object('shift_id',sh.id,'expected_minor',expected,'counted_minor',counted,'difference_minor',counted-expected);

    elsif op='cash_move' then
      perform private.pos_require_access(c,r,'pos.sale.create','cash');
      amount:=(p->>'amount_minor')::bigint;
      if nullif(btrim(p->>'reason'),'') is null then raise exception 'POS_INVALID' using errcode='22023'; end if;
      if private.pos_expected_cash(c,sh.id)+amount<0 then raise exception 'POS_CASH_INSUFFICIENT' using errcode='22023'; end if;
      insert into public.pos_cash_movements(company_id,register_id,shift_id,amount_minor,reason,created_by)
        values(c,r,sh.id,amount,btrim(p->>'reason'),actor) returning id into doc;
      result:=jsonb_build_object('movement_id',doc);

    elsif op='sale' then
      perform private.pos_require_access(c,r,'pos.sale.create','sale');
      select jsonb_build_object('name',x.name,'address',to_jsonb(x)->>'address',
        'registration_number',coalesce(to_jsonb(x)->>'registration_number',to_jsonb(x)->>'ico'),
        'tax_number',coalesce(to_jsonb(x)->>'tax_number',to_jsonb(x)->>'dic'),
        'country',coalesce(to_jsonb(x)->>'country_code',to_jsonb(x)->>'billing_country')) into issuer from public.companies x where x.id=c;
      if upper(coalesce(issuer->>'country',''))<>'CZ' then raise exception 'POS_COUNTRY_UNSUPPORTED' using errcode='22023'; end if;
      method:=p->>'payment_method';
      if method is null or method not in ('cash','external') or jsonb_typeof(p->'lines') is distinct from 'array'
        or jsonb_array_length(p->'lines') not between 1 and 100 or length(coalesce(p->>'payment_note',''))>200 then raise exception 'POS_INVALID' using errcode='22023'; end if;
      if (select count(*)<>count(distinct x->>'item_id') from jsonb_array_elements(p->'lines') x) then raise exception 'POS_INVALID' using errcode='22023'; end if;
      -- Deterministic item lock order also coordinates price edits and stock flows.
      for entry in select x from jsonb_array_elements(p->'lines') x order by x->>'item_id' loop
        qty:=(entry->>'quantity')::numeric;
        if qty is null or qty<=0 or qty>1000000 or qty<>round(qty,3) then raise exception 'POS_INVALID' using errcode='22023'; end if;
        select * into item from public.gastro_items x where x.company_id=c and x.id=(entry->>'item_id')::uuid and not x.archived for share;
        if not found or item.version is distinct from (entry->>'version')::int or item.currency<>'CZK' then raise exception 'POS_PRICE_CHANGED' using errcode='40001'; end if;
        line_amount:=round(item.sale_price_minor*qty)::bigint;
        if line_amount>100000000000 then raise exception 'POS_INVALID' using errcode='22023'; end if;
        line_tax:=round(line_amount*item.tax_rate/(100+item.tax_rate))::bigint;
        amount:=amount+line_amount; tax:=tax+line_tax;
        lines:=lines||jsonb_build_array(jsonb_build_object('item',to_jsonb(item),'quantity',qty,'total',line_amount,'tax',line_tax));
      end loop;
      if amount<=0 or amount>100000000000 then raise exception 'POS_INVALID' using errcode='22023'; end if;
      paid:=case when method='cash' then round(amount::numeric/100)::bigint*100 else amount end;
      tendered:=case when method='cash' then (p->>'tendered_minor')::bigint else paid end;
      if tendered is null or tendered<paid or tendered>100000000000 or (method='cash' and tendered%100<>0) then raise exception 'POS_TENDER_INSUFFICIENT' using errcode='22023'; end if;
      document_no:='P-'||reg.code::text||'-'||reg.next_sequence::text;
      insert into public.pos_sales(company_id,register_id,shift_id,sequence_no,document_no,created_by,issuer,payment_method,payment_note,total_minor,tax_minor,paid_minor,tendered_minor,rounding_minor,warehouse_id)
        values(c,r,sh.id,reg.next_sequence,document_no,actor,issuer,method,coalesce(p->>'payment_note',''),amount,tax,paid,tendered,paid-amount,reg.warehouse_id) returning id into doc;
      for entry in select x from jsonb_array_elements(lines) x loop
        line_id:=gen_random_uuid();
        insert into public.pos_sale_lines(id,company_id,sale_id,item_id,item_version,name,sku,unit,kind,quantity,unit_price_minor,tax_rate,total_minor,tax_minor)
          values(line_id,c,doc,(entry->'item'->>'id')::uuid,(entry->'item'->>'version')::int,entry->'item'->>'name',entry->'item'->>'sku',entry->'item'->>'unit',entry->'item'->>'kind',
            (entry->>'quantity')::numeric,(entry->'item'->>'sale_price_minor')::bigint,(entry->'item'->>'tax_rate')::numeric,(entry->>'total')::bigint,(entry->>'tax')::bigint);
        if reg.warehouse_id is not null and entry->'item'->>'kind'='stock' then
          perform private.pos_stock_move(c,reg.warehouse_id,(entry->'item'->>'id')::uuid,-(entry->>'quantity')::numeric,'pos_sale',line_id);
        end if;
      end loop;
      update public.pos_registers set next_sequence=next_sequence+1 where id=r and company_id=c;
      result:=jsonb_build_object('sale_id',doc,'document_no',document_no,'paid_minor',paid,'change_minor',tendered-paid);

    elsif op='return' then
      if nullif(btrim(p->>'reason'),'') is null or length(p->>'reason')>500 or jsonb_typeof(p->'lines') is distinct from 'array'
        or jsonb_array_length(p->'lines') not between 1 and 100 then raise exception 'POS_INVALID' using errcode='22023'; end if;
      select * into sale from public.pos_sales x where x.company_id=c and x.register_id=r and x.id=(p->>'sale_id')::uuid for update;
      if not found then raise exception 'POS_FORBIDDEN' using errcode='42501'; end if;
      if (select count(*)<>count(distinct x->>'line_id') from jsonb_array_elements(p->'lines') x) then raise exception 'POS_INVALID' using errcode='22023'; end if;
      for entry in select x from jsonb_array_elements(p->'lines') x order by x->>'line_id' loop
        qty:=(entry->>'quantity')::numeric;
        if qty is null or qty<=0 or qty>1000000 or qty<>round(qty,3) then raise exception 'POS_INVALID' using errcode='22023'; end if;
        select * into source from public.pos_sale_lines x where x.company_id=c and x.sale_id=sale.id and x.id=(entry->>'line_id')::uuid for update;
        if not found then raise exception 'POS_FORBIDDEN' using errcode='42501'; end if;
        select coalesce(sum(x.quantity),0) into old_quantity from public.pos_return_lines x where x.company_id=c and x.sale_line_id=source.id;
        if old_quantity+qty>source.quantity then raise exception 'POS_RETURN_EXCEEDED' using errcode='22023'; end if;
        line_amount:=round(source.total_minor*(old_quantity+qty)/source.quantity)::bigint-round(source.total_minor*old_quantity/source.quantity)::bigint;
        line_tax:=round(source.tax_minor*(old_quantity+qty)/source.quantity)::bigint-round(source.tax_minor*old_quantity/source.quantity)::bigint;
        amount:=amount+line_amount; tax:=tax+line_tax;
        lines:=lines||jsonb_build_array(jsonb_build_object('source',to_jsonb(source),'quantity',qty,'total',line_amount,'tax',line_tax));
      end loop;
      select coalesce(sum(x.total_minor),0),coalesce(sum(x.paid_minor),0) into old_amount,old_paid from public.pos_returns x where x.company_id=c and x.sale_id=sale.id;
      paid:=case when sale.payment_method='cash' then round((old_amount+amount)::numeric*sale.paid_minor/sale.total_minor/100)::bigint*100-old_paid else amount end;
      if paid<0 or old_paid+paid>sale.paid_minor then raise exception 'POS_RETURN_EXCEEDED' using errcode='22023'; end if;
      if sale.payment_method='cash' and private.pos_expected_cash(c,sh.id)<paid then raise exception 'POS_CASH_INSUFFICIENT' using errcode='22023'; end if;
      document_no:='V-'||reg.code::text||'-'||reg.next_sequence::text;
      insert into public.pos_returns(company_id,register_id,shift_id,sale_id,sequence_no,document_no,reason,created_by,total_minor,tax_minor,paid_minor,payment_method)
        values(c,r,sh.id,sale.id,reg.next_sequence,document_no,btrim(p->>'reason'),actor,amount,tax,paid,sale.payment_method) returning id into doc;
      for entry in select x from jsonb_array_elements(lines) x loop
        line_id:=gen_random_uuid();
        insert into public.pos_return_lines(id,company_id,return_id,sale_line_id,quantity,total_minor,tax_minor)
          values(line_id,c,doc,(entry->'source'->>'id')::uuid,(entry->>'quantity')::numeric,(entry->>'total')::bigint,(entry->>'tax')::bigint);
        if sale.warehouse_id is not null and entry->'source'->>'kind'='stock' then
          perform private.pos_stock_move(c,sale.warehouse_id,(entry->'source'->>'item_id')::uuid,(entry->>'quantity')::numeric,'pos_return',line_id);
        end if;
      end loop;
      update public.pos_registers set next_sequence=next_sequence+1 where id=r and company_id=c;
      result:=jsonb_build_object('return_id',doc,'sale_id',sale.id,'document_no',document_no,'refund_minor',paid);
    end if;
  end if;
  insert into private.pos_events(company_id,register_id,event_id,command,payload,result,actor_id) values(c,r,e,op,p,result,actor);
  return result||jsonb_build_object('replayed',false);
end $fn$;
revoke all on function private.pos_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.pos_command(uuid,uuid,uuid,text,jsonb) to authenticated;
create function public.pos_command(company_id uuid,register_id uuid,event_id uuid,command text,payload jsonb)
returns jsonb language sql security invoker set search_path='' as $fn$ select private.pos_command(company_id,register_id,event_id,command,payload) $fn$;
revoke all on function public.pos_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.pos_command(uuid,uuid,uuid,text,jsonb) to authenticated;

create function private.pos_read(c uuid,r uuid,mode text,p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor uuid; role_name text; candidate uuid; entries jsonb:='[]'; licences jsonb:='[]'; result jsonb;
  can_manage boolean; can_refund boolean; reg public.pos_registers%rowtype; sale public.pos_sales%rowtype; refund public.pos_returns%rowtype;
  sh public.pos_shifts%rowtype; rows jsonb; total jsonb; cursor_value bigint; date_from timestamptz; date_until timestamptz;
begin
  if mode='bootstrap' then
    select cm.profile_id,cm.role into actor,role_name from public.company_members cm join public.profiles pr on pr.id=cm.profile_id
      where cm.company_id=c and cm.is_active and pr.auth_user_id=auth.uid() and (pr.user_id is null or pr.user_id=pr.auth_user_id)
      and cm.role in ('worker','manager','company_admin','super_admin');
    if actor is null then raise exception 'POS_FORBIDDEN' using errcode='42501'; end if;
    for candidate in select distinct q.id from (
      select x.id from public.pos_registers x where x.company_id=c
      union select x.register_id from public.company_module_entitlements x where x.company_id=c and x.product='pos' and x.register_id is not null
      union select x.register_id from private.company_test_module_grants x where x.company_id=c and x.product='pos' and x.register_id is not null
    ) q order by q.id loop
      begin
        perform private.pos_require_access(c,candidate,null,'read');
        select * into reg from public.pos_registers x where x.company_id=c and x.id=candidate;
        if found then entries:=entries||jsonb_build_array(to_jsonb(reg));
        elsif role_name in ('manager','company_admin','super_admin') then
          perform private.pos_require_access(c,candidate,'pos.sale.create','manage');
          licences:=licences||jsonb_build_array(candidate);
        end if;
      exception when insufficient_privilege then null;
      end;
    end loop;
    return jsonb_build_object('registers',entries,'available_licences',licences,'can_manage',role_name in ('manager','company_admin','super_admin'));
  end if;
  actor:=private.pos_require_access(c,r,null,'read');
  select cm.role into role_name from public.company_members cm where cm.company_id=c and cm.profile_id=actor and cm.is_active;
  can_manage:=role_name in ('manager','company_admin','super_admin');
  can_refund:=can_manage or exists(select 1 from public.pos_register_operators o where o.company_id=c and o.register_id=r and o.profile_id=actor and o.active and o.role='supervisor');
  select * into reg from public.pos_registers x where x.id=r and x.company_id=c;
  if not found then raise exception 'POS_REGISTER_REQUIRED' using errcode='22023'; end if;
  if mode='workspace' then
    select * into sh from public.pos_shifts x where x.company_id=c and x.register_id=r and x.closed_at is null;
    result:=jsonb_build_object('register',to_jsonb(reg),'can_manage',can_manage,'can_refund',can_refund,
      'can_sell',private.module_has_entitlement(c,'pos','pos.sale.create',r),
      'can_catalog',can_manage and private.module_has_entitlement(c,'pos','pos.catalog.manage',r),
      'shift',case when sh.id is null then null else to_jsonb(sh)-'browser_id'||jsonb_build_object('expected_minor',private.pos_expected_cash(c,sh.id),'this_browser',sh.browser_id=(p->>'browser_id')::uuid,'can_close',sh.opened_by=actor or can_refund) end);
    if can_manage then
      result:=result||jsonb_build_object('warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'name',w.name)) from public.gastro_warehouses w where w.company_id=c and not w.archived),'[]'::jsonb),
        'operators',coalesce((select jsonb_agg(jsonb_build_object('profile_id',pr.id,'name',pr.full_name,'role',o.role,'active',coalesce(o.active,false))) from public.company_members cm join public.profiles pr on pr.id=cm.profile_id left join public.pos_register_operators o on o.company_id=c and o.register_id=r and o.profile_id=pr.id where cm.company_id=c and cm.is_active and cm.role='worker'),'[]'::jsonb));
    end if;
    return result;
  elsif mode='catalog' then
    if length(coalesce(p->>'search',''))>160 then raise exception 'POS_INVALID' using errcode='22023'; end if;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.name,q.id),'[]') into rows from (
      select i.id,i.name,i.sku,i.unit,i.kind,i.sale_price_minor,i.currency,i.tax_rate,i.archived,i.version
      from public.gastro_items i where i.company_id=c and (not i.archived or (can_manage and coalesce((p->>'include_archived')::boolean,false)))
      and (coalesce(p->>'search','')='' or i.name ilike '%'||(p->>'search')||'%' or i.sku ilike '%'||(p->>'search')||'%')
      order by i.name,i.id limit 51 offset greatest(0,least(100000,coalesce((p->>'offset')::int,0)))
    ) q;
    return jsonb_build_object('items',rows,'has_more',jsonb_array_length(rows)>50);
  elsif mode='receipt' then
    if p->>'kind'='return' then
      select * into refund from public.pos_returns x where x.company_id=c and x.register_id=r and x.id=(p->>'id')::uuid;
      if not found then raise exception 'POS_FORBIDDEN' using errcode='42501'; end if;
      select * into sale from public.pos_sales x where x.company_id=c and x.id=refund.sale_id;
      select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('name',s.name,'unit',s.unit,'tax_rate',s.tax_rate) order by s.name),'[]') into rows
        from public.pos_return_lines l join public.pos_sale_lines s on s.id=l.sale_line_id and s.company_id=c where l.company_id=c and l.return_id=refund.id;
      return jsonb_build_object('kind','return','document',to_jsonb(refund),'issuer',sale.issuer,'original_document_no',sale.document_no,'lines',rows);
    end if;
    select * into sale from public.pos_sales x where x.company_id=c and x.register_id=r and x.id=(p->>'id')::uuid;
    if not found then raise exception 'POS_FORBIDDEN' using errcode='42501'; end if;
    select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('returned_quantity',coalesce((select sum(x.quantity) from public.pos_return_lines x where x.company_id=c and x.sale_line_id=l.id),0)) order by l.name),'[]') into rows
      from public.pos_sale_lines l where l.company_id=c and l.sale_id=sale.id;
    return jsonb_build_object('kind','sale','document',to_jsonb(sale),'issuer',sale.issuer,'lines',rows);
  elsif mode in ('history','export') then
    if mode='export' then perform private.pos_require_access(c,r,'pos.history.export','read'); end if;
    cursor_value:=coalesce((p->>'before')::bigint,9223372036854775807);
    date_from:=coalesce(nullif(p->>'from','')::timestamptz,'2000-01-01'::timestamptz);
    date_until:=coalesce(nullif(p->>'until','')::timestamptz,'2100-01-01'::timestamptz);
    if not isfinite(date_from) or not isfinite(date_until) or date_until<=date_from then raise exception 'POS_INVALID' using errcode='22023'; end if;
    with documents as (
      select x.id,x.sequence_no,x.document_no,x.created_at,x.payment_method,x.total_minor,x.paid_minor,'sale'::text kind from public.pos_sales x where x.company_id=c and x.register_id=r
      union all select x.id,x.sequence_no,x.document_no,x.created_at,x.payment_method,-x.total_minor,-x.paid_minor,'return' from public.pos_returns x where x.company_id=c and x.register_id=r
    ) select coalesce(jsonb_agg(to_jsonb(q) order by q.sequence_no desc),'[]') into rows from (
      select * from documents where sequence_no<cursor_value and created_at>=date_from and created_at<date_until order by sequence_no desc limit (case when mode='export' then 10001 else 51 end)
    ) q;
    with documents as (
      select x.created_at,x.total_minor,x.paid_minor from public.pos_sales x where x.company_id=c and x.register_id=r
      union all select x.created_at,-x.total_minor,-x.paid_minor from public.pos_returns x where x.company_id=c and x.register_id=r
    ) select jsonb_build_object('count',count(*),'total_minor',coalesce(sum(total_minor),0),'paid_minor',coalesce(sum(paid_minor),0)) into total
      from documents where created_at>=date_from and created_at<date_until;
    return jsonb_build_object('rows',rows,'totals',total,'has_more',jsonb_array_length(rows)>(case when mode='export' then 10000 else 50 end));
  elsif mode='shifts' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.opened_at desc),'[]') into rows from (
      select x.id,x.opened_at,x.closed_at,x.opening_minor,x.expected_minor,x.counted_minor,x.difference_minor,x.closure_note
      from public.pos_shifts x where x.company_id=c and x.register_id=r order by x.opened_at desc limit 51 offset greatest(0,least(100000,coalesce((p->>'offset')::int,0)))
    ) q;
    return jsonb_build_object('rows',rows,'has_more',jsonb_array_length(rows)>50);
  elsif mode='cash' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id),'[]') into rows from (
      select x.id,x.created_at,x.shift_id,x.amount_minor,x.reason from public.pos_cash_movements x
      where x.company_id=c and x.register_id=r order by x.created_at desc,x.id
      limit 51 offset greatest(0,least(100000,coalesce((p->>'offset')::int,0)))
    ) q;
    return jsonb_build_object('rows',rows,'has_more',jsonb_array_length(rows)>50);
  end if;
  raise exception 'POS_INVALID' using errcode='22023';
end $fn$;
revoke all on function private.pos_read(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.pos_read(uuid,uuid,text,jsonb) to authenticated;
create function public.pos_read(company_id uuid,register_id uuid,mode text,params jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $fn$
  select private.pos_read(company_id,register_id,mode,params)
$fn$;
revoke all on function public.pos_read(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.pos_read(uuid,uuid,text,jsonb) to authenticated;
