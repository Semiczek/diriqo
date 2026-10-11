-- Follow-up: disambiguate published version; preserve existing administrator-only Core job creation.
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
    if not public.has_company_role(target_company_id,array['super_admin','company_admin']) then raise exception 'Zakázku z nabídky může založit pouze administrátor firmy.' using errcode='42501'; end if;
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

create or replace function public.smart_quotes_read(target_company_id uuid,target_quote_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
  perform private.require_module_access(target_company_id,'smart_quotes',null);
  result:=jsonb_build_object('companyId',target_company_id,'canWrite',private.module_is_active(target_company_id,'smart_quotes'),
    'canConvert',private.module_is_active(target_company_id,'diriqo_core') and public.has_company_role(target_company_id,array['super_admin','company_admin']),
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
