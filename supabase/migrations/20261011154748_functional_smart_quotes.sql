-- Requires the module foundation's private.require_module_access and module_is_active.
-- All changes go through guarded, atomic commands. Core quotes remain independent.
create table public.smart_quote_templates (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  name text not null check(length(name) between 1 and 160), draft jsonb not null,
  revision integer not null default 1, archived boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.smart_quote_library_items (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  item jsonb not null, revision integer not null default 1, archived boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.smart_quotes (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  customer_id uuid references public.customers(id), draft jsonb not null, revision integer not null default 1,
  current_version integer not null default 0, published_revision integer,
  status text not null default 'draft' check(status in ('draft','sent','accepted','rejected')),
  approved_revision integer, approved_by uuid references public.profiles(id), approved_at timestamptz, approval_reason text,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,id)
);
create table public.smart_quote_versions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, quote_id uuid not null,
  version integer not null check(version>0), snapshot jsonb not null, internal_snapshot jsonb not null,
  content_hash text not null, published_by uuid not null references public.profiles(id), published_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id), approval_reason text,
  unique(quote_id,version), unique(company_id,quote_id,version),
  foreign key(company_id,quote_id) references public.smart_quotes(company_id,id)
);
create table public.smart_quote_acceptances (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, quote_id uuid not null unique,
  version integer not null, variant_id text not null, name text not null, email text not null,
  mechanism text not null default 'bearer_link_and_declared_identity', accepted_at timestamptz not null default now(),
  content_hash text not null,
  foreign key(company_id,quote_id,version) references public.smart_quote_versions(company_id,quote_id,version)
);
create table public.smart_quote_rejections (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, quote_id uuid not null,
  version integer not null, name text not null, email text not null, rejected_at timestamptz not null default now(),
  mechanism text not null default 'bearer_link_and_declared_identity', content_hash text not null,
  unique(quote_id,version), foreign key(company_id,quote_id,version) references public.smart_quote_versions(company_id,quote_id,version)
);
create table public.smart_quote_conversions (
  quote_id uuid primary key references public.smart_quotes(id), company_id uuid not null references public.companies(id),
  acceptance_id uuid not null unique references public.smart_quote_acceptances(id), job_id uuid not null unique references public.jobs(id),
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table private.smart_quote_tokens (
  token_hash text primary key, company_id uuid not null, quote_id uuid not null, version integer not null,
  created_at timestamptz not null default now(), read_until timestamptz not null default (now()+interval '2 years'),
  foreign key(company_id,quote_id,version) references public.smart_quote_versions(company_id,quote_id,version)
);
create index on public.smart_quotes(company_id,updated_at desc);
create index on public.smart_quote_templates(company_id);
create index on public.smart_quote_library_items(company_id);
create index on public.smart_quote_versions(company_id,quote_id);
create index on public.smart_quote_acceptances(company_id);
create index on public.smart_quote_rejections(company_id);
create index on public.smart_quote_conversions(company_id);
alter table private.smart_quote_tokens enable row level security;
revoke all on private.smart_quote_tokens from public,anon,authenticated;

do $$ declare t text; begin
  foreach t in array array['smart_quotes','smart_quote_templates','smart_quote_library_items','smart_quote_versions','smart_quote_acceptances','smart_quote_rejections','smart_quote_conversions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy tenant_history_read on public.%I for select to authenticated using (private.module_can_read(company_id,''smart_quotes''))',t);
  end loop;
end $$;

create function private.smart_quote_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Vydanou verzi ani záznam přijetí nelze měnit nebo mazat.' using errcode='55000'; end $$;
create trigger immutable_version before update or delete on public.smart_quote_versions for each row execute function private.smart_quote_immutable();
create trigger immutable_acceptance before update or delete on public.smart_quote_acceptances for each row execute function private.smart_quote_immutable();
create trigger immutable_rejection before update or delete on public.smart_quote_rejections for each row execute function private.smart_quote_immutable();
create trigger immutable_conversion before update or delete on public.smart_quote_conversions for each row execute function private.smart_quote_immutable();
revoke all on function private.smart_quote_immutable() from public,anon,authenticated;

create function private.smart_quote_normalize(d jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v jsonb; i jsonb; variants jsonb:='[]'; items jsonb; vi text[]:='{}'; ii text[];
  price numeric; qty numeric; vat numeric; cost numeric; discount numeric; line_net numeric; line_vat numeric;
  net numeric; tax numeric; total_cost numeric; k text;
begin
  if d is null or jsonb_typeof(d)<>'object' or octet_length(d::text)>250000 then raise exception 'Neplatný nebo příliš velký návrh.'; end if;
  foreach k in array array['title','customerName','customerEmail','validUntil','deliveryTerms','terms'] loop
    if jsonb_typeof(d->k) is distinct from 'string' then raise exception 'Chybí textové pole %.',k; end if;
  end loop;
  if length(btrim(d->>'title')) not between 1 and 200 or length(btrim(d->>'customerName')) not between 1 and 200
    or length(d->>'customerEmail')>254 or length(d->>'deliveryTerms')>4000 or length(d->>'terms')>10000
    or (d->>'validUntil') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Zkontrolujte název, zákazníka, platnost a podmínky.'; end if;
  perform (d->>'validUntil')::date;
  if d->>'customerEmail'<>'' and d->>'customerEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Neplatný e-mail.'; end if;
  if jsonb_typeof(d->'variants') is distinct from 'array' or jsonb_array_length(d->'variants') not between 1 and 10 then raise exception 'Povoleno je 1 až 10 variant.'; end if;
  for v in select value from jsonb_array_elements(d->'variants') loop
    if coalesce(v->>'id','') !~ '^[a-zA-Z0-9_-]{1,64}$' or v->>'id'=any(vi) or length(btrim(coalesce(v->>'name',''))) not between 1 and 160 then raise exception 'Neplatná varianta.'; end if;
    vi:=array_append(vi,v->>'id'); ii:='{}'; items:='[]'; net:=0; tax:=0; total_cost:=0;
    if jsonb_typeof(v->'discountPercent') is distinct from 'number' then raise exception 'Neplatná sleva.'; end if;
    discount:=(v->>'discountPercent')::numeric;
    if discount not between 0 and 100 then raise exception 'Sleva musí být 0 až 100 procent.'; end if;
    if jsonb_typeof(v->'items') is distinct from 'array' or jsonb_array_length(v->'items') not between 1 and 200 then raise exception 'Varianta musí obsahovat 1 až 200 položek.'; end if;
    for i in select value from jsonb_array_elements(v->'items') loop
      if coalesce(i->>'id','') !~ '^[a-zA-Z0-9_-]{1,64}$' or i->>'id'=any(ii)
        or length(btrim(coalesce(i->>'name',''))) not between 1 and 200
        or length(btrim(coalesce(i->>'unit',''))) not between 1 and 20 or length(coalesce(i->>'description',''))>2000 then raise exception 'Neplatná položka.'; end if;
      ii:=array_append(ii,i->>'id');
      foreach k in array array['unitPrice','quantity','vatRate','costPrice'] loop
        if jsonb_typeof(i->k) is distinct from 'number' then raise exception 'Neplatné číselné pole %.',k; end if;
      end loop;
      price:=(i->>'unitPrice')::numeric; qty:=(i->>'quantity')::numeric; vat:=(i->>'vatRate')::numeric; cost:=(i->>'costPrice')::numeric;
      if price not between 0 and 100000000 or cost not between 0 and 100000000 or qty not between 0.001 and 1000000 or vat not between 0 and 100 then raise exception 'Cena, množství nebo DPH jsou mimo povolený rozsah.'; end if;
      line_net:=round(qty*price*(1-discount/100),2); line_vat:=round(line_net*vat/100,2);
      net:=net+line_net; tax:=tax+line_vat; total_cost:=total_cost+round(qty*cost,2);
      items:=items||jsonb_build_array(jsonb_build_object('id',i->>'id','name',btrim(i->>'name'),'description',coalesce(i->>'description',''),
        'unit',btrim(i->>'unit'),'quantity',qty,'unitPrice',price,'vatRate',vat,'costPrice',cost,'net',line_net,'vat',line_vat,'total',line_net+line_vat));
    end loop;
    if net+tax>999999999 then raise exception 'Celková cena je příliš vysoká.'; end if;
    variants:=variants||jsonb_build_array(jsonb_build_object('id',v->>'id','name',btrim(v->>'name'),'discountPercent',discount,'items',items,
      'net',net,'vat',tax,'total',net+tax,'cost',total_cost,'margin',case when net=0 then case when total_cost>0 then -100 else 0 end else round((net-total_cost)/net*100,2) end));
  end loop;
  return jsonb_build_object('title',btrim(d->>'title'),'customerName',btrim(d->>'customerName'),'customerEmail',btrim(d->>'customerEmail'),
    'validUntil',d->>'validUntil','deliveryTerms',d->>'deliveryTerms','terms',d->>'terms','currency','CZK','variants',variants);
end $$;
revoke all on function private.smart_quote_normalize(jsonb) from public,anon,authenticated;

create function private.smart_quote_customer_snapshot(d jsonb,supplier text) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('title',d->>'title','customerName',d->>'customerName','customerEmail',d->>'customerEmail',
    'validUntil',d->>'validUntil','deliveryTerms',d->>'deliveryTerms','terms',d->>'terms','currency','CZK','supplierName',supplier,
    'variants',(select jsonb_agg(jsonb_build_object('id',v->>'id','name',v->>'name','discountPercent',v->'discountPercent',
      'net',v->'net','vat',v->'vat','total',v->'total','items',(select jsonb_agg(jsonb_build_object('id',i->>'id','name',i->>'name',
        'description',i->>'description','unit',i->>'unit','quantity',i->'quantity','unitPrice',i->'unitPrice','vatRate',i->'vatRate',
        'net',i->'net','vat',i->'vat','total',i->'total')) from jsonb_array_elements(v->'items') i))) from jsonb_array_elements(d->'variants') v))
$$;
revoke all on function private.smart_quote_customer_snapshot(jsonb,text) from public,anon,authenticated;

create function public.smart_quotes_read(target_company_id uuid,target_quote_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
  perform private.require_module_access(target_company_id,'smart_quotes',null);
  result:=jsonb_build_object('companyId',target_company_id,'canWrite',private.module_is_active(target_company_id,'smart_quotes'),
    'canConvert',private.module_is_active(target_company_id,'diriqo_core'),
    'templates',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from public.smart_quote_templates t where company_id=target_company_id),'[]'::jsonb),
    'library',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at) from public.smart_quote_library_items i where company_id=target_company_id),'[]'::jsonb),
    'quotes',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'title',q.draft->>'title','customer',q.draft->>'customerName','status',q.status,'current_version',q.current_version,'updated_at',q.updated_at) order by q.updated_at desc) from public.smart_quotes q where company_id=target_company_id),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name) from public.customers c where company_id=target_company_id),'[]'::jsonb));
  if target_quote_id is not null then
    if not exists(select 1 from public.smart_quotes where id=target_quote_id and company_id=target_company_id) then raise exception 'Nabídka není dostupná.'; end if;
    result:=result||jsonb_build_object('quote',(select to_jsonb(q) from public.smart_quotes q where id=target_quote_id and company_id=target_company_id),
      'versions',coalesce((select jsonb_agg(to_jsonb(v) order by version desc) from public.smart_quote_versions v where quote_id=target_quote_id and company_id=target_company_id),'[]'::jsonb),
      'acceptance',(select to_jsonb(a) from public.smart_quote_acceptances a where quote_id=target_quote_id and company_id=target_company_id),
      'rejections',coalesce((select jsonb_agg(to_jsonb(r) order by version desc) from public.smart_quote_rejections r where quote_id=target_quote_id and company_id=target_company_id),'[]'::jsonb),
      'conversion',(select to_jsonb(c) from public.smart_quote_conversions c where quote_id=target_quote_id and company_id=target_company_id));
  end if;
  return result;
end $$;
revoke all on function public.smart_quotes_read(uuid,uuid) from public,anon;
grant execute on function public.smart_quotes_read(uuid,uuid) to authenticated;

create function public.smart_quotes_command(target_company_id uuid,command text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; q public.smart_quotes; d jsonb; snapshot jsonb; v jsonb; customer uuid; result_id uuid; revision integer;
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
    revision:=q.current_version+1;
    insert into public.smart_quote_versions(company_id,quote_id,version,snapshot,internal_snapshot,content_hash,published_by,approved_by,approval_reason)
      values(target_company_id,q.id,revision,snapshot,d,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),actor,q.approved_by,q.approval_reason);
    update public.smart_quotes set current_version=revision,published_revision=q.revision,status='sent',updated_at=now() where id=q.id;
  elsif command='share' then
    if q.current_version=0 then raise exception 'Nejprve vydejte verzi nabídky.'; end if;
    revision:=q.current_version;
  else raise exception 'Neznámý příkaz.';
  end if;
  raw_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into private.smart_quote_tokens(token_hash,company_id,quote_id,version) values(encode(sha256(convert_to(raw_token,'UTF8')),'hex'),target_company_id,q.id,revision);
  return jsonb_build_object('id',q.id,'version',revision,'token',raw_token);
end $$;
revoke all on function public.smart_quotes_command(uuid,text,jsonb) from public,anon;
grant execute on function public.smart_quotes_command(uuid,text,jsonb) to authenticated;

create function public.smart_quote_public_read(access_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t private.smart_quote_tokens; q public.smart_quotes; v public.smart_quote_versions; a public.smart_quote_acceptances; begin
  if access_token is null or access_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into t from private.smart_quote_tokens where token_hash=encode(sha256(convert_to(access_token,'UTF8')),'hex') and read_until>now();
  if t.quote_id is null then return null; end if;
  if not private.module_has_entitlement(t.company_id,'smart_quotes',null) then return null; end if;
  select * into q from public.smart_quotes where id=t.quote_id and company_id=t.company_id;
  select * into v from public.smart_quote_versions where quote_id=t.quote_id and version=t.version and company_id=t.company_id;
  select * into a from public.smart_quote_acceptances where quote_id=q.id;
  return jsonb_build_object('version',t.version,'snapshot',v.snapshot,'publishedAt',v.published_at,'current',q.current_version=t.version,
    'expired',(v.snapshot->>'validUntil')::date<current_date,'active',private.module_is_active(t.company_id,'smart_quotes'),
    'status',case when q.current_version<>t.version then 'replaced' else q.status end,
    'acceptance',case when a.version=t.version then jsonb_build_object('variantId',a.variant_id,'name',a.name,'acceptedAt',a.accepted_at) else null end);
end $$;
revoke all on function public.smart_quote_public_read(text) from public;
grant execute on function public.smart_quote_public_read(text) to anon,authenticated;

create function public.smart_quote_public_respond(access_token text,target_version integer,variant_id text,customer_name text,customer_email text,decision text,consent boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t private.smart_quote_tokens; q public.smart_quotes; v public.smart_quote_versions; a public.smart_quote_acceptances; result_id uuid; begin
  if access_token is null or access_token !~ '^[0-9a-f]{64}$' then raise exception 'Odkaz není platný.'; end if;
  select * into t from private.smart_quote_tokens where token_hash=encode(sha256(convert_to(access_token,'UTF8')),'hex') and read_until>now();
  if t.quote_id is null then raise exception 'Odkaz není platný.'; end if;
  -- Same lock order as require_module_entitlement; revocation cannot race acceptance.
  perform 1 from private.company_module_rollouts where company_id=t.company_id order by product for share;
  perform 1 from public.company_module_entitlements where company_id=t.company_id order by id for share;
  perform 1 from private.company_test_module_grants where company_id=t.company_id order by id for share;
  select * into q from public.smart_quotes where id=t.quote_id and company_id=t.company_id for update;
  if target_version is distinct from t.version or q.current_version<>t.version then raise exception 'Tuto verzi nahradila novější nabídka. Vyžádejte si aktuální odkaz.'; end if;
  select * into a from public.smart_quote_acceptances where quote_id=q.id;
  if a.id is not null then
    if decision='accept' and a.version=target_version and a.variant_id=variant_id then return jsonb_build_object('accepted',true,'id',a.id); end if;
    raise exception 'Nabídka už byla přijata a vybraná varianta je uzamčená.';
  end if;
  if not private.module_is_active(t.company_id,'smart_quotes') then raise exception 'Online přijetí nyní není dostupné. Kontaktujte dodavatele.'; end if;
  select * into v from public.smart_quote_versions where quote_id=q.id and version=t.version;
  if (v.snapshot->>'validUntil')::date<current_date then raise exception 'Platnost nabídky skončila. Kontaktujte dodavatele.'; end if;
  if q.status<>'sent' then raise exception 'Tato nabídka už není otevřená k přijetí.'; end if;
  if decision not in ('accept','reject') or decision is null or consent is distinct from true then raise exception 'Potvrďte svou volbu a souhlas.'; end if;
  if length(btrim(coalesce(customer_name,''))) not between 2 and 200 or length(coalesce(customer_email,''))>254
    or coalesce(customer_email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Vyplňte své jméno a platný e-mail.'; end if;
  if decision='reject' then
    insert into public.smart_quote_rejections(company_id,quote_id,version,name,email,content_hash)
      values(t.company_id,q.id,t.version,btrim(customer_name),btrim(customer_email),v.content_hash);
    update public.smart_quotes set status='rejected',updated_at=now() where id=q.id;
    return jsonb_build_object('accepted',false,'rejected',true);
  end if;
  if not exists(select 1 from jsonb_array_elements(v.snapshot->'variants') x where x->>'id'=variant_id) then raise exception 'Vyberte existující variantu této verze.'; end if;
  insert into public.smart_quote_acceptances(company_id,quote_id,version,variant_id,name,email,content_hash)
    values(t.company_id,q.id,t.version,variant_id,btrim(customer_name),btrim(customer_email),v.content_hash) returning id into result_id;
  update public.smart_quotes set status='accepted',updated_at=now() where id=q.id;
  return jsonb_build_object('accepted',true,'id',result_id);
end $$;
revoke all on function public.smart_quote_public_respond(text,integer,text,text,text,text,boolean) from public;
grant execute on function public.smart_quote_public_respond(text,integer,text,text,text,text,boolean) to anon,authenticated;
