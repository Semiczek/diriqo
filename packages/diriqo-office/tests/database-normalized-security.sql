-- TEST ONLY: isolated fresh local PostgreSQL/PGlite fixture, never an application migration.
-- Uses the public RPC as authenticated principals; privileged assertions inspect
-- constraints/storage only after the externally observable checks.
set role authenticated;
select office_test.login(2);
do $$
declare f jsonb:=(select v from office_test.state where k='normalized.legacy.file'); r jsonb; req jsonb;
begin
 r:=public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'));
 perform office_test.assert(r#>>'{file,revision}'='2' and r#>>'{file,content,doc,content,0,content,0,text}'='Legacy version two','normalized migration retains latest revision/content');
 req:=(select v from office_test.state where k='normalized.legacy.create-request');
 r:=public.office_request(office_test.id(1001),req);
 perform office_test.assert(r=(select v from office_test.state where k='normalized.legacy.create-response'),'normalized legacy receipt replays original version after later save');
 perform office_test.expect_rpc_error('normalized legacy key cannot accept changed payload',office_test.id(1001),req||'{"title":"Changed replay"}','IDEMPOTENCY_CONFLICT');
 perform office_test.expect_rpc_error('normalized stale CAS rejected after migration',office_test.id(1001),jsonb_build_object('op','save','id',f->>'id','expectedRevision',1,'content',office_test.doc('Must not replace'),'idempotencyKey','normalized-stale'),'CONFLICT');
 r:=public.office_request(office_test.id(1001),jsonb_build_object('op','readVersion','id',f->>'id','revision',1));
 perform office_test.assert(r#>>'{version,content,doc,content,0,content,0,text}'='Legacy version one','normalized historical content independently readable');
 r:=public.office_request(office_test.id(1001),jsonb_build_object('op','original','id',(select v#>>'{file,id}' from office_test.state where k='normalized.legacy.import-response')));
 perform office_test.assert(r->>'base64'='YWJj','normalized legacy original bytes retained');
end;$$;

-- One dual member reuses an operation key in two companies. Receipts must include tenant.
reset role;
insert into public.company_members(id,company_id,profile_id,role,is_active)
values(office_test.id(902),office_test.id(1002),office_test.id(102),'company_admin',true);
set role authenticated;
select office_test.login(2);
do $$
declare req jsonb:=jsonb_build_object('op','create','kind','document','title','Tenant receipt','content',office_test.doc('Tenant receipt'),'idempotencyKey','normalized-same-actor-key'); a jsonb;b jsonb;
begin
 a:=public.office_request(office_test.id(1001),req);b:=public.office_request(office_test.id(1002),req);
 perform office_test.assert(a#>>'{file,id}'<>b#>>'{file,id}' and a#>>'{file,tenantId}'=office_test.id(1001)::text and b#>>'{file,tenantId}'=office_test.id(1002)::text,'normalized receipt scoped to tenant for same actor/key');
 insert into office_test.state values('normalized.a',a->'file'),('normalized.b',b->'file');
 perform office_test.expect_rpc_error('normalized cross-company file ID denied even dual member',office_test.id(1002),jsonb_build_object('op','read','id',a#>>'{file,id}'),'NOT_FOUND');
 perform office_test.expect_rpc_error('normalized cross-company version ID denied',office_test.id(1002),jsonb_build_object('op','readVersion','id',a#>>'{file,id}','revision',1),'NOT_FOUND');
 perform office_test.expect_rpc_error('normalized cross-company copy source denied',office_test.id(1002),jsonb_build_object('op','copy','id',a#>>'{file,id}','title','Forbidden copy','idempotencyKey','normalized-cross-copy'),'NOT_FOUND');
end;$$;

-- An actor without company A membership cannot obtain A through its child identifiers.
select office_test.login(5);
do $$
declare f jsonb:=(select v from office_test.state where k='normalized.a');original_id text:=(select v#>>'{file,id}' from office_test.state where k='normalized.legacy.import-response'); op text;
begin
 foreach op in array array['read','permissions','original','listVersions','listProposals'] loop
  perform office_test.expect_rpc_error('normalized ownerB cannot query tenant A '||op,office_test.id(1001),jsonb_build_object('op',op,'id',f->>'id'),'FORBIDDEN');
 end loop;
 perform office_test.expect_rpc_error('normalized ownerB cannot read A original under B',office_test.id(1002),jsonb_build_object('op','original','id',original_id),'NOT_FOUND');
end;$$;

select office_test.login(4);
do $$
declare f jsonb:=(select v from office_test.state where k='normalized.a');
begin
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'))#>>'{file,id}'=f->>'id','normalized reader keeps authorized read');
 perform office_test.expect_rpc_error('normalized reader cannot mutate file',office_test.id(1001),jsonb_build_object('op','save','id',f->>'id','expectedRevision',1,'content',office_test.doc('reader write'),'idempotencyKey','normalized-reader-save'),'FORBIDDEN');
end;$$;
select office_test.login(2,true);
do $$
declare f jsonb:=(select v from office_test.state where k='normalized.a');proposal jsonb;
begin
 proposal:=public.office_request(office_test.id(1001),jsonb_build_object('op','propose','id',f->>'id','expectedRevision',1,'content',office_test.doc('AI change'),'summary','Review required','idempotencyKey','normalized-ai-propose'),'human');
 insert into office_test.state values('normalized.ai.proposal',proposal->'proposal');
 perform office_test.expect_rpc_error('normalized signed AI cannot approve through human argument',office_test.id(1001),jsonb_build_object('op','approve','id',f->>'id','proposalId',proposal#>>'{proposal,id}','expectedRevision',1,'idempotencyKey','normalized-ai-approve'),'HUMAN_APPROVAL_REQUIRED','human');
end;$$;

select office_test.login(5);
do $$
declare a jsonb:=(select v from office_test.state where k='normalized.a');b jsonb:=(select v from office_test.state where k='normalized.b');p jsonb:=(select v from office_test.state where k='normalized.ai.proposal');op text;
begin
 foreach op in array array['read','permissions','original','listVersions','listProposals'] loop
  perform office_test.expect_rpc_error('normalized A file ID cannot be used inside ownerB token tenant for '||op,office_test.id(1002),jsonb_build_object('op',op,'id',a->>'id'),'NOT_FOUND');
 end loop;
 perform office_test.expect_rpc_error('normalized foreign proposal detail cannot attach to own B file',office_test.id(1002),jsonb_build_object('op','readProposal','id',b->>'id','proposalId',p->>'id'),'NOT_FOUND');
 perform office_test.expect_rpc_error('normalized foreign proposal cannot approve into own B file',office_test.id(1002),jsonb_build_object('op','approve','id',b->>'id','proposalId',p->>'id','expectedRevision',1,'idempotencyKey','normalized-cross-approve'),'NOT_FOUND');
end;$$;

reset role;
update public.company_members set is_active=false where company_id=office_test.id(1001) and profile_id=office_test.id(102);
set role authenticated;
select office_test.login(2);
select office_test.expect_rpc_error('normalized revoked member cannot replay old receipt',office_test.id(1001),(select v from office_test.state where k='normalized.legacy.create-request'),'FORBIDDEN');
reset role;
update public.company_members set is_active=true,role='worker' where company_id=office_test.id(1001) and profile_id=office_test.id(102);
set role authenticated;
select office_test.login(2);
select office_test.expect_rpc_error('normalized demoted reader cannot replay old write receipt',office_test.id(1001),(select v from office_test.state where k='normalized.legacy.create-request'),'FORBIDDEN');
reset role;
update public.company_members set role='company_admin' where company_id=office_test.id(1001) and profile_id=office_test.id(102);
set role authenticated;

-- Original data stays in private PostgreSQL BLOBs. No user-provided path/bucket/URL.
select office_test.login(2);
do $$
declare original jsonb:=jsonb_build_object('name','original.txt','mime','text/plain','size',3,'sha256',encode(sha256(convert_to('abc','UTF8')),'hex'),'base64','YWJj'); req jsonb; a jsonb;b jsonb;c jsonb;field text;
begin
 req:=jsonb_build_object('op','import','title','BLOB integrity','content',office_test.doc('blob'),'original',original,'idempotencyKey','normalized-blob-a');
 foreach field in array array['bucket','path','url','storageKey'] loop
  perform office_test.expect_rpc_error('normalized original rejects external field '||field,office_test.id(1001),jsonb_set(req,'{original}',original||jsonb_build_object(field,'https://invalid.example/private')),'INVALID_REQUEST');
 end loop;
 perform office_test.expect_rpc_error('normalized original size mismatch rejected',office_test.id(1001),jsonb_set(req,'{original,size}','4'),'INVALID_ORIGINAL');
 perform office_test.expect_rpc_error('normalized original SHA mismatch rejected',office_test.id(1001),jsonb_set(req,'{original,sha256}',to_jsonb(repeat('0',64))),'INVALID_ORIGINAL');
 perform office_test.expect_rpc_error('normalized original base64 mismatch rejected',office_test.id(1001),jsonb_set(req,'{original,base64}','"YWJk"'),'INVALID_ORIGINAL');
 a:=public.office_request(office_test.id(1001),req);
 b:=public.office_request(office_test.id(1001),req||'{"idempotencyKey":"normalized-blob-b"}');
 c:=public.office_request(office_test.id(1002),req);
 perform office_test.assert(a#>>'{file,id}'<>b#>>'{file,id}' and c#>>'{file,tenantId}'=office_test.id(1002)::text,'normalized independent files and tenants can share equal original bytes');
 insert into office_test.state values('normalized.blob.a',a->'file'),('normalized.blob.b',b->'file'),('normalized.blob.other',c->'file');
 perform office_test.assert(public.office_request(office_test.id(1001),req)=a,'normalized blob import exact receipt replay');
 perform office_test.expect_rpc_error('normalized blob receipt cannot change bytes under same key',office_test.id(1001),jsonb_set(jsonb_set(req,'{original,base64}','"YWJk"'),'{original,sha256}',to_jsonb(encode(sha256(convert_to('abd','UTF8')),'hex'))),'IDEMPOTENCY_CONFLICT');
 perform public.office_request(office_test.id(1001),jsonb_build_object('op','delete','id',a#>>'{file,id}','expectedRevision',1,'idempotencyKey','normalized-delete-one-reference'));
 perform office_test.expect_rpc_error('normalized deleted origin cannot be read',office_test.id(1001),jsonb_build_object('op','original','id',a#>>'{file,id}'),'NOT_FOUND');
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','original','id',b#>>'{file,id}'))->>'base64'='YWJj','normalized deleting one reference preserves another original');
end;$$;

-- A failure after the BLOB insert must leave no orphan, file, receipt or audit.
reset role;
create function office_test.fail_original_reference() returns trigger language plpgsql as $$
begin perform office_private.fail('TEST_FAILURE','Injected reference failure.');return new;end;$$;
create trigger normalized_test_original_failure before insert on office_private.file_originals
for each row when(new.name='rollback-origin.txt') execute function office_test.fail_original_reference();
insert into office_test.state values('normalized.rollback.audit-before',
 jsonb_build_object('count',(select count(*) from office_private.audit_events where company_id=office_test.id(1001))));
set role authenticated;
select office_test.login(2);
do $$
declare req jsonb;
begin
 req:=jsonb_build_object('op','import','title','Original transaction rollback','content',office_test.doc('Must roll back'),'original',
  jsonb_build_object('name','rollback-origin.txt','mime','text/plain','size',6,'sha256',encode(sha256(convert_to('orphan','UTF8')),'hex'),'base64','b3JwaGFu'),'idempotencyKey','normalized-original-rollback');
 insert into office_test.state values('normalized.rollback.import',req);
 perform office_test.expect_rpc_error('normalized downstream original failure rejects transaction',office_test.id(1001),req,'TEST_FAILURE');
end;$$;
reset role;
drop trigger normalized_test_original_failure on office_private.file_originals;
do $$
begin
 perform office_test.assert(not exists(select 1 from office_private.original_blobs where company_id=office_test.id(1001) and sha256=encode(sha256(convert_to('orphan','UTF8')),'hex')),'normalized failed import leaves no orphan BLOB');
 perform office_test.assert(not exists(select 1 from office_private.files where company_id=office_test.id(1001) and title='Original transaction rollback'),'normalized failed import leaves no file');
 perform office_test.assert(not exists(select 1 from office_private.receipts where company_id=office_test.id(1001) and key='normalized-original-rollback'),'normalized failed import leaves no poisoned receipt');
 perform office_test.assert((select count(*) from office_private.audit_events where company_id=office_test.id(1001))=(select (v->>'count')::bigint from office_test.state where k='normalized.rollback.audit-before'),'normalized failed import leaves no partial audit');
end;$$;
set role authenticated;
select office_test.login(2);
select office_test.assert(public.office_request(office_test.id(1001),(select v from office_test.state where k='normalized.rollback.import'))#>>'{file,revision}'='1','normalized failed import can retry same operation after rollback');

-- Ordinary bounded documents: each payload is below the 3.8 MB host envelope.
-- The proof is logical canonical bytes, not physical disk size (TOAST may compress).
select office_test.login(2);
do $$
declare n integer;r jsonb;req jsonb;f jsonb;v jsonb;body text;total bigint:=0;first_id text;
begin
 for n in 1..40 loop
  body:=lpad(n::text,4,'0')||repeat('x',1799996);
  req:=jsonb_build_object('op','create','title','Normalized capacity '||n,'kind','document','content',office_test.doc(body),'idempotencyKey','normalized-capacity-'||n);
  perform office_test.assert(octet_length(req::text)<3800000,'normalized capacity file '||n||' fits host request budget');
  r:=public.office_request(office_test.id(1001),req);f:=r->'file';
  if first_id is null then first_id:=f->>'id';insert into office_test.state values('normalized.capacity.first',f-'content');end if;
  total:=total+octet_length((f->'content')::text);
  insert into office_test.state values('normalized.capacity.'||n,jsonb_build_object('id',f->>'id','sha256',encode(sha256(convert_to((f->'content')::text,'UTF8')),'hex')));
 end loop;
 perform office_test.assert(total>67108864,'normalized current documents exceed former 64 MiB tenant boundary');
 insert into office_test.state values('normalized.capacity.metrics',jsonb_build_object('fileCount',40,'logicalContentBytes',total,'perDocumentTextBytes',1800000));
 for n in 1..40 loop
  f:=(select value.v from office_test.state value where k='normalized.capacity.'||n);
  r:=public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'));
  perform office_test.assert(encode(sha256(convert_to((r#>'{file,content}')::text,'UTF8')),'hex')=f->>'sha256','normalized capacity reread hash '||n);
 end loop;
 -- More than 64 MiB of history on one file must not be aggregated for metadata paging.
 for n in 2..40 loop
  body:=lpad(n::text,4,'0')||repeat('y',1799996);
  req:=jsonb_build_object('op','save','id',first_id,'expectedRevision',n-1,'content',office_test.doc(body),'idempotencyKey','normalized-history-'||n);
  r:=public.office_request(office_test.id(1001),req);
  perform office_test.assert((r#>>'{file,revision}')::int=n,'normalized growing history CAS '||n);
 end loop;
 perform office_test.assert(public.office_request(office_test.id(1001),req)=r,'normalized final large save exact replay does not require stale CAS');
 perform office_test.expect_rpc_error('normalized large history stale save refused',office_test.id(1001),req||'{"idempotencyKey":"normalized-history-stale","expectedRevision":39}','CONFLICT');
 r:=public.office_request(office_test.id(1001),jsonb_build_object('op','listVersions','id',first_id,'limit',10));
 perform office_test.assert(octet_length(r::text)<65536 and jsonb_array_length(r->'versionSummaries')=10 and (r->>'nextCursor')::bigint>0,'normalized large history returns bounded paginated metadata');
 perform office_test.assert(not exists(select 1 from jsonb_array_elements(r->'versionSummaries')e where e?'content'),'normalized history summaries omit content');
 v:=public.office_request(office_test.id(1001),jsonb_build_object('op','readVersion','id',first_id,'revision',1));
 perform office_test.assert(v#>>'{version,content,doc,content,0,content,0,text}'='0001'||repeat('x',1799996),'normalized oldest large version preserved');
 v:=public.office_request(office_test.id(1001),jsonb_build_object('op','readVersion','id',first_id,'revision',40));
 perform office_test.assert(v#>>'{version,content,doc,content,0,content,0,text}'='0040'||repeat('y',1799996),'normalized latest large version preserved');
end;$$;

reset role;
do $$
declare tab text;private_tables text[]:=array['files','versions','proposals','original_blobs','file_originals','receipts','audit_events','topology_locks','persistence_migrations']; fid text:=(select v->>'id' from office_test.state where k='normalized.capacity.first');
begin
 foreach tab in array private_tables loop
  perform office_test.assert((select relrowsecurity from pg_class where oid=('office_private.'||tab)::regclass),'normalized RLS enabled '||tab);
  perform office_test.assert((select attnotnull from pg_attribute where attrelid=('office_private.'||tab)::regclass and attname='company_id' and not attisdropped),'normalized company_id mandatory '||tab);
  perform office_test.assert(exists(select 1 from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey) where c.conrelid=('office_private.'||tab)::regclass and c.contype='p' and a.attname='company_id'),'normalized primary key includes company_id '||tab);
  perform office_test.assert(not has_table_privilege('authenticated','office_private.'||tab,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon','office_private.'||tab,'SELECT,INSERT,UPDATE,DELETE'),'normalized no direct table grants '||tab);
 end loop;
 perform office_test.assert(not has_schema_privilege('authenticated','office_private','USAGE'),'normalized private schema inaccessible');
 perform office_test.assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='office_private' and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))),'normalized private helpers not executable by client roles');
 perform office_test.assert((select count(*)=2 from office_private.original_blobs where sha256=encode(sha256(convert_to('abc','UTF8')),'hex')),'normalized original dedup is per tenant');
 perform office_test.assert((select sum(octet_length(content::text))>67108864 from office_private.versions where company_id=office_test.id(1001) and file_id=fid),'normalized history independently exceeds old tenant quota');
 perform office_test.assert((select sum(octet_length(response::text))<1000000 from office_private.receipts where company_id=office_test.id(1001) and key like 'normalized-capacity-%'),'normalized receipts do not duplicate all large document content');
 perform office_test.expect_sqlstate('normalized cross-tenant version FK denied',format('insert into office_private.versions(company_id,file_id,revision,metadata,content) select %L::uuid,file_id,999,metadata||''{"revision":999}''::jsonb,content from office_private.versions where company_id=%L::uuid and file_id=%L limit 1',office_test.id(1002),office_test.id(1001),fid),'23503');
 perform office_test.expect_sqlstate('normalized cross-tenant original file FK denied',format('insert into office_private.file_originals(company_id,file_id,name,mime,size,sha256) select %L::uuid,file_id,name,mime,size,sha256 from office_private.file_originals where company_id=%L::uuid limit 1',office_test.id(1002),office_test.id(1001)),'23503');
 perform office_test.expect_sqlstate('normalized inconsistent file metadata tenant denied',format('insert into office_private.files(company_id,id,metadata,content) select %L::uuid,id,metadata,content from office_private.files where company_id=%L::uuid and id=%L',office_test.id(1002),office_test.id(1001),fid),'23514');
 perform office_test.expect_sqlstate('normalized missing file metadata tenant cannot bypass CHECK with NULL',format('insert into office_private.files(company_id,id,metadata,content) select %L::uuid,id,metadata-''tenantId'',content from office_private.files where company_id=%L::uuid and id=%L',office_test.id(1002),office_test.id(1001),fid),'23514');
 perform office_test.expect_sqlstate('normalized foreign proposal file FK denied',format('insert into office_private.proposals(company_id,id,file_id,metadata,content) select %L::uuid,id,file_id,metadata,content from office_private.proposals where company_id=%L::uuid limit 1',office_test.id(1002),office_test.id(1001)),'23503');
 perform office_test.expect_sqlstate('normalized foreign receipt version FK denied',format('insert into office_private.receipts(company_id,actor_id,key,fingerprint,response,file_id,file_revision) select %L::uuid,actor_id,''normalized-foreign-receipt-version'',fingerprint,response,file_id,file_revision from office_private.receipts where company_id=%L::uuid and file_id=%L limit 1',office_test.id(1002),office_test.id(1001),fid),'23503');
 perform office_test.expect_sqlstate('normalized foreign receipt proposal FK denied',format('insert into office_private.receipts(company_id,actor_id,key,fingerprint,response,proposal_id) select %L::uuid,%L,''normalized-foreign-receipt-proposal'',repeat(''0'',64),''{}''::jsonb,id from office_private.proposals where company_id=%L::uuid limit 1',office_test.id(1002),office_test.id(102)::text,office_test.id(1001)),'23503');
 perform office_test.expect_sqlstate('normalized own B file cannot reference A-only original BLOB',format('insert into office_private.file_originals(company_id,file_id,name,mime,size,sha256) values(%L::uuid,%L,''foreign-blob.txt'',''text/plain'',6,%L)',office_test.id(1002),(select v->>'id' from office_test.state where k='normalized.b'),encode(sha256(convert_to('orphan','UTF8')),'hex')),'23503');
 perform office_test.expect_sqlstate('normalized audit cannot reference a foreign file',format('insert into office_private.audit_events(company_id,id,event) values(%L::uuid,''normalized-cross-audit'',jsonb_build_object(''id'',''normalized-cross-audit'',''actorId'',%L,''at'',now(),''principal'',''human'',''operation'',''read'',''fileId'',%L))',office_test.id(1002),office_test.id(102)::text,fid),'23503');
 perform office_test.expect_sqlstate('normalized immutable original bytes reject even same-value UPDATE','update office_private.original_blobs set bytes=bytes','P0001');
 perform office_test.expect_sqlstate('normalized immutable historical content rejects UPDATE','update office_private.versions set content=content','P0001');
end;$$;
set role authenticated;
select office_test.login(2);
select office_test.expect_sqlstate('normalized direct files read denied','select * from office_private.files','42501');
select office_test.expect_sqlstate('normalized direct BLOB read denied','select * from office_private.original_blobs','42501');
select office_test.expect_sqlstate('normalized direct receipt read denied','select * from office_private.receipts','42501');
select office_test.login(1);
select office_test.assert(public.office_set_enabled(office_test.id(1001),false)=false,'normalized module can be disabled');
select office_test.login(2);
select office_test.expect_rpc_error('normalized disabled tenant receipt replay denied',office_test.id(1001),(select v from office_test.state where k='normalized.legacy.create-request'),'MODULE_DISABLED');
select office_test.expect_rpc_error('normalized disabled tenant history read denied',office_test.id(1001),jsonb_build_object('op','listVersions','id',(select v->>'id' from office_test.state where k='normalized.capacity.first')),'MODULE_DISABLED');
select office_test.assert(public.office_request(office_test.id(1002),jsonb_build_object('op','read','id',(select v->>'id' from office_test.state where k='normalized.b')))#>>'{file,tenantId}'=office_test.id(1002)::text,'normalized disabling A leaves B readable');
select office_test.login(1);
select office_test.assert(public.office_set_enabled(office_test.id(1001),true),'normalized module restore preserves content');
reset role;
