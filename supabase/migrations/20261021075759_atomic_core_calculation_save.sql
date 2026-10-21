-- Atomic Core calculation CREATE + UPDATE. No historical tax/type/amount backfill.
alter table public.calculations
  add column if not exists internal_note text,
  add column revision bigint not null default 1 check (revision >= 1);
alter table public.calculation_items
  add column if not exists item_type text,
  add column if not exists vat_rate numeric(5,2),
  add column if not exists note text;
-- A preimage must preserve an unknown historical VAT, never substitute today's rate.
alter table public.calculation_version_items alter column vat_rate drop not null;
alter table public.calculation_version_items alter column vat_rate drop default;
alter table public.calculation_versions
  add column source_revision bigint,
  add column source_snapshot jsonb;
alter table public.calculation_version_items
  add column source_item_id uuid,
  add column source_created_at timestamptz;

create table private.core_calculation_save_requests (
  company_id uuid not null,
  operation_id uuid not null,
  actor_auth_user_id uuid not null,
  actor_profile_id uuid not null,
  operation_kind text not null check(operation_kind in('create','update')),
  calculation_id uuid not null,
  expected_revision bigint,
  input jsonb not null,
  result_revision bigint not null,
  completed_at timestamptz not null default clock_timestamp(),
  primary key(company_id,operation_id),
  check((operation_kind='create' and expected_revision is null and result_revision=1)
     or(operation_kind='update' and expected_revision>=1 and result_revision=expected_revision+1))
);
-- Deliberately no FK to the result: deletion must not permit operation-ID reuse.
alter table private.core_calculation_save_requests enable row level security;
revoke all on private.core_calculation_save_requests from public,anon,authenticated,service_role;

create function private.can_read_core_calculation(p_company_id uuid)
returns boolean language sql stable security definer set search_path='' as $f$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p join public.company_members m on m.profile_id=p.id
    where p.auth_user_id=auth.uid() and (p.user_id is null or p.user_id=p.auth_user_id)
      and p.is_active and m.company_id=p_company_id and m.is_active
      and m.role in('company_admin','super_admin')
  );
$f$;
revoke all on function private.can_read_core_calculation(uuid) from public,anon,authenticated,service_role;
grant execute on function private.can_read_core_calculation(uuid) to authenticated;

create function private.core_calculation_text(p_value jsonb,p_limit integer,p_required boolean default false)
returns text language plpgsql immutable set search_path='' as $f$
declare v text;
begin
  if p_value is null or jsonb_typeof(p_value) not in('string','null') then
    raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
  end if;
  if jsonb_typeof(p_value)='null' then
    if p_required then raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023'; end if;
    return null;
  end if;
  v:=nullif(btrim(p_value#>>'{}',E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)),'');
  if length(v)>p_limit or (p_required and v is null) then
    raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
  end if;
  return v;
end;
$f$;
revoke all on function private.core_calculation_text(jsonb,integer,boolean) from public,anon,authenticated,service_role;

create function private.core_calculation_decimal(p_value jsonb,p_positive boolean default false,p_max numeric default 9999999999.99)
returns numeric language plpgsql immutable set search_path='' as $f$
declare v numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'string' or length(p_value#>>'{}')>32
    or (p_value#>>'{}')!~'^[0-9]+([.][0-9]{1,2})?$' then
    raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
  end if;
  v:=(p_value#>>'{}')::numeric;
  if v>9999999999.99 then raise exception 'CALCULATION_NUMERIC_OVERFLOW' using errcode='22003'; end if;
  if v>p_max or (p_positive and v<=0) then
    raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
  end if;
  return v::numeric(12,2);
end;
$f$;
revoke all on function private.core_calculation_decimal(jsonb,boolean,numeric) from public,anon,authenticated,service_role;

create function private.normalize_core_calculation_input(p_input jsonb)
returns jsonb language plpgsql immutable set search_path='' as $f$
declare v_out jsonb; v_item jsonb; v_rows jsonb:='[]'; v_date date; v_customer uuid;
  v_type text; v_quantity numeric; v_cost numeric; v_price numeric; v_vat numeric;
  v_total_cost numeric:=0; v_total_price numeric:=0; v_line_cost numeric; v_line_price numeric;
begin
  if jsonb_typeof(p_input) is distinct from 'object'
    or not (p_input ?& array['customer_id','title','description','status','calculation_date','internal_note','currency','items'])
    or exists(select 1 from jsonb_object_keys(p_input) k where k<>all(array['customer_id','title','description','status','calculation_date','internal_note','currency','items']))
    or jsonb_typeof(p_input->'customer_id') not in('string','null')
    or jsonb_typeof(p_input->'status') is distinct from 'string'
    or p_input->>'status' not in('draft','ready')
    or p_input->'currency' is distinct from '"CZK"'::jsonb
    or jsonb_typeof(p_input->'calculation_date') is distinct from 'string'
    or (p_input->>'calculation_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_input->'items') is distinct from 'array' then
    raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
  end if;
  if jsonb_array_length(p_input->'items') not between 1 and 500 then
    raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
  end if;
  begin
    v_date:=(p_input->>'calculation_date')::date;
    if v_date not between date '0001-01-01' and date '9999-12-31'
      or to_char(v_date,'YYYY-MM-DD')<>p_input->>'calculation_date' then
      raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
    end if;
    if jsonb_typeof(p_input->'customer_id')='string' then
      if (p_input->>'customer_id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
      end if;
      v_customer:=(p_input->>'customer_id')::uuid;
    end if;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
  end;
  v_out:=jsonb_build_object('customer_id',v_customer,
    'title',private.core_calculation_text(p_input->'title',300,true),
    'description',private.core_calculation_text(p_input->'description',10000),
    'status',p_input->>'status','calculation_date',to_char(v_date,'YYYY-MM-DD'),
    'internal_note',private.core_calculation_text(p_input->'internal_note',10000),'currency','CZK');
  for v_item in select value from jsonb_array_elements(p_input->'items') loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or not(v_item ?& array['item_type','name','description','quantity','unit','unit_cost','unit_price','vat_rate','note'])
      or exists(select 1 from jsonb_object_keys(v_item) k where k<>all(array['item_type','name','description','quantity','unit','unit_cost','unit_price','vat_rate','note']))
      or jsonb_typeof(v_item->'item_type') is distinct from 'string'
      or v_item->>'item_type' not in('customer','labor','material','rental','transport','accommodation') then
      raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
    end if;
    v_type:=v_item->>'item_type';
    v_quantity:=private.core_calculation_decimal(v_item->'quantity',true);
    v_cost:=private.core_calculation_decimal(v_item->'unit_cost');
    v_price:=private.core_calculation_decimal(v_item->'unit_price');
    v_vat:=private.core_calculation_decimal(v_item->'vat_rate',false,100);
    if(v_type='customer' and v_cost<>0) or(v_type<>'customer' and v_price<>0) then
      raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
    end if;
    v_line_cost:=round(v_quantity*v_cost,2); v_line_price:=round(v_quantity*v_price,2);
    v_total_cost:=v_total_cost+v_line_cost; v_total_price:=v_total_price+v_line_price;
    if greatest(v_total_cost,v_total_price)>9999999999.99 then
      raise exception 'CALCULATION_NUMERIC_OVERFLOW' using errcode='22003';
    end if;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
      'item_type',v_type,'name',private.core_calculation_text(v_item->'name',300,true),
      'description',private.core_calculation_text(v_item->'description',4000),
      'quantity',v_quantity::text,'unit',private.core_calculation_text(v_item->'unit',50),
      'unit_cost',v_cost::text,'unit_price',v_price::text,'vat_rate',v_vat::text,
      'note',private.core_calculation_text(v_item->'note',4000)));
  end loop;
  v_out:=v_out||jsonb_build_object('items',v_rows);
  if octet_length(convert_to(v_out::text,'UTF8'))>1048576 then
    raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
  end if;
  return v_out;
end;
$f$;
revoke all on function private.normalize_core_calculation_input(jsonb) from public,anon,authenticated,service_role;

create function private.core_calculation_actor(p_company_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare v_actor uuid;
begin
  if auth.uid() is null then raise exception 'CALCULATION_FORBIDDEN' using errcode='42501'; end if;
  select p.id into v_actor from public.profiles p join public.company_members m on m.profile_id=p.id
  where p.auth_user_id=auth.uid() and (p.user_id is null or p.user_id=p.auth_user_id)
    and p.is_active and m.company_id=p_company_id and m.is_active and m.role in('company_admin','super_admin');
  if v_actor is null then raise exception 'CALCULATION_FORBIDDEN' using errcode='42501'; end if;
  return v_actor;
end;
$f$;
revoke all on function private.core_calculation_actor(uuid) from public,anon,authenticated,service_role;

-- Recheck current rows and wall-clock validity after any entitlement/customer wait.
create function private.assert_core_calculation_access(p_company_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare v_actor uuid; v_access jsonb; v_paid public.company_module_entitlements%rowtype;
  v_test private.company_test_module_grants%rowtype; v_valid boolean; v_now timestamptz;
begin
  v_actor:=private.core_calculation_actor(p_company_id);
  perform 1 from public.profiles where id=v_actor for share;
  perform 1 from public.company_members where company_id=p_company_id and profile_id=v_actor for share;
  perform 1 from public.company_modules where company_id=p_company_id and module_key='quotes' for share;
  perform private.core_calculation_actor(p_company_id);
  if exists(select 1 from public.company_modules where company_id=p_company_id and module_key='quotes' and not is_enabled) then
    raise exception 'CALCULATION_MODULE_REQUIRED' using errcode='42501';
  end if;
  perform private.evaluate_company_capability_access(p_company_id,'core.quotes.create',clock_timestamp());
  v_access:=private.evaluate_company_capability_access(p_company_id,'core.quotes.create',clock_timestamp());
  if not coalesce((v_access->>'allowed')::boolean,false) then raise exception 'CALCULATION_MODULE_REQUIRED' using errcode='42501'; end if;
  if v_access->>'reason'='paid' then
    select * into v_paid from public.company_module_entitlements where id=(v_access->>'entitlement_id')::uuid and company_id=p_company_id for share;
    if not found then raise exception 'CALCULATION_MODULE_REQUIRED' using errcode='42501'; end if;
    v_now:=clock_timestamp();
    v_valid:=v_paid.product='diriqo_core' and v_paid.register_id is null
      and v_paid.policy_version='diriqo-capabilities-v0.1' and v_paid.origin='paid' and v_paid.state='active' and not v_paid.revoked
      and v_paid.livemode=(v_access->>'livemode')::boolean and v_paid.valid_from<=v_now and v_now<v_paid.valid_until
      and 'core.quotes.create'=any(v_paid.capabilities);
  elsif v_access->>'reason'='test' then
    select * into v_test from private.company_test_module_grants where id=(v_access->>'test_grant_id')::uuid and company_id=p_company_id for share;
    if not found then raise exception 'CALCULATION_MODULE_REQUIRED' using errcode='42501'; end if;
    v_now:=clock_timestamp();
    v_valid:=v_test.product='diriqo_core' and v_test.register_id is null
      and v_test.policy_version='diriqo-capabilities-v0.1' and v_test.origin='manual_grant' and v_test.state='active' and v_test.revoked_at is null
      and not v_test.livemode and (v_access->>'livemode')::boolean=false
      and v_test.valid_from<=v_now and v_now<v_test.valid_until and 'core.quotes.create'=any(v_test.capabilities);
  else
    v_valid:=v_access->>'reason'='legacy' and (v_access->>'enforced')::boolean=false;
  end if;
  if v_valid is distinct from true then raise exception 'CALCULATION_MODULE_REQUIRED' using errcode='42501'; end if;
  perform private.core_calculation_actor(p_company_id);
  if exists(select 1 from public.company_modules where company_id=p_company_id and module_key='quotes' and not is_enabled) then
    raise exception 'CALCULATION_MODULE_REQUIRED' using errcode='42501';
  end if;
  return v_actor;
exception when insufficient_privilege then
  if sqlerrm='MODULE_CAPABILITY_FORBIDDEN' then raise exception 'CALCULATION_FORBIDDEN' using errcode='42501'; end if;
  raise;
end;
$f$;
revoke all on function private.assert_core_calculation_access(uuid) from public,anon,authenticated,service_role;


create function private.save_core_calculation_atomic(
  p_company_id uuid,p_calculation_id uuid,p_expected_revision bigint,p_operation_id uuid,p_input jsonb,p_kind text
) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare
  v_actor uuid; v_input jsonb; v_request private.core_calculation_save_requests%rowtype;
  v_current public.calculations%rowtype; v_id uuid; v_revision bigint;
  v_customer uuid; v_item jsonb; v_index integer:=0; v_version uuid; v_version_number bigint;
  v_cost numeric:=0; v_price numeric:=0;
begin
  if p_company_id is null or p_operation_id is null or p_kind not in('create','update')
    or(p_kind='create' and(p_calculation_id is not null or p_expected_revision is not null))
    or(p_kind='update' and(p_calculation_id is null or p_expected_revision is null or p_expected_revision<1)) then
    raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023';
  end if;
  v_actor:=private.assert_core_calculation_access(p_company_id);
  v_input:=private.normalize_core_calculation_input(p_input);
  -- Serialize one logical operation. A second update operation additionally locks
  -- the parent, so both cannot consume the same expected revision.
  perform pg_advisory_xact_lock(hashtextextended('core-calculation:'||p_company_id::text||':'||p_operation_id::text,0));
  v_actor:=private.assert_core_calculation_access(p_company_id);
  select * into v_request from private.core_calculation_save_requests
    where company_id=p_company_id and operation_id=p_operation_id;
  if found then
    if v_request.actor_auth_user_id is distinct from auth.uid()
      or v_request.actor_profile_id is distinct from v_actor
      or v_request.operation_kind<>p_kind or v_request.input<>v_input
      or v_request.expected_revision is distinct from p_expected_revision
      or(p_kind='update' and v_request.calculation_id<>p_calculation_id) then
      raise exception 'CALCULATION_OPERATION_CONFLICT' using errcode='PT409';
    end if;
    perform 1 from public.calculations where id=v_request.calculation_id and company_id=p_company_id for share;
    if not found then raise exception 'CALCULATION_RESULT_MISSING' using errcode='PT409'; end if;
    perform private.assert_core_calculation_access(p_company_id);
    return jsonb_build_object('companyId',p_company_id,'operationId',p_operation_id,
      'calculationId',v_request.calculation_id,'revision',v_request.result_revision::text,'replayed',true);
  end if;

  if p_kind='update' then
    select * into v_current from public.calculations where id=p_calculation_id and company_id=p_company_id for update;
    if not found then raise exception 'CALCULATION_NOT_FOUND' using errcode='P0002'; end if;
    perform private.assert_core_calculation_access(p_company_id);
    if v_current.revision<>p_expected_revision then raise exception 'CALCULATION_REVISION_CONFLICT' using errcode='PT409'; end if;
    if p_expected_revision=9223372036854775807 then raise exception 'CALCULATION_NUMERIC_OVERFLOW' using errcode='22003'; end if;
    -- The current UI supports CZK; never relabel historical foreign amounts.
    if v_current.currency is distinct from 'CZK' then raise exception 'CALCULATION_INVALID_INPUT' using errcode='22023'; end if;
    v_id:=v_current.id; v_revision:=p_expected_revision+1;
  else
    v_id:=gen_random_uuid(); v_revision:=1;
  end if;
  v_customer:=(v_input->>'customer_id')::uuid;
  if v_customer is not null then
    perform 1 from public.customers where id=v_customer and company_id=p_company_id for share;
    if not found then raise exception 'CALCULATION_CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;
  end if;
  -- This is after the operation, parent and customer waits, before any write.
  v_actor:=private.assert_core_calculation_access(p_company_id);
  select sum(round((x->>'quantity')::numeric*(x->>'unit_cost')::numeric,2)),
    sum(round((x->>'quantity')::numeric*(x->>'unit_price')::numeric,2))
    into v_cost,v_price from jsonb_array_elements(v_input->'items') x;
  if p_kind='update' then
    select coalesce(max(version_number),0)::bigint+1 into v_version_number
      from public.calculation_versions where calculation_id=v_id;
    if v_version_number>2147483647 then raise exception 'CALCULATION_NUMERIC_OVERFLOW' using errcode='22003'; end if;
    insert into public.calculation_versions(calculation_id,company_id,customer_id,version_number,title,description,
      status,calculation_date,internal_note,subtotal_cost,subtotal_price,margin_amount,total_price,currency,saved_by,
      source_revision,source_snapshot)
    values(v_id,p_company_id,v_current.customer_id,v_version_number,v_current.title,v_current.description,
      v_current.status,v_current.calculation_date,v_current.internal_note,v_current.subtotal_cost,v_current.subtotal_price,
      v_current.margin_amount,v_current.total_price,v_current.currency,v_actor,v_current.revision,to_jsonb(v_current))
    returning id into v_version;
    insert into public.calculation_version_items(calculation_version_id,sort_order,item_type,name,description,
      quantity,unit,unit_cost,unit_price,vat_rate,total_cost,total_price,note,source_item_id,source_created_at)
    select v_version,sort_order,item_type,name,description,quantity,unit,unit_cost,unit_price,vat_rate,
      total_cost,total_price,note,id,created_at from public.calculation_items where calculation_id=v_id;
    update public.calculations set customer_id=v_customer,title=v_input->>'title',description=v_input->>'description',
      status=v_input->>'status',calculation_date=(v_input->>'calculation_date')::date,internal_note=v_input->>'internal_note',
      subtotal_cost=v_cost,subtotal_price=v_price,margin_amount=v_price-v_cost,total_price=v_price,
      currency='CZK',revision=v_revision,updated_at=clock_timestamp()
      where id=v_id and company_id=p_company_id;
    delete from public.calculation_items where calculation_id=v_id;
  else
    insert into public.calculations(id,company_id,customer_id,title,description,status,calculation_date,internal_note,
      subtotal_cost,subtotal_price,margin_amount,total_price,currency,created_by,revision)
    values(v_id,p_company_id,v_customer,v_input->>'title',v_input->>'description',v_input->>'status',
      (v_input->>'calculation_date')::date,v_input->>'internal_note',v_cost,v_price,v_price-v_cost,v_price,'CZK',v_actor,1);
  end if;
  for v_item in select value from jsonb_array_elements(v_input->'items') loop
    insert into public.calculation_items(calculation_id,sort_order,item_type,name,description,quantity,unit,
      unit_cost,unit_price,vat_rate,total_cost,total_price,note)
    values(v_id,v_index,v_item->>'item_type',v_item->>'name',v_item->>'description',(v_item->>'quantity')::numeric,
      v_item->>'unit',(v_item->>'unit_cost')::numeric,(v_item->>'unit_price')::numeric,(v_item->>'vat_rate')::numeric,
      round((v_item->>'quantity')::numeric*(v_item->>'unit_cost')::numeric,2),
      round((v_item->>'quantity')::numeric*(v_item->>'unit_price')::numeric,2),v_item->>'note');
    v_index:=v_index+1;
  end loop;
  insert into private.core_calculation_save_requests(company_id,operation_id,actor_auth_user_id,actor_profile_id,
    operation_kind,calculation_id,expected_revision,input,result_revision)
  values(p_company_id,p_operation_id,auth.uid(),v_actor,p_kind,v_id,p_expected_revision,v_input,v_revision);
  -- Expiry or any authorization change observed during DML aborts the entire save,
  -- including its preimage and receipt. There is no partial-success exception path.
  perform private.assert_core_calculation_access(p_company_id);
  return jsonb_build_object('companyId',p_company_id,'operationId',p_operation_id,
    'calculationId',v_id,'revision',v_revision::text,'replayed',false);
end;
$f$;
revoke all on function private.save_core_calculation_atomic(uuid,uuid,bigint,uuid,jsonb,text) from public,anon,authenticated,service_role;

create function private.create_core_calculation_atomic(p_company_id uuid,p_operation_id uuid,p_input jsonb)
returns jsonb language sql volatile security definer set search_path='' as $f$
  select private.save_core_calculation_atomic(p_company_id,null,null,p_operation_id,p_input,'create');
$f$;
create function private.update_core_calculation_atomic(p_company_id uuid,p_calculation_id uuid,p_expected_revision bigint,p_operation_id uuid,p_input jsonb)
returns jsonb language sql volatile security definer set search_path='' as $f$
  select private.save_core_calculation_atomic(p_company_id,p_calculation_id,p_expected_revision,p_operation_id,p_input,'update');
$f$;
revoke all on function private.create_core_calculation_atomic(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.update_core_calculation_atomic(uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.create_core_calculation_atomic(uuid,uuid,jsonb) to authenticated;
grant execute on function private.update_core_calculation_atomic(uuid,uuid,bigint,uuid,jsonb) to authenticated;
create function public.create_core_calculation_atomic(p_company_id uuid,p_operation_id uuid,p_input jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $f$
  select private.create_core_calculation_atomic(p_company_id,p_operation_id,p_input);
$f$;
create function public.update_core_calculation_atomic(p_company_id uuid,p_calculation_id uuid,p_expected_revision bigint,p_operation_id uuid,p_input jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $f$
  select private.update_core_calculation_atomic(p_company_id,p_calculation_id,p_expected_revision,p_operation_id,p_input);
$f$;
revoke all on function public.create_core_calculation_atomic(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.update_core_calculation_atomic(uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_core_calculation_atomic(uuid,uuid,jsonb) to authenticated;
grant execute on function public.update_core_calculation_atomic(uuid,uuid,bigint,uuid,jsonb) to authenticated;

-- Old clients cannot partially update header/items/history, even through a permissive
-- historical policy. Header DELETE remains available; FK cascades are one statement.
revoke all on public.calculations,public.calculation_items,public.calculation_versions,public.calculation_version_items from public,anon,service_role;
revoke insert,update,truncate,references,trigger on public.calculations from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.calculation_items,public.calculation_versions,public.calculation_version_items from authenticated;
-- Also close any preexisting column-level DML grants.
do $acl$
declare t text; cols text;
begin
  foreach t in array array['calculations','calculation_items','calculation_versions','calculation_version_items'] loop
    select string_agg(quote_ident(attname),',') into cols from pg_attribute
      where attrelid=('public.'||t)::regclass and attnum>0 and not attisdropped;
    execute format('revoke insert(%s),update(%s),references(%s) on public.%I from public,anon,authenticated,service_role',cols,cols,cols,t);
  end loop;
end;
$acl$;
grant select on public.calculations,public.calculation_items,public.calculation_versions,public.calculation_version_items to authenticated;
alter table public.calculations enable row level security;
alter table public.calculation_items enable row level security;
alter table public.calculation_versions enable row level security;
alter table public.calculation_version_items enable row level security;

-- Internal costs and complete preimages are admin-only, even if old SELECT policies
-- permit any member. Read access intentionally does not depend on a current licence.
create policy core_calculation_read on public.calculations for select to authenticated
  using(private.can_read_core_calculation(company_id));
create policy core_calculation_read_boundary on public.calculations as restrictive for select to authenticated
  using(private.can_read_core_calculation(company_id));
create policy core_calculation_delete_boundary on public.calculations as restrictive for delete to authenticated
  using(private.can_read_core_calculation(company_id));
create policy core_calculation_item_read on public.calculation_items for select to authenticated
  using(exists(select 1 from public.calculations c where c.id=calculation_id and private.can_read_core_calculation(c.company_id)));
create policy core_calculation_item_read_boundary on public.calculation_items as restrictive for select to authenticated
  using(exists(select 1 from public.calculations c where c.id=calculation_id and private.can_read_core_calculation(c.company_id)));
create policy core_calculation_version_read on public.calculation_versions for select to authenticated
  using(private.can_read_core_calculation(company_id) and exists(select 1 from public.calculations c where c.id=calculation_id and c.company_id=calculation_versions.company_id));
create policy core_calculation_version_read_boundary on public.calculation_versions as restrictive for select to authenticated
  using(private.can_read_core_calculation(company_id) and exists(select 1 from public.calculations c where c.id=calculation_id and c.company_id=calculation_versions.company_id));
create policy core_calculation_version_item_read on public.calculation_version_items for select to authenticated
  using(exists(select 1 from public.calculation_versions v where v.id=calculation_version_id));
create policy core_calculation_version_item_read_boundary on public.calculation_version_items as restrictive for select to authenticated
  using(exists(select 1 from public.calculation_versions v where v.id=calculation_version_id));
