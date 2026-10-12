-- Shared Diriqo Office migration TEMPLATE. Validate in a disposable database before rollout.
-- No live database was changed. Default host hooks match JSPD Hub.
begin;
create schema if not exists office_private;
revoke all on schema office_private from public, anon, authenticated;

create table if not exists public.office_settings (
  company_id uuid primary key references public.companies(id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.office_settings enable row level security;
revoke all on public.office_settings from public, anon, authenticated;
grant select on public.office_settings to authenticated;

create table if not exists office_private.tenant_state (
  company_id uuid primary key references public.companies(id),
  state jsonb not null default '{"files":{},"versions":{},"proposals":{},"originals":{},"receipts":{},"audit":[]}'::jsonb
);
alter table office_private.tenant_state enable row level security;
revoke all on office_private.tenant_state from public, anon, authenticated;

create table if not exists office_private.settings_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  enabled boolean not null,
  actor_auth_id uuid,
  created_at timestamptz not null default now()
);
alter table office_private.settings_events enable row level security;
revoke all on office_private.settings_events from public, anon, authenticated;

create or replace function office_private.fail(code text, message text, status integer default 400)
returns void language plpgsql set search_path=pg_catalog as $$
begin
  raise exception '%', jsonb_build_object('code',code,'message',message,'status',status)::text using errcode='P0001';
end;
$$;

create or replace function public.office_host_context(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_profile uuid; v_role text;
begin
  if auth.uid() is null then perform office_private.fail('UNAUTHENTICATED','Sign in required.',401); end if;
  select p.id,lower(cm.role::text) into v_profile,v_role
  from public.company_members cm join public.profiles p on p.id=cm.profile_id
  where cm.company_id=p_company_id and cm.is_active=true
    and (p.auth_user_id=auth.uid() or p.user_id=auth.uid())
    and lower(cm.role::text) in ('super_admin','company_admin','manager','user','worker')
  order by (p.auth_user_id=auth.uid()) desc nulls last limit 1;
  if v_profile is null then perform office_private.fail('FORBIDDEN','Company membership required.',403); end if;
  return jsonb_build_object('actorId',v_profile,'role',
    case when v_role in ('super_admin','company_admin') then 'owner' when v_role='manager' then 'editor' else 'reader' end,
    'hostRole',v_role);
end;
$$;

create or replace function public.office_host_can_configure(p_company_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(
    select 1 from public.company_members cm join public.profiles p on p.id=cm.profile_id
    where cm.company_id=p_company_id and cm.is_active=true and lower(cm.role::text)='super_admin'
      and (p.auth_user_id=auth.uid() or p.user_id=auth.uid())
  );
$$;

create or replace function public.office_host_write_allowed(p_company_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select true; $$;

create or replace function public.office_host_resolve_entity(p_company_id uuid,p_type text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_row jsonb;
begin
  perform public.office_host_context(p_company_id);
  if p_type='job' then select to_jsonb(j) into v_row from public.jobs j where j.id=p_id and j.company_id=p_company_id;
  elsif p_type='customer' then select to_jsonb(c) into v_row from public.customers c where c.id=p_id and c.company_id=p_company_id;
  else perform office_private.fail('INVALID_REQUEST','Unsupported linked entity.'); end if;
  if v_row is null then perform office_private.fail('NOT_FOUND','Entity was not found in this company.',404); end if;
  return jsonb_build_object('id',p_id,'label',
    coalesce(nullif(v_row->>'title',''),nullif(v_row->>'name',''),nullif(v_row->>'company_name',''),p_id::text));
end;
$$;

create or replace function public.office_is_member(p_company_id uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  perform public.office_host_context(p_company_id);
  return true;
exception when others then return false;
end;
$$;

drop policy if exists office_settings_member_read on public.office_settings;
create policy office_settings_member_read on public.office_settings for select to authenticated
using(public.office_is_member(company_id));

create or replace function office_private.audit_settings()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into office_private.settings_events(company_id,enabled,actor_auth_id)
  values(new.company_id,new.enabled,auth.uid());
  return new;
end;
$$;
drop trigger if exists office_settings_audit on public.office_settings;
create trigger office_settings_audit after insert or update of enabled on public.office_settings
for each row execute function office_private.audit_settings();

create or replace function public.office_set_enabled(p_company_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or public.office_host_can_configure(p_company_id) is distinct from true then
    perform office_private.fail('FORBIDDEN','Platform administrator required.',403);
  end if;
  if p_enabled is null then perform office_private.fail('INVALID_REQUEST','Enabled must be a boolean.'); end if;
  insert into public.office_settings(company_id,enabled,updated_by)
  values(p_company_id,p_enabled,auth.uid())
  on conflict(company_id) do update set enabled=excluded.enabled,updated_at=now(),updated_by=excluded.updated_by;
  return p_enabled;
end;
$$;

create or replace function office_private.valid_id(v text)
returns boolean language sql immutable set search_path=pg_catalog as $$
  select coalesce(v ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' and v not in ('constructor','prototype','__proto__'),false);
$$;

create or replace function office_private.valid_attrs(attrs jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare a record; val text;
begin
  if attrs is null then return true; end if;
  if jsonb_typeof(attrs) is distinct from 'object' then return false; end if;
  for a in select key,value from jsonb_each(attrs) loop
    if a.key not in ('level','textAlign','align','indent','lineHeight','start','language','colspan','rowspan','colwidth','src','alt','title','width','height','href','target','rel','class','fontFamily','fontSize','color','backgroundColor') then return false; end if;
    if a.value='null'::jsonb then continue; end if;
    val:=a.value#>>'{}';
    if a.key='colwidth' then
      if jsonb_typeof(a.value) is distinct from 'array' or jsonb_array_length(a.value)>100 then return false; end if;
      if exists(select 1 from jsonb_array_elements(a.value) item where jsonb_typeof(item)<>'number' or (item#>>'{}')!~'^[0-9]{1,5}$' or (item#>>'{}')::integer>10000) then return false; end if;
    elsif jsonb_typeof(a.value) not in ('string','number','boolean') then return false;
    elsif a.key in ('align','textAlign') and val not in ('left','center','right','justify') then return false;
    elsif a.key='href' and (jsonb_typeof(a.value)<>'string' or val !~* '^(https?://|mailto:|tel:|#)' or val ~ '[[:space:][:cntrl:]]') then return false;
    elsif a.key='src' and (jsonb_typeof(a.value)<>'string' or val !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$') then return false;
    elsif a.key in ('fontSize','lineHeight') and val !~ '^[0-9]{1,3}(\.[0-9]{1,2})?(px|pt|em|%)?$' then return false;
    elsif a.key in ('color','backgroundColor') and val !~* '^(#[0-9a-f]{3,8}|[a-z]{1,20}|rgba?\([0-9 .,%]+\))$' then return false;
    elsif a.key='fontFamily' and (length(val)>120 or val ~ '[;{}<>\\]') then return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function office_private.valid_content(c jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare x record; sid text; sh jsonb; r record; cell record; count_values bigint:=0; count_cells bigint:=0; formula text; resource jsonb;
begin
  if jsonb_typeof(c) is distinct from 'object' or not c ?& array['schemaVersion','kind']
    or (c->>'schemaVersion') is distinct from '1' or octet_length(c::text)>8000000 then return false; end if;
  for x in with recursive walk(v,depth) as (
    select c,0
    union all
    select q.v,w.depth+1 from walk w cross join lateral (
      select value v from jsonb_each(case when jsonb_typeof(w.v)='object' then w.v else '{}'::jsonb end)
      union all
      select value from jsonb_array_elements(case when jsonb_typeof(w.v)='array' then w.v else '[]'::jsonb end)
    )q where w.depth<61
  )select v,depth from walk loop
    count_values:=count_values+1;
    if count_values>1000000 or x.depth>=60 then return false; end if;
    if jsonb_typeof(x.v)='object' and (x.v ? '__proto__' or x.v ? 'constructor' or x.v ? 'prototype') then return false; end if;
  end loop;

  if c->>'kind'='document' then
    if not c ?& array['doc','page'] or exists(select 1 from jsonb_object_keys(c)t(k) where k not in ('kind','schemaVersion','doc','page'))
      or (c#>>'{doc,type}') is distinct from 'doc' then return false; end if;
    if jsonb_typeof(c->'page') is distinct from 'object' or not (c->'page') ?& array['marginMm','header','footer']
      or jsonb_typeof(c#>'{page,marginMm}') is distinct from 'number' or (c#>>'{page,marginMm}')::numeric not between 5 and 50
      or jsonb_typeof(c#>'{page,header}') is distinct from 'string' or jsonb_typeof(c#>'{page,footer}') is distinct from 'string'
      or length(c#>>'{page,header}')>1000 or length(c#>>'{page,footer}')>1000 then return false; end if;
    for x in with recursive nd(v) as (
      select c->'doc'
      union all
      select value from nd cross join lateral jsonb_array_elements(
        case when jsonb_typeof(v->'content')='array' then v->'content' else '[]'::jsonb end)
    )select v from nd loop
      if jsonb_typeof(x.v) is distinct from 'object' or coalesce(x.v->>'type','') not in ('doc','paragraph','text','heading','blockquote','bulletList','orderedList','listItem','hardBreak','horizontalRule','codeBlock','table','tableRow','tableCell','tableHeader','image','pageBreak') then return false; end if;
      if exists(select 1 from jsonb_object_keys(x.v)t(k) where k not in ('type','attrs','text','marks','content')) then return false; end if;
      if x.v?'content' and jsonb_typeof(x.v->'content') is distinct from 'array' then return false; end if;
      if x.v?'text' and (x.v->>'type'<>'text' or jsonb_typeof(x.v->'text') is distinct from 'string') then return false; end if;
      if not office_private.valid_attrs(x.v->'attrs') then return false; end if;
      if x.v?'marks' then
        if jsonb_typeof(x.v->'marks') is distinct from 'array' or jsonb_array_length(x.v->'marks')>20 then return false; end if;
        if exists(select 1 from jsonb_array_elements(x.v->'marks') m
          where jsonb_typeof(m)<>'object'
            or coalesce(m->>'type','') not in ('bold','italic','underline','strike','code','link','textStyle','highlight','subscript','superscript')
            or exists(select 1 from jsonb_object_keys(m)t(k) where k not in ('type','attrs'))
            or not office_private.valid_attrs(m->'attrs')) then return false; end if;
      end if;
    end loop;

  elsif c->>'kind'='spreadsheet' then
    if exists(select 1 from jsonb_object_keys(c)t(k) where k not in ('kind','schemaVersion','workbook'))
      or jsonb_typeof(c->'workbook') is distinct from 'object'
      or not (c->'workbook') ?& array['id','name','sheets','sheetOrder'] then return false; end if;
    if jsonb_typeof(c#>'{workbook,id}') is distinct from 'string' or jsonb_typeof(c#>'{workbook,name}') is distinct from 'string'
      or not office_private.valid_id(c#>>'{workbook,id}') or length(coalesce(c#>>'{workbook,name}','')) not between 1 and 240
      or jsonb_typeof(c#>'{workbook,sheets}') is distinct from 'object'
      or jsonb_typeof(c#>'{workbook,sheetOrder}') is distinct from 'array' then return false; end if;
    if jsonb_array_length(c#>'{workbook,sheetOrder}') not between 1 and 64
      or exists(select 1 from jsonb_array_elements(c#>'{workbook,sheetOrder}') v where jsonb_typeof(v) is distinct from 'string')
      or (select count(*) from jsonb_object_keys(c#>'{workbook,sheets}'))<>jsonb_array_length(c#>'{workbook,sheetOrder}')
      or (select count(distinct value) from jsonb_array_elements(c#>'{workbook,sheetOrder}'))<>jsonb_array_length(c#>'{workbook,sheetOrder}') then return false; end if;
    for sid in select value from jsonb_array_elements_text(c#>'{workbook,sheetOrder}') loop
      sh:=c#>array['workbook','sheets',sid];
      if not office_private.valid_id(sid) or sh is null or not sh ?& array['id','name','rowCount','columnCount']
        or jsonb_typeof(sh->'id') is distinct from 'string' or jsonb_typeof(sh->'name') is distinct from 'string'
        or (sh->>'id') is distinct from sid or length(coalesce(sh->>'name','')) not between 1 and 100
        or jsonb_typeof(sh->'rowCount') is distinct from 'number' or (sh->>'rowCount')!~'^[0-9]+$'
        or (sh->>'rowCount')::integer not between 1 and 100000
        or jsonb_typeof(sh->'columnCount') is distinct from 'number' or (sh->>'columnCount')!~'^[0-9]+$'
        or (sh->>'columnCount')::integer not between 1 and 16384 then return false; end if;
      if sh?'cellData' and jsonb_typeof(sh->'cellData') is distinct from 'object' then return false; end if;
      for r in select key,value from jsonb_each(coalesce(sh->'cellData','{}'::jsonb)) loop
        if r.key !~ '^[0-9]{1,6}$' or r.key::integer>=(sh->>'rowCount')::integer or jsonb_typeof(r.value)<>'object' then return false; end if;
        for cell in select key,value from jsonb_each(r.value) loop
          count_cells:=count_cells+1;
          if count_cells>100000 or cell.key !~ '^[0-9]{1,6}$' or cell.key::integer>=(sh->>'columnCount')::integer then return false; end if;
          if cell.value='null'::jsonb then continue; end if;
          if jsonb_typeof(cell.value) is distinct from 'object' then return false; end if;
          formula:=cell.value->>'f';
          if formula is not null and (length(formula)>4096 or left(formula,1)<>'=' or position('[' in formula)>0 or position(']' in formula)>0 or position('|' in formula)>0
            or formula ~* '(WEBSERVICE|HYPERLINK|IMAGE|IMPORTXML|IMPORTHTML|IMPORTDATA|IMPORTRANGE|RTD|CALL|REGISTER(\.ID)?|EXEC|EVALUATE|FILTERXML|GOOGLEFINANCE|DDE)[[:space:]]*\(|\[[^]]+\]|https?:|file:|\\\\') then return false; end if;
          if cell.value?'v' and jsonb_typeof(cell.value->'v') not in ('null','string','number','boolean') then return false; end if;
          if cell.value?'m' and (jsonb_typeof(cell.value->'m') is distinct from 'string' or length(cell.value->>'m')>32767) then return false; end if;
          if concat_ws(' ',cell.value->>'v',cell.value->>'f',cell.value->>'m') ~* '<(script|iframe|object|img|svg|math|link|style|meta|audio|video|input|textarea|span)([[:space:]>]|$)|javascript:|on[a-z]+[[:space:]]*=' then return false; end if;
        end loop;
      end loop;
    end loop;
    -- Resource JSON can otherwise smuggle remote image URLs inside escaped strings.
    -- Opaque external-engine resource plugins are not part of our canonical schema.
    if c#>'{workbook,resources}' is not null then
      if jsonb_typeof(c#>'{workbook,resources}') is distinct from 'array' or jsonb_array_length(c#>'{workbook,resources}')<>0 then return false; end if;
    end if;
    if (c->'workbook')::text ~* '"(url|src|href|imageSource|imageUrl)"[[:space:]]*:[[:space:]]*"(https?:|file:|ftp:|javascript:|//)' then return false; end if;
  else return false;
  end if;
  return true;
exception when others then return false;
end;
$$;

create or replace function office_private.get_file(s jsonb,p_company_id uuid,fid text)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare f jsonb;
begin
  f:=s#>array['files',fid];
  if not office_private.valid_id(fid) or f is null or f?'deletedAt' or (f->>'tenantId') is distinct from p_company_id::text then
    perform office_private.fail('NOT_FOUND','File was not found.',404);
  end if;
  return f;
end;
$$;

create or replace function office_private.check_parent(s jsonb,p_company_id uuid,p_parent text,p_moving text default null)
returns void language plpgsql immutable set search_path=pg_catalog as $$
declare current_id text:=p_parent; seen text[]:='{}'; f jsonb;
begin
  while current_id is not null loop
    if current_id=any(seen) or current_id=p_moving or cardinality(seen)>=100 then
      perform office_private.fail('FOLDER_CYCLE','Folder cycle or excessive nesting.');
    end if;
    seen:=array_append(seen,current_id);
    f:=office_private.get_file(s,p_company_id,current_id);
    if f->>'kind'<>'folder' then perform office_private.fail('INVALID_PARENT','Parent must be a folder.'); end if;
    current_id:=f->>'parentId';
  end loop;
end;
$$;

create or replace function office_private.add_version(s jsonb,f jsonb,actor_id text)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select jsonb_set(s,array['versions',f->>'id'],
    coalesce(s#>array['versions',f->>'id'],'[]'::jsonb)||
    jsonb_build_array(jsonb_build_object('revision',f->'revision','createdAt',f->>'updatedAt',
      'actorId',actor_id,'content',f->'content','title',f->>'title')),true);
$$;

create or replace function public.office_request(p_company_id uuid,p_request jsonb,p_principal text default 'human')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  ctx jsonb; actor_id text; actor_role text; principal text; op text:=p_request->>'op';
  s jsonb; f jsonb; result jsonb; proposal jsonb; old jsonb; original jsonb; entity jsonb;
  fid text; pid text; newid text; receipt_key text; fingerprint text; memo jsonb;
  now_text text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  allowed text[]; required text[]; field text; enabled boolean; is_read boolean; can_write boolean;
  add_version boolean:=false; operation_file jsonb; original_bytes bytea; audit_event jsonb;
begin
  ctx:=public.office_host_context(p_company_id);
  actor_id:=ctx->>'actorId'; actor_role:=ctx->>'role';
  if not office_private.valid_id(actor_id) or actor_role is null or actor_role not in ('owner','editor','reader') then
    perform office_private.fail('FORBIDDEN','Invalid host identity.',403);
  end if;
  if p_principal not in ('human','ai') or p_principal is null then
    perform office_private.fail('INVALID_REQUEST','Invalid principal.');
  end if;
  -- A caller cannot turn a signed AI principal into a human by changing this argument.
  principal:=case when auth.jwt()#>>'{app_metadata,office_principal}'='ai' then 'ai' else p_principal end;
  select os.enabled into enabled from public.office_settings os where os.company_id=p_company_id for share;
  if enabled is distinct from true then perform office_private.fail('MODULE_DISABLED','Office is disabled for this company.',403); end if;
  if jsonb_typeof(p_request) is distinct from 'object' or op is null or octet_length(p_request::text)>26000000 then
    perform office_private.fail('INVALID_REQUEST','Invalid or excessive request.');
  end if;

  case op
    when 'list' then allowed:=array['op','query','parentId']; required:=array['op'];
    when 'read','versions','proposals','permissions','original' then allowed:=array['op','id']; required:=allowed;
    when 'recordExport' then allowed:=array['op','id','format']; required:=allowed;
    when 'create' then allowed:=array['op','title','kind','content','parentId','idempotencyKey']; required:=array['op','title','kind','idempotencyKey'];
    when 'import' then allowed:=array['op','title','content','original','idempotencyKey','parentId']; required:=array['op','title','content','original','idempotencyKey'];
    when 'save' then allowed:=array['op','id','expectedRevision','content','idempotencyKey']; required:=allowed;
    when 'rename' then allowed:=array['op','id','expectedRevision','title','idempotencyKey']; required:=allowed;
    when 'move' then allowed:=array['op','id','expectedRevision','parentId','idempotencyKey']; required:=allowed;
    when 'copy' then allowed:=array['op','id','title','idempotencyKey']; required:=allowed;
    when 'delete' then allowed:=array['op','id','expectedRevision','idempotencyKey']; required:=allowed;
    when 'restore' then allowed:=array['op','id','expectedRevision','revision','idempotencyKey']; required:=allowed;
    when 'link' then allowed:=array['op','id','expectedRevision','type','entityId','idempotencyKey']; required:=allowed;
    when 'propose' then allowed:=array['op','id','expectedRevision','content','summary','idempotencyKey']; required:=allowed;
    when 'approve' then allowed:=array['op','id','proposalId','expectedRevision','idempotencyKey']; required:=allowed;
    when 'reject' then allowed:=array['op','id','proposalId','idempotencyKey']; required:=allowed;
    else perform office_private.fail('INVALID_REQUEST','Unknown Office operation.');
  end case;
  if not p_request ?& required or exists(select 1 from jsonb_object_keys(p_request)t(k) where not(k=any(allowed))) then
    perform office_private.fail('INVALID_REQUEST','Missing or unexpected request fields.');
  end if;
  foreach field in array array['id','proposalId','entityId','idempotencyKey'] loop
    if p_request?field and (jsonb_typeof(p_request->field) is distinct from 'string' or not office_private.valid_id(p_request->>field)) then
      perform office_private.fail('INVALID_ID','Invalid identifier.');
    end if;
  end loop;
  if p_request?'entityId' and (p_request->>'entityId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform office_private.fail('INVALID_ID','Linked entity must have a UUID identifier.');
  end if;
  foreach field in array array['expectedRevision','revision'] loop
    if p_request?field and (jsonb_typeof(p_request->field) is distinct from 'number'
      or (p_request->>field)!~'^[0-9]{1,12}$' or (p_request->>field)::bigint<1) then
      perform office_private.fail('INVALID_REVISION','Invalid revision.');
    end if;
  end loop;
  if p_request?'parentId' and p_request->'parentId'<>'null'::jsonb
    and (jsonb_typeof(p_request->'parentId') is distinct from 'string' or not office_private.valid_id(p_request->>'parentId')) then
    perform office_private.fail('INVALID_ID','Invalid parent.');
  end if;
  if p_request?'title' and (jsonb_typeof(p_request->'title') is distinct from 'string'
    or length(trim(p_request->>'title')) not between 1 and 240 or (p_request->>'title')~'[[:cntrl:]]') then
    perform office_private.fail('INVALID_TEXT','Invalid title.');
  end if;
  if p_request?'summary' and (jsonb_typeof(p_request->'summary') is distinct from 'string'
    or length(trim(p_request->>'summary')) not between 1 and 16384) then
    perform office_private.fail('INVALID_TEXT','Invalid summary.');
  end if;
  if p_request?'query' and (jsonb_typeof(p_request->'query') is distinct from 'string' or length(p_request->>'query')>240) then
    perform office_private.fail('INVALID_REQUEST','Invalid query.');
  end if;
  if p_request?'content' and office_private.valid_content(p_request->'content') is distinct from true then
    perform office_private.fail('INVALID_CONTENT','Content is invalid, unsupported, or exceeds limits.');
  end if;
  is_read:=op in ('list','read','versions','proposals','permissions','original','recordExport');
  if not is_read and (actor_role='reader' or public.office_host_write_allowed(p_company_id) is distinct from true) then
    perform office_private.fail('FORBIDDEN','Write permission or host capability required.',403);
  end if;
  if principal='ai' and not(is_read or op='propose') then
    perform office_private.fail('HUMAN_APPROVAL_REQUIRED','AI may read and propose; a human must apply changes.',403);
  end if;
  insert into office_private.tenant_state(company_id) values(p_company_id) on conflict(company_id) do nothing;
  select ts.state into s from office_private.tenant_state ts where ts.company_id=p_company_id for update;

  if p_request?'idempotencyKey' then
    receipt_key:=actor_id||':'||(p_request->>'idempotencyKey');
    fingerprint:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');
    memo:=s#>array['receipts',receipt_key];
    if memo is not null then
      if memo->>'fingerprint'<>fingerprint then
        perform office_private.fail('IDEMPOTENCY_CONFLICT','Operation key was already used for a different request.',409);
      end if;
      s:=jsonb_set(s,'{audit}',(s->'audit')||jsonb_build_array(jsonb_build_object(
        'id',gen_random_uuid(),'at',now_text,'actorId',actor_id,'principal',principal,
        'operation','idempotency.replay','details',jsonb_build_object('operation',op))));
      update office_private.tenant_state set state=s where company_id=p_company_id;
      return memo->'response';
    end if;
  end if;

  if op='list' then
    if p_request->>'parentId' is not null then perform office_private.check_parent(s,p_company_id,p_request->>'parentId'); end if;
    select jsonb_build_object('files',coalesce(jsonb_agg(value || '{"content":null}'::jsonb order by value->>'updatedAt' desc),'[]'::jsonb))
    into result from jsonb_each(s->'files')
    where not value?'deletedAt' and value->>'tenantId'=p_company_id::text
      and (not p_request?'parentId' or (value->>'parentId') is not distinct from (p_request->>'parentId'))
      and (not p_request?'query' or position(lower(p_request->>'query') in lower(value->>'title'))>0);

  elsif op in ('create','import') then
    if (select count(*) from jsonb_each(s->'files') where not value?'deletedAt')>=10000 then
      perform office_private.fail('FILE_LIMIT','Company file quota reached.');
    end if;
    if op='create' then
      if coalesce(p_request->>'kind','') not in ('document','spreadsheet','folder') then
        perform office_private.fail('INVALID_REQUEST','Invalid file kind.');
      end if;
      if (p_request->>'kind'='folder' and p_request?'content')
        or (p_request->>'kind'<>'folder' and (p_request#>>'{content,kind}') is distinct from (p_request->>'kind')) then
        perform office_private.fail('INVALID_CONTENT','Kind mismatch.');
      end if;
      perform office_private.check_parent(s,p_company_id,p_request->>'parentId');
    end if;
    fid:=gen_random_uuid()::text;
    f:=jsonb_build_object('id',fid,'tenantId',p_company_id,'ownerId',actor_id,
      'title',trim(p_request->>'title'),'kind',
      case when op='import' then p_request#>>'{content,kind}' else p_request->>'kind' end,
      'parentId',p_request->>'parentId','revision',1,'content',coalesce(p_request->'content','null'::jsonb),
      'updatedAt',now_text,'link',null);
    if op='import' then
      perform office_private.check_parent(s,p_company_id,p_request->>'parentId');
      original:=p_request->'original';
      if jsonb_typeof(original) is distinct from 'object'
        or not original ?& array['name','mime','size','sha256','base64']
        or exists(select 1 from jsonb_object_keys(original)t(k) where k not in ('name','mime','size','sha256','base64')) then
        perform office_private.fail('INVALID_REQUEST','Invalid original.');
      end if;
      foreach field in array array['name','mime','sha256','base64'] loop
        if jsonb_typeof(original->field) is distinct from 'string' then
          perform office_private.fail('INVALID_ORIGINAL','Invalid original metadata.');
        end if;
      end loop;
      if jsonb_typeof(original->'size') is distinct from 'number'
        or (original->>'size')!~'^[0-9]{1,8}$'
        or (original->>'size')::bigint not between 1 and 12582912
        or length(original->>'name') not between 1 and 240
        or length(original->>'mime') not between 1 and 160
        or length(original->>'base64')>16777216
        or (original->>'base64')!~'^[A-Za-z0-9+/=]+$'
        or (original->>'sha256')!~'^[0-9a-f]{64}$' then
        perform office_private.fail('FILE_LIMIT','Original metadata or size is invalid.');
      end if;
      begin
        original_bytes:=decode(original->>'base64','base64');
      exception when invalid_parameter_value then
        perform office_private.fail('INVALID_ORIGINAL','Original base64 encoding is invalid.');
      end;
      if octet_length(original_bytes) not between 1 and 12582912
        or original->>'size'<>octet_length(original_bytes)::text
        or original->>'sha256'<>encode(sha256(original_bytes),'hex') then
        perform office_private.fail('INVALID_ORIGINAL','Original integrity check failed.');
      end if;
      f:=f||jsonb_build_object('original',original-'base64');
      s:=jsonb_set(s,array['originals',fid],jsonb_build_object(
        'name',original->>'name','mime',original->>'mime','base64',original->>'base64'),true);
    end if;
    s:=jsonb_set(s,array['files',fid],f,true);
    s:=office_private.add_version(s,f,actor_id);
    operation_file:=f; result:=jsonb_build_object('file',f);

  else
    fid:=p_request->>'id';
    f:=office_private.get_file(s,p_company_id,fid);
    operation_file:=f;
    if p_request?'expectedRevision' and (f->>'revision')::bigint<>(p_request->>'expectedRevision')::bigint then
      perform office_private.fail('CONFLICT','A newer version exists. Reload before saving.',409);
    end if;
    case op
      when 'read' then result:=jsonb_build_object('file',f);
      when 'permissions' then
        can_write:=actor_role<>'reader' and public.office_host_write_allowed(p_company_id) is true;
        result:=jsonb_build_object('permissions',jsonb_build_object('role',actor_role,'ownerId',f->>'ownerId',
          'canWrite',can_write,'canDelete',can_write and (actor_role='owner' or (actor_role='editor' and f->>'ownerId'=actor_id))));
      when 'versions' then result:=jsonb_build_object('versions',coalesce(s#>array['versions',fid],'[]'::jsonb));
      when 'proposals' then
        select jsonb_build_object('proposals',coalesce(jsonb_agg(value),'[]'::jsonb))
        into result from jsonb_each(s->'proposals') where value->>'fileId'=fid;
      when 'original' then
        result:=s#>array['originals',fid];
        if result is null then perform office_private.fail('NOT_FOUND','Original is not available.',404); end if;
      when 'recordExport' then
        if coalesce(p_request->>'format','') not in ('docx','xlsx','csv','txt','html','pdf','print') then
          perform office_private.fail('UNSUPPORTED_FORMAT','Unsupported format.');
        end if;
        result:='{}'::jsonb;
      when 'save' then
        if (p_request#>>'{content,kind}') is distinct from (f->>'kind') then
          perform office_private.fail('INVALID_CONTENT','Kind cannot change.');
        end if;
        f:=f||jsonb_build_object('content',p_request->'content'); add_version:=true;
      when 'rename' then f:=f||jsonb_build_object('title',trim(p_request->>'title')); add_version:=true;
      when 'move' then
        perform office_private.check_parent(s,p_company_id,p_request->>'parentId',fid);
        f:=f||jsonb_build_object('parentId',p_request->>'parentId'); add_version:=true;
      when 'copy' then
        if f->>'kind'='folder' then perform office_private.fail('UNSUPPORTED_OPERATION','Folder copying is not supported.'); end if;
        if (select count(*) from jsonb_each(s->'files') where not value?'deletedAt')>=10000 then
          perform office_private.fail('FILE_LIMIT','Company file quota reached.');
        end if;
        newid:=gen_random_uuid()::text;
        f:=f||jsonb_build_object('id',newid,'ownerId',actor_id,'title',trim(p_request->>'title'),'revision',1,'updatedAt',now_text);
        s:=jsonb_set(s,array['files',newid],f,true);
        if s#>array['originals',fid] is not null then s:=jsonb_set(s,array['originals',newid],s#>array['originals',fid],true); end if;
        s:=office_private.add_version(s,f,actor_id); operation_file:=f; result:=jsonb_build_object('file',f);
      when 'delete' then
        if actor_role<>'owner' and f->>'ownerId'<>actor_id then
          perform office_private.fail('FORBIDDEN','File owner or company administrator required.',403);
        end if;
        if exists(select 1 from jsonb_each(s->'files') where not value?'deletedAt' and value->>'parentId'=fid) then
          perform office_private.fail('FOLDER_NOT_EMPTY','Move or delete folder contents first.',409);
        end if;
        f:=f||jsonb_build_object('deletedAt',now_text); add_version:=true; result:=jsonb_build_object('deleted',true);
      when 'restore' then
        select value into old from jsonb_array_elements(coalesce(s#>array['versions',fid],'[]'::jsonb))
        where value->>'revision'=p_request->>'revision';
        if old is null then perform office_private.fail('NOT_FOUND','Version was not found.',404); end if;
        f:=f||jsonb_build_object('content',old->'content','title',old->>'title'); add_version:=true;
      when 'link' then
        if coalesce(p_request->>'type','') not in ('job','customer') then
          perform office_private.fail('INVALID_REQUEST','Unsupported linked entity.');
        end if;
        entity:=public.office_host_resolve_entity(p_company_id,p_request->>'type',(p_request->>'entityId')::uuid);
        f:=f||jsonb_build_object('link',entity||jsonb_build_object('type',p_request->>'type')); add_version:=true;
      when 'propose' then
        if (p_request#>>'{content,kind}') is distinct from (f->>'kind') then
          perform office_private.fail('INVALID_CONTENT','Kind cannot change.');
        end if;
        pid:=gen_random_uuid()::text;
        proposal:=jsonb_build_object('id',pid,'fileId',fid,'baseRevision',f->'revision','status','pending',
          'summary',trim(p_request->>'summary'),'content',p_request->'content','createdBy',actor_id,'createdAt',now_text);
        s:=jsonb_set(s,array['proposals',pid],proposal,true); result:=jsonb_build_object('proposal',proposal);
      when 'approve','reject' then
        if principal<>'human' then perform office_private.fail('HUMAN_APPROVAL_REQUIRED','Human approval required.',403); end if;
        pid:=p_request->>'proposalId'; proposal:=s#>array['proposals',pid];
        if proposal is null or proposal->>'fileId'<>fid then perform office_private.fail('NOT_FOUND','Proposal was not found.',404); end if;
        if proposal->>'status'<>'pending' then perform office_private.fail('PROPOSAL_FINAL','Proposal has already been resolved.',409); end if;
        if op='approve' then
          if proposal->>'baseRevision'<>f->>'revision' then
            perform office_private.fail('CONFLICT','Proposal is based on an older version.',409);
          end if;
          if office_private.valid_content(proposal->'content') is distinct from true
            or (proposal#>>'{content,kind}') is distinct from (f->>'kind') then
            perform office_private.fail('INVALID_CONTENT','Invalid proposal content.');
          end if;
          f:=f||jsonb_build_object('content',proposal->'content'); add_version:=true;
        end if;
        proposal:=proposal||jsonb_build_object('status',case when op='approve' then 'applied' else 'rejected' end);
        s:=jsonb_set(s,array['proposals',pid],proposal); result:=jsonb_build_object('proposal',proposal);
      else perform office_private.fail('INVALID_REQUEST','Unknown operation.');
    end case;
    if add_version then
      f:=f||jsonb_build_object('revision',(f->>'revision')::bigint+1,'updatedAt',now_text);
      s:=jsonb_set(s,array['files',fid],f);
      s:=office_private.add_version(s,f,actor_id); operation_file:=f;
      if op<>'delete' then result:=coalesce(result,'{}'::jsonb)||jsonb_build_object('file',f); end if;
    end if;
  end if;

  audit_event:=jsonb_build_object('id',gen_random_uuid(),'at',now_text,'actorId',actor_id,'principal',principal,'operation',op);
  if operation_file is not null then audit_event:=audit_event||jsonb_build_object('fileId',operation_file->>'id','revision',operation_file->'revision'); end if;
  if op='recordExport' then audit_event:=audit_event||jsonb_build_object('details',jsonb_build_object('format',p_request->>'format')); end if;
  s:=jsonb_set(s,'{audit}',(s->'audit')||jsonb_build_array(audit_event));
  if receipt_key is not null then
    s:=jsonb_set(s,array['receipts',receipt_key],jsonb_build_object('fingerprint',fingerprint,'response',result),true);
  end if;
  -- Bounded reference persistence; versions and originals count toward the tenant quota.
  -- Reads and audits remain available when the content quota is reached.
  if not is_read and octet_length((s-'audit')::text)>67108864 then
    perform office_private.fail('TENANT_QUOTA','Office workspace exceeds the 64 MiB reference storage quota.',413);
  end if;
  update office_private.tenant_state set state=s where company_id=p_company_id;
  return result;
end;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC by default; revoke privileged helpers explicitly.
revoke all on all functions in schema office_private from public,anon,authenticated;
revoke all on function public.office_host_context(uuid),public.office_host_can_configure(uuid),
  public.office_host_write_allowed(uuid),public.office_host_resolve_entity(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.office_is_member(uuid),public.office_set_enabled(uuid,boolean),
  public.office_request(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.office_is_member(uuid),public.office_set_enabled(uuid,boolean),
  public.office_request(uuid,jsonb,text) to authenticated;
commit;
