-- Atomic CZK draft creation. No company is enrolled and no commercial data is seeded.
-- Reconcile columns used by the existing application without guessing historical VAT.
alter table public.invoices
  add column if not exists payment_method text,
  add column if not exists is_vat_payer boolean,
  add column if not exists vat_note text,
  add column if not exists pohoda_external_id text,
  add column if not exists pohoda_last_export_id uuid;
alter table public.invoices alter column payment_method set default 'bank_transfer';
alter table public.pohoda_export_invoices add column if not exists error_message text;

-- The canonical migration omitted this column; the current test database already has it.
-- Deriving tenancy from the parent is factual metadata, not a financial snapshot rewrite.
alter table public.invoice_items add column if not exists company_id uuid references public.companies(id);
update public.invoice_items item set company_id = invoice.company_id
from public.invoices invoice where invoice.id = item.invoice_id and item.company_id is null;
alter table public.invoice_items alter column company_id set not null;
create index if not exists invoice_items_company_invoice_idx on public.invoice_items(company_id,invoice_id);

create table private.invoice_draft_requests (
  company_id uuid not null references public.companies(id) on delete restrict,
  request_id uuid not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  -- Deliberately no invoice FK: deleting a draft leaves a tombstone, never a reusable request.
  invoice_id uuid not null unique,
  actor_auth_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (company_id,request_id)
);
alter table private.invoice_draft_requests enable row level security;
revoke all on private.invoice_draft_requests from public, anon, authenticated, service_role;

create function private.guard_invoice_draft_request_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  raise exception 'INVOICE_REQUEST_IMMUTABLE' using errcode = '42501';
end;
$function$;
revoke all on function private.guard_invoice_draft_request_immutable() from public, anon, authenticated, service_role;
create trigger guard_invoice_draft_request_immutable before update or delete on private.invoice_draft_requests
for each row execute function private.guard_invoice_draft_request_immutable();

-- Only this small helper needs private-table authority. It can allocate a random invoice
-- ID, never accept or stamp a caller-selected existing invoice. Its row and the invoice
-- created by the invoker RPC commit together. A direct private SQL reservation without
-- creation merely consumes that administrator's request and fails closed on later retry.
create function private.reserve_invoice_draft_request(target_company_id uuid, target_request_id uuid, target_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_request private.invoice_draft_requests%rowtype; v_hash text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.company_members cm join public.profiles p on p.id = cm.profile_id
    where cm.company_id = target_company_id and cm.is_active
      and cm.role in ('super_admin','company_admin','manager') and p.auth_user_id = auth.uid()
  ) then raise exception 'INVOICE_CREATE_FORBIDDEN' using errcode = '42501'; end if;
  if target_request_id is null or target_input is null or jsonb_typeof(target_input) <> 'object'
    or octet_length(target_input::text) > 100000 then
    raise exception 'INVOICE_CREATE_INVALID' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice-issue:' || target_company_id::text,0));
  v_hash := encode(pg_catalog.sha256(convert_to(target_input::text,'UTF8')),'hex');
  select * into v_request from private.invoice_draft_requests r
    where r.company_id = target_company_id and r.request_id = target_request_id;
  if found then
    if v_request.input_hash <> v_hash then
      raise exception 'INVOICE_REQUEST_CONFLICT' using errcode = '23514';
    end if;
    return jsonb_build_object('invoice_id',v_request.invoice_id,'created',false);
  end if;
  perform private.invoice_issue_entitlement(target_company_id,clock_timestamp());
  insert into private.invoice_draft_requests(company_id,request_id,input_hash,invoice_id,actor_auth_user_id)
    values(target_company_id,target_request_id,v_hash,gen_random_uuid(),auth.uid()) returning * into v_request;
  return jsonb_build_object('invoice_id',v_request.invoice_id,'created',true);
end;
$function$;
revoke all on function private.reserve_invoice_draft_request(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.reserve_invoice_draft_request(uuid,uuid,jsonb) to authenticated;

-- Financial child access always derives from an authorized parent. The restrictive
-- policy also bounds older permissive policies in checkouts with the canonical schema.
alter table public.invoice_items enable row level security;
create policy invoice_items_parent_read on public.invoice_items for select to authenticated
using (public.is_company_member(company_id) and exists (
  select 1 from public.invoices i where i.id = invoice_items.invoice_id and i.company_id = invoice_items.company_id
));
create policy invoice_items_parent_access on public.invoice_items for all to authenticated
using (public.is_company_admin(company_id) and exists (
  select 1 from public.invoices i where i.id = invoice_items.invoice_id and i.company_id = invoice_items.company_id
)) with check (public.is_company_admin(company_id) and exists (
  select 1 from public.invoices i where i.id = invoice_items.invoice_id and i.company_id = invoice_items.company_id
));
create policy invoice_items_parent_boundary on public.invoice_items as restrictive for all to authenticated
using (public.is_company_member(company_id) and exists (
  select 1 from public.invoices i where i.id = invoice_items.invoice_id and i.company_id = invoice_items.company_id
)) with check (public.is_company_member(company_id) and exists (
  select 1 from public.invoices i where i.id = invoice_items.invoice_id and i.company_id = invoice_items.company_id
));
create policy invoice_items_insert_admin_boundary on public.invoice_items as restrictive for insert to authenticated
with check (public.is_company_admin(company_id));
create policy invoice_items_update_admin_boundary on public.invoice_items as restrictive for update to authenticated
using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy invoice_items_delete_admin_boundary on public.invoice_items as restrictive for delete to authenticated
using (public.is_company_admin(company_id));
grant select,insert,update,delete on public.invoice_items to authenticated;

create function private.guard_invoice_item_scope()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_invoice public.invoices%rowtype; v_invoice_id uuid; v_detach boolean := false;
begin
  v_invoice_id := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.invoice_id is distinct from old.invoice_id
      or new.company_id is distinct from old.company_id or new.created_at is distinct from old.created_at then
      raise exception 'INVOICE_ITEM_SCOPE_INVALID' using errcode = '23514';
    end if;
    -- Deleting a source job may detach the FK but must preserve every snapshot and amount.
    v_detach := old.source_job_id is not null and new.source_job_id is null
      and (to_jsonb(new) - 'source_job_id' - 'updated_at') = (to_jsonb(old) - 'source_job_id' - 'updated_at');
    if (new.source_job_id is distinct from old.source_job_id and not v_detach)
      or new.source_snapshot is distinct from old.source_snapshot then
      raise exception 'INVOICE_ITEM_SCOPE_INVALID' using errcode = '23514';
    end if;
  end if;
  select * into v_invoice from public.invoices i where i.id = v_invoice_id
    and auth.uid() is not null and public.is_company_admin(i.company_id) for update;
  if not found then
    if tg_op = 'DELETE' then return old; end if; -- parent FK cascade
    raise exception 'INVOICE_ITEM_SCOPE_INVALID' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.company_id is null then new.company_id := v_invoice.company_id; end if;
  if (case when tg_op = 'DELETE' then old.company_id else new.company_id end) is distinct from v_invoice.company_id then
    raise exception 'INVOICE_ITEM_SCOPE_INVALID' using errcode = '23514';
  end if;
  if v_detach then return new; end if;
  if v_invoice.status <> 'draft' or v_invoice.issued_at is not null then
    raise exception 'INVOICE_ITEM_IMMUTABLE' using errcode = '23514';
  end if;
  -- Deleting a draft remains possible after expiry; creating/editing its financial items does not.
  if tg_op = 'DELETE' then return old; end if;
  perform private.invoice_issue_entitlement(v_invoice.company_id,clock_timestamp());
  if new.source_job_id is not null and not exists (
    select 1 from public.jobs j where j.id = new.source_job_id
      and j.company_id = v_invoice.company_id and j.customer_id = v_invoice.customer_id
  ) then raise exception 'INVOICE_ITEM_SCOPE_INVALID' using errcode = '23514'; end if;
  return new;
end;
$function$;
revoke all on function private.guard_invoice_item_scope() from public, anon, authenticated, service_role;
create trigger guard_invoice_item_scope before insert or update or delete on public.invoice_items
for each row execute function private.guard_invoice_item_scope();

alter table public.pohoda_export_invoices enable row level security;
create policy pohoda_export_invoices_parent_access on public.pohoda_export_invoices for all to authenticated
using (public.is_company_admin(company_id) and exists (
  select 1 from public.invoices i join public.pohoda_exports e on e.company_id = i.company_id
  where i.id = pohoda_export_invoices.invoice_id and e.id = pohoda_export_invoices.export_id
    and i.company_id = pohoda_export_invoices.company_id
)) with check (public.is_company_admin(company_id) and exists (
  select 1 from public.invoices i join public.pohoda_exports e on e.company_id = i.company_id
  where i.id = pohoda_export_invoices.invoice_id and e.id = pohoda_export_invoices.export_id
    and i.company_id = pohoda_export_invoices.company_id
));
create policy pohoda_export_invoices_parent_boundary on public.pohoda_export_invoices as restrictive for all to authenticated
using (public.is_company_admin(company_id) and exists (
  select 1 from public.invoices i join public.pohoda_exports e on e.company_id = i.company_id
  where i.id = pohoda_export_invoices.invoice_id and e.id = pohoda_export_invoices.export_id
    and i.company_id = pohoda_export_invoices.company_id
)) with check (public.is_company_admin(company_id) and exists (
  select 1 from public.invoices i join public.pohoda_exports e on e.company_id = i.company_id
  where i.id = pohoda_export_invoices.invoice_id and e.id = pohoda_export_invoices.export_id
    and i.company_id = pohoda_export_invoices.company_id
));
grant select,insert,update,delete on public.pohoda_export_invoices to authenticated;

create function private.guard_invoice_export_scope()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op = 'UPDATE' and (new.invoice_id is distinct from old.invoice_id
    or new.export_id is distinct from old.export_id or new.company_id is distinct from old.company_id) then
    raise exception 'INVOICE_EXPORT_SCOPE_INVALID' using errcode = '23514';
  end if;
  if auth.uid() is null or not public.is_company_admin(new.company_id) or not exists (
    select 1 from public.invoices i join public.pohoda_exports e on e.company_id = i.company_id
    where i.id = new.invoice_id and e.id = new.export_id and i.company_id = new.company_id) then
    raise exception 'INVOICE_EXPORT_SCOPE_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_invoice_export_scope() from public, anon, authenticated, service_role;
create trigger guard_invoice_export_scope before insert or update on public.pohoda_export_invoices
for each row execute function private.guard_invoice_export_scope();

create function public.create_invoice_from_jobs_atomic(
  target_company_id uuid, target_customer_id uuid, target_job_ids uuid[],
  target_issue_date date, target_taxable_supply_date date, target_due_date date,
  target_vat_rate numeric, target_note text, target_request_id uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_profile_id uuid; v_jobs uuid[]; v_count integer; v_note text; v_request jsonb;
  v_invoice_id uuid; v_invoice public.invoices%rowtype; v_company public.companies%rowtype;
  v_customer public.customers%rowtype; v_job public.jobs%rowtype;
  v_is_vat_payer boolean; v_vat_rate numeric(5,2); v_vat_note text;
  v_supplier_snapshot jsonb; v_customer_snapshot jsonb; v_items jsonb := '[]'; v_item jsonb;
  v_sort integer := 0; v_unit_price numeric(12,2); v_vat numeric(12,2); v_total numeric(12,2);
  v_subtotal numeric(12,2) := 0; v_vat_total numeric(12,2) := 0; v_grand_total numeric(12,2) := 0;
begin
  if auth.uid() is null or not public.is_company_admin(target_company_id) then
    raise exception 'INVOICE_CREATE_FORBIDDEN' using errcode = '42501';
  end if;
  select p.id into v_profile_id from public.profiles p join public.company_members cm on cm.profile_id = p.id
    where p.auth_user_id = auth.uid() and cm.company_id = target_company_id and cm.is_active
      and cm.role in ('super_admin','company_admin','manager') order by p.id limit 1;
  if v_profile_id is null then raise exception 'INVOICE_CREATE_FORBIDDEN' using errcode = '42501'; end if;
  if target_customer_id is null or target_request_id is null or target_job_ids is null
    or cardinality(target_job_ids) not between 1 and 200 or array_ndims(target_job_ids) <> 1
    or array_position(target_job_ids,null) is not null
    or target_issue_date is null or not isfinite(target_issue_date)
    or target_taxable_supply_date is null or not isfinite(target_taxable_supply_date)
    or target_due_date is null or not isfinite(target_due_date)
    or target_issue_date not between date '1900-01-01' and date '9999-12-31'
    or target_taxable_supply_date not between date '1900-01-01' and date '9999-12-31'
    or target_due_date not between date '1900-01-01' and date '9999-12-31'
    or target_due_date < target_issue_date
    or target_vat_rate is null or target_vat_rate::text in ('NaN','Infinity','-Infinity')
    or target_vat_rate not between 0 and 100 or target_vat_rate <> round(target_vat_rate,2)
    or char_length(coalesce(target_note,'')) > 10000 then
    raise exception 'INVOICE_CREATE_INVALID' using errcode = '22023';
  end if;
  select array_agg(j order by j), count(distinct j) into v_jobs,v_count from unnest(target_job_ids) j;
  if v_count <> cardinality(target_job_ids) then raise exception 'INVOICE_CREATE_INVALID' using errcode = '22023'; end if;
  v_note := nullif(btrim(target_note),'');
  v_request := private.reserve_invoice_draft_request(target_company_id,target_request_id,
    jsonb_build_object('version',1,'company_id',target_company_id,'customer_id',target_customer_id,
      'job_ids',to_jsonb(v_jobs),'issue_date',target_issue_date,'taxable_supply_date',target_taxable_supply_date,
      'due_date',target_due_date,'vat_rate',trim_scale(target_vat_rate),'note',v_note));
  v_invoice_id := (v_request->>'invoice_id')::uuid;
  if not (v_request->>'created')::boolean then
    select * into v_invoice from public.invoices i where i.id = v_invoice_id and i.company_id = target_company_id;
    if not found then raise exception 'INVOICE_DRAFT_REQUEST_GONE' using errcode = 'P0002'; end if;
    return jsonb_build_object('invoice_id',v_invoice.id,'status',v_invoice.status,'created',false);
  end if;

  select * into v_company from public.companies c where c.id = target_company_id;
  if not found then raise exception 'INVOICE_CREATE_FORBIDDEN' using errcode = '42501'; end if;
  select * into v_customer from public.customers c where c.id = target_customer_id and c.company_id = target_company_id;
  if not found then raise exception 'INVOICE_JOBS_INVALID' using errcode = '23514'; end if;
  -- Serialize drafts sharing jobs, then inspect the complete, current set under tenant RLS.
  perform 1 from public.jobs j where j.id = any(v_jobs) and j.company_id = target_company_id
    and j.customer_id = target_customer_id order by j.id for update;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_jobs) then raise exception 'INVOICE_JOBS_INVALID' using errcode = '23514'; end if;
  if exists (select 1 from public.jobs j where j.id = any(v_jobs) and j.company_id = target_company_id
    and (coalesce(j.work_state,'') <> 'done' and coalesce(j.status,'') <> 'done'
      or j.price is null or j.price::text in ('NaN','Infinity','-Infinity') or j.price <= 0 or j.currency is distinct from 'CZK')) then
    raise exception 'INVOICE_JOBS_INVALID' using errcode = '23514';
  end if;
  if exists (select 1 from public.invoice_jobs ij where ij.job_id = any(v_jobs) and ij.is_active) then
    raise exception 'INVOICE_LINK_CONFLICT' using errcode = '23514';
  end if;

  v_is_vat_payer := nullif(btrim(v_company.vat_number),'') is not null;
  v_vat_rate := case when v_is_vat_payer then target_vat_rate else 0 end;
  v_vat_note := case when v_is_vat_payer then null else 'Dodavatel není plátcem DPH.' end;
  v_supplier_snapshot := jsonb_build_object('id',v_company.id,'name',v_company.name,
    'billingName',coalesce(v_company.billing_name,v_company.name),'companyNumber',v_company.company_number,
    'vatNumber',v_company.vat_number,'billingStreet',v_company.billing_street,'billingCity',v_company.billing_city,
    'billingPostalCode',v_company.billing_postal_code,'billingCountry',v_company.billing_country,
    'bankAccountNumber',v_company.bank_account_number,'bankCode',v_company.bank_code,'iban',v_company.iban,
    'swiftBic',v_company.swift_bic,'logoUrl',v_company.logo_url,'isVatPayer',v_is_vat_payer,'vatNote',v_vat_note);
  v_customer_snapshot := jsonb_build_object('id',v_customer.id,'name',v_customer.name,'email',v_customer.email,
    'phone',v_customer.phone,'billingName',coalesce(v_customer.billing_name,v_customer.name),
    'billingStreet',v_customer.billing_street,'billingCity',v_customer.billing_city,
    'billingPostalCode',v_customer.billing_postal_code,'billingCountry',v_customer.billing_country,
    'companyNumber',v_customer.company_number,'vatNumber',v_customer.vat_number);
  for v_job in select j.* from public.jobs j where j.id = any(v_jobs) and j.company_id = target_company_id
    order by coalesce(j.end_at,j.start_at) nulls first,j.id
  loop
    v_sort := v_sort + 1;
    v_unit_price := round(v_job.price,2);
    v_vat := round(v_unit_price * v_vat_rate / 100,2);
    v_total := v_unit_price + v_vat;
    v_subtotal := v_subtotal + v_unit_price; v_vat_total := v_vat_total + v_vat; v_grand_total := v_grand_total + v_total;
    v_items := v_items || jsonb_build_array(jsonb_build_object('job_id',v_job.id,'sort_order',v_sort,
      'item_name',coalesce(nullif(btrim(v_job.title),''),'Zakázka ' || v_sort::text),'description',v_job.description,
      'unit_price',v_unit_price,'vat',v_vat,'total',v_total,
      'snapshot',jsonb_build_object('jobId',v_job.id,'title',v_job.title,'description',v_job.description,
        'price',v_job.price,'startAt',v_job.start_at,'endAt',v_job.end_at)));
  end loop;
  insert into public.invoices(id,company_id,customer_id,invoice_year,status,currency,issue_date,taxable_supply_date,
    due_date,payment_method,is_vat_payer,vat_note,subtotal_without_vat,vat_total,total_with_vat,
    supplier_snapshot,customer_snapshot,note,created_by)
  values(v_invoice_id,target_company_id,target_customer_id,extract(year from target_issue_date)::integer,'draft','CZK',
    target_issue_date,target_taxable_supply_date,target_due_date,'bank_transfer',v_is_vat_payer,v_vat_note,
    v_subtotal,v_vat_total,v_grand_total,v_supplier_snapshot,v_customer_snapshot,
    nullif(concat_ws(E'\n',v_note,v_vat_note),''),v_profile_id);
  for v_item in select value from jsonb_array_elements(v_items)
  loop
    insert into public.invoice_items(invoice_id,company_id,sort_order,source_job_id,item_name,description,
      quantity,unit,unit_price_without_vat,vat_rate,vat_amount,total_without_vat,total_with_vat,source_snapshot)
    values(v_invoice_id,target_company_id,(v_item->>'sort_order')::integer,(v_item->>'job_id')::uuid,
      v_item->>'item_name',v_item->>'description',1,'ks',(v_item->>'unit_price')::numeric,v_vat_rate,
      (v_item->>'vat')::numeric,(v_item->>'unit_price')::numeric,(v_item->>'total')::numeric,v_item->'snapshot');
    insert into public.invoice_jobs(invoice_id,job_id,company_id,customer_id)
      values(v_invoice_id,(v_item->>'job_id')::uuid,target_company_id,target_customer_id);
  end loop;
  return jsonb_build_object('invoice_id',v_invoice_id,'status','draft','created',true);
end;
$function$;
revoke all on function public.create_invoice_from_jobs_atomic(uuid,uuid,uuid[],date,date,date,numeric,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_invoice_from_jobs_atomic(uuid,uuid,uuid[],date,date,date,numeric,text,uuid) to authenticated;
