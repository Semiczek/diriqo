-- Atomically edit the existing invoice form without changing historical guards,
-- table grants, old RPC contracts, or existing rows. The revision is an opaque
-- hash of the complete stored header and ordered complete item rows.
set local lock_timeout = '5s';

create function private.invoice_edit_revision(invoice_row jsonb, item_rows jsonb)
returns text language sql immutable security invoker set search_path = '' as $function$
  select encode(pg_catalog.sha256(convert_to(
    jsonb_build_object('invoice',invoice_row,'items',coalesce(item_rows,'[]'::jsonb))::text,'UTF8')),'hex');
$function$;
revoke all on function private.invoice_edit_revision(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.invoice_edit_revision(jsonb,jsonb) to authenticated;

-- One statement supplies the header, children and hash from one MVCC snapshot.
-- Preserve existing member read access; writing has a separate fresh admin gate.
create function public.get_invoice_edit_snapshot(target_company_id uuid, target_invoice_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_company_member(target_company_id) then
    raise exception 'INVOICE_DRAFT_FORBIDDEN' using errcode='42501';
  end if;
  select jsonb_build_object('invoice',to_jsonb(i),'items',lines.items,
    'revision',private.invoice_edit_revision(to_jsonb(i),lines.items)) into v_result
  from public.invoices i
  cross join lateral (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order,x.created_at,x.id),'[]'::jsonb) items
    from public.invoice_items x where x.invoice_id=i.id and x.company_id=i.company_id
  ) lines
  where i.id=target_invoice_id and i.company_id=target_company_id;
  if v_result is null then raise exception 'INVOICE_NOT_FOUND' using errcode='P0002'; end if;
  return v_result;
end;
$function$;
revoke all on function public.get_invoice_edit_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_invoice_edit_snapshot(uuid,uuid) to authenticated;

-- A pure allowlist normalizer, not an authorization or write bypass.
create function private.invoice_edit_text_object(input_object jsonb, allowed_keys text[])
returns jsonb language plpgsql immutable security invoker set search_path = '' as $function$
declare v_result jsonb; v_entry record;
begin
  if input_object is null or jsonb_typeof(input_object)<>'object' then
    raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
  end if;
  for v_entry in select key,value from jsonb_each(input_object) loop
    if not (v_entry.key=any(allowed_keys)) or jsonb_typeof(v_entry.value) not in ('string','null')
      or char_length(coalesce(input_object->>v_entry.key,''))>10000 then
      raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
    end if;
  end loop;
  select jsonb_object_agg(k,to_jsonb(nullif(btrim(input_object->>k),''))) into v_result
    from unnest(allowed_keys) k;
  return coalesce(v_result,'{}'::jsonb);
end;
$function$;
revoke all on function private.invoice_edit_text_object(jsonb,text[]) from public,anon,authenticated,service_role;
grant execute on function private.invoice_edit_text_object(jsonb,text[]) to authenticated;

create function private.write_invoice_draft_atomic(
  target_company_id uuid, target_invoice_id uuid, expected_revision text,
  expected_item_ids uuid[], header_input jsonb, item_inputs jsonb, refresh_supplier boolean
)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_invoice public.invoices%rowtype; v_company public.companies%rowtype;
  v_items jsonb; v_payload jsonb; v_updated_items jsonb:='[]'; v_item jsonb;
  v_supplier jsonb; v_customer jsonb; v_patch jsonb; v_access jsonb;
  v_actual_ids uuid[]; v_expected_ids uuid[]; v_payload_ids uuid[]:='{}'; v_id uuid;
  v_rows integer; v_count integer; v_sort integer:=0; v_key text;
  v_quantity numeric; v_price numeric; v_rate numeric; v_net numeric; v_tax numeric; v_gross numeric;
  v_subtotal numeric:=0; v_vat_total numeric:=0; v_total numeric:=0;
  v_issue_date date; v_tax_date date; v_due_date date;
  v_number text; v_symbol text; v_note text; v_vat_note text; v_payer boolean;
  v_name text; v_unit text; v_description text; v_result jsonb;
  v_supplier_keys constant text[]:=array['name','billingName','companyNumber','vatNumber',
    'billingStreet','billingCity','billingPostalCode','billingCountry','bankAccountNumber',
    'bankCode','iban','swiftBic'];
  v_customer_keys constant text[]:=array['name','billingName','companyNumber','vatNumber',
    'billingStreet','billingCity','billingPostalCode','billingCountry','email','phone'];
  v_tax_note constant text:='Dodavatel není plátcem DPH.';
begin
  if auth.uid() is null or not public.is_company_admin(target_company_id) then
    raise exception 'INVOICE_DRAFT_FORBIDDEN' using errcode='42501';
  end if;
  if expected_revision is null or expected_revision !~ '^[0-9a-f]{64}$' or refresh_supplier is null then
    raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
  end if;
  if expected_item_ids is null or cardinality(expected_item_ids) not between 1 and 200
    or array_ndims(expected_item_ids)<>1 or array_position(expected_item_ids,null) is not null then
    raise exception 'INVOICE_DRAFT_ITEMS_INVALID' using errcode='23514';
  end if;
  select array_agg(id order by id),count(distinct id) into v_expected_ids,v_count from unnest(expected_item_ids) id;
  if v_count<>cardinality(expected_item_ids) then
    raise exception 'INVOICE_DRAFT_ITEMS_INVALID' using errcode='23514';
  end if;

  -- Match the existing issue/delete RPCs' parent-first locking order.
  select * into v_invoice from public.invoices i
    where i.id=target_invoice_id and i.company_id=target_company_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode='P0002'; end if;
  if auth.uid() is null or not public.is_company_admin(target_company_id) then
    raise exception 'INVOICE_DRAFT_FORBIDDEN' using errcode='42501';
  end if;
  if v_invoice.status is distinct from 'draft' or v_invoice.issued_at is not null then
    raise exception 'INVOICE_INVALID_STATE' using errcode='23514';
  end if;
  v_access:=public.get_company_capability_access(target_company_id,'invoicing.invoice.issue');
  if not coalesce((v_access->>'allowed')::boolean,false) then
    raise exception 'INVOICE_MODULE_REQUIRED' using errcode='42501';
  end if;
  -- Existing child scope trigger locks this same parent before child mutations.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order,x.created_at,x.id),'[]'::jsonb),
    array_agg(x.id order by x.id) into v_items,v_actual_ids
  from public.invoice_items x where x.invoice_id=v_invoice.id and x.company_id=v_invoice.company_id;
  if private.invoice_edit_revision(to_jsonb(v_invoice),v_items)<>expected_revision then
    raise exception 'INVOICE_DRAFT_STALE' using errcode='23514';
  end if;
  if v_actual_ids is distinct from v_expected_ids then
    raise exception 'INVOICE_DRAFT_ITEMS_INVALID' using errcode='23514';
  end if;
  if jsonb_typeof(v_invoice.supplier_snapshot) is distinct from 'object'
    or jsonb_typeof(v_invoice.customer_snapshot) is distinct from 'object' then
    raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
  end if;

  if refresh_supplier then
    if header_input is not null or item_inputs is not null then
      raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
    end if;
    select * into v_company from public.companies c where c.id=target_company_id;
    if not found then raise exception 'INVOICE_DRAFT_FORBIDDEN' using errcode='42501'; end if;
    v_patch:=private.invoice_edit_text_object(jsonb_build_object(
      'name',v_company.name,'billingName',coalesce(v_company.billing_name,v_company.name),
      'companyNumber',v_company.company_number,'vatNumber',v_company.vat_number,
      'billingStreet',v_company.billing_street,'billingCity',v_company.billing_city,
      'billingPostalCode',v_company.billing_postal_code,'billingCountry',v_company.billing_country,
      'bankAccountNumber',v_company.bank_account_number,'bankCode',v_company.bank_code,
      'iban',v_company.iban,'swiftBic',v_company.swift_bic),v_supplier_keys);
    if v_patch->>'billingName' is null then v_patch:=v_patch||jsonb_build_object('billingName',v_patch->>'name'); end if;
    v_supplier:=v_invoice.supplier_snapshot||v_patch||jsonb_build_object('logoUrl',v_company.logo_url);
    v_customer:=v_invoice.customer_snapshot;
    v_issue_date:=v_invoice.issue_date; v_tax_date:=v_invoice.taxable_supply_date; v_due_date:=v_invoice.due_date;
    v_number:=v_invoice.invoice_number; v_symbol:=v_invoice.variable_symbol; v_note:=v_invoice.note;
    select jsonb_agg(jsonb_build_object('id',x.value->>'id','itemName',x.value->>'item_name',
      'description',x.value->>'description','quantity',x.value->>'quantity','unit',x.value->>'unit',
      'unitPriceWithoutVat',x.value->>'unit_price_without_vat','vatRate',x.value->>'vat_rate') order by x.ordinality)
      into v_payload from jsonb_array_elements(v_items) with ordinality x(value,ordinality);
  else
    if header_input is null or jsonb_typeof(header_input)<>'object' or octet_length(header_input::text)>100000
      or item_inputs is null or jsonb_typeof(item_inputs)<>'array' or octet_length(item_inputs::text)>1000000 then
      raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
    end if;
    for v_key in select jsonb_object_keys(header_input) loop
      if not (v_key=any(array['invoiceNumber','variableSymbol','issueDate','taxableSupplyDate','dueDate','note','supplier','customer'])) then
        raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
      end if;
      if v_key not in ('supplier','customer') and (jsonb_typeof(header_input->v_key) not in ('string','null')
        or char_length(coalesce(header_input->>v_key,''))>10000) then
        raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
      end if;
    end loop;
    v_patch:=private.invoice_edit_text_object(header_input->'supplier',v_supplier_keys);
    if v_patch->>'billingName' is null then v_patch:=v_patch||jsonb_build_object('billingName',v_patch->>'name'); end if;
    v_supplier:=v_invoice.supplier_snapshot||v_patch;
    v_patch:=private.invoice_edit_text_object(header_input->'customer',v_customer_keys);
    if v_patch->>'billingName' is null then v_patch:=v_patch||jsonb_build_object('billingName',v_patch->>'name'); end if;
    v_customer:=v_invoice.customer_snapshot||v_patch||jsonb_build_object('id',v_invoice.customer_id);
    foreach v_key in array array['issueDate','taxableSupplyDate','dueDate'] loop
      if coalesce(header_input->>v_key,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
      end if;
    end loop;
    begin
      v_issue_date:=(header_input->>'issueDate')::date;
      v_tax_date:=(header_input->>'taxableSupplyDate')::date;
      v_due_date:=(header_input->>'dueDate')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
    end;
    v_number:=nullif(btrim(header_input->>'invoiceNumber'),'');
    v_symbol:=coalesce(nullif(btrim(header_input->>'variableSymbol'),''),
      nullif(left(regexp_replace(v_number,'[^0-9]','','g'),10),''));
    v_note:=nullif(btrim(header_input->>'note'),'');
    v_payload:=item_inputs;
  end if;
  if v_issue_date is null or v_tax_date is null or v_due_date is null
    or not isfinite(v_issue_date) or not isfinite(v_tax_date) or not isfinite(v_due_date)
    or v_issue_date not between date '1900-01-01' and date '9999-12-31'
    or v_tax_date not between date '1900-01-01' and date '9999-12-31'
    or v_due_date not between date '1900-01-01' and date '9999-12-31' or v_due_date<v_issue_date
    or char_length(coalesce(v_note,''))>10000 then
    raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
  end if;
  v_payer:=nullif(btrim(v_supplier->>'vatNumber'),'') is not null;
  v_vat_note:=case when v_payer then null else v_tax_note end;
  v_supplier:=v_supplier||jsonb_build_object('id',v_invoice.company_id,'isVatPayer',v_payer,'vatNote',v_vat_note);
  v_customer:=v_customer||jsonb_build_object('id',v_invoice.customer_id);
  -- Remove only an exact generated standalone line, never a substring in user prose.
  select nullif(btrim(string_agg(line,E'\n' order by ord)),'') into v_note
    from regexp_split_to_table(coalesce(v_note,''),E'\r?\n') with ordinality x(line,ord)
    where btrim(line)<>v_tax_note;
  v_note:=nullif(concat_ws(E'\n',v_note,v_vat_note),'');
  if char_length(coalesce(v_note,''))>10000 then
    raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
  end if;
  if jsonb_array_length(v_payload) not between 1 and 200 then
    raise exception 'INVOICE_DRAFT_ITEMS_INVALID' using errcode='23514';
  end if;
  for v_item in select value from jsonb_array_elements(v_payload) loop
    if jsonb_typeof(v_item)<>'object' then raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023'; end if;
    for v_key in select jsonb_object_keys(v_item) loop
      if not (v_key=any(array['id','itemName','description','quantity','unit','unitPriceWithoutVat','vatRate']))
        or jsonb_typeof(v_item->v_key) not in ('string','null')
        or char_length(coalesce(v_item->>v_key,''))>10000 then
        raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
      end if;
    end loop;
    if coalesce(v_item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'INVOICE_DRAFT_ITEMS_INVALID' using errcode='23514';
    end if;
    v_id:=(v_item->>'id')::uuid;
    if v_id=any(v_payload_ids) or not (v_id=any(v_actual_ids)) then
      raise exception 'INVOICE_DRAFT_ITEMS_INVALID' using errcode='23514';
    end if;
    v_payload_ids:=array_append(v_payload_ids,v_id);
    v_name:=nullif(btrim(v_item->>'itemName'),'');
    if v_name is null then raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023'; end if;
    v_description:=nullif(btrim(v_item->>'description'),''); v_unit:=coalesce(nullif(btrim(v_item->>'unit'),''),'ks');
    foreach v_key in array array['quantity','unitPriceWithoutVat','vatRate'] loop
      if jsonb_typeof(v_item->v_key) is distinct from 'string'
        or coalesce(v_item->>v_key,'') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
        raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
      end if;
    end loop;
    v_quantity:=(v_item->>'quantity')::numeric; v_price:=(v_item->>'unitPriceWithoutVat')::numeric;
    v_rate:=(v_item->>'vatRate')::numeric;
    if v_quantity<=0 or v_quantity>9999999999.99 or v_price<0 or v_price>9999999999.99
      or v_rate<0 or v_rate>100 then raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023'; end if;
    if not v_payer then v_rate:=0; end if;
    v_net:=round(v_quantity*v_price,2); v_tax:=round(v_net*v_rate/100,2); v_gross:=v_net+v_tax;
    v_subtotal:=v_subtotal+v_net; v_vat_total:=v_vat_total+v_tax; v_total:=v_total+v_gross;
    if greatest(v_net,v_tax,v_gross,v_subtotal,v_vat_total,v_total)>9999999999.99 then
      raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
    end if;
    v_sort:=v_sort+1;
    v_updated_items:=v_updated_items||jsonb_build_array(jsonb_build_object('id',v_id,'sort_order',v_sort,
      'item_name',v_name,'description',v_description,'quantity',v_quantity,'unit',v_unit,
      'unit_price_without_vat',v_price,'vat_rate',v_rate,'vat_amount',v_tax,'total_without_vat',v_net,'total_with_vat',v_gross));
  end loop;
  select array_agg(id order by id) into v_payload_ids from unnest(v_payload_ids) id;
  if v_payload_ids is distinct from v_actual_ids then
    raise exception 'INVOICE_DRAFT_ITEMS_INVALID' using errcode='23514';
  end if;

  update public.invoices set invoice_number=v_number,variable_symbol=v_symbol,
    invoice_year=extract(year from v_issue_date)::integer,issue_date=v_issue_date,
    taxable_supply_date=v_tax_date,due_date=v_due_date,is_vat_payer=v_payer,vat_note=v_vat_note,
    supplier_snapshot=v_supplier,customer_snapshot=v_customer,note=v_note,
    subtotal_without_vat=v_subtotal,vat_total=v_vat_total,total_with_vat=v_total,updated_at=clock_timestamp()
    where id=v_invoice.id and company_id=v_invoice.company_id and status='draft' and issued_at is null;
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'INVOICE_INVALID_STATE' using errcode='23514'; end if;
  for v_item in select value from jsonb_array_elements(v_updated_items) loop
    update public.invoice_items set sort_order=(v_item->>'sort_order')::integer,item_name=v_item->>'item_name',
      description=v_item->>'description',quantity=(v_item->>'quantity')::numeric,unit=v_item->>'unit',
      unit_price_without_vat=(v_item->>'unit_price_without_vat')::numeric,vat_rate=(v_item->>'vat_rate')::numeric,
      vat_amount=(v_item->>'vat_amount')::numeric,total_without_vat=(v_item->>'total_without_vat')::numeric,
      total_with_vat=(v_item->>'total_with_vat')::numeric
    where id=(v_item->>'id')::uuid and invoice_id=v_invoice.id and company_id=v_invoice.company_id;
    get diagnostics v_rows=row_count;
    if v_rows<>1 then raise exception 'INVOICE_DRAFT_ITEMS_INVALID' using errcode='23514'; end if;
  end loop;
  -- Refresh after all writes; do not hash stale local header/item variables.
  select jsonb_build_object('invoice_id',i.id,'status',i.status,'updated',true,
    'revision',private.invoice_edit_revision(to_jsonb(i),lines.items)) into v_result
  from public.invoices i cross join lateral (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order,x.created_at,x.id),'[]'::jsonb) items
    from public.invoice_items x where x.invoice_id=i.id and x.company_id=i.company_id
  ) lines where i.id=v_invoice.id and i.company_id=v_invoice.company_id;
  if v_result is null then raise exception 'INVOICE_NOT_FOUND' using errcode='P0002'; end if;
  return v_result;
end;
$function$;
revoke all on function private.write_invoice_draft_atomic(uuid,uuid,text,uuid[],jsonb,jsonb,boolean)
  from public,anon,authenticated,service_role;
grant execute on function private.write_invoice_draft_atomic(uuid,uuid,text,uuid[],jsonb,jsonb,boolean) to authenticated;

create function public.update_invoice_draft_atomic(target_company_id uuid,target_invoice_id uuid,
  expected_revision text,expected_item_ids uuid[],header_input jsonb,item_inputs jsonb)
returns jsonb language sql security invoker set search_path='' as $function$
  select private.write_invoice_draft_atomic(target_company_id,target_invoice_id,expected_revision,
    expected_item_ids,header_input,item_inputs,false);
$function$;
revoke all on function public.update_invoice_draft_atomic(uuid,uuid,text,uuid[],jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.update_invoice_draft_atomic(uuid,uuid,text,uuid[],jsonb,jsonb) to authenticated;

create function public.refresh_invoice_supplier_atomic(target_company_id uuid,target_invoice_id uuid,
  expected_revision text,expected_item_ids uuid[])
returns jsonb language sql security invoker set search_path='' as $function$
  select private.write_invoice_draft_atomic(target_company_id,target_invoice_id,expected_revision,
    expected_item_ids,null,null,true);
$function$;
revoke all on function public.refresh_invoice_supplier_atomic(uuid,uuid,text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.refresh_invoice_supplier_atomic(uuid,uuid,text,uuid[]) to authenticated;

create function public.issue_invoice_revision_atomic(target_company_id uuid,target_invoice_id uuid,expected_revision text)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare v_invoice public.invoices%rowtype; v_items jsonb;
begin
  if auth.uid() is null or not public.is_company_admin(target_company_id) then
    raise exception 'INVOICE_ISSUE_FORBIDDEN' using errcode='42501';
  end if;
  if expected_revision is null or expected_revision !~ '^[0-9a-f]{64}$' then
    raise exception 'INVOICE_DRAFT_INPUT_INVALID' using errcode='22023';
  end if;
  -- Preserve the deployed issue RPC's parent-first -> issue-trigger advisory order.
  select * into v_invoice from public.invoices i
    where i.id=target_invoice_id and i.company_id=target_company_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode='P0002'; end if;
  if auth.uid() is null or not public.is_company_admin(target_company_id) then
    raise exception 'INVOICE_ISSUE_FORBIDDEN' using errcode='42501';
  end if;
  -- An already-issued retry makes no new financial mutation, including after expiry.
  if v_invoice.status in ('issued','sent','paid','overdue') then
    return public.issue_invoice_atomic(target_company_id,target_invoice_id);
  end if;
  if v_invoice.status is distinct from 'draft' or v_invoice.issued_at is not null then
    raise exception 'INVOICE_INVALID_STATE' using errcode='23514';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order,x.created_at,x.id),'[]'::jsonb) into v_items
    from public.invoice_items x where x.invoice_id=v_invoice.id and x.company_id=v_invoice.company_id;
  if private.invoice_edit_revision(to_jsonb(v_invoice),v_items)<>expected_revision then
    raise exception 'INVOICE_DRAFT_STALE' using errcode='23514';
  end if;
  return public.issue_invoice_atomic(target_company_id,target_invoice_id);
end;
$function$;
revoke all on function public.issue_invoice_revision_atomic(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.issue_invoice_revision_atomic(uuid,uuid,text) to authenticated;
