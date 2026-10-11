-- Apply after the POS schema and the inventory_move provenance follow-up.
-- Private only: every stock effect must name a committed-within-this-transaction
-- POS line. New sales need Inventory; a return settles the original stock issue.
create table private.pos_stock_return_allocations (
  company_id uuid not null references public.companies(id),
  return_line_id uuid not null references public.pos_return_lines(id),
  consumption_id uuid not null references public.inventory_consumptions(id),
  lot_id uuid not null references public.gastro_stock_lots(id),
  quantity numeric(14,3) not null check(quantity>0),
  primary key(return_line_id,consumption_id)
);
create index pos_stock_return_origin on private.pos_stock_return_allocations(company_id,consumption_id);
alter table private.pos_stock_return_allocations enable row level security;
revoke all on private.pos_stock_return_allocations from public,anon,authenticated,service_role;
create trigger pos_immutable before update or delete on private.pos_stock_return_allocations
  for each row execute function private.pos_immutable();

create or replace function private.pos_stock_move(c uuid,w uuid,i uuid,q numeric,kind text,ref uuid)
returns void language plpgsql security definer set search_path='' as $fn$
declare
  actor uuid; source record; original public.gastro_stock_movements;
  existing public.gastro_stock_movements; con record; movement uuid; lot_id uuid;
  prior_qty numeric; remaining_qty numeric; take_qty numeric; allocated numeric;
  total_cost numeric:=0; origin_time timestamptz;
begin
  if c is null or w is null or i is null or ref is null or q is null or q=0
    or abs(q)>1000000 or q<>round(q,3) or kind is null or kind not in ('pos_sale','pos_return') then
    raise exception 'INVENTORY_INVALID';
  end if;

  if kind='pos_sale' then
    select l.id,l.quantity,l.kind,s.register_id,s.warehouse_id,s.created_by
      into source from public.pos_sale_lines l
      join public.pos_sales s on s.company_id=l.company_id and s.id=l.sale_id
      where l.company_id=c and l.id=ref and l.item_id=i;
    if not found or source.kind<>'stock' or source.warehouse_id is distinct from w
      or q is distinct from -source.quantity then raise exception 'INVENTORY_INVALID'; end if;
    actor:=private.pos_require_access(c,source.register_id,'pos.sale.create','sale');
    begin
      perform private.require_module_entitlement(c,'inventory','inventory.movement.post',null);
    exception when insufficient_privilege then
      raise exception 'INVENTORY_MODULE_REQUIRED' using errcode='42501';
    end;
    if actor is distinct from source.created_by then raise exception 'POS_FORBIDDEN' using errcode='42501'; end if;
    -- The outer POS command has already locked all company grants and this row.
    perform 1 from public.companies where id=c for update;
    select * into existing from public.gastro_stock_movements
      where company_id=c and reference_kind=kind and reference_id=ref and item_id=i and warehouse_id=w;
    if found then
      if existing.quantity is distinct from q then raise exception 'INVENTORY_RETRY_CONFLICT'; end if;
      return;
    end if;
    if -q > coalesce((select sum(remaining) from public.gastro_stock_lots where company_id=c and warehouse_id=w and item_id=i),0)
      -coalesce((select sum(quantity) from public.inventory_reservations where company_id=c and warehouse_id=w and item_id=i and released_at is null),0)
      then raise exception 'INVENTORY_RESERVED'; end if;
    perform private.inventory_move(c,w,i,q,0,kind,ref,actor);
    return;
  end if;

  select rl.id,rl.quantity,sl.id sale_line_id,sl.quantity sold_quantity,sl.kind,
    s.register_id,s.warehouse_id,ret.created_by into source
    from public.pos_return_lines rl
    join public.pos_returns ret on ret.company_id=rl.company_id and ret.id=rl.return_id
    join public.pos_sale_lines sl on sl.company_id=rl.company_id and sl.id=rl.sale_line_id and sl.sale_id=ret.sale_id
    join public.pos_sales s on s.company_id=sl.company_id and s.id=sl.sale_id and s.register_id=ret.register_id
    where rl.company_id=c and rl.id=ref and sl.item_id=i;
  if not found or source.kind<>'stock' or source.warehouse_id is distinct from w
    or q is distinct from source.quantity then raise exception 'INVENTORY_INVALID'; end if;
  -- Settlement retains the POS role + company + register/history checks, without
  -- requiring a new Inventory licence or an unarchived catalogue/warehouse.
  actor:=private.pos_require_access(c,source.register_id,null,'refund');
  if actor is distinct from source.created_by then raise exception 'POS_FORBIDDEN' using errcode='42501'; end if;
  perform 1 from public.companies where id=c for update;
  select * into original from public.gastro_stock_movements
    where company_id=c and item_id=i and warehouse_id=w
      and reference_kind='pos_sale' and reference_id=source.sale_line_id for update;
  if not found or original.quantity is distinct from -source.sold_quantity then
    raise exception 'INVENTORY_RETURN_SOURCE';
  end if;
  select * into existing from public.gastro_stock_movements
    where company_id=c and reference_kind=kind and reference_id=ref and item_id=i and warehouse_id=w;
  if found then
    if existing.quantity is distinct from q or q is distinct from (
      select coalesce(sum(a.quantity),0) from private.pos_stock_return_allocations a where a.company_id=c and a.return_line_id=ref
    ) then raise exception 'INVENTORY_RETRY_CONFLICT'; end if;
    return;
  end if;
  select coalesce(sum(m.quantity),0) into prior_qty from public.gastro_stock_movements m
    join public.pos_return_lines rl on rl.company_id=m.company_id and rl.id=m.reference_id
    where m.company_id=c and m.item_id=i and m.warehouse_id=w and m.reference_kind='pos_return'
      and rl.sale_line_id=source.sale_line_id;
  if prior_qty<0 or prior_qty+q>source.sold_quantity then raise exception 'POS_RETURN_EXCEEDED' using errcode='22023'; end if;
  if source.sold_quantity is distinct from (
    select coalesce(sum(co.quantity),0) from public.inventory_consumptions co
      join public.gastro_stock_lots lo on lo.company_id=co.company_id and lo.id=co.lot_id
      where co.company_id=c and co.movement_id=original.id and lo.item_id=i and lo.warehouse_id=w
  ) or prior_qty is distinct from (
    select coalesce(sum(a.quantity),0) from private.pos_stock_return_allocations a
      join public.inventory_consumptions co on co.company_id=a.company_id and co.id=a.consumption_id
      where a.company_id=c and co.movement_id=original.id
  ) then raise exception 'INVENTORY_RETURN_SOURCE'; end if;

  insert into public.gastro_stock_movements(company_id,item_id,warehouse_id,quantity,unit_cost_minor,reference_kind,reference_id,actor_id)
    values(c,i,w,q,0,kind,ref,actor) returning id into movement;
  remaining_qty:=q;
  -- Allocate against the actual FIFO consumptions, including their origin and
  -- current origin valuation (revaluations intentionally update all origin lots).
  for con in select co.id,co.quantity,lo.origin_id,lo.unit_cost_minor,lo.created_at,lo.id source_lot_id
    from public.inventory_consumptions co join public.gastro_stock_lots lo on lo.company_id=co.company_id and lo.id=co.lot_id
    where co.company_id=c and co.movement_id=original.id and lo.item_id=i and lo.warehouse_id=w
    order by lo.created_at,lo.origin_id,lo.id for update of lo
  loop
    select coalesce(sum(a.quantity),0) into allocated from private.pos_stock_return_allocations a
      where a.company_id=c and a.consumption_id=con.id;
    if allocated>con.quantity then raise exception 'INVENTORY_RETURN_SOURCE'; end if;
    take_qty:=least(con.quantity-allocated,remaining_qty);
    if take_qty>0 then
      select min(created_at) into origin_time from public.gastro_stock_lots where company_id=c and item_id=i and origin_id=con.origin_id;
      lot_id:=gen_random_uuid();
      insert into public.gastro_stock_lots(id,company_id,item_id,warehouse_id,origin_id,receipt_id,quantity,remaining,unit_cost_minor,created_at)
        values(lot_id,c,i,w,con.origin_id,movement,take_qty,take_qty,con.unit_cost_minor,origin_time);
      insert into private.pos_stock_return_allocations(company_id,return_line_id,consumption_id,lot_id,quantity)
        values(c,ref,con.id,lot_id,take_qty);
      total_cost:=total_cost+take_qty*con.unit_cost_minor;
      remaining_qty:=remaining_qty-take_qty;
    end if;
    exit when remaining_qty=0;
  end loop;
  if remaining_qty<>0 then raise exception 'INVENTORY_RETURN_SOURCE'; end if;
  update public.gastro_stock_movements set unit_cost_minor=round(total_cost/q,4) where id=movement;
  update public.gastro_warehouses set version=version+1 where company_id=c and id=w;
end $fn$;
revoke all on function private.pos_stock_move(uuid,uuid,uuid,numeric,text,uuid) from public,anon,authenticated,service_role;

-- Follow-up: disambiguate next published version from the smart_quotes.revision column.
create or replace function public.smart_quotes_command(target_company_id uuid,command text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; q public.smart_quotes; d jsonb; snapshot jsonb; v jsonb; customer uuid; result_id uuid; next_version integer;
  raw_token text; supplier text; accepted public.smart_quote_acceptances; existing_job uuid; job_start timestamptz; job_end timestamptz; scope text;
begin
  actor:=private.require_module_access(target_company_id,'smart_quotes','smart_quotes.template.manage');
  if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>260000 then raise exception 'Neplatný příkaz.'; end if;
  if command in ('save','template_save','library_save') then
    d:=private.smart_quote_normalize(payload->'draft');
  end if;
  if command='template_save' then
    if length(btrim(coalesce(payload->>'name',''))) not between 1 and 160 then raise exception 'Vyplňte název šablony.'; end if;
    if nullif(payload->>'id','') is null then
      insert into public.smart_quote_templates(company_id,name,draft) values(target_company_id,btrim(payload->>'name'),d) returning id into result_id;
    else
      update public.smart_quote_templates set name=btrim(payload->>'name'),draft=d,revision=smart_quote_templates.revision+1,updated_at=now()
        where id=(payload->>'id')::uuid and company_id=target_company_id and smart_quote_templates.revision=(payload->>'revision')::integer and not archived returning id into result_id;
      if result_id is null then raise exception 'Šablona se mezitím změnila. Obnovte stránku.'; end if;
    end if;
    return jsonb_build_object('id',result_id);
  elsif command='library_save' then
    v:=d#>'{variants,0,items,0}';
    if nullif(payload->>'id','') is null then
      insert into public.smart_quote_library_items(company_id,item) values(target_company_id,v) returning id into result_id;
    else
      update public.smart_quote_library_items set item=v,revision=smart_quote_library_items.revision+1,updated_at=now()
        where id=(payload->>'id')::uuid and company_id=target_company_id and smart_quote_library_items.revision=(payload->>'revision')::integer and not archived returning id into result_id;
      if result_id is null then raise exception 'Položka se mezitím změnila. Obnovte stránku.'; end if;
    end if;
    return jsonb_build_object('id',result_id);
  elsif command='template_archive' then
    update public.smart_quote_templates set archived=true,updated_at=now() where id=(payload->>'id')::uuid and company_id=target_company_id returning id into result_id;
    if result_id is null then raise exception 'Šablona není dostupná.'; end if;
    return jsonb_build_object('id',result_id);
  elsif command='library_archive' then
    update public.smart_quote_library_items set archived=true,updated_at=now() where id=(payload->>'id')::uuid and company_id=target_company_id returning id into result_id;
    if result_id is null then raise exception 'Položka není dostupná.'; end if;
    return jsonb_build_object('id',result_id);
  end if;
  if command='save' then
    customer:=nullif(payload->>'customerId','')::uuid;
    if customer is not null and not exists(select 1 from public.customers where id=customer and company_id=target_company_id) then raise exception 'Zákazník nepatří do aktivní firmy.'; end if;
    if nullif(payload->>'id','') is null then
      insert into public.smart_quotes(company_id,customer_id,draft,created_by) values(target_company_id,customer,d,actor) returning id into result_id;
      return jsonb_build_object('id',result_id);
    end if;
  end if;
  select * into q from public.smart_quotes where id=(payload->>'id')::uuid and company_id=target_company_id for update;
  if q.id is null then raise exception 'Nabídka není dostupná.'; end if;
  if command='convert' then
    perform private.require_module_access(target_company_id,'diriqo_core','core.jobs.create');
    select job_id into existing_job from public.smart_quote_conversions where quote_id=q.id and company_id=target_company_id;
    if existing_job is not null then return jsonb_build_object('jobId',existing_job,'created',false); end if;
    select * into accepted from public.smart_quote_acceptances where quote_id=q.id and company_id=target_company_id;
    if accepted.id is null or q.status<>'accepted' or accepted.version<>q.current_version then raise exception 'Převést lze pouze přijatou aktuální verzi.'; end if;
    select s.snapshot into snapshot from public.smart_quote_versions s where quote_id=q.id and version=accepted.version;
    select value into v from jsonb_array_elements(snapshot->'variants') where value->>'id'=accepted.variant_id;
    job_start:=nullif(payload->>'startAt','')::timestamptz; job_end:=nullif(payload->>'endAt','')::timestamptz;
    if job_start is null or job_end is null or job_end<=job_start then raise exception 'Vyplňte začátek a konec zakázky.'; end if;
    select string_agg((i->>'name')||' — '||(i->>'quantity')||' '||(i->>'unit')||case when i->>'description'<>'' then E'\n'||(i->>'description') else '' end,E'\n') into scope from jsonb_array_elements(v->'items') i;
    insert into public.jobs(company_id,customer_id,title,description,address,price,currency,status,work_state,billing_state,billing_status,is_paid,is_internal,start_at,end_at,scheduled_start,scheduled_end)
      values(target_company_id,q.customer_id,snapshot->>'title','Přijatá nabídka, verze '||accepted.version||', varianta '||(v->>'name')||E'\n'||scope||E'\n\n'||(snapshot->>'deliveryTerms')||E'\n'||(snapshot->>'terms'),
        nullif(payload->>'address',''),(v->>'total')::numeric,'CZK','planned','not_started','waiting_for_invoice','waiting_for_invoice',false,false,job_start,job_end,job_start,job_end)
      returning id into result_id;
    insert into public.smart_quote_conversions(quote_id,company_id,acceptance_id,job_id,created_by) values(q.id,target_company_id,accepted.id,result_id,actor);
    return jsonb_build_object('jobId',result_id,'created',true);
  end if;
  if q.revision is distinct from (payload->>'revision')::integer then raise exception 'Nabídka se mezitím změnila. Obnovte stránku.'; end if;
  if q.status='accepted' and command<>'share' then raise exception 'Přijatý rozsah je uzamčený. Založte novou nabídku.'; end if;
  if command='save' then
    update public.smart_quotes set draft=d,customer_id=customer,revision=q.revision+1,approved_revision=null,approved_by=null,approved_at=null,approval_reason=null,updated_at=now() where id=q.id;
    return jsonb_build_object('id',q.id);
  elsif command='approve' then
    if not public.has_company_role(target_company_id,array['super_admin','company_admin']) then raise exception 'Podlimitní marži schvaluje administrátor firmy.' using errcode='42501'; end if;
    if length(btrim(coalesce(payload->>'reason',''))) not between 5 and 1000 then raise exception 'Uveďte důvod schválení (5 až 1000 znaků).'; end if;
    update public.smart_quotes set approved_revision=q.revision,approved_by=actor,approved_at=now(),approval_reason=btrim(payload->>'reason'),updated_at=now() where id=q.id;
    return jsonb_build_object('id',q.id);
  elsif command='publish' then
    if q.published_revision=q.revision then raise exception 'Tento návrh už má vydanou verzi. Můžete vytvořit nový odkaz.'; end if;
    d:=private.smart_quote_normalize(q.draft);
    if (d->>'validUntil')::date<current_date or (d->>'validUntil')::date>current_date+365 then raise exception 'Platnost musí být od dneška nejvýše do jednoho roku.'; end if;
    if exists(select 1 from jsonb_array_elements(d->'variants') x where (x->>'margin')::numeric<20) and q.approved_revision is distinct from q.revision then raise exception 'Marže pod 20 %% vyžaduje výslovné schválení administrátora.'; end if;
    select name into supplier from public.companies where id=target_company_id;
    snapshot:=private.smart_quote_customer_snapshot(d,supplier);
    next_version:=q.current_version+1;
    insert into public.smart_quote_versions(company_id,quote_id,version,snapshot,internal_snapshot,content_hash,published_by,approved_by,approval_reason)
      values(target_company_id,q.id,next_version,snapshot,d,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),actor,q.approved_by,q.approval_reason);
    update public.smart_quotes set current_version=next_version,published_revision=q.revision,status='sent',updated_at=now() where id=q.id;
  elsif command='share' then
    if q.current_version=0 then raise exception 'Nejprve vydejte verzi nabídky.'; end if;
    next_version:=q.current_version;
  else raise exception 'Neznámý příkaz.';
  end if;
  raw_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into private.smart_quote_tokens(token_hash,company_id,quote_id,version) values(encode(sha256(convert_to(raw_token,'UTF8')),'hex'),target_company_id,q.id,next_version);
  return jsonb_build_object('id',q.id,'version',next_version,'token',raw_token);
end $$;
