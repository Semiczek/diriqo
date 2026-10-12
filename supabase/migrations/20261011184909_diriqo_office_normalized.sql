-- Additive Office persistence v2. Apply AFTER office-core and the host adapter.
-- Legacy tenant_state is retained as a frozen, tenant-scoped rollback snapshot.
-- No application role receives direct table access. No remote service is used.
begin;
lock table office_private.tenant_state in access exclusive mode;

create table if not exists office_private.files (
 company_id uuid not null references public.companies(id),
 id text not null check(office_private.valid_id(id)),
 metadata jsonb not null,
 content jsonb,
 kind text generated always as (metadata->>'kind') stored,
 parent_id text generated always as (metadata->>'parentId') stored,
 revision bigint generated always as ((metadata->>'revision')::bigint) stored,
 owner_id text generated always as (metadata->>'ownerId') stored,
 title text generated always as (metadata->>'title') stored,
 deleted boolean generated always as (metadata?'deletedAt') stored,
 primary key(company_id,id),
 check((jsonb_typeof(metadata)='object' and metadata ?& array['id','tenantId','kind','revision','ownerId','title','updatedAt','parentId','link'] and not metadata?'content'
   and metadata->>'id'=id and metadata->>'tenantId'=company_id::text
   and metadata->>'kind' in ('document','spreadsheet','folder')
   and (metadata->>'revision')::bigint>0 and office_private.valid_id(metadata->>'ownerId')) is true)
);
create index if not exists office_files_parent on office_private.files(company_id,parent_id,id) where not deleted;
create index if not exists office_files_live on office_private.files(company_id,id) where not deleted;

create table if not exists office_private.versions (
 company_id uuid not null,
 file_id text not null,
 revision bigint not null check(revision>0),
 metadata jsonb not null,
 content jsonb,
 primary key(company_id,file_id,revision),
 foreign key(company_id,file_id) references office_private.files(company_id,id),
 check((jsonb_typeof(metadata)='object' and metadata ?& array['revision','createdAt','actorId','title'] and not metadata?'content' and (metadata->>'revision')::bigint=revision) is true)
);
create table if not exists office_private.proposals (
 company_id uuid not null,
 id text not null check(office_private.valid_id(id)),
 file_id text not null,
 metadata jsonb not null,
 content jsonb not null,
 primary key(company_id,id),
 foreign key(company_id,file_id) references office_private.files(company_id,id),
 check((jsonb_typeof(metadata)='object' and metadata ?& array['id','fileId','status','baseRevision','summary','createdBy','createdAt'] and not metadata?'content' and metadata->>'id'=id
   and metadata->>'fileId'=file_id and metadata->>'status' in ('pending','applied','rejected')) is true)
);
create index if not exists office_proposals_file on office_private.proposals(company_id,file_id,id);
create table if not exists office_private.original_blobs (
 company_id uuid not null references public.companies(id),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 bytes bytea not null check(octet_length(bytes) between 1 and 12582912),
 size integer generated always as (octet_length(bytes)) stored,
 primary key(company_id,sha256),
 unique(company_id,sha256,size),
 check(encode(sha256(bytes),'hex')=sha256)
);
create table if not exists office_private.file_originals (
 company_id uuid not null,
 file_id text not null,
 name text not null check(length(name) between 1 and 240),
 mime text not null check(length(mime) between 1 and 160),
 size integer not null check(size between 1 and 12582912),
 sha256 text not null,
 primary key(company_id,file_id),
 foreign key(company_id,file_id) references office_private.files(company_id,id),
 foreign key(company_id,sha256,size) references office_private.original_blobs(company_id,sha256,size)
);
create table if not exists office_private.receipts (
 company_id uuid not null references public.companies(id),
 actor_id text not null check(office_private.valid_id(actor_id)),
 key text not null check(office_private.valid_id(key)),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 response jsonb,
 file_id text,
 file_revision bigint,
 proposal_id text,
 primary key(company_id,actor_id,key),
 foreign key(company_id,file_id,file_revision) references office_private.versions(company_id,file_id,revision),
 foreign key(company_id,proposal_id) references office_private.proposals(company_id,id),
 check((file_id is null)=(file_revision is null))
);
create table if not exists office_private.audit_events (
 company_id uuid not null references public.companies(id),
 id text not null check(office_private.valid_id(id)),
 sequence bigint generated always as identity,
 event jsonb not null,
 file_id text generated always as (event->>'fileId') stored,
 primary key(company_id,id),
 foreign key(company_id,file_id) references office_private.files(company_id,id),
 check((jsonb_typeof(event)='object' and event ?& array['id','actorId','at','principal','operation'] and event->>'id'=id) is true)
);
create index if not exists office_audit_sequence on office_private.audit_events(company_id,sequence);
create table if not exists office_private.topology_locks (
 company_id uuid primary key references public.companies(id)
);
create table if not exists office_private.persistence_migrations (
 company_id uuid primary key references public.companies(id),
 active boolean not null default true,
 migrated_at timestamptz not null default now(),
 snapshot_sha256 text,
 legacy_definition_sha256 text,
 legacy_counts jsonb,
 audit_boundary bigint not null default 0,
 rolled_back_at timestamptz,
 check(snapshot_sha256 is null or snapshot_sha256 ~ '^[a-f0-9]{64}$')
);

do $$
declare name text;
begin
 foreach name in array array['files','versions','proposals','original_blobs','file_originals','receipts','audit_events','topology_locks','persistence_migrations'] loop
  execute format('alter table office_private.%I enable row level security',name);
  execute format('revoke all on office_private.%I from public,anon,authenticated,service_role',name);
 end loop;
end;$$;

create or replace function office_private.file_v2(p_company_id uuid,p_file_id text,p_write boolean default false,p_include_content boolean default true)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare value jsonb;
begin
 if not office_private.valid_id(p_file_id) then perform office_private.fail('NOT_FOUND','File was not found.',404);end if;
 if p_write then
  select f.metadata||jsonb_build_object('content',case when p_include_content then f.content else 'null'::jsonb end) into value from office_private.files f
  where f.company_id=p_company_id and f.id=p_file_id and not f.deleted for update;
 else
  select f.metadata||jsonb_build_object('content',case when p_include_content then f.content else 'null'::jsonb end) into value from office_private.files f
  where f.company_id=p_company_id and f.id=p_file_id and not f.deleted for share;
 end if;
 if value is null then perform office_private.fail('NOT_FOUND','File was not found.',404);end if;
 return value;
end;$$;

create or replace function office_private.check_parent_v2(p_company_id uuid,p_parent text,p_moving text default null)
returns void language plpgsql set search_path=pg_catalog as $$
declare current_id text:=p_parent;seen text[]:='{}';row_value record;
begin
 while current_id is not null loop
  if current_id=any(seen) or current_id=p_moving or cardinality(seen)>=100 then
   perform office_private.fail('FOLDER_CYCLE','Folder cycle or excessive nesting.');
  end if;
  seen:=array_append(seen,current_id);
  select f.kind,f.parent_id into row_value from office_private.files f
  where f.company_id=p_company_id and f.id=current_id and not f.deleted;
  if not found then perform office_private.fail('NOT_FOUND','File was not found.',404);end if;
  if row_value.kind<>'folder' then perform office_private.fail('INVALID_PARENT','Parent must be a folder.');end if;
  current_id:=row_value.parent_id;
 end loop;
end;$$;

create or replace function office_private.version_v2(p_company_id uuid,f jsonb,p_actor_id text)
returns void language sql set search_path=pg_catalog as $$
 insert into office_private.versions(company_id,file_id,revision,metadata,content)
 values(p_company_id,f->>'id',(f->>'revision')::bigint,jsonb_build_object('revision',f->'revision',
  'createdAt',f->>'updatedAt','actorId',p_actor_id,'title',f->>'title'),f->'content');
$$;

-- Only migration/maintenance calls this full reconstruction. Runtime requests never
-- collect a tenant's content into one value. Used to verify a bounded legacy snapshot.
create or replace function office_private.normalized_snapshot(p_company_id uuid)
returns jsonb language sql set search_path=pg_catalog as $$
 select jsonb_build_object(
  'files',coalesce((select jsonb_object_agg(f.id,f.metadata||jsonb_build_object('content',f.content)) from office_private.files f where f.company_id=p_company_id),'{}'::jsonb),
  'versions',coalesce((select jsonb_object_agg(v.file_id,v.items) from
   (select file_id,jsonb_agg(metadata||jsonb_build_object('content',content) order by revision)items
    from office_private.versions where company_id=p_company_id group by file_id)v),'{}'::jsonb),
  'proposals',coalesce((select jsonb_object_agg(p.id,p.metadata||jsonb_build_object('content',p.content)) from office_private.proposals p where p.company_id=p_company_id),'{}'::jsonb),
  'originals',coalesce((select jsonb_object_agg(o.file_id,jsonb_build_object('name',o.name,'mime',o.mime,'base64',replace(encode(b.bytes,'base64'),E'\n','')))
    from office_private.file_originals o join office_private.original_blobs b on b.company_id=o.company_id and b.sha256=o.sha256 where o.company_id=p_company_id),'{}'::jsonb),
  'receipts',coalesce((select jsonb_object_agg(r.actor_id||':'||r.key,jsonb_build_object('fingerprint',r.fingerprint,'response',r.response)) from office_private.receipts r where r.company_id=p_company_id),'{}'::jsonb),
  'audit',coalesce((select jsonb_agg(a.event order by a.sequence) from office_private.audit_events a where a.company_id=p_company_id),'[]'::jsonb)
 );
$$;

do $$
declare tenant record;item record;v jsonb;expected jsonb;definition text;digest text;raw bytea;meta jsonb;
begin
 if to_regprocedure('office_private.normalized_version()') is not null then
  if exists(select 1 from office_private.persistence_migrations where not active) then
   raise exception 'OFFICE_MIGRATION_ROLLED_BACK_REVIEW_REQUIRED';
  end if;
  return;
 end if;
 if exists(select 1 from office_private.files) or exists(select 1 from office_private.persistence_migrations) then
  raise exception 'OFFICE_MIGRATION_UNEXPECTED_NORMALIZED_DATA';
 end if;
 definition:=pg_get_functiondef('public.office_request(uuid,jsonb,text)'::regprocedure);
 -- Retain the genuine pre-cutover implementation as a revoked private function.
 execute replace(definition,'FUNCTION public.office_request(','FUNCTION office_private.office_request_legacy(');
 for tenant in select company_id,state from office_private.tenant_state order by company_id loop
  expected:=tenant.state;
  if jsonb_typeof(expected)<>'object' or not expected ?& array['files','versions','proposals','originals','receipts','audit']
   or exists(select 1 from jsonb_object_keys(expected)t(k) where k not in ('files','versions','proposals','originals','receipts','audit')) then
   raise exception 'OFFICE_MIGRATION_INVALID_LEGACY_SHAPE';
  end if;
  for item in select key,value from jsonb_each(expected->'files') loop
   if item.value->>'id' is distinct from item.key or item.value->>'tenantId' is distinct from tenant.company_id::text
    or (item.value->>'kind'<>'folder' and office_private.valid_content(item.value->'content') is distinct from true) then
    raise exception 'OFFICE_MIGRATION_INVALID_FILE_SCOPE';
   end if;
   insert into office_private.files(company_id,id,metadata,content) values(tenant.company_id,item.key,item.value-'content',item.value->'content');
  end loop;
  for item in select key,value from jsonb_each(expected->'versions') loop
   for v in select value from jsonb_array_elements(item.value) loop
    insert into office_private.versions(company_id,file_id,revision,metadata,content)
    values(tenant.company_id,item.key,(v->>'revision')::bigint,v-'content',v->'content');
   end loop;
  end loop;
  for item in select key,value from jsonb_each(expected->'proposals') loop
   insert into office_private.proposals(company_id,id,file_id,metadata,content)
   values(tenant.company_id,item.key,item.value->>'fileId',item.value-'content',item.value->'content');
  end loop;
  for item in select key,value from jsonb_each(expected->'originals') loop
   raw:=decode(item.value->>'base64','base64');digest:=encode(sha256(raw),'hex');
   meta:=expected#>array['files',item.key,'original'];
   if meta is null or meta->>'sha256' is distinct from digest or (meta->>'size')::integer is distinct from octet_length(raw)
     or meta->>'name' is distinct from item.value->>'name' or meta->>'mime' is distinct from item.value->>'mime' then
    raise exception 'OFFICE_MIGRATION_ORIGINAL_INTEGRITY';
   end if;
   insert into office_private.original_blobs(company_id,sha256,bytes) values(tenant.company_id,digest,raw) on conflict do nothing;
   if (select bytes from office_private.original_blobs where company_id=tenant.company_id and sha256=digest) is distinct from raw then
    raise exception 'OFFICE_MIGRATION_BLOB_COLLISION';
   end if;
   insert into office_private.file_originals(company_id,file_id,name,mime,size,sha256)
   values(tenant.company_id,item.key,item.value->>'name',item.value->>'mime',octet_length(raw),digest);
   expected:=jsonb_set(expected,array['originals',item.key,'base64'],to_jsonb(replace(encode(raw,'base64'),E'\n','')));
  end loop;
  for item in select key,value from jsonb_each(expected->'receipts') loop
   if array_length(string_to_array(item.key,':'),1)<>2 or not item.value ?& array['fingerprint','response'] then
    raise exception 'OFFICE_MIGRATION_RECEIPT_SHAPE';
   end if;
   if item.value#>'{response,file}' is not null then
    meta:=item.value#>'{response,file}';
    if meta->>'tenantId' is distinct from tenant.company_id::text
      or not exists(select 1 from office_private.versions v where v.company_id=tenant.company_id and v.file_id=meta->>'id' and v.revision=(meta->>'revision')::bigint)
    then raise exception 'OFFICE_MIGRATION_RECEIPT_SCOPE';end if;
   end if;
   if item.value#>'{response,proposal}' is not null then
    meta:=item.value#>'{response,proposal}';
    if not exists(select 1 from office_private.proposals q where q.company_id=tenant.company_id and q.id=meta->>'id' and q.file_id=meta->>'fileId')
    then raise exception 'OFFICE_MIGRATION_RECEIPT_SCOPE';end if;
   end if;
   insert into office_private.receipts(company_id,actor_id,key,fingerprint,response)
   values(tenant.company_id,split_part(item.key,':',1),split_part(item.key,':',2),item.value->>'fingerprint',item.value->'response');
  end loop;
  for v in select value from jsonb_array_elements(expected->'audit') loop
   insert into office_private.audit_events(company_id,id,event) values(tenant.company_id,v->>'id',v);
  end loop;
  for item in select id,parent_id from office_private.files where company_id=tenant.company_id and not deleted loop
   perform office_private.check_parent_v2(tenant.company_id,item.parent_id,item.id);
  end loop;
  if office_private.normalized_snapshot(tenant.company_id) is distinct from expected then
   raise exception 'OFFICE_MIGRATION_CONTENT_VERIFICATION_FAILED';
  end if;
  insert into office_private.persistence_migrations(company_id,snapshot_sha256,legacy_definition_sha256,legacy_counts,audit_boundary)
  values(tenant.company_id,encode(sha256(convert_to(tenant.state::text,'UTF8')),'hex'),encode(sha256(convert_to(definition,'UTF8')),'hex'),
   jsonb_build_object('files',(select count(*) from office_private.files where company_id=tenant.company_id),
    'versions',(select count(*) from office_private.versions where company_id=tenant.company_id),
    'audit',(select count(*) from office_private.audit_events where company_id=tenant.company_id)),
   coalesce((select max(sequence) from office_private.audit_events where company_id=tenant.company_id),0));
 end loop;
end;$$;

create or replace function office_private.normalized_version() returns integer language sql immutable set search_path=pg_catalog as $$select 2$$;

create or replace function office_private.freeze_legacy_state()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if not exists(select 1 from office_private.persistence_migrations m where m.company_id=coalesce(new.company_id,old.company_id) and not m.active) then
  raise exception 'OFFICE_LEGACY_STATE_FROZEN';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
drop trigger if exists office_legacy_frozen on office_private.tenant_state;
create trigger office_legacy_frozen before insert or update or delete on office_private.tenant_state for each row execute function office_private.freeze_legacy_state();

-- Before any post-cutover request, an administrator can restore this company's
-- genuine legacy implementation routing. Never discards new Office activity.
create or replace function office_private.rollback_normalized_company(p_company_id uuid)
returns void language plpgsql set search_path=pg_catalog as $$
declare migration office_private.persistence_migrations%rowtype;
begin
 perform 1 from public.office_settings where company_id=p_company_id for update;
 select * into migration from office_private.persistence_migrations where company_id=p_company_id for update;
 if not found or not migration.active or migration.snapshot_sha256 is null then raise exception 'OFFICE_ROLLBACK_NO_SNAPSHOT';end if;
 if exists(select 1 from office_private.audit_events where company_id=p_company_id and sequence>migration.audit_boundary) then raise exception 'OFFICE_ROLLBACK_NEW_ACTIVITY';end if;
 if (select encode(sha256(convert_to(state::text,'UTF8')),'hex') from office_private.tenant_state where company_id=p_company_id) is distinct from migration.snapshot_sha256 then raise exception 'OFFICE_ROLLBACK_SNAPSHOT_CHANGED';end if;
 update office_private.persistence_migrations set active=false,rolled_back_at=clock_timestamp() where company_id=p_company_id;
end;$$;

create or replace function office_private.immutable_row()
returns trigger language plpgsql set search_path=pg_catalog as $$begin raise exception 'OFFICE_IMMUTABLE_RECORD';end;$$;
drop trigger if exists office_version_immutable on office_private.versions;
create trigger office_version_immutable before update or delete on office_private.versions for each row execute function office_private.immutable_row();
drop trigger if exists office_blob_immutable on office_private.original_blobs;
create trigger office_blob_immutable before update or delete on office_private.original_blobs for each row execute function office_private.immutable_row();
drop trigger if exists office_original_ref_immutable on office_private.file_originals;
create trigger office_original_ref_immutable before update or delete on office_private.file_originals for each row execute function office_private.immutable_row();
drop trigger if exists office_audit_immutable on office_private.audit_events;
create trigger office_audit_immutable before update or delete on office_private.audit_events for each row execute function office_private.immutable_row();

-- Content and identity are immutable; a pending proposal has one terminal state.
create or replace function office_private.proposal_transition_v2()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception 'OFFICE_IMMUTABLE_RECORD';end if;
 if (new.company_id,new.id,new.file_id,new.content,new.metadata-'status') is distinct from
    (old.company_id,old.id,old.file_id,old.content,old.metadata-'status') or old.metadata->>'status'<>'pending'
    or new.metadata->>'status' not in ('applied','rejected') then raise exception 'OFFICE_IMMUTABLE_RECORD';end if;
 return new;
end;$$;
drop trigger if exists office_proposal_transition on office_private.proposals;
create trigger office_proposal_transition before update or delete on office_private.proposals for each row execute function office_private.proposal_transition_v2();

-- A receipt may be completed once, in its claiming transaction. A deferred check
-- prevents an accidental committed placeholder from allowing a second execution.
create or replace function office_private.receipt_transition_v2()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception 'OFFICE_IMMUTABLE_RECORD';end if;
 if old.response is not null or new.response is null or
    (new.company_id,new.actor_id,new.key,new.fingerprint) is distinct from (old.company_id,old.actor_id,old.key,old.fingerprint)
 then raise exception 'OFFICE_IMMUTABLE_RECORD';end if;
 return new;
end;$$;
create or replace function office_private.receipt_complete_v2()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if exists(select 1 from office_private.receipts r where r.company_id=new.company_id and r.actor_id=new.actor_id and r.key=new.key and r.response is null)
 then raise exception 'OFFICE_INCOMPLETE_RECEIPT';end if;
 return null;
end;$$;
drop trigger if exists office_receipt_transition on office_private.receipts;
create trigger office_receipt_transition before update or delete on office_private.receipts for each row execute function office_private.receipt_transition_v2();
drop trigger if exists office_receipt_complete on office_private.receipts;
create constraint trigger office_receipt_complete after insert or update on office_private.receipts deferrable initially deferred for each row execute function office_private.receipt_complete_v2();

create or replace function public.office_request(p_company_id uuid,p_request jsonb,p_principal text default 'human')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
<<office_rpc>>
declare
  ctx jsonb; actor_id text; actor_role text; principal text; op text:=p_request->>'op';
  receipt office_private.receipts%rowtype; items jsonb; compact_response jsonb; next_cursor text;
  item_count bigint; result_bytes bigint; page_limit integer:=50;
  f jsonb; result jsonb; proposal jsonb; old jsonb; original jsonb; entity jsonb;
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
    when 'listFiles' then allowed:=array['op','query','parentId','afterId','limit','foldersOnly']; required:=array['op'];
    when 'listVersions' then allowed:=array['op','id','beforeRevision','limit']; required:=array['op','id'];
    when 'readVersion' then allowed:=array['op','id','revision']; required:=allowed;
    when 'listProposals' then allowed:=array['op','id','afterId','limit']; required:=array['op','id'];
    when 'readProposal' then allowed:=array['op','id','proposalId']; required:=allowed;
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
  foreach field in array array['id','proposalId','entityId','idempotencyKey','afterId'] loop
    if p_request?field and (jsonb_typeof(p_request->field) is distinct from 'string' or not office_private.valid_id(p_request->>field)) then
      perform office_private.fail('INVALID_ID','Invalid identifier.');
    end if;
  end loop;
  if p_request?'entityId' and (p_request->>'entityId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform office_private.fail('INVALID_ID','Linked entity must have a UUID identifier.');
  end if;
  foreach field in array array['expectedRevision','revision','beforeRevision'] loop
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
  if p_request?'limit' and (jsonb_typeof(p_request->'limit') is distinct from 'number' or (p_request->>'limit')!~'^[0-9]{1,3}$' or (p_request->>'limit')::integer not between 1 and 100) then
    perform office_private.fail('INVALID_REQUEST','Limit must be between 1 and 100.');
  end if;
  if p_request?'foldersOnly' and jsonb_typeof(p_request->'foldersOnly') is distinct from 'boolean' then perform office_private.fail('INVALID_REQUEST','Invalid folder filter.');end if;
  page_limit:=coalesce((p_request->>'limit')::integer,50);
  is_read:=op in ('listFiles','listVersions','readVersion','listProposals','readProposal','list','read','versions','proposals','permissions','original','recordExport');
  if not is_read and (actor_role='reader' or public.office_host_write_allowed(p_company_id) is distinct from true) then
    perform office_private.fail('FORBIDDEN','Write permission or host capability required.',403);
  end if;
  if principal='ai' and not(is_read or op='propose') then
    perform office_private.fail('HUMAN_APPROVAL_REQUIRED','AI may read and propose; a human must apply changes.',403);
  end if;
  -- The settings SHARE lock above also coordinates company rollback/disable.
  if exists(select 1 from office_private.persistence_migrations m where m.company_id=p_company_id and not m.active) then
    return office_private.office_request_legacy(p_company_id,p_request,p_principal);
  end if;
  insert into office_private.persistence_migrations(company_id) values(p_company_id) on conflict do nothing;

  if p_request?'idempotencyKey' then
    receipt_key:=p_request->>'idempotencyKey';
    fingerprint:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');
    insert into office_private.receipts(company_id,actor_id,key,fingerprint)
    values(p_company_id,actor_id,receipt_key,fingerprint) on conflict do nothing;
    select r.* into receipt from office_private.receipts r
    where r.company_id=p_company_id and r.actor_id=office_rpc.actor_id and r.key=receipt_key for update;
    if receipt.fingerprint<>fingerprint then
      perform office_private.fail('IDEMPOTENCY_CONFLICT','Operation key was already used for a different request.',409);
    end if;
    if receipt.response is not null then
      result:=receipt.response;
      if receipt.file_id is not null then
        select v.content into old from office_private.versions v where v.company_id=p_company_id and v.file_id=receipt.file_id and v.revision=receipt.file_revision;
        result:=jsonb_set(result,'{file,content}',coalesce(old,'null'::jsonb),true);
      end if;
      if receipt.proposal_id is not null then
        select q.content into old from office_private.proposals q where q.company_id=p_company_id and q.id=receipt.proposal_id;
        result:=jsonb_set(result,'{proposal,content}',old,true);
      end if;
      audit_event:=jsonb_build_object('id',gen_random_uuid(),'at',now_text,'actorId',actor_id,'principal',principal,
        'operation','idempotency.replay','details',jsonb_build_object('operation',op));
      insert into office_private.audit_events(company_id,id,event) values(p_company_id,audit_event->>'id',audit_event);
      return result;
    end if;
  end if;

  -- Serialize only topology changes; saves and reads on unrelated files have no
  -- exclusive company lock. Ancestor reads are stable under this topology lock.
  if op in ('create','import','copy','move','delete') then
    insert into office_private.topology_locks(company_id) values(p_company_id) on conflict do nothing;
    perform 1 from office_private.topology_locks where company_id=p_company_id for update;
  end if;

  if op in ('list','listFiles') then
    if p_request->>'parentId' is not null then perform office_private.check_parent_v2(p_company_id,p_request->>'parentId');end if;
    if op='list' then
      select count(*) into item_count from (select 1 from office_private.files x where x.company_id=p_company_id and not x.deleted
        and (not p_request?'parentId' or x.parent_id is not distinct from p_request->>'parentId')
        and (not p_request?'query' or position(lower(p_request->>'query') in lower(x.title))>0) limit 101) bounded;
      if item_count>100 then perform office_private.fail('PAGINATION_REQUIRED','Use listFiles for this workspace.',413);end if;
      select jsonb_build_object('files',coalesce(jsonb_agg(x.metadata||'{"content":null}'::jsonb order by x.metadata->>'updatedAt' desc,x.id),'[]'::jsonb)) into result
      from office_private.files x where x.company_id=p_company_id and not x.deleted
        and (not p_request?'parentId' or x.parent_id is not distinct from p_request->>'parentId')
        and (not p_request?'query' or position(lower(p_request->>'query') in lower(x.title))>0);
    else
      select coalesce(jsonb_agg(row_value order by id),'[]'::jsonb) into items from (
        select x.id,x.metadata||'{"content":null}'::jsonb as row_value from office_private.files x
        where x.company_id=p_company_id and not x.deleted
          and (not p_request?'parentId' or x.parent_id is not distinct from p_request->>'parentId')
          and (not p_request?'query' or position(lower(p_request->>'query') in lower(x.title))>0)
          and (not coalesce((p_request->>'foldersOnly')::boolean,false) or x.kind='folder')
          and (not p_request?'afterId' or x.id>p_request->>'afterId') order by x.id limit page_limit+1
      ) page;
      next_cursor:=null;
      if jsonb_array_length(items)>page_limit then items:=items-page_limit;next_cursor:=items#>>array[(page_limit-1)::text,'id'];end if;
      result:=jsonb_build_object('files',items,'nextCursor',next_cursor);
    end if;

  elsif op in ('create','import') then
    if op='create' then
      if coalesce(p_request->>'kind','') not in ('document','spreadsheet','folder') then perform office_private.fail('INVALID_REQUEST','Invalid file kind.');end if;
      if (p_request->>'kind'='folder' and p_request?'content') or
        (p_request->>'kind'<>'folder' and p_request#>>'{content,kind}' is distinct from p_request->>'kind') then
        perform office_private.fail('INVALID_CONTENT','Kind mismatch.');
      end if;
    end if;
    perform office_private.check_parent_v2(p_company_id,p_request->>'parentId');
    fid:=gen_random_uuid()::text;
    f:=jsonb_build_object('id',fid,'tenantId',p_company_id,'ownerId',actor_id,'title',trim(p_request->>'title'),
      'kind',case when op='import' then p_request#>>'{content,kind}' else p_request->>'kind' end,
      'parentId',p_request->>'parentId','revision',1,'content',coalesce(p_request->'content','null'::jsonb),'updatedAt',now_text,'link',null);
    if op='import' then
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
    end if;
    insert into office_private.files(company_id,id,metadata,content) values(p_company_id,fid,f-'content',f->'content');
    if op='import' then
      insert into office_private.original_blobs(company_id,sha256,bytes) values(p_company_id,original->>'sha256',original_bytes) on conflict do nothing;
      if not exists(select 1 from office_private.original_blobs b where b.company_id=p_company_id and b.sha256=original->>'sha256' and b.bytes=original_bytes) then
        perform office_private.fail('INVALID_ORIGINAL','Original digest collision.');
      end if;
      insert into office_private.file_originals(company_id,file_id,name,mime,size,sha256)
      values(p_company_id,fid,original->>'name',original->>'mime',(original->>'size')::integer,original->>'sha256');
    end if;
    perform office_private.version_v2(p_company_id,f,actor_id);
    operation_file:=f;result:=jsonb_build_object('file',f);

  else
    fid:=p_request->>'id';
    f:=office_private.file_v2(p_company_id,fid,not is_read,op not in ('versions','proposals','listVersions','listProposals','readVersion','readProposal','permissions','original','recordExport'));
    operation_file:=f;
    if p_request?'expectedRevision' and (f->>'revision')::bigint<>(p_request->>'expectedRevision')::bigint then
      perform office_private.fail('CONFLICT','A newer version exists. Reload before saving.',409);
    end if;
    case op
      when 'read' then result:=jsonb_build_object('file',f);
      when 'permissions' then
        can_write:=actor_role<>'reader' and public.office_host_write_allowed(p_company_id) is true;
        result:=jsonb_build_object('permissions',jsonb_build_object('role',actor_role,'ownerId',f->>'ownerId','canWrite',can_write,
          'canDelete',can_write and (actor_role='owner' or (actor_role='editor' and f->>'ownerId'=actor_id))));
      when 'versions' then
        result_bytes:=0;item_count:=0;
        for old in select v.metadata||jsonb_build_object('content',v.content) from office_private.versions v where v.company_id=p_company_id and v.file_id=fid limit 101 loop
          item_count:=item_count+1;result_bytes:=result_bytes+octet_length(old::text)+2;
          if item_count>100 or result_bytes>2998000 then perform office_private.fail('PAGINATION_REQUIRED','Use listVersions and readVersion.',413);end if;
        end loop;
        select jsonb_build_object('versions',coalesce(jsonb_agg(v.metadata||jsonb_build_object('content',v.content) order by v.revision),'[]'::jsonb))
        into result from office_private.versions v where v.company_id=p_company_id and v.file_id=fid;
      when 'listVersions' then
        select coalesce(jsonb_agg(metadata order by revision desc),'[]'::jsonb) into items from (
          select v.revision,v.metadata from office_private.versions v where v.company_id=p_company_id and v.file_id=fid
            and (not p_request?'beforeRevision' or v.revision<(p_request->>'beforeRevision')::bigint) order by v.revision desc limit page_limit+1
        ) page;
        next_cursor:=null;
        if jsonb_array_length(items)>page_limit then items:=items-page_limit;next_cursor:=items#>>array[(page_limit-1)::text,'revision'];end if;
        result:=jsonb_build_object('versionSummaries',items,'nextCursor',next_cursor);
      when 'readVersion' then
        select v.metadata||jsonb_build_object('content',v.content) into old from office_private.versions v
        where v.company_id=p_company_id and v.file_id=fid and v.revision=(p_request->>'revision')::bigint;
        if old is null then perform office_private.fail('NOT_FOUND','Version was not found.',404);end if;
        result:=jsonb_build_object('version',old);
      when 'proposals' then
        result_bytes:=0;item_count:=0;
        for old in select q.metadata||jsonb_build_object('content',q.content) from office_private.proposals q where q.company_id=p_company_id and q.file_id=fid limit 101 loop
          item_count:=item_count+1;result_bytes:=result_bytes+octet_length(old::text)+2;
          if item_count>100 or result_bytes>2998000 then perform office_private.fail('PAGINATION_REQUIRED','Use listProposals and readProposal.',413);end if;
        end loop;
        select jsonb_build_object('proposals',coalesce(jsonb_agg(q.metadata||jsonb_build_object('content',q.content) order by q.id),'[]'::jsonb))
        into result from office_private.proposals q where q.company_id=p_company_id and q.file_id=fid;
      when 'listProposals' then
        select coalesce(jsonb_agg(metadata order by id),'[]'::jsonb) into items from (
          select q.id,q.metadata from office_private.proposals q where q.company_id=p_company_id and q.file_id=fid
            and (not p_request?'afterId' or q.id>p_request->>'afterId') order by q.id limit page_limit+1
        ) page;
        next_cursor:=null;
        if jsonb_array_length(items)>page_limit then items:=items-page_limit;next_cursor:=items#>>array[(page_limit-1)::text,'id'];end if;
        result:=jsonb_build_object('proposalSummaries',items,'nextCursor',next_cursor);
      when 'readProposal' then
        select q.metadata||jsonb_build_object('content',q.content) into proposal from office_private.proposals q
        where q.company_id=p_company_id and q.file_id=fid and q.id=p_request->>'proposalId';
        if proposal is null then perform office_private.fail('NOT_FOUND','Proposal was not found.',404);end if;
        result:=jsonb_build_object('proposal',proposal);
      when 'original' then
        select jsonb_build_object('name',o.name,'mime',o.mime,'base64',replace(encode(b.bytes,'base64'),E'\n','')) into result
        from office_private.file_originals o join office_private.original_blobs b on b.company_id=o.company_id and b.sha256=o.sha256 and b.size=o.size
        where o.company_id=p_company_id and o.file_id=fid;
        if result is null then perform office_private.fail('NOT_FOUND','Original is not available.',404);end if;
      when 'recordExport' then
        if coalesce(p_request->>'format','') not in ('docx','xlsx','csv','txt','html','pdf','print') then perform office_private.fail('UNSUPPORTED_FORMAT','Unsupported format.');end if;
        result:='{}'::jsonb;
      when 'save' then
        if p_request#>>'{content,kind}' is distinct from f->>'kind' then perform office_private.fail('INVALID_CONTENT','Kind cannot change.');end if;
        f:=f||jsonb_build_object('content',p_request->'content');add_version:=true;
      when 'rename' then f:=f||jsonb_build_object('title',trim(p_request->>'title'));add_version:=true;
      when 'move' then
        perform office_private.check_parent_v2(p_company_id,p_request->>'parentId',fid);
        f:=f||jsonb_build_object('parentId',p_request->>'parentId');add_version:=true;
      when 'copy' then
        if f->>'kind'='folder' then perform office_private.fail('UNSUPPORTED_OPERATION','Folder copying is not supported.');end if;
        perform office_private.check_parent_v2(p_company_id,f->>'parentId');
        newid:=gen_random_uuid()::text;
        f:=f||jsonb_build_object('id',newid,'ownerId',actor_id,'title',trim(p_request->>'title'),'revision',1,'updatedAt',now_text);
        insert into office_private.files(company_id,id,metadata,content) values(p_company_id,newid,f-'content',f->'content');
        insert into office_private.file_originals(company_id,file_id,name,mime,size,sha256)
          select p_company_id,newid,o.name,o.mime,o.size,o.sha256 from office_private.file_originals o where o.company_id=p_company_id and o.file_id=fid;
        perform office_private.version_v2(p_company_id,f,actor_id);operation_file:=f;result:=jsonb_build_object('file',f);
      when 'delete' then
        if actor_role<>'owner' and f->>'ownerId'<>actor_id then perform office_private.fail('FORBIDDEN','File owner or company administrator required.',403);end if;
        if exists(select 1 from office_private.files x where x.company_id=p_company_id and not x.deleted and x.parent_id=fid) then
          perform office_private.fail('FOLDER_NOT_EMPTY','Move or delete folder contents first.',409);
        end if;
        f:=f||jsonb_build_object('deletedAt',now_text);add_version:=true;result:=jsonb_build_object('deleted',true);
      when 'restore' then
        select v.metadata||jsonb_build_object('content',v.content) into old from office_private.versions v
          where v.company_id=p_company_id and v.file_id=fid and v.revision=(p_request->>'revision')::bigint;
        if old is null then perform office_private.fail('NOT_FOUND','Version was not found.',404);end if;
        f:=f||jsonb_build_object('content',old->'content','title',old->>'title');add_version:=true;
      when 'link' then
        if coalesce(p_request->>'type','') not in ('job','customer') then perform office_private.fail('INVALID_REQUEST','Unsupported linked entity.');end if;
        entity:=public.office_host_resolve_entity(p_company_id,p_request->>'type',(p_request->>'entityId')::uuid);
        f:=f||jsonb_build_object('link',entity||jsonb_build_object('type',p_request->>'type'));add_version:=true;
      when 'propose' then
        if p_request#>>'{content,kind}' is distinct from f->>'kind' then perform office_private.fail('INVALID_CONTENT','Kind cannot change.');end if;
        pid:=gen_random_uuid()::text;
        proposal:=jsonb_build_object('id',pid,'fileId',fid,'baseRevision',f->'revision','status','pending','summary',trim(p_request->>'summary'),
          'content',p_request->'content','createdBy',actor_id,'createdAt',now_text);
        insert into office_private.proposals(company_id,id,file_id,metadata,content) values(p_company_id,pid,fid,proposal-'content',proposal->'content');
        result:=jsonb_build_object('proposal',proposal);
      when 'approve','reject' then
        if principal<>'human' then perform office_private.fail('HUMAN_APPROVAL_REQUIRED','Human approval required.',403);end if;
        pid:=p_request->>'proposalId';
        select q.metadata||jsonb_build_object('content',q.content) into proposal from office_private.proposals q
          where q.company_id=p_company_id and q.file_id=fid and q.id=pid for update;
        if proposal is null then perform office_private.fail('NOT_FOUND','Proposal was not found.',404);end if;
        if proposal->>'status'<>'pending' then perform office_private.fail('PROPOSAL_FINAL','Proposal has already been resolved.',409);end if;
        if op='approve' then
          if proposal->>'baseRevision'<>f->>'revision' then perform office_private.fail('CONFLICT','Proposal is based on an older version.',409);end if;
          if office_private.valid_content(proposal->'content') is distinct from true or proposal#>>'{content,kind}' is distinct from f->>'kind' then
            perform office_private.fail('INVALID_CONTENT','Invalid proposal content.');
          end if;
          f:=f||jsonb_build_object('content',proposal->'content');add_version:=true;
        end if;
        proposal:=proposal||jsonb_build_object('status',case when op='approve' then 'applied' else 'rejected' end);
        update office_private.proposals set metadata=proposal-'content' where company_id=p_company_id and id=pid and file_id=fid;
        result:=jsonb_build_object('proposal',proposal);
      else perform office_private.fail('INVALID_REQUEST','Unknown operation.');
    end case;
    if add_version then
      f:=f||jsonb_build_object('revision',(f->>'revision')::bigint+1,'updatedAt',now_text);
      update office_private.files set metadata=f-'content',content=f->'content' where company_id=p_company_id and id=fid;
      perform office_private.version_v2(p_company_id,f,actor_id);operation_file:=f;
      if op<>'delete' then result:=coalesce(result,'{}'::jsonb)||jsonb_build_object('file',f);end if;
    end if;
  end if;

  if op in ('list','versions','proposals') and octet_length(result::text)>3000000 then
    perform office_private.fail('PAGINATION_REQUIRED','Use paginated metadata and individual content reads.',413);
  end if;
  audit_event:=jsonb_build_object('id',gen_random_uuid(),'at',now_text,'actorId',actor_id,'principal',principal,'operation',op);
  if operation_file is not null then audit_event:=audit_event||jsonb_build_object('fileId',operation_file->>'id','revision',operation_file->'revision');end if;
  if op='recordExport' then audit_event:=audit_event||jsonb_build_object('details',jsonb_build_object('format',p_request->>'format'));end if;
  insert into office_private.audit_events(company_id,id,event) values(p_company_id,audit_event->>'id',audit_event);
  if receipt_key is not null then
    compact_response:=result;
    if result?'file' then compact_response:=compact_response#-'{file,content}';end if;
    if result?'proposal' then compact_response:=compact_response#-'{proposal,content}';end if;
    update office_private.receipts r set response=compact_response,
      file_id=result#>>'{file,id}',file_revision=(result#>>'{file,revision}')::bigint,proposal_id=result#>>'{proposal,id}'
      where r.company_id=p_company_id and r.actor_id=office_rpc.actor_id and r.key=receipt_key;
  end if;
  return result;
end;
$$;

-- Every externally callable entry remains authenticated and host-authorized.
revoke all on all functions in schema office_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema office_private from public,anon,authenticated,service_role;
revoke all on function public.office_request(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.office_request(uuid,jsonb,text) to authenticated;
commit;
