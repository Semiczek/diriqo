-- Core quote lifecycle. Historical content is never claimed as an old issued version.
-- Public mutation entry points are invokers; only narrowly scoped private routines write.
alter table public.quotes
  add column revision bigint not null default 1 check(revision>0),
  add column draft_open boolean not null default true,
  add column pricing_mode text check(pricing_mode is null or pricing_mode='net'),
  add column discount_amount numeric(12,2),
  add column customer_note text,
  add column internal_note text,
  add column source_calculation_revision bigint,
  add column current_version_id uuid,
  add column accepted_version_id uuid,
  add column archived_at timestamptz;
alter table public.quote_items alter column vat_rate drop not null, alter column vat_rate drop default;
create index if not exists quote_items_parent_order_idx on public.quote_items(quote_id,sort_order,id);
create index if not exists quotes_calculation_company_idx on public.quotes(company_id,source_calculation_id);

create table private.core_quote_write_permits (company_id uuid not null,quote_id uuid not null,transaction_id xid8 not null,primary key(company_id,quote_id,transaction_id));
create table private.core_quote_versions (
  id uuid primary key, company_id uuid not null references public.companies(id) on delete restrict,
  quote_id uuid not null, version_number integer not null check(version_number>0), source_revision bigint not null,
  customer_id uuid, document jsonb not null check(jsonb_typeof(document)='object'),
  content_hash text not null, published_at timestamptz not null, published_by uuid not null,
  unique(company_id,quote_id,version_number), unique(company_id,quote_id,id)
);
create table private.core_quote_tokens (
  token text primary key check(length(token) between 1 and 2048), company_id uuid not null,
  quote_id uuid not null, version_id uuid, legacy boolean not null default false,
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz, revoked_at timestamptz,
  check((version_id is null)=legacy), foreign key(company_id,quote_id,version_id) references private.core_quote_versions(company_id,quote_id,id)
);
create index core_quote_tokens_version_idx on private.core_quote_tokens(company_id,quote_id,version_id);
create table private.core_quote_legacy_documents (
  company_id uuid not null,quote_id uuid not null,customer_id uuid,document jsonb not null,
  captured_at timestamptz not null default clock_timestamp(),original_status text not null,
  primary key(company_id,quote_id)
);
create table private.core_quote_source_claims (
  company_id uuid not null,calculation_id uuid not null,quote_id uuid not null,
  primary key(company_id,calculation_id),unique(company_id,quote_id)
);
create table private.core_quote_operations (
  company_id uuid not null,operation_id uuid not null,actor_id uuid not null,kind text not null,
  quote_id uuid not null,payload jsonb not null,result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),primary key(company_id,operation_id)
);
create table private.core_quote_decisions (
  id uuid primary key default gen_random_uuid(),company_id uuid not null,quote_id uuid not null,version_id uuid not null,
  decision text not null check(decision in('accepted','rejected')),evidence text not null check(length(evidence) between 1 and 10000),
  actor_id uuid not null,actor_kind text not null check(actor_kind in('employee','portal')),
  decided_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),
  unique(company_id,quote_id,version_id),foreign key(company_id,quote_id,version_id) references private.core_quote_versions(company_id,quote_id,id)
);
create table private.core_quote_responses (
  company_id uuid not null,quote_id uuid not null,version_id uuid not null,operation_id uuid not null,
  actor_scope text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
  primary key(actor_scope,operation_id),foreign key(company_id,quote_id,version_id) references private.core_quote_versions(company_id,quote_id,id)
);
create table private.core_quote_deliveries (
  id uuid primary key, company_id uuid not null,quote_id uuid not null,version_id uuid not null,
  operation_id uuid not null,actor_id uuid not null,payload jsonb not null,payload_hash text not null,
  attempt_hash text not null,state text not null check(state in('reserved','sent','uncertain')),
  provider_message_id text,created_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
  unique(company_id,operation_id),foreign key(company_id,quote_id,version_id) references private.core_quote_versions(company_id,quote_id,id)
);
alter table private.core_quote_conversions add column version_id uuid;

-- Reads and access-reducing actions need current identity, not a paid new-write licence.
create function private.core_quote_access(p_company_id uuid,p_write boolean default true)
returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare v_actor uuid;
begin
  v_actor:=private.quote_customer_actor(p_company_id);
  perform 1 from public.profiles where id=v_actor for share;
  perform 1 from public.company_members where company_id=p_company_id and profile_id=v_actor for share;
  v_actor:=private.quote_customer_actor(p_company_id);
  if p_write then v_actor:=private.assert_quote_customer_publication(p_company_id); end if;
  return v_actor;
exception when insufficient_privilege then
  if sqlerrm='QUOTE_CUSTOMER_MODULE_REQUIRED' then raise exception 'CORE_QUOTE_MODULE_REQUIRED' using errcode='42501'; end if;
  raise exception 'CORE_QUOTE_FORBIDDEN' using errcode='42501';
end;
$f$;
create function private.core_quote_hash(p_value jsonb) returns text language sql immutable set search_path='' as $f$
 select encode(sha256(convert_to(p_value::text,'UTF8')),'hex');
$f$;
create function private.core_quote_input(p_input jsonb,p_allow_unknown_vat boolean default false)
returns jsonb language plpgsql immutable set search_path='' as $f$
declare v jsonb; c jsonb:='{}'; items jsonb:='[]'; r jsonb; k text; amount numeric; subtotal numeric:=0; discount numeric; d date; until_date date;
 keys constant text[]:=array['contact_name','contact_email','intro_text','customer_request_title','customer_request','our_solution_title','proposed_solution','benefits_text','timeline_title','work_description','work_schedule','pricing_title','pricing_text','payment_terms_title','payment_terms'];
begin
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>1048576
   or exists(select 1 from jsonb_object_keys(p_input) x where x<>all(array['title','quote_date','valid_until','currency','pricing_mode','discount_amount','customer_note','internal_note','content','items']))
   or not(p_input ?& array['title','quote_date','valid_until','currency','pricing_mode','discount_amount','customer_note','internal_note','content','items'])
   or jsonb_typeof(p_input->'currency') is distinct from 'string' or p_input->>'currency' !~ '^[A-Z]{3}$'
   or p_input->>'pricing_mode' is distinct from 'net'
   or jsonb_typeof(p_input->'quote_date') is distinct from 'string' or p_input->>'quote_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or jsonb_typeof(p_input->'valid_until') not in('string','null') then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 d:=(p_input->>'quote_date')::date;
 if d<'0001-01-01'::date or d>'9999-12-31'::date then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 if p_input->>'valid_until' is not null then
   if p_input->>'valid_until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
   until_date:=(p_input->>'valid_until')::date;
   if until_date<d or until_date>'9999-12-31'::date then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 end if;
 if jsonb_typeof(p_input->'content') is distinct from 'object' or not(p_input->'content' ?& keys)
   or exists(select 1 from jsonb_object_keys(p_input->'content') x where x<>all(keys))
   or jsonb_typeof(p_input->'items') is distinct from 'array' then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 if jsonb_array_length(p_input->'items') not between 1 and 500 then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 foreach k in array keys loop
   c:=c||jsonb_build_object(k,private.core_calculation_text(coalesce(p_input->'content'->k,'null'),case when k='contact_name' then 200 when k='contact_email' then 320 when k like '%_title' then 300 else 10000 end));
 end loop;
 for r in select value from jsonb_array_elements(p_input->'items') loop
   if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) x where x<>all(array['name','description','quantity','unit','unit_price','vat_rate','note']))
      or not(r ?& array['name','description','quantity','unit','unit_price','vat_rate','note']) then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
   v:=jsonb_build_object('name',private.core_calculation_text(r->'name',300,true),'description',private.core_calculation_text(r->'description',4000),
     'quantity',private.core_calculation_decimal(r->'quantity',true)::text,'unit',private.core_calculation_text(r->'unit',30),
     'unit_price',private.core_calculation_decimal(r->'unit_price')::text,'vat_rate',case when p_allow_unknown_vat and r->'vat_rate'='null'::jsonb then null else private.core_calculation_decimal(r->'vat_rate',false,100)::text end,
     'note',private.core_calculation_text(r->'note',4000));
   amount:=round((v->>'quantity')::numeric*(v->>'unit_price')::numeric,2); subtotal:=subtotal+amount;
   if amount>9999999999.99 or subtotal>9999999999.99 then raise exception 'CORE_QUOTE_NUMERIC_OVERFLOW' using errcode='22003'; end if;
   items:=items||jsonb_build_array(v);
 end loop;
 discount:=private.core_calculation_decimal(p_input->'discount_amount');
 if discount>subtotal then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 return jsonb_build_object('title',private.core_calculation_text(p_input->'title',300,true),'quote_date',d,'valid_until',until_date,
  'currency',p_input->>'currency','pricing_mode','net','discount_amount',discount::numeric(12,2)::text,
  'customer_note',private.core_calculation_text(p_input->'customer_note',10000),'internal_note',private.core_calculation_text(p_input->'internal_note',10000),'content',c,'items',items);
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023';
 when sqlstate '22023' then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023';
 when numeric_value_out_of_range then raise exception 'CORE_QUOTE_NUMERIC_OVERFLOW' using errcode='22003';
end;
$f$;

create function private.core_quote_draft(p_company_id uuid,p_quote_id uuid)
returns jsonb language sql stable security definer set search_path='' as $f$
 select jsonb_build_object('title',q.title,'quote_date',q.quote_date,'valid_until',q.valid_until,'currency',q.currency,
  'pricing_mode',q.pricing_mode,'discount_amount',q.discount_amount::text,'customer_note',q.customer_note,'internal_note',q.internal_note,
  'content',jsonb_build_object('contact_name',q.contact_name,'contact_email',q.contact_email,'intro_text',q.intro_text,
  'customer_request_title',q.customer_request_title,'customer_request',q.customer_request,'our_solution_title',q.our_solution_title,
  'proposed_solution',q.proposed_solution,'benefits_text',q.benefits_text,'timeline_title',q.timeline_title,'work_description',q.work_description,
  'work_schedule',q.work_schedule,'pricing_title',q.pricing_title,'pricing_text',q.pricing_text,'payment_terms_title',q.payment_terms_title,'payment_terms',q.payment_terms),
  'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.name,'description',i.description,'quantity',i.quantity::text,'unit',i.unit,
    'unit_price',i.unit_price::text,'vat_rate',i.vat_rate::text,'note',i.note) order by i.sort_order,i.id)
    from public.quote_items i where i.quote_id=q.id and i.company_id=q.company_id),'[]'))
 from public.quotes q where q.company_id=p_company_id and q.id=p_quote_id;
$f$;
create function private.core_quote_document(p_company_id uuid,p_quote_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare q public.quotes%rowtype; company jsonb; customer jsonb; doc jsonb; draft jsonb;
begin
 select * into q from public.quotes where id=p_quote_id and company_id=p_company_id;
 if not found then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 select to_jsonb(c) into company from public.companies c where id=q.company_id;
 customer:=q.customer_snapshot;
 if q.customer_identity_state='draft' then
  select jsonb_build_object('name',c.name,'billingName',c.billing_name,'companyNumber',c.company_number,'vatNumber',c.vat_number,
   'billingStreet',c.billing_street,'billingCity',c.billing_city,'billingPostalCode',c.billing_postal_code,'billingCountry',c.billing_country,'email',c.email,'phone',c.phone)
   into customer from public.customers c where c.id=q.customer_id and c.company_id=q.company_id;
 end if;
 draft:=private.core_quote_draft(p_company_id,p_quote_id);
 doc:=jsonb_build_object('id',q.id,'quote_id',q.id,'version_id',null,'version_number',null,'title',q.title,'quote_number',q.quote_number,
  'quote_date',q.quote_date,'valid_until',q.valid_until,'currency',q.currency,'pricing_mode',q.pricing_mode,
  'subtotal_price',q.subtotal_price::text,'discount_amount',q.discount_amount::text,'total_price',q.total_price::text,'customer_note',q.customer_note,
  'customer_identity_state',q.customer_identity_state,'customer',jsonb_build_object('name',customer->'name','billing_name',customer->'billingName',
  'company_number',customer->'companyNumber','vat_number',customer->'vatNumber','billing_street',customer->'billingStreet','billing_city',customer->'billingCity',
  'billing_postal_code',customer->'billingPostalCode','billing_country',customer->'billingCountry','email',customer->'email','phone',customer->'phone'),
  'supplier',jsonb_build_object('name',company->'name','company_number',company->'company_number','vat_number',company->'vat_number','address',company->'address',
  'street',company->'street','city',company->'city','postal_code',company->'postal_code','country',company->'country','email',company->'email','phone',company->'phone',
  'logo_url',company->'logo_url','bank_account',company->'bank_account','iban',company->'iban','bic',company->'bic'),'content',draft->'content',
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'sort_order',i.sort_order,'name',i.name,'description',i.description,
   'quantity',i.quantity::text,'unit',i.unit,'unit_price',i.unit_price::text,'total_price',i.total_price::text,'vat_rate',i.vat_rate::text,'note',i.note) order by i.sort_order,i.id)
   from public.quote_items i where i.quote_id=q.id and i.company_id=q.company_id),'[]'),'locale','cs','schema_version',1);
 return doc||jsonb_build_object('content_hash',private.core_quote_hash(doc));
end;
$f$;

-- These are current legacy baselines, NOT backfilled publication or acceptance history.
insert into private.core_quote_legacy_documents(company_id,quote_id,customer_id,document,original_status)
 select company_id,id,customer_id,private.core_quote_document(company_id,id),status from public.quotes
 where share_token is not null or share_enabled or status not in('draft','ready') or sent_at is not null or accepted_at is not null or rejected_at is not null;
insert into private.core_quote_tokens(token,company_id,quote_id,legacy,expires_at,revoked_at)
 select share_token,company_id,id,true,share_token_expires_at,
  case when not share_enabled or share_token_scope is distinct from 'quote_public_offer' then coalesce(share_token_revoked_at,clock_timestamp()) else share_token_revoked_at end
 from public.quotes where share_token is not null;
update public.quotes q set draft_open=false where exists(select 1 from private.core_quote_legacy_documents d where d.company_id=q.company_id and d.quote_id=q.id);
-- Source claims are created lazily after checking all old rows, preserving ambiguous history.

create function private.core_quote_write_draft(p_company_id uuid,p_quote_id uuid,p_input jsonb)
returns void language plpgsql security definer set search_path='' as $f$
declare r jsonb; n integer:=0; total numeric:=0;
begin
 update public.quotes set title=p_input->>'title',quote_date=(p_input->>'quote_date')::date,valid_until=(p_input->>'valid_until')::date,
  currency=p_input->>'currency',pricing_mode=p_input->>'pricing_mode',discount_amount=(p_input->>'discount_amount')::numeric,
  customer_note=p_input->>'customer_note',internal_note=p_input->>'internal_note',
  contact_name=p_input->'content'->>'contact_name',contact_email=p_input->'content'->>'contact_email',intro_text=p_input->'content'->>'intro_text',
  customer_request_title=p_input->'content'->>'customer_request_title',customer_request=p_input->'content'->>'customer_request',
  our_solution_title=p_input->'content'->>'our_solution_title',proposed_solution=p_input->'content'->>'proposed_solution',benefits_text=p_input->'content'->>'benefits_text',
  timeline_title=p_input->'content'->>'timeline_title',work_description=p_input->'content'->>'work_description',work_schedule=p_input->'content'->>'work_schedule',
  pricing_title=p_input->'content'->>'pricing_title',pricing_text=p_input->'content'->>'pricing_text',payment_terms_title=p_input->'content'->>'payment_terms_title',payment_terms=p_input->'content'->>'payment_terms'
 where id=p_quote_id and company_id=p_company_id;
 delete from public.quote_items where quote_id=p_quote_id and company_id=p_company_id;
 for r in select value from jsonb_array_elements(p_input->'items') loop
  insert into public.quote_items(company_id,quote_id,sort_order,name,description,quantity,unit,unit_price,total_price,vat_rate,note)
   values(p_company_id,p_quote_id,n,r->>'name',r->>'description',(r->>'quantity')::numeric,r->>'unit',(r->>'unit_price')::numeric,
    round((r->>'quantity')::numeric*(r->>'unit_price')::numeric,2),(r->>'vat_rate')::numeric,r->>'note');
  total:=total+round((r->>'quantity')::numeric*(r->>'unit_price')::numeric,2); n:=n+1;
 end loop;
 update public.quotes set subtotal_price=total,total_price=total-(p_input->>'discount_amount')::numeric,total_amount=total-(p_input->>'discount_amount')::numeric,
  updated_at=clock_timestamp() where id=p_quote_id and company_id=p_company_id;
end;
$f$;

create function private.core_quote_command(p_kind text,p_company_id uuid,p_quote_id uuid,p_expected_revision bigint,p_operation_id uuid,p_input jsonb default null,p_calculation_id uuid default null,p_calculation_revision bigint default null,p_version_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare actor uuid; q public.quotes%rowtype; calc public.calculations%rowtype; op private.core_quote_operations%rowtype;
 v private.core_quote_versions%rowtype; payload jsonb; data jsonb; result jsonb; document jsonb; token text; version_no integer;
 now_at timestamptz; decision_id uuid; decision_at timestamptz; request_quote uuid:=p_quote_id; n integer;
begin
 if p_company_id is null or p_operation_id is null or p_kind not in('create','sync','update','open','publish','decision','archive','delete','revoke') then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 perform private.quote_customer_actor(p_company_id);
 perform 1 from public.companies where id=p_company_id for update;
 actor:=private.core_quote_access(p_company_id,p_kind not in('archive','delete','revoke'));
 if p_kind='update' then data:=private.core_quote_input(p_input); else data:=p_input; end if;
 payload:=jsonb_build_object('quote_id',p_quote_id,'expected_revision',p_expected_revision,'input',data,'calculation_id',p_calculation_id,'calculation_revision',p_calculation_revision,'version_id',p_version_id);
 select * into op from private.core_quote_operations where company_id=p_company_id and operation_id=p_operation_id;
 if found then
  if op.actor_id<>actor or op.kind<>p_kind or op.payload<>payload then raise exception 'CORE_QUOTE_OPERATION_CONFLICT' using errcode='PT409'; end if;
  if p_kind<>'delete' and not exists(select 1 from public.quotes where company_id=p_company_id and id=op.quote_id) then raise exception 'CORE_QUOTE_RESULT_MISSING' using errcode='PT409'; end if;
  perform private.core_quote_access(p_company_id,p_kind not in('archive','delete','revoke'));
  return op.result||jsonb_build_object('replayed',true);
 end if;
 if p_kind='create' then
  if p_calculation_id is null or p_calculation_revision is null or p_calculation_revision<1 then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
  perform private.core_calculation_actor(p_company_id);
  select * into calc from public.calculations where id=p_calculation_id and company_id=p_company_id for share;
  if not found then raise exception 'CORE_QUOTE_CALCULATION_NOT_FOUND' using errcode='P0002'; end if;
  if calc.revision<>p_calculation_revision then raise exception 'CORE_QUOTE_SOURCE_REVISION_CONFLICT' using errcode='PT409'; end if;
  select count(*) into n from public.quotes where company_id=p_company_id and source_calculation_id=p_calculation_id;
  if n>1 then raise exception 'CORE_QUOTE_LEGACY_AMBIGUOUS' using errcode='PT409'; end if;
  if n>0 or exists(select 1 from private.core_quote_source_claims where company_id=p_company_id and calculation_id=p_calculation_id) then raise exception 'CORE_QUOTE_OPERATION_CONFLICT' using errcode='PT409'; end if;
  if calc.customer_id is not null and not exists(select 1 from public.customers where id=calc.customer_id and company_id=p_company_id) then raise exception 'CORE_QUOTE_SCOPE_INVALID' using errcode='23514'; end if;
  if exists(select 1 from public.calculation_items where calculation_id=calc.id and item_type is null) then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
  p_quote_id:=gen_random_uuid();
  insert into private.core_quote_write_permits values(p_company_id,p_quote_id,pg_current_xact_id());
  insert into public.quotes(id,company_id,customer_id,source_calculation_id,source_calculation_revision,title,quote_date,currency,created_by)
   values(p_quote_id,p_company_id,calc.customer_id,calc.id,calc.revision,calc.title,calc.calculation_date,calc.currency,actor) returning * into q;
  insert into private.core_quote_source_claims(company_id,calculation_id,quote_id) values(p_company_id,calc.id,q.id);
 else
  if p_quote_id is null then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
  select * into q from public.quotes where company_id=p_company_id and id=p_quote_id for update;
  if not found then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if p_kind<>'decision' and (p_expected_revision is null or p_expected_revision<1 or q.revision<>p_expected_revision) then raise exception 'CORE_QUOTE_REVISION_CONFLICT' using errcode='PT409'; end if;
  if q.archived_at is not null and p_kind not in('revoke') then raise exception 'CORE_QUOTE_ARCHIVED' using errcode='PT409'; end if;
  if q.revision=9223372036854775807 then raise exception 'CORE_QUOTE_REVISION_CONFLICT' using errcode='PT409'; end if;
 end if;
 insert into private.core_quote_write_permits values(p_company_id,q.id,pg_current_xact_id()) on conflict do nothing;
 if p_kind in('create','sync') then
  if p_kind='sync' then
   if not q.draft_open then raise exception 'CORE_QUOTE_DRAFT_CLOSED' using errcode='PT409'; end if;
   if p_calculation_id is null or p_calculation_revision is null or q.source_calculation_id is distinct from p_calculation_id then raise exception 'CORE_QUOTE_SCOPE_INVALID' using errcode='23514'; end if;
   perform private.core_calculation_actor(p_company_id);
   select * into calc from public.calculations where id=p_calculation_id and company_id=p_company_id for share;
   if not found then raise exception 'CORE_QUOTE_CALCULATION_NOT_FOUND' using errcode='P0002'; end if;
   if calc.revision<>p_calculation_revision then raise exception 'CORE_QUOTE_SOURCE_REVISION_CONFLICT' using errcode='PT409'; end if;
   if calc.currency is distinct from q.currency then raise exception 'CORE_QUOTE_CURRENCY_UNSUPPORTED' using errcode='22023'; end if;
   if calc.customer_id is distinct from q.customer_id then raise exception 'CORE_QUOTE_SCOPE_INVALID' using errcode='23514'; end if;
   if exists(select 1 from public.calculation_items where calculation_id=calc.id and item_type is null) then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
   if (select count(*) from public.quotes where company_id=p_company_id and source_calculation_id=p_calculation_id)>1 then raise exception 'CORE_QUOTE_LEGACY_AMBIGUOUS' using errcode='PT409'; end if;
  end if;
  data:=private.core_quote_draft(p_company_id,q.id);
  if p_kind='create' then data:=data||jsonb_build_object('discount_amount','0.00','pricing_mode','net'); end if;
  select data||jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('name',i.name,'description',i.description,'quantity',i.quantity::text,'unit',i.unit,
   'unit_price',i.unit_price::text,'vat_rate',i.vat_rate::text,'note',i.note) order by i.sort_order,i.id),'[]')) into data
   from public.calculation_items i where i.calculation_id=calc.id and i.item_type='customer';
  data:=private.core_quote_input(data,true);
  perform private.core_quote_write_draft(p_company_id,q.id,data);
  update public.quotes set source_calculation_revision=calc.revision where id=q.id;
 elsif p_kind='update' then
  if not q.draft_open then raise exception 'CORE_QUOTE_DRAFT_CLOSED' using errcode='PT409'; end if;
  if data->>'currency' is distinct from q.currency then raise exception 'CORE_QUOTE_CURRENCY_UNSUPPORTED' using errcode='22023'; end if;
  perform private.core_quote_write_draft(p_company_id,q.id,data);
 elsif p_kind='open' then
  if q.draft_open then raise exception 'CORE_QUOTE_STATUS_INVALID' using errcode='PT409'; end if;
  if p_version_id is not null then
   select * into v from private.core_quote_versions where id=p_version_id and company_id=p_company_id and quote_id=q.id;
   if not found then raise exception 'CORE_QUOTE_VERSION_CONFLICT' using errcode='PT409'; end if;
   document:=v.document;
  else
   if q.current_version_id is not null or exists(select 1 from private.core_quote_versions where company_id=p_company_id and quote_id=q.id) then raise exception 'CORE_QUOTE_VERSION_CONFLICT' using errcode='PT409';end if;
   select d.document into document from private.core_quote_legacy_documents d where d.company_id=p_company_id and d.quote_id=q.id;
   if not found then raise exception 'CORE_QUOTE_VERSION_CONFLICT' using errcode='PT409'; end if;
  end if;
  -- Projection is already the last closed content. Selecting an older issued version
  -- restores its public fields without altering its immutable record or the internal note.
  if p_version_id is not null then
   data:=jsonb_build_object('title',document->'title','quote_date',document->'quote_date','valid_until',document->'valid_until','currency',document->'currency',
     'pricing_mode',document->'pricing_mode','discount_amount',document->'discount_amount','customer_note',document->'customer_note','internal_note',q.internal_note,'content',document->'content',
     'items',(select jsonb_agg(value-array['id','sort_order','total_price']) from jsonb_array_elements(document->'items')));
   perform private.core_quote_write_draft(p_company_id,q.id,private.core_quote_input(data));
  end if;
  update public.quotes set draft_open=true where id=q.id;
 elsif p_kind='publish' then
  if not q.draft_open then raise exception 'CORE_QUOTE_DRAFT_CLOSED' using errcode='PT409'; end if;
  data:=private.core_quote_input(private.core_quote_draft(p_company_id,q.id));
  -- Validate and normalize totals before capturing a version. C02 trigger captures
  -- identity only on first true publication, preserving legacy_unknown unchanged.
  perform private.core_quote_write_draft(p_company_id,q.id,data);
  token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  now_at:=clock_timestamp(); p_version_id:=gen_random_uuid();
  select coalesce(max(version_number),0)+1 into version_no from private.core_quote_versions where company_id=p_company_id and quote_id=q.id;
  update public.quotes set share_token=token,share_enabled=true,share_token_scope='quote_public_offer',share_token_expires_at=null,share_token_revoked_at=null,
   current_version_id=p_version_id,draft_open=false where id=q.id;
  document:=private.core_quote_document(p_company_id,q.id)-'content_hash';
  document:=document||jsonb_build_object('version_id',p_version_id,'version_number',version_no);
  document:=document||jsonb_build_object('content_hash',private.core_quote_hash(document));
  insert into private.core_quote_versions(id,company_id,quote_id,version_number,source_revision,customer_id,document,content_hash,published_at,published_by)
   values(p_version_id,p_company_id,q.id,version_no,q.revision,q.customer_id,document,document->>'content_hash',now_at,actor);
  insert into private.core_quote_tokens(token,company_id,quote_id,version_id) values(token,p_company_id,q.id,p_version_id);
 elsif p_kind in('decision','revoke') then
  if p_kind='revoke' and p_version_id is null then
   if not exists(select 1 from private.core_quote_legacy_documents where company_id=p_company_id and quote_id=q.id) then raise exception 'CORE_QUOTE_VERSION_CONFLICT' using errcode='PT409';end if;
   update private.core_quote_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company_id and quote_id=q.id and legacy;
   if q.current_version_id is null then update public.quotes set share_enabled=false,share_token_revoked_at=clock_timestamp() where id=q.id;end if;
  else
   select * into v from private.core_quote_versions where id=p_version_id and company_id=p_company_id and quote_id=q.id;
   if not found then raise exception 'CORE_QUOTE_VERSION_CONFLICT' using errcode='PT409';end if;
  end if;
  if p_kind='revoke' and p_version_id is not null then
   update private.core_quote_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company_id and quote_id=q.id and version_id=v.id;
   if q.current_version_id=v.id then update public.quotes set share_enabled=false,share_token_revoked_at=clock_timestamp() where id=q.id; end if;
  elsif p_kind='decision' then
   if jsonb_typeof(p_input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input) x where x not in('decision','evidence','decided_at'))
    or p_input->>'decision' not in('accepted','rejected') or p_input->>'decision' is null
    or jsonb_typeof(p_input->'decided_at') is distinct from 'string' or p_input->>'decided_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
   decision_at:=(p_input->>'decided_at')::timestamptz;
   if not isfinite(decision_at) or decision_at>clock_timestamp()+interval '5 minutes' then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
   if exists(select 1 from private.core_quote_decisions where company_id=p_company_id and quote_id=q.id and version_id=v.id)
      or exists(select 1 from private.core_quote_conversions where company_id=p_company_id and quote_id=q.id and (version_id is distinct from v.id or p_input->>'decision'='rejected'))
      or exists(select 1 from private.core_quote_tokens where company_id=p_company_id and quote_id=q.id and version_id=v.id and revoked_at is not null) then raise exception 'CORE_QUOTE_STATUS_INVALID' using errcode='PT409'; end if;
   insert into private.core_quote_decisions(company_id,quote_id,version_id,decision,evidence,actor_id,actor_kind,decided_at)
    values(p_company_id,q.id,v.id,p_input->>'decision',private.core_calculation_text(p_input->'evidence',10000,true),actor,'employee',decision_at) returning id into decision_id;
   if p_input->>'decision'='accepted' then
    update public.quotes set accepted_version_id=v.id,status='accepted',accepted_at=decision_at where id=q.id;
   elsif q.accepted_version_id is null and q.current_version_id=v.id then
    update public.quotes set status='rejected',rejected_at=decision_at where id=q.id;
   end if;
  end if;
 elsif p_kind='archive' then
  update public.quotes set archived_at=clock_timestamp() where id=q.id;
 elsif p_kind='delete' then
  if not q.draft_open or q.current_version_id is not null or q.accepted_version_id is not null
   or q.share_token is not null or q.share_enabled or q.sent_at is not null or q.accepted_at is not null or q.rejected_at is not null
   or q.status not in('draft','ready') or q.customer_identity_state<>'draft'
   or exists(select 1 from private.core_quote_versions where company_id=p_company_id and quote_id=q.id)
   or exists(select 1 from private.core_quote_legacy_documents where company_id=p_company_id and quote_id=q.id)
   or exists(select 1 from private.core_quote_conversions where company_id=p_company_id and quote_id=q.id)
   or exists(select 1 from public.jobs where source_quote_id=q.id) then raise exception 'CORE_QUOTE_STATUS_INVALID' using errcode='PT409'; end if;
  delete from public.quotes where id=q.id and company_id=p_company_id;
  delete from private.core_quote_source_claims where company_id=p_company_id and quote_id=q.id;
 end if;
 if p_kind<>'delete' then
  update public.quotes set revision=case when p_kind='create' then 1 else revision+1 end,updated_at=clock_timestamp() where id=q.id returning * into q;
 else q.revision:=q.revision+1; end if;
 result:=jsonb_build_object('companyId',p_company_id,'operationId',p_operation_id,'quoteId',q.id,'revision',q.revision::text,'replayed',false);
 if p_kind='publish' then result:=result||jsonb_build_object('versionId',p_version_id,'versionNumber',version_no,'shareToken',token,'publishedAt',now_at); end if;
 if p_kind='decision' then result:=result||jsonb_build_object('versionId',p_version_id,'decisionId',decision_id,'decision',p_input->>'decision','recordedAt',(select recorded_at from private.core_quote_decisions where id=decision_id)); end if;
 if p_kind='revoke' then result:=result||jsonb_build_object('versionId',p_version_id); end if;
 delete from private.core_quote_write_permits where company_id=p_company_id and quote_id=q.id and transaction_id=pg_current_xact_id();
 insert into private.core_quote_operations(company_id,operation_id,actor_id,kind,quote_id,payload,result) values(p_company_id,p_operation_id,actor,p_kind,q.id,payload,result);
 perform private.core_quote_access(p_company_id,p_kind not in('archive','delete','revoke'));
 if p_kind in('create','sync') then perform private.core_calculation_actor(p_company_id); end if;
 return result;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023';
 when invalid_parameter_value then if sqlerrm like 'CALCULATION_%' then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023';end if;raise;
end;
$f$;

create function private.core_quote_version_read(p_company_id uuid,p_quote_id uuid,p_version_id uuid,p_public boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare v private.core_quote_versions%rowtype; d private.core_quote_decisions%rowtype; doc jsonb; state text; current_id uuid; archived timestamptz;
begin
 select * into v from private.core_quote_versions where company_id=p_company_id and quote_id=p_quote_id and id=p_version_id;
 if not found then raise exception 'CORE_QUOTE_VERSION_CONFLICT' using errcode='PT409'; end if;
 select * into d from private.core_quote_decisions where company_id=p_company_id and quote_id=p_quote_id and version_id=p_version_id;
 select current_version_id,archived_at into current_id,archived from public.quotes where id=p_quote_id and company_id=p_company_id;
 state:=case when archived is not null then 'archived'
  when d.id is not null then d.decision
  when exists(select 1 from private.core_quote_tokens where company_id=p_company_id and quote_id=p_quote_id and version_id=p_version_id and revoked_at is not null) then 'revoked'
  when nullif(v.document->>'valid_until','')::date<current_date then 'expired'
  when current_id is distinct from p_version_id then 'superseded' else 'published' end;
 doc:=v.document;
 if p_public then doc:=jsonb_set(doc,'{customer}',jsonb_build_object('name',doc->'customer'->'name')); end if;
 return jsonb_build_object('kind','issued','publishedAt',v.published_at,'legacyCapturedAt',null,'status',state,
   'acceptedAt',case when d.decision='accepted' then d.decided_at end,'rejectedAt',case when d.decision='rejected' then d.decided_at end,'document',doc);
end;
$f$;
create function private.get_core_quote_workspace(p_company_id uuid,p_quote_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare q public.quotes%rowtype; versions jsonb; legacy jsonb; revision bigint; responses jsonb;
begin
 perform private.core_quote_access(p_company_id,false);
 select * into q from public.quotes where company_id=p_company_id and id=p_quote_id for share;
 if not found then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 select jsonb_agg(jsonb_build_object('versionId',v.id,'versionNumber',v.version_number,'sourceRevision',v.source_revision::text,
  'contentHash',v.content_hash,'publishedAt',v.published_at,'status',private.core_quote_version_read(p_company_id,q.id,v.id)->>'status',
  'acceptedAt',case when d.decision='accepted' then d.decided_at end,'rejectedAt',case when d.decision='rejected' then d.decided_at end,
  'shareToken',(select t.token from private.core_quote_tokens t where t.company_id=p_company_id and t.quote_id=q.id and t.version_id=v.id and t.revoked_at is null and(t.expires_at is null or t.expires_at>clock_timestamp()) order by t.created_at limit 1),
  'decision',case when d.id is not null then jsonb_build_object('id',d.id,'decision',d.decision,'evidence',d.evidence,'decidedAt',d.decided_at,'recordedAt',d.recorded_at,'actorId',d.actor_id,'actorKind',d.actor_kind) end) order by v.version_number desc)
  into versions from private.core_quote_versions v left join private.core_quote_decisions d on d.company_id=v.company_id and d.quote_id=v.quote_id and d.version_id=v.id where v.company_id=p_company_id and v.quote_id=q.id;
 select jsonb_build_object('capturedAt',l.captured_at,'revokedAt',case when not exists(select 1 from private.core_quote_tokens t where t.company_id=p_company_id and t.quote_id=q.id and t.legacy and t.revoked_at is null) then(select max(t.revoked_at) from private.core_quote_tokens t where t.company_id=p_company_id and t.quote_id=q.id and t.legacy) end,'document',l.document) into legacy from private.core_quote_legacy_documents l where l.company_id=p_company_id and l.quote_id=q.id;
 select coalesce(jsonb_agg(jsonb_build_object('responseId',r.result->>'responseId','versionId',r.version_id,'actionType',r.payload->>'action_type',
  'customerName',r.payload->>'customer_name','customerEmail',r.payload->>'customer_email','customerPhone',r.payload->>'customer_phone','note',r.payload->>'note',
  'recordedAt',r.created_at,'actorKind',case when r.actor_scope like 'portal:%' then 'portal' else 'public' end,
  'actorId',case when r.actor_scope like 'portal:%' then substring(r.actor_scope from 8) else null end) order by r.created_at desc),'[]') into responses
  from(select * from private.core_quote_responses where company_id=p_company_id and quote_id=q.id and payload ? 'action_type' order by created_at desc,operation_id limit 200) r;
 -- Do not expose calculation contents to a quote manager; revision alone is a sync prerequisite.
 select c.revision into revision from public.calculations c where c.id=q.source_calculation_id and c.company_id=p_company_id;
 perform private.core_quote_access(p_company_id,false);
 return jsonb_build_object('companyId',p_company_id,'quoteId',q.id,'customerId',q.customer_id,'sourceCalculationId',q.source_calculation_id,
  'sourceCalculationRevision',q.source_calculation_revision::text,'currentCalculationRevision',revision::text,'revision',q.revision::text,'draftOpen',q.draft_open,
  'archivedAt',q.archived_at,'currentVersionId',q.current_version_id,'acceptedVersionId',q.accepted_version_id,'customerIdentityState',q.customer_identity_state,
  'customerSnapshot',q.customer_snapshot,'draft',private.core_quote_draft(p_company_id,q.id),'versions',coalesce(versions,'[]'),'legacy',legacy,'responses',responses);
end;
$f$;
create function private.core_quote_legacy_read(p_company_id uuid,p_quote_id uuid,p_public boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare l private.core_quote_legacy_documents%rowtype;document jsonb;
begin
 select * into l from private.core_quote_legacy_documents where company_id=p_company_id and quote_id=p_quote_id;
 if not found then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002';end if;
 document:=l.document;
 if p_public then document:=jsonb_set(document,'{customer}',jsonb_build_object('name',document->'customer'->'name'));end if;
 return jsonb_build_object('kind','legacy','publishedAt',null,'legacyCapturedAt',l.captured_at,'status','legacy','acceptedAt',null,'rejectedAt',null,'document',document);
end;
$f$;
create function private.get_core_quote_version(p_company_id uuid,p_quote_id uuid,p_version_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
begin
 perform private.core_quote_access(p_company_id,false);
 if p_version_id is null then return private.core_quote_legacy_read(p_company_id,p_quote_id);end if;
 return private.core_quote_version_read(p_company_id,p_quote_id,p_version_id);
end;
$f$;
create function private.get_core_quote_draft_document(p_company_id uuid,p_quote_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare q public.quotes%rowtype; result jsonb;
begin
 perform private.core_quote_access(p_company_id,false);
 select * into q from public.quotes where company_id=p_company_id and id=p_quote_id for share;
 if not found then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 if q.revision is distinct from p_expected_revision then raise exception 'CORE_QUOTE_REVISION_CONFLICT' using errcode='PT409'; end if;
 result:=jsonb_build_object('kind','draft','publishedAt',null,'legacyCapturedAt',null,'status','draft','acceptedAt',null,'rejectedAt',null,'document',private.core_quote_document(p_company_id,p_quote_id));
 perform private.core_quote_access(p_company_id,false);
 return result;
end;
$f$;
create function private.get_public_core_quote_version(input_token text)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare t private.core_quote_tokens%rowtype; l private.core_quote_legacy_documents%rowtype; doc jsonb;
begin
 if input_token is null or length(input_token) not between 1 and 2048 then return null; end if;
 select * into t from private.core_quote_tokens where token=input_token and revoked_at is null and(expires_at is null or expires_at>clock_timestamp()) for share;
 if not found or(t.expires_at is not null and t.expires_at<=clock_timestamp()) then return null; end if;
 if not t.legacy then return private.core_quote_version_read(t.company_id,t.quote_id,t.version_id,true); end if;
 select * into l from private.core_quote_legacy_documents where company_id=t.company_id and quote_id=t.quote_id;
 if not found then return null; end if;
 doc:=jsonb_set(l.document,'{customer}',jsonb_build_object('name',l.document->'customer'->'name'));
 return jsonb_build_object('kind','legacy','publishedAt',null,'legacyCapturedAt',l.captured_at,'status','legacy','acceptedAt',null,'rejectedAt',null,'document',doc);
end;
$f$;
create function private.core_quote_portal_actor(p_company_id uuid,p_customer_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare actor uuid;
begin
 if auth.uid() is null then raise exception 'CORE_QUOTE_FORBIDDEN' using errcode='42501'; end if;
 select u.id into actor from public.customer_portal_users u join public.customers c on c.id=u.customer_id and c.company_id=u.company_id
  where u.company_id=p_company_id and u.customer_id=p_customer_id and u.auth_user_id=auth.uid() and u.is_active order by u.id limit 1 for share of u,c;
 if actor is null then raise exception 'CORE_QUOTE_FORBIDDEN' using errcode='42501'; end if;
 return actor;
end;
$f$;
create function private.list_portal_core_quote_versions(p_company_id uuid,p_customer_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare result jsonb;
begin
 perform private.core_quote_portal_actor(p_company_id,p_customer_id);
 select coalesce(jsonb_agg(x.value order by x.sort_at desc,x.version_no desc),'[]') into result from(
  select private.core_quote_version_read(v.company_id,v.quote_id,v.id) value,v.published_at sort_at,v.version_number version_no
   from private.core_quote_versions v where v.company_id=p_company_id and v.customer_id=p_customer_id
  union all
  select private.core_quote_legacy_read(l.company_id,l.quote_id),l.captured_at,0
   from private.core_quote_legacy_documents l where l.company_id=p_company_id and l.customer_id=p_customer_id) x;
 perform private.core_quote_portal_actor(p_company_id,p_customer_id);
 return result;
end;
$f$;
create function private.get_portal_core_quote_version(p_company_id uuid,p_customer_id uuid,p_quote_id uuid,p_version_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
begin
 perform private.core_quote_portal_actor(p_company_id,p_customer_id);
 if p_version_id is null then
  if not exists(select 1 from private.core_quote_legacy_documents where company_id=p_company_id and quote_id=p_quote_id and customer_id=p_customer_id) then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002';end if;
  return private.core_quote_legacy_read(p_company_id,p_quote_id);
 end if;
 if not exists(select 1 from private.core_quote_versions where company_id=p_company_id and customer_id=p_customer_id and quote_id=p_quote_id and id=p_version_id) then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 return private.core_quote_version_read(p_company_id,p_quote_id,p_version_id);
end;
$f$;

create function private.respond_public_core_quote_version(input_token text,p_operation_id uuid,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare t private.core_quote_tokens%rowtype; q public.quotes%rowtype; r private.core_quote_responses%rowtype; result jsonb; scope text; response_id uuid; x text;
begin
 if p_operation_id is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>40000
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in('version_id','action_type','customer_name','customer_email','customer_phone','note','visitor_id','user_agent','referrer'))
  or p_input->>'action_type' is null or p_input->>'action_type' not in('interested','contact_requested','revision_requested','not_interested') then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 foreach x in array array['customer_name','customer_email','customer_phone','visitor_id','user_agent','referrer'] loop
  perform private.core_calculation_text(coalesce(p_input->x,'null'),case when x='referrer' then 2000 when x='user_agent' then 1000 else 320 end);
 end loop;
 perform private.core_calculation_text(coalesce(p_input->'note','null'),10000);
 -- Resolve without a row lock, then take the same company -> quote -> token order
 -- as authenticated revocation; no token-lock/company-lock inversion.
 select * into t from private.core_quote_tokens where token=input_token and not legacy;
 if not found or t.version_id::text is distinct from p_input->>'version_id' then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 perform 1 from public.companies where id=t.company_id for update;
 select * into q from public.quotes where company_id=t.company_id and id=t.quote_id for update;
 if not found or q.archived_at is not null then raise exception 'CORE_QUOTE_STATUS_INVALID' using errcode='PT409'; end if;
 select * into t from private.core_quote_tokens where token=input_token and revoked_at is null and(expires_at is null or expires_at>clock_timestamp()) for share;
 if not found or(t.expires_at is not null and t.expires_at<=clock_timestamp()) then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 scope:='public:'||private.core_quote_hash(to_jsonb(input_token));
 select * into r from private.core_quote_responses where actor_scope=scope and operation_id=p_operation_id;
 if found then
  if r.payload<>p_input or r.version_id<>t.version_id then raise exception 'CORE_QUOTE_OPERATION_CONFLICT' using errcode='PT409'; end if;
  return r.result||jsonb_build_object('replayed',true);
 end if;
 if exists(select 1 from private.core_quote_versions v where v.id=t.version_id and nullif(v.document->>'valid_until','')::date<current_date) then raise exception 'CORE_QUOTE_STATUS_INVALID' using errcode='PT409'; end if;
 response_id:=gen_random_uuid();
 result:=jsonb_build_object('success',true,'quoteId',t.quote_id,'versionId',t.version_id,'operationId',p_operation_id,'responseId',response_id,'replayed',false);
 insert into private.core_quote_responses(company_id,quote_id,version_id,operation_id,actor_scope,payload,result) values(t.company_id,t.quote_id,t.version_id,p_operation_id,scope,p_input,result);
 -- Interest/request is an event only. It never changes acceptance or issued content.
 return result;
exception when invalid_parameter_value then if sqlerrm like 'CALCULATION_%' then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023';end if;raise;
end;
$f$;
create function private.respond_portal_core_quote_version(p_company_id uuid,p_customer_id uuid,p_quote_id uuid,p_version_id uuid,p_operation_id uuid,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare actor uuid; q public.quotes%rowtype; r private.core_quote_responses%rowtype; scope text; result jsonb; response_id uuid; decision_id uuid; evidence text;
begin
 if p_operation_id is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>40000 then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 perform 1 from public.companies where id=p_company_id for update;
 actor:=private.core_quote_portal_actor(p_company_id,p_customer_id);
 select * into q from public.quotes where company_id=p_company_id and id=p_quote_id for update;
 if not found then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 if not exists(select 1 from private.core_quote_versions where company_id=p_company_id and quote_id=p_quote_id and id=p_version_id and customer_id=p_customer_id) then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 scope:='portal:'||actor::text;
 select * into r from private.core_quote_responses where actor_scope=scope and operation_id=p_operation_id;
 if found then
  if r.payload<>p_input or r.quote_id<>p_quote_id or r.version_id<>p_version_id then raise exception 'CORE_QUOTE_OPERATION_CONFLICT' using errcode='PT409'; end if;
  perform private.core_quote_portal_actor(p_company_id,p_customer_id);
  return r.result||jsonb_build_object('replayed',true);
 end if;
 if q.archived_at is not null or exists(select 1 from private.core_quote_tokens where company_id=p_company_id and quote_id=p_quote_id and version_id=p_version_id and revoked_at is not null)
  or exists(select 1 from private.core_quote_versions where id=p_version_id and (document->>'valid_until')::date<current_date) then raise exception 'CORE_QUOTE_STATUS_INVALID' using errcode='PT409'; end if;
 if p_input ? 'decision' then
  if p_input->>'decision' is distinct from 'accepted' or exists(select 1 from jsonb_object_keys(p_input) k where k not in('decision','evidence')) then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
  evidence:=private.core_calculation_text(p_input->'evidence',10000,true);
  if exists(select 1 from private.core_quote_decisions where company_id=p_company_id and quote_id=p_quote_id and version_id=p_version_id)
   or exists(select 1 from private.core_quote_conversions where company_id=p_company_id and quote_id=p_quote_id and version_id is distinct from p_version_id) then raise exception 'CORE_QUOTE_STATUS_INVALID' using errcode='PT409'; end if;
  insert into private.core_quote_decisions(company_id,quote_id,version_id,decision,evidence,actor_id,actor_kind,decided_at)
   values(p_company_id,p_quote_id,p_version_id,'accepted',evidence,actor,'portal',clock_timestamp()) returning id into decision_id;
  insert into private.core_quote_write_permits values(p_company_id,p_quote_id,pg_current_xact_id());
  update public.quotes set accepted_version_id=p_version_id,status='accepted',accepted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=p_quote_id;
  delete from private.core_quote_write_permits where company_id=p_company_id and quote_id=p_quote_id and transaction_id=pg_current_xact_id();
  result:=jsonb_build_object('success',true,'quoteId',p_quote_id,'versionId',p_version_id,'operationId',p_operation_id,'decisionId',decision_id,'replayed',false);
 else
  if p_input->>'action_type' is null or p_input->>'action_type' not in('interested','contact_requested','revision_requested','not_interested')
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in('action_type','note')) then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
  perform private.core_calculation_text(coalesce(p_input->'note','null'),10000);
  response_id:=gen_random_uuid();
  result:=jsonb_build_object('success',true,'quoteId',p_quote_id,'versionId',p_version_id,'operationId',p_operation_id,'responseId',response_id,'replayed',false);
 end if;
 insert into private.core_quote_responses(company_id,quote_id,version_id,operation_id,actor_scope,payload,result) values(p_company_id,p_quote_id,p_version_id,p_operation_id,scope,p_input,result);
 perform private.core_quote_portal_actor(p_company_id,p_customer_id);
 return result;
exception when invalid_parameter_value then if sqlerrm like 'CALCULATION_%' then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023';end if;raise;
end;
$f$;

create function private.begin_core_quote_delivery_atomic(p_company_id uuid,p_quote_id uuid,p_version_id uuid,p_operation_id uuid,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare actor uuid; d private.core_quote_deliveries%rowtype; share text; attempt text; result jsonb; k text;
begin
 if p_operation_id is null or p_quote_id is null or p_version_id is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>1048576
  or exists(select 1 from jsonb_object_keys(p_input) x where x not in('to_email','to_name','subject','body_text','body_html','thread_id'))
  or not(p_input ?& array['to_email','to_name','subject','body_text','body_html','thread_id']) then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 perform private.core_calculation_text(p_input->'to_email',320,true);
 perform private.core_calculation_text(p_input->'to_name',300);
 perform private.core_calculation_text(p_input->'subject',1000,true);
 perform private.core_calculation_text(p_input->'body_text',400000);
 perform private.core_calculation_text(p_input->'body_html',400000);
 if p_input->>'to_email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or coalesce(p_input->>'body_text',p_input->>'body_html') is null then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 perform private.quote_customer_actor(p_company_id);
 perform 1 from public.companies where id=p_company_id for update;
 actor:=private.core_quote_access(p_company_id);
 perform 1 from public.quotes where id=p_quote_id and company_id=p_company_id for update;
 if not found then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 if not exists(select 1 from private.core_quote_versions where company_id=p_company_id and quote_id=p_quote_id and id=p_version_id) then raise exception 'CORE_QUOTE_VERSION_CONFLICT' using errcode='PT409'; end if;
 select * into d from private.core_quote_deliveries where company_id=p_company_id and operation_id=p_operation_id;
 if found then
  if d.actor_id<>actor or d.quote_id<>p_quote_id or d.version_id<>p_version_id or d.payload<>p_input then raise exception 'CORE_QUOTE_OPERATION_CONFLICT' using errcode='PT409'; end if;
  perform private.core_quote_access(p_company_id);
  return jsonb_build_object('companyId',p_company_id,'quoteId',p_quote_id,'versionId',p_version_id,'operationId',p_operation_id,'deliveryId',d.id,'state',d.state,'canSend',false);
 end if;
 if exists(select 1 from public.quotes where id=p_quote_id and archived_at is not null) then raise exception 'CORE_QUOTE_ARCHIVED' using errcode='PT409'; end if;
 select t.token into share from private.core_quote_tokens t where t.company_id=p_company_id and t.quote_id=p_quote_id and t.version_id=p_version_id and t.revoked_at is null and(t.expires_at is null or t.expires_at>clock_timestamp()) order by t.created_at limit 1 for share;
 if share is null or not exists(select 1 from private.core_quote_tokens t where t.token=share and t.revoked_at is null and(t.expires_at is null or t.expires_at>clock_timestamp())) then raise exception 'CORE_QUOTE_VERSION_CONFLICT' using errcode='PT409'; end if;
 if p_input->>'thread_id' is not null then
  if p_input->>'thread_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
  -- The existing mail subsystem may not be installed in an offline SQL fixture.
  -- In the hosted application the table must exist for a supplied thread.
  if to_regclass('public.mail_threads') is null then raise exception 'CORE_QUOTE_SCOPE_INVALID' using errcode='23514'; end if;
  execute 'select id::text from public.mail_threads where id=$1 and company_id=$2 and offer_id=$3 for share' into k using (p_input->>'thread_id')::uuid,p_company_id,p_quote_id;
  if k is null then raise exception 'CORE_QUOTE_SCOPE_INVALID' using errcode='23514'; end if;
 end if;
 attempt:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into private.core_quote_deliveries(id,company_id,quote_id,version_id,operation_id,actor_id,payload,payload_hash,attempt_hash,state)
  values(gen_random_uuid(),p_company_id,p_quote_id,p_version_id,p_operation_id,actor,p_input,private.core_quote_hash(p_input),private.core_quote_hash(to_jsonb(attempt)),'reserved') returning * into d;
 perform private.core_quote_access(p_company_id);
 if not exists(select 1 from private.core_quote_tokens t where t.token=share and t.revoked_at is null and(t.expires_at is null or t.expires_at>clock_timestamp())) then raise exception 'CORE_QUOTE_VERSION_CONFLICT' using errcode='PT409';end if;
 return jsonb_build_object('companyId',p_company_id,'quoteId',p_quote_id,'versionId',p_version_id,'operationId',p_operation_id,'deliveryId',d.id,'state',d.state,'canSend',true,'attemptToken',attempt,'shareToken',share);
exception when invalid_parameter_value then if sqlerrm like 'CALCULATION_%' then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023';end if;raise;
end;
$f$;
create function private.complete_core_quote_delivery_atomic(p_delivery_id uuid,p_attempt_token text,p_state text,p_provider_message_id text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare d private.core_quote_deliveries%rowtype;
begin
 if p_state is null or p_state not in('sent','uncertain') or length(p_attempt_token) is distinct from 64 or length(coalesce(p_provider_message_id,''))>2000 then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 select * into d from private.core_quote_deliveries where id=p_delivery_id for update;
 if not found or d.attempt_hash<>private.core_quote_hash(to_jsonb(p_attempt_token)) then raise exception 'CORE_QUOTE_FORBIDDEN' using errcode='42501'; end if;
 if d.state='sent' then return jsonb_build_object('state','sent'); end if;
 update private.core_quote_deliveries set state=p_state,provider_message_id=p_provider_message_id,completed_at=clock_timestamp() where id=p_delivery_id;
 -- Sending is recorded separately from publication; it cannot replace a version.
 return jsonb_build_object('state',p_state);
end;
$f$;

alter table public.jobs add column source_quote_version_id uuid;
alter table private.core_quote_conversion_requests add column actor_id uuid,add column version_id uuid;
create or replace function private.guard_core_quote_source_link()
returns trigger language plpgsql security definer set search_path='' as $f$
declare receipt private.core_quote_conversions%rowtype;
begin
 if tg_op='UPDATE' then
  select * into receipt from private.core_quote_conversions where job_id=old.id;
  if found and(new.company_id is distinct from old.company_id or new.source_quote_version_id is distinct from old.source_quote_version_id) then raise exception 'CORE_QUOTE_REQUEST_CONFLICT' using errcode='PT409'; end if;
  if new.source_quote_id is not distinct from old.source_quote_id then
   if new.source_quote_version_id is distinct from old.source_quote_version_id then raise exception 'CORE_QUOTE_REQUEST_CONFLICT' using errcode='PT409'; end if;
   return new;
  end if;
  if old.source_quote_id is not null then
   if new.source_quote_id is null and not exists(select 1 from public.quotes where id=old.source_quote_id) then return new; end if;
   raise exception 'CORE_QUOTE_REQUEST_CONFLICT' using errcode='PT409';
  end if;
 end if;
 if new.source_quote_id is null and new.source_quote_version_id is not null then raise exception 'CORE_QUOTE_FORBIDDEN' using errcode='42501'; end if;
 if new.source_quote_id is not null and not exists(select 1 from private.core_quote_conversions r where r.company_id=new.company_id and r.quote_id=new.source_quote_id and r.job_id=new.id
  and r.created_xid=pg_current_xact_id() and r.version_id is not distinct from new.source_quote_version_id) then raise exception 'CORE_QUOTE_FORBIDDEN' using errcode='42501'; end if;
 return new;
end;
$f$;
drop trigger guard_core_quote_source_link on public.jobs;
create trigger guard_core_quote_source_link before insert or update of source_quote_id,source_quote_version_id,company_id on public.jobs for each row execute function private.guard_core_quote_source_link();
create or replace function private.check_core_quote_conversion_complete()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if not exists(select 1 from public.jobs j join public.quotes q on q.id=new.quote_id and q.company_id=new.company_id
  left join private.core_quote_versions v on v.id=new.version_id and v.quote_id=new.quote_id and v.company_id=new.company_id
  where j.id=new.job_id and j.company_id=new.company_id and j.source_quote_id=new.quote_id and j.parent_job_id is null
   and j.source_quote_version_id is not distinct from new.version_id and j.customer_id is not distinct from q.customer_id
   and((new.version_id is null and j.price=q.total_price and j.currency=q.currency and q.status='accepted' and q.accepted_at is not null)
    or(new.version_id is not null and j.price=(v.document->>'total_price')::numeric and j.currency=v.document->>'currency'
      and exists(select 1 from private.core_quote_decisions d where d.company_id=new.company_id and d.quote_id=new.quote_id and d.version_id=new.version_id and d.decision='accepted'))))
  or (select count(*) from public.jobs j where j.parent_job_id=new.job_id)<>cardinality(new.child_job_ids)
  or exists(select 1 from unnest(new.child_job_ids) child_id left join public.jobs j on j.id=child_id where j.id is null or j.company_id<>new.company_id or j.parent_job_id is distinct from new.job_id or j.source_quote_id is not null)
  or not exists(select 1 from private.core_quote_conversion_requests r where r.company_id=new.company_id and r.quote_id=new.quote_id) then raise exception 'CORE_QUOTE_RESULT_MISSING' using errcode='PT409'; end if;
 return null;
end;
$f$;
-- An old client can recover its exact completed operation, never start an implicit acceptance.
create or replace function private.convert_core_quote_to_job_atomic(p_company_id uuid,p_quote_id uuid,p_operation_id uuid,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare actor uuid; input jsonb; r private.core_quote_conversions%rowtype;
begin
 perform private.core_quote_actor(p_company_id);
 input:=private.core_quote_conversion_input(p_input);
 perform 1 from public.companies where id=p_company_id for update;
 actor:=private.assert_core_quote_conversion(p_company_id);
 select * into r from private.core_quote_conversions where company_id=p_company_id and quote_id=p_quote_id;
 if not found or r.version_id is not null or not exists(select 1 from private.core_quote_conversion_requests where company_id=p_company_id and operation_id=p_operation_id and quote_id=p_quote_id) then raise exception 'CORE_QUOTE_VERSION_REQUIRED' using errcode='PT409'; end if;
 if r.payload<>input or r.actor_id<>actor then raise exception 'CORE_QUOTE_REQUEST_CONFLICT' using errcode='PT409'; end if;
 if not exists(select 1 from public.quotes where id=p_quote_id and company_id=p_company_id)
  or not exists(select 1 from public.jobs where id=r.job_id and company_id=p_company_id and source_quote_id=p_quote_id) then raise exception 'CORE_QUOTE_RESULT_MISSING' using errcode='PT409'; end if;
 perform private.assert_core_quote_conversion(p_company_id);
 return jsonb_build_object('companyId',p_company_id,'quoteId',p_quote_id,'jobId',r.job_id,'created',false);
end;
$f$;
create function private.convert_core_quote_to_job_atomic(p_company_id uuid,p_quote_id uuid,p_version_id uuid,p_operation_id uuid,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare actor uuid; input jsonb; q public.quotes%rowtype; v private.core_quote_versions%rowtype;
 r private.core_quote_conversions%rowtype; request private.core_quote_conversion_requests%rowtype; job uuid; child uuid; children uuid[]; day jsonb; idx integer:=0;
begin
 if p_company_id is null or p_quote_id is null or p_version_id is null or p_operation_id is null then raise exception 'CORE_QUOTE_INPUT_INVALID' using errcode='22023'; end if;
 perform private.core_quote_actor(p_company_id);
 input:=private.core_quote_conversion_input(p_input);
 perform 1 from public.companies where id=p_company_id for update;
 actor:=private.assert_core_quote_conversion(p_company_id);
 select * into q from public.quotes where id=p_quote_id and company_id=p_company_id for update;
 if not found then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 select * into v from private.core_quote_versions where id=p_version_id and company_id=p_company_id and quote_id=p_quote_id;
 if not found then raise exception 'CORE_QUOTE_VERSION_CONFLICT' using errcode='PT409'; end if;
 select * into request from private.core_quote_conversion_requests where company_id=p_company_id and operation_id=p_operation_id;
 if found and(request.quote_id<>p_quote_id or request.version_id is distinct from p_version_id or request.actor_id is distinct from actor) then raise exception 'CORE_QUOTE_REQUEST_CONFLICT' using errcode='PT409'; end if;
 select * into r from private.core_quote_conversions where company_id=p_company_id and quote_id=p_quote_id;
 if found then
  if r.version_id is distinct from p_version_id then raise exception 'CORE_QUOTE_VERSION_CONFLICT' using errcode='PT409'; end if;
  if r.payload<>input then raise exception 'CORE_QUOTE_REQUEST_CONFLICT' using errcode='PT409'; end if;
  if not exists(select 1 from public.jobs where id=r.job_id and company_id=p_company_id and source_quote_id=p_quote_id and source_quote_version_id=p_version_id) then raise exception 'CORE_QUOTE_RESULT_MISSING' using errcode='PT409'; end if;
  insert into private.core_quote_conversion_requests(company_id,operation_id,quote_id,actor_id,version_id) values(p_company_id,p_operation_id,p_quote_id,actor,p_version_id) on conflict do nothing;
  perform private.assert_core_quote_conversion(p_company_id);
  return jsonb_build_object('companyId',p_company_id,'quoteId',p_quote_id,'versionId',p_version_id,'jobId',r.job_id,'created',false);
 end if;
 if exists(select 1 from public.jobs where source_quote_id=p_quote_id) then raise exception 'CORE_QUOTE_LEGACY_CONVERSION' using errcode='PT409'; end if;
 if q.archived_at is not null or q.accepted_version_id is distinct from p_version_id
  or not exists(select 1 from private.core_quote_decisions where company_id=p_company_id and quote_id=p_quote_id and version_id=p_version_id and decision='accepted') then raise exception 'CORE_QUOTE_STATUS_INVALID' using errcode='PT409'; end if;
 if q.customer_id is not null then
  perform 1 from public.customers where id=q.customer_id and company_id=p_company_id for share;
  if not found then raise exception 'CORE_QUOTE_SCOPE_INVALID' using errcode='23514'; end if;
 end if;
 job:=gen_random_uuid(); select coalesce(array_agg(gen_random_uuid()),'{}'::uuid[]) into children from jsonb_array_elements(input->'split_days');
 insert into private.core_quote_conversions(company_id,quote_id,job_id,child_job_ids,payload,actor_id,version_id) values(p_company_id,p_quote_id,job,children,input,actor,p_version_id);
 insert into private.core_quote_conversion_requests(company_id,operation_id,quote_id,actor_id,version_id) values(p_company_id,p_operation_id,p_quote_id,actor,p_version_id);
 insert into public.jobs(id,company_id,customer_id,title,description,address,status,work_state,billing_status,billing_state,is_paid,price,currency,start_at,end_at,parent_job_id,source_quote_id,source_quote_version_id)
 values(job,p_company_id,q.customer_id,input->>'title',input->>'description',input->>'address','planned','not_started','waiting_for_invoice','waiting_for_invoice',false,
  (v.document->>'total_price')::numeric,v.document->>'currency',(input->>'start_at')::timestamptz,(input->>'end_at')::timestamptz,null,p_quote_id,p_version_id);
 for day in select value from jsonb_array_elements(input->'split_days') loop
  idx:=idx+1;child:=children[idx];
  insert into public.jobs(id,company_id,customer_id,title,description,address,status,work_state,billing_status,billing_state,is_paid,price,currency,start_at,end_at,parent_job_id,source_quote_id)
  values(child,p_company_id,q.customer_id,(input->>'title')||' - '||(day->>'label'),input->>'description',input->>'address','planned','not_started','waiting_for_invoice','waiting_for_invoice',false,0,
   v.document->>'currency',(day->>'start_at')::timestamptz,(day->>'end_at')::timestamptz,job,null);
 end loop;
 perform private.assert_core_quote_conversion(p_company_id);
 return jsonb_build_object('companyId',p_company_id,'quoteId',p_quote_id,'versionId',p_version_id,'jobId',job,'created',true);
end;
$f$;

-- No caller-controlled GUC can authorize writes. A private permit belongs to the
-- exact quote and current transaction and is removed before a command returns.
create function private.guard_core_quote_projection()
returns trigger language plpgsql security definer set search_path='' as $f$
declare c uuid; q uuid;
begin
 if tg_table_name='quotes' then
  if tg_op='DELETE' then c:=old.company_id;q:=old.id; else c:=new.company_id;q:=new.id; end if;
  if tg_op='UPDATE' and(new.id is distinct from old.id or new.company_id is distinct from old.company_id) then raise exception 'CORE_QUOTE_SCOPE_INVALID' using errcode='23514'; end if;
  -- Real ON DELETE SET NULL preserves a captured identity, without opening manual detachment.
  if tg_op='UPDATE' and old.customer_id is not null and new.customer_id is null and not exists(select 1 from public.customers where id=old.customer_id)
    and (to_jsonb(new)-'customer_id')=(to_jsonb(old)-'customer_id') then return new; end if;
 else
  if tg_op='DELETE' then c:=old.company_id;q:=old.quote_id; else c:=new.company_id;q:=new.quote_id; end if;
  if tg_op<>'DELETE' and not exists(select 1 from public.quotes where id=q and company_id=c) then raise exception 'CORE_QUOTE_SCOPE_INVALID' using errcode='23514'; end if;
  if tg_op='UPDATE' and(old.company_id is distinct from new.company_id or old.quote_id is distinct from new.quote_id or old.id is distinct from new.id) then raise exception 'CORE_QUOTE_SCOPE_INVALID' using errcode='23514'; end if;
 end if;
 if not exists(select 1 from private.core_quote_write_permits where company_id=c and quote_id=q and transaction_id=pg_current_xact_id()) then raise exception 'CORE_QUOTE_FORBIDDEN' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;return new;
end;
$f$;
create trigger guard_core_quote_projection before insert or update or delete on public.quotes for each row execute function private.guard_core_quote_projection();
create trigger guard_core_quote_items_projection before insert or update or delete on public.quote_items for each row execute function private.guard_core_quote_projection();
create function private.guard_core_quote_immutable()
returns trigger language plpgsql security definer set search_path='' as $f$
begin raise exception 'CORE_QUOTE_VERSION_CONFLICT' using errcode='PT409';end;
$f$;
create trigger core_quote_versions_immutable before update or delete on private.core_quote_versions for each row execute function private.guard_core_quote_immutable();
create trigger core_quote_legacy_immutable before update or delete on private.core_quote_legacy_documents for each row execute function private.guard_core_quote_immutable();
create trigger core_quote_decisions_immutable before update or delete on private.core_quote_decisions for each row execute function private.guard_core_quote_immutable();
create trigger core_quote_operations_immutable before update or delete on private.core_quote_operations for each row execute function private.guard_core_quote_immutable();
create trigger core_quote_responses_immutable before update or delete on private.core_quote_responses for each row execute function private.guard_core_quote_immutable();

-- Compatibility publication resolves only a real issued version. Old clients can
-- no longer generate a token against a mutable projection.
create or replace function private.publish_core_quote_customer_identity(p_company_id uuid,p_quote_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare q public.quotes%rowtype; token text;
begin
 perform private.quote_customer_actor(p_company_id);
 perform 1 from public.companies where id=p_company_id for update;
 perform private.core_quote_access(p_company_id);
 select * into q from public.quotes where id=p_quote_id and company_id=p_company_id for share;
 if not found then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 select t.token into token from private.core_quote_tokens t where t.company_id=p_company_id and t.quote_id=p_quote_id and t.version_id=q.current_version_id and not t.legacy and t.revoked_at is null and(t.expires_at is null or t.expires_at>clock_timestamp()) order by t.created_at limit 1;
 if token is null then raise exception 'CORE_QUOTE_VERSION_REQUIRED' using errcode='PT409'; end if;
 return jsonb_build_object('quoteId',q.id,'shareToken',token,'state',q.customer_identity_state,'capturedAt',q.customer_snapshot_captured_at);
end;
$f$;

-- Close all unsafe table and column DML, including TRUNCATE (which bypasses RLS).
revoke all on public.quotes,public.quote_items from anon,authenticated,service_role;
grant select on public.quotes,public.quote_items to authenticated;
do $f$
declare t text; c text;
begin
 foreach t in array array['quotes','quote_items'] loop
  for c in select column_name from information_schema.columns where table_schema='public' and table_name=t loop
   execute format('revoke insert (%I), update (%I), references (%I) on public.%I from anon,authenticated,service_role',c,c,c,t);
  end loop;
 end loop;
end;
$f$;
create function private.core_quote_read_allowed(p_company_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $f$
begin perform private.quote_customer_actor(p_company_id);return true;exception when insufficient_privilege then return false;end;
$f$;
-- A restrictive policy also constrains pre-existing broad SELECT/ALL policies.
create policy core_quotes_current_actor_read on public.quotes as restrictive for select to authenticated using(private.core_quote_read_allowed(company_id));
create policy core_quote_items_current_actor_read on public.quote_items for select to authenticated using(private.core_quote_read_allowed(company_id) and exists(select 1 from public.quotes q where q.id=quote_id and q.company_id=quote_items.company_id));
-- Legacy public endpoints cannot mutate mutable content behind the new lifecycle.
do $f$
declare f record;
begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('track_public_offer_event','submit_public_offer_response') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end;
$f$;

-- Explicit API entry points and ACLs. No generic dispatcher is callable by clients.
create function private.create_core_quote_from_calculation_atomic(p_company_id uuid,p_calculation_id uuid,p_expected_calculation_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security definer set search_path='' as $f$ select private.core_quote_command('create',p_company_id,null,null,p_operation_id,null,p_calculation_id,p_expected_calculation_revision,null); $f$;
create function private.sync_core_quote_draft_atomic(p_company_id uuid,p_quote_id uuid,p_expected_revision bigint,p_calculation_id uuid,p_expected_calculation_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security definer set search_path='' as $f$ select private.core_quote_command('sync',p_company_id,p_quote_id,p_expected_revision,p_operation_id,null,p_calculation_id,p_expected_calculation_revision,null); $f$;
create function private.update_core_quote_draft_atomic(p_company_id uuid,p_quote_id uuid,p_expected_revision bigint,p_operation_id uuid,p_input jsonb) returns jsonb language sql volatile security definer set search_path='' as $f$ select private.core_quote_command('update',p_company_id,p_quote_id,p_expected_revision,p_operation_id,p_input); $f$;
create function private.open_core_quote_revision_atomic(p_company_id uuid,p_quote_id uuid,p_version_id uuid,p_expected_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security definer set search_path='' as $f$ select private.core_quote_command('open',p_company_id,p_quote_id,p_expected_revision,p_operation_id,null,null,null,p_version_id); $f$;
create function private.publish_core_quote_version_atomic(p_company_id uuid,p_quote_id uuid,p_expected_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security definer set search_path='' as $f$ select private.core_quote_command('publish',p_company_id,p_quote_id,p_expected_revision,p_operation_id); $f$;
create function private.record_core_quote_decision_atomic(p_company_id uuid,p_quote_id uuid,p_version_id uuid,p_operation_id uuid,p_input jsonb) returns jsonb language sql volatile security definer set search_path='' as $f$ select private.core_quote_command('decision',p_company_id,p_quote_id,null,p_operation_id,p_input,null,null,p_version_id); $f$;
create function private.archive_core_quote_atomic(p_company_id uuid,p_quote_id uuid,p_expected_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security definer set search_path='' as $f$ select private.core_quote_command('archive',p_company_id,p_quote_id,p_expected_revision,p_operation_id); $f$;
create function private.delete_core_quote_draft_atomic(p_company_id uuid,p_quote_id uuid,p_expected_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security definer set search_path='' as $f$ select private.core_quote_command('delete',p_company_id,p_quote_id,p_expected_revision,p_operation_id); $f$;
create function private.revoke_core_quote_publication_atomic(p_company_id uuid,p_quote_id uuid,p_version_id uuid,p_expected_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security definer set search_path='' as $f$ select private.core_quote_command('revoke',p_company_id,p_quote_id,p_expected_revision,p_operation_id,null,null,null,p_version_id); $f$;
revoke all on function private.create_core_quote_from_calculation_atomic(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function private.create_core_quote_from_calculation_atomic(uuid,uuid,bigint,uuid) to authenticated;
create function public.create_core_quote_from_calculation_atomic(p_company_id uuid,p_calculation_id uuid,p_expected_calculation_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.create_core_quote_from_calculation_atomic(p_company_id,p_calculation_id,p_expected_calculation_revision,p_operation_id); $f$;
revoke all on function public.create_core_quote_from_calculation_atomic(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_core_quote_from_calculation_atomic(uuid,uuid,bigint,uuid) to authenticated;
revoke all on function private.sync_core_quote_draft_atomic(uuid,uuid,bigint,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function private.sync_core_quote_draft_atomic(uuid,uuid,bigint,uuid,bigint,uuid) to authenticated;
create function public.sync_core_quote_draft_atomic(p_company_id uuid,p_quote_id uuid,p_expected_revision bigint,p_calculation_id uuid,p_expected_calculation_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.sync_core_quote_draft_atomic(p_company_id,p_quote_id,p_expected_revision,p_calculation_id,p_expected_calculation_revision,p_operation_id); $f$;
revoke all on function public.sync_core_quote_draft_atomic(uuid,uuid,bigint,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sync_core_quote_draft_atomic(uuid,uuid,bigint,uuid,bigint,uuid) to authenticated;
revoke all on function private.update_core_quote_draft_atomic(uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.update_core_quote_draft_atomic(uuid,uuid,bigint,uuid,jsonb) to authenticated;
create function public.update_core_quote_draft_atomic(p_company_id uuid,p_quote_id uuid,p_expected_revision bigint,p_operation_id uuid,p_input jsonb) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.update_core_quote_draft_atomic(p_company_id,p_quote_id,p_expected_revision,p_operation_id,p_input); $f$;
revoke all on function public.update_core_quote_draft_atomic(uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.update_core_quote_draft_atomic(uuid,uuid,bigint,uuid,jsonb) to authenticated;
revoke all on function private.open_core_quote_revision_atomic(uuid,uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function private.open_core_quote_revision_atomic(uuid,uuid,uuid,bigint,uuid) to authenticated;
create function public.open_core_quote_revision_atomic(p_company_id uuid,p_quote_id uuid,p_version_id uuid,p_expected_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.open_core_quote_revision_atomic(p_company_id,p_quote_id,p_version_id,p_expected_revision,p_operation_id); $f$;
revoke all on function public.open_core_quote_revision_atomic(uuid,uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.open_core_quote_revision_atomic(uuid,uuid,uuid,bigint,uuid) to authenticated;
revoke all on function private.publish_core_quote_version_atomic(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function private.publish_core_quote_version_atomic(uuid,uuid,bigint,uuid) to authenticated;
create function public.publish_core_quote_version_atomic(p_company_id uuid,p_quote_id uuid,p_expected_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.publish_core_quote_version_atomic(p_company_id,p_quote_id,p_expected_revision,p_operation_id); $f$;
revoke all on function public.publish_core_quote_version_atomic(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.publish_core_quote_version_atomic(uuid,uuid,bigint,uuid) to authenticated;
revoke all on function private.record_core_quote_decision_atomic(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.record_core_quote_decision_atomic(uuid,uuid,uuid,uuid,jsonb) to authenticated;
create function public.record_core_quote_decision_atomic(p_company_id uuid,p_quote_id uuid,p_version_id uuid,p_operation_id uuid,p_input jsonb) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.record_core_quote_decision_atomic(p_company_id,p_quote_id,p_version_id,p_operation_id,p_input); $f$;
revoke all on function public.record_core_quote_decision_atomic(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_core_quote_decision_atomic(uuid,uuid,uuid,uuid,jsonb) to authenticated;
revoke all on function private.archive_core_quote_atomic(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function private.archive_core_quote_atomic(uuid,uuid,bigint,uuid) to authenticated;
create function public.archive_core_quote_atomic(p_company_id uuid,p_quote_id uuid,p_expected_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.archive_core_quote_atomic(p_company_id,p_quote_id,p_expected_revision,p_operation_id); $f$;
revoke all on function public.archive_core_quote_atomic(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.archive_core_quote_atomic(uuid,uuid,bigint,uuid) to authenticated;
revoke all on function private.delete_core_quote_draft_atomic(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function private.delete_core_quote_draft_atomic(uuid,uuid,bigint,uuid) to authenticated;
create function public.delete_core_quote_draft_atomic(p_company_id uuid,p_quote_id uuid,p_expected_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.delete_core_quote_draft_atomic(p_company_id,p_quote_id,p_expected_revision,p_operation_id); $f$;
revoke all on function public.delete_core_quote_draft_atomic(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_core_quote_draft_atomic(uuid,uuid,bigint,uuid) to authenticated;
revoke all on function private.revoke_core_quote_publication_atomic(uuid,uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function private.revoke_core_quote_publication_atomic(uuid,uuid,uuid,bigint,uuid) to authenticated;
create function public.revoke_core_quote_publication_atomic(p_company_id uuid,p_quote_id uuid,p_version_id uuid,p_expected_revision bigint,p_operation_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.revoke_core_quote_publication_atomic(p_company_id,p_quote_id,p_version_id,p_expected_revision,p_operation_id); $f$;
revoke all on function public.revoke_core_quote_publication_atomic(uuid,uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.revoke_core_quote_publication_atomic(uuid,uuid,uuid,bigint,uuid) to authenticated;
revoke all on function private.get_core_quote_workspace(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_core_quote_workspace(uuid,uuid) to authenticated;
create function public.get_core_quote_workspace(p_company_id uuid,p_quote_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.get_core_quote_workspace(p_company_id,p_quote_id); $f$;
revoke all on function public.get_core_quote_workspace(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_core_quote_workspace(uuid,uuid) to authenticated;
revoke all on function private.get_core_quote_version(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_core_quote_version(uuid,uuid,uuid) to authenticated;
create function public.get_core_quote_version(p_company_id uuid,p_quote_id uuid,p_version_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.get_core_quote_version(p_company_id,p_quote_id,p_version_id); $f$;
revoke all on function public.get_core_quote_version(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_core_quote_version(uuid,uuid,uuid) to authenticated;
revoke all on function private.get_core_quote_draft_document(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function private.get_core_quote_draft_document(uuid,uuid,bigint) to authenticated;
create function public.get_core_quote_draft_document(p_company_id uuid,p_quote_id uuid,p_expected_revision bigint) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.get_core_quote_draft_document(p_company_id,p_quote_id,p_expected_revision); $f$;
revoke all on function public.get_core_quote_draft_document(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.get_core_quote_draft_document(uuid,uuid,bigint) to authenticated;
revoke all on function private.get_public_core_quote_version(text) from public,anon,authenticated,service_role;
create function public.get_public_core_quote_version(input_token text) returns jsonb language sql volatile security definer set search_path='' as $f$ select private.get_public_core_quote_version(input_token); $f$;
revoke all on function public.get_public_core_quote_version(text) from public,anon,authenticated,service_role;
grant execute on function public.get_public_core_quote_version(text) to anon,authenticated;
revoke all on function private.list_portal_core_quote_versions(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.list_portal_core_quote_versions(uuid,uuid) to authenticated;
create function public.list_portal_core_quote_versions(p_company_id uuid,p_customer_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.list_portal_core_quote_versions(p_company_id,p_customer_id); $f$;
revoke all on function public.list_portal_core_quote_versions(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_portal_core_quote_versions(uuid,uuid) to authenticated;
revoke all on function private.get_portal_core_quote_version(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_portal_core_quote_version(uuid,uuid,uuid,uuid) to authenticated;
create function public.get_portal_core_quote_version(p_company_id uuid,p_customer_id uuid,p_quote_id uuid,p_version_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.get_portal_core_quote_version(p_company_id,p_customer_id,p_quote_id,p_version_id); $f$;
revoke all on function public.get_portal_core_quote_version(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_portal_core_quote_version(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function private.respond_portal_core_quote_version(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.respond_portal_core_quote_version(uuid,uuid,uuid,uuid,uuid,jsonb) to authenticated;
create function public.respond_portal_core_quote_version(p_company_id uuid,p_customer_id uuid,p_quote_id uuid,p_version_id uuid,p_operation_id uuid,p_input jsonb) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.respond_portal_core_quote_version(p_company_id,p_customer_id,p_quote_id,p_version_id,p_operation_id,p_input); $f$;
revoke all on function public.respond_portal_core_quote_version(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.respond_portal_core_quote_version(uuid,uuid,uuid,uuid,uuid,jsonb) to authenticated;
revoke all on function private.respond_public_core_quote_version(text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.respond_public_core_quote_version(input_token text,p_operation_id uuid,p_input jsonb) returns jsonb language sql volatile security definer set search_path='' as $f$ select private.respond_public_core_quote_version(input_token,p_operation_id,p_input); $f$;
revoke all on function public.respond_public_core_quote_version(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.respond_public_core_quote_version(text,uuid,jsonb) to anon,authenticated;
revoke all on function private.begin_core_quote_delivery_atomic(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.begin_core_quote_delivery_atomic(uuid,uuid,uuid,uuid,jsonb) to authenticated;
create function public.begin_core_quote_delivery_atomic(p_company_id uuid,p_quote_id uuid,p_version_id uuid,p_operation_id uuid,p_input jsonb) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.begin_core_quote_delivery_atomic(p_company_id,p_quote_id,p_version_id,p_operation_id,p_input); $f$;
revoke all on function public.begin_core_quote_delivery_atomic(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.begin_core_quote_delivery_atomic(uuid,uuid,uuid,uuid,jsonb) to authenticated;
revoke all on function private.complete_core_quote_delivery_atomic(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.complete_core_quote_delivery_atomic(uuid,text,text,text) to service_role;
create function public.complete_core_quote_delivery_atomic(p_delivery_id uuid,p_attempt_token text,p_state text,p_provider_message_id text default null) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.complete_core_quote_delivery_atomic(p_delivery_id,p_attempt_token,p_state,p_provider_message_id); $f$;
revoke all on function public.complete_core_quote_delivery_atomic(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.complete_core_quote_delivery_atomic(uuid,text,text,text) to service_role;
revoke all on function private.convert_core_quote_to_job_atomic(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.convert_core_quote_to_job_atomic(uuid,uuid,uuid,uuid,jsonb) to authenticated;
create function public.convert_core_quote_to_job_atomic(p_company_id uuid,p_quote_id uuid,p_version_id uuid,p_operation_id uuid,p_input jsonb) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.convert_core_quote_to_job_atomic(p_company_id,p_quote_id,p_version_id,p_operation_id,p_input); $f$;
revoke all on function public.convert_core_quote_to_job_atomic(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.convert_core_quote_to_job_atomic(uuid,uuid,uuid,uuid,jsonb) to authenticated;
do $f$ declare f record;t text;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and(p.proname like 'core_quote_%' or p.proname in('guard_core_quote_projection','guard_core_quote_immutable')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
 foreach t in array array['core_quote_write_permits','core_quote_versions','core_quote_tokens','core_quote_legacy_documents','core_quote_source_claims','core_quote_operations','core_quote_decisions','core_quote_responses','core_quote_deliveries'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end;$f$;
grant execute on function private.core_quote_read_allowed(uuid) to authenticated;
-- The compatibility readers below will be rebound to the same immutable resolver.
revoke all on function public.get_public_offer_by_token(text),public.get_public_offer_items_by_token(text) from public,anon,authenticated,service_role;

-- Legacy read adapters resolve the exact immutable token, including its revocation
-- and expiry. They expose no current projection and make no acceptance assertion.
create or replace function public.get_public_offer_by_token(input_token text)
returns table(id uuid,title text,status text,valid_until date,intro_text text,contact_name text,contact_email text,
 customer_request_title text,customer_request text,our_solution_title text,proposed_solution text,timeline_title text,
 work_description text,work_schedule text,pricing_title text,pricing_text text,payment_terms_title text,payment_terms text,
 benefits_text text,total_price numeric,customer_name text,company_name text,company_logo_url text,created_at timestamptz,updated_at timestamptz,creator_name text)
language sql volatile security definer set search_path='' as $f$
 with r as(select private.get_public_core_quote_version(input_token) value), d as(select value,value->'document' doc from r where value is not null)
 select (doc->>'id')::uuid,doc->>'title',value->>'status',(doc->>'valid_until')::date,
 doc->'content'->>'intro_text',doc->'content'->>'contact_name',doc->'content'->>'contact_email',doc->'content'->>'customer_request_title',doc->'content'->>'customer_request',
 doc->'content'->>'our_solution_title',doc->'content'->>'proposed_solution',doc->'content'->>'timeline_title',doc->'content'->>'work_description',doc->'content'->>'work_schedule',
 doc->'content'->>'pricing_title',doc->'content'->>'pricing_text',doc->'content'->>'payment_terms_title',doc->'content'->>'payment_terms',doc->'content'->>'benefits_text',
 (doc->>'total_price')::numeric,doc->'customer'->>'name',doc->'supplier'->>'name',doc->'supplier'->>'logo_url',
 coalesce(value->>'publishedAt',value->>'legacyCapturedAt')::timestamptz,coalesce(value->>'publishedAt',value->>'legacyCapturedAt')::timestamptz,null::text from d;
$f$;
create or replace function public.get_public_offer_items_by_token(input_token text)
returns table(id uuid,name text,description text,quantity numeric,unit text,unit_price numeric,total_price numeric,note text)
language sql volatile security definer set search_path='' as $f$
 select (i.value->>'id')::uuid,i.value->>'name',i.value->>'description',(i.value->>'quantity')::numeric,i.value->>'unit',
  (i.value->>'unit_price')::numeric,(i.value->>'total_price')::numeric,i.value->>'note'
 from jsonb_array_elements(private.get_public_core_quote_version(input_token)->'document'->'items') with ordinality i(value,ord) order by i.ord;
$f$;
revoke all on function public.get_public_offer_by_token(text),public.get_public_offer_items_by_token(text) from public,anon,authenticated,service_role;
grant execute on function public.get_public_offer_by_token(text),public.get_public_offer_items_by_token(text) to anon,authenticated;
revoke all on function public.publish_core_quote_customer_identity(uuid,uuid),private.publish_core_quote_customer_identity(uuid,uuid) from public,anon,authenticated,service_role;
alter table public.offer_events add column quote_version_id uuid;
create or replace function public.track_public_offer_event(input_token text,input_event_type text,input_section_key text default null,input_event_value text default null,input_visitor_id text default null,input_user_agent text default null,input_device_type text default null,input_referrer text default null)
returns boolean language plpgsql volatile security definer set search_path='' as $f$
declare t private.core_quote_tokens%rowtype;
begin
 if length(coalesce(input_event_type,'')) not between 1 and 100 or length(coalesce(input_visitor_id,''))>320 then return false; end if;
 select * into t from private.core_quote_tokens where token=input_token;
 if not found then return false;end if;
 perform 1 from public.companies where id=t.company_id for share;
 perform 1 from public.quotes where id=t.quote_id and company_id=t.company_id for share;
 if not found then return false;end if;
 select * into t from private.core_quote_tokens where token=input_token and revoked_at is null and(expires_at is null or expires_at>clock_timestamp()) for share;
 if not found or(t.expires_at is not null and t.expires_at<=clock_timestamp()) then return false; end if;
 insert into public.offer_events(company_id,quote_id,quote_version_id,event_type,visitor_id) values(t.company_id,t.quote_id,t.version_id,input_event_type,input_visitor_id);
 return true;
end;
$f$;
revoke all on function public.track_public_offer_event(text,text,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.track_public_offer_event(text,text,text,text,text,text,text,text) to anon,authenticated;

create index core_quote_responses_quote_created_idx on private.core_quote_responses(company_id,quote_id,created_at desc,operation_id);
create policy core_quotes_staff_read on public.quotes for select to authenticated using(private.core_quote_read_allowed(company_id));
create policy core_quote_items_current_actor_guard on public.quote_items as restrictive for select to authenticated using(private.core_quote_read_allowed(company_id) and exists(select 1 from public.quotes q where q.id=quote_id and q.company_id=quote_items.company_id));
