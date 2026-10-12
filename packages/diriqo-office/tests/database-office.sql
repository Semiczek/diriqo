-- The actual Office SQL functions are loaded unchanged between fixture and this suite.
-- Assertions execute under SET ROLE authenticated / anon, not a bypass-RLS test actor.
-- A stale-revision interleaving is tested; PGlite does NOT prove multi-session races.
set role authenticated;
select office_test.login(null);
select office_test.expect_rpc_error('authentication required',office_test.id(1001),'{"op":"list"}','UNAUTHENTICATED');
select office_test.login(6);
select office_test.expect_rpc_error('outsider blocked before module state',office_test.id(1001),'{"op":"list"}','FORBIDDEN');
select office_test.login(7);
select office_test.expect_rpc_error('inactive membership blocked',office_test.id(1001),'{"op":"list"}','FORBIDDEN');
select office_test.login(10);
select office_test.expect_rpc_error('unknown role blocked',office_test.id(1001),'{"op":"list"}','FORBIDDEN');
select office_test.login(2);
select office_test.expect_rpc_error('default module off',office_test.id(1001),'{"op":"list"}','MODULE_DISABLED');
select office_test.expect_setting_error('company admin cannot enable',office_test.id(1001));
select office_test.login(3);
select office_test.expect_setting_error('manager cannot enable',office_test.id(1001));
select office_test.login(4);
select office_test.expect_setting_error('reader cannot enable',office_test.id(1001));
select office_test.login(1);
select office_test.assert(public.office_set_enabled(office_test.id(1001),true),'authorized configuration');
reset role;
-- B is enabled by fixture owner so tests can distinguish inaccessible files from a disabled tenant.
insert into public.office_settings(company_id,enabled) values(office_test.id(1002),true);
set role authenticated;
select office_test.login(12);
do $$
begin
 if current_setting('office_test.host')='diriqo' then
  perform office_test.expect_setting_error('tenant super_admin is not platform authority',office_test.id(1001));
 else
  perform office_test.assert(public.office_set_enabled(office_test.id(1001),true),'Hub super_admin may configure own tenant');
 end if;
end;$$;
select office_test.login(11);
do $$
begin
 if current_setting('office_test.host')='diriqo' then
  perform office_test.assert(public.office_set_enabled(office_test.id(1001),true),'independent platform grant may configure');
 else
  perform office_test.expect_setting_error('Hub platform fixture without membership cannot configure',office_test.id(1001));
 end if;
 perform office_test.expect_rpc_error('platform grant does not grant document access',office_test.id(1001),'{"op":"list"}','FORBIDDEN');
end;$$;
select office_test.login(2);
select office_test.assert((select count(*)=1 from public.office_settings),'RLS settings only active tenant membership');
select office_test.assert((select company_id=office_test.id(1001) from public.office_settings),'RLS settings tenant id');
select office_test.expect_sqlstate('settings direct update denied','update public.office_settings set enabled=false','42501');
select office_test.expect_sqlstate('private state select denied','select * from office_private.tenant_state','42501');
select office_test.expect_sqlstate('private state insert denied','insert into office_private.tenant_state(company_id) values(gen_random_uuid())','42501');
select office_test.expect_sqlstate('private events select denied','select * from office_private.settings_events','42501');
select office_test.expect_sqlstate('host context direct execution denied','select public.office_host_context(office_test.id(1001))','42501');
select office_test.expect_sqlstate('host configure direct execution denied','select public.office_host_can_configure(office_test.id(1001))','42501');
select office_test.expect_sqlstate('host write direct execution denied','select public.office_host_write_allowed(office_test.id(1001))','42501');
select office_test.expect_sqlstate('host entity direct execution denied','select public.office_host_resolve_entity(office_test.id(1001),''job'',office_test.id(2001))','42501');
select office_test.expect_sqlstate('private helper direct execution denied','select office_private.valid_id(''safe'')','42501');
set role anon;
select office_test.expect_sqlstate('anon RPC execute denied','select public.office_request(office_test.id(1001),''{"op":"list"}''::jsonb)','42501');
select office_test.expect_sqlstate('anon configure execute denied','select public.office_set_enabled(office_test.id(1001),true)','42501');
reset role;
set role authenticated;
select office_test.login(2);
do $$
declare req jsonb;first jsonb;again jsonb;
begin
 req:=jsonb_build_object('op','create','title','First document','kind','document','content',office_test.doc('Version one'),'idempotencyKey','create-first');
 first:=public.office_request(office_test.id(1001),req);
 again:=public.office_request(office_test.id(1001),req);
 perform office_test.assert(first=again,'idempotency exact response replay');
 perform office_test.assert(first#>>'{file,revision}'='1' and first#>>'{file,ownerId}'=office_test.id(102)::text,'create shape revision and owner');
 insert into office_test.state values('file',first->'file');
 perform office_test.expect_rpc_error('idempotency changed payload rejected',office_test.id(1001),req||'{"title":"Different"}','IDEMPOTENCY_CONFLICT');
 perform office_test.assert(jsonb_array_length(public.office_request(office_test.id(1001),'{"op":"list"}')->'files')=1,'replay creates exactly one file');
 perform office_test.assert(public.office_request(office_test.id(1001),'{"op":"list"}')#>'{files,0,content}'='null'::jsonb,'list strips content');
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',first#>>'{file,id}'))=first,'read preserves saved document');
end;$$;
select office_test.login(3);
do $$
declare f jsonb:=(select v from office_test.state where k='file');a jsonb;b jsonb;updated jsonb;
begin
 a:=public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'));
 b:=public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'));
 updated:=public.office_request(office_test.id(1001),jsonb_build_object('op','save','id',f->>'id','expectedRevision',(a#>>'{file,revision}')::int,
 'content',office_test.doc('Version two'),'idempotencyKey','save-two'));
 update office_test.state set v=updated->'file' where k='file';
 perform office_test.assert(updated#>>'{file,revision}'='2','manager can save');
 perform office_test.expect_rpc_error('stale writer CAS rejected',office_test.id(1001),jsonb_build_object('op','save','id',f->>'id','expectedRevision',(b#>>'{file,revision}')::int,
 'content',office_test.doc('Lost concurrent content'),'idempotencyKey','save-stale'),'CONFLICT');
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'))#>'{file,content}'=office_test.doc('Version two'),'CAS does not overwrite latest content');
 perform office_test.expect_rpc_error('manager cannot delete another owner file',office_test.id(1001),jsonb_build_object('op','delete','id',f->>'id','expectedRevision',2,'idempotencyKey','delete-not-owner'),'FORBIDDEN');
end;$$;
select office_test.login(4);
do $$
declare f jsonb:=(select v from office_test.state where k='file');p jsonb;
begin
 p:=public.office_request(office_test.id(1001),jsonb_build_object('op','permissions','id',f->>'id'));
 perform office_test.assert(p#>>'{permissions,role}'='reader' and p#>>'{permissions,canWrite}'='false','reader permission shape');
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'))#>>'{file,id}'=f->>'id','reader can read');
 perform office_test.expect_rpc_error('reader cannot create',office_test.id(1001),jsonb_build_object('op','create','kind','document','title','Denied','content',office_test.doc(''),'idempotencyKey','reader-create'),'FORBIDDEN');
 perform office_test.expect_rpc_error('reader cannot save',office_test.id(1001),jsonb_build_object('op','save','id',f->>'id','expectedRevision',2,'content',office_test.doc('Denied'),'idempotencyKey','reader-save'),'FORBIDDEN');
 perform office_test.expect_rpc_error('reader cannot propose',office_test.id(1001),jsonb_build_object('op','propose','id',f->>'id','expectedRevision',2,'content',office_test.doc('Denied'),'summary','Denied','idempotencyKey','reader-propose'),'FORBIDDEN');
end;$$;
select office_test.login(5);
do $$
declare f jsonb:=(select v from office_test.state where k='file');op text;
begin
 perform office_test.expect_rpc_error('foreign company direct RPC denied',office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'),'FORBIDDEN');
 foreach op in array array['read','versions','proposals','permissions','original'] loop
  perform office_test.expect_rpc_error('foreign file hidden: '||op,office_test.id(1002),jsonb_build_object('op',op,'id',f->>'id'),'NOT_FOUND');
 end loop;
 perform office_test.expect_rpc_error('foreign file save hidden',office_test.id(1002),jsonb_build_object('op','save','id',f->>'id','expectedRevision',2,'content',office_test.doc('Cross tenant'),'idempotencyKey','cross-save'),'NOT_FOUND');
 perform office_test.expect_rpc_error('foreign file delete hidden',office_test.id(1002),jsonb_build_object('op','delete','id',f->>'id','expectedRevision',2,'idempotencyKey','cross-delete'),'NOT_FOUND');
 perform office_test.expect_rpc_error('foreign file export hidden',office_test.id(1002),jsonb_build_object('op','recordExport','id',f->>'id','format','docx'),'NOT_FOUND');
 perform office_test.assert(jsonb_array_length(public.office_request(office_test.id(1002),'{"op":"list"}')->'files')=0,'foreign list has no tenant A files');
end;$$;
select office_test.login(2);
do $$
declare f jsonb:=(select v from office_test.state where k='file');outcome jsonb;versions jsonb;
begin
 versions:=public.office_request(office_test.id(1001),jsonb_build_object('op','versions','id',f->>'id'))->'versions';
 perform office_test.assert(jsonb_array_length(versions)=2 and versions#>'{0,content}'=office_test.doc('Version one'),'version history preserves initial content');
 outcome:=public.office_request(office_test.id(1001),jsonb_build_object('op','restore','id',f->>'id','expectedRevision',2,'revision',1,'idempotencyKey','restore-first'));
 perform office_test.assert(outcome#>>'{file,revision}'='3' and outcome#>'{file,content}'=office_test.doc('Version one'),'restore creates next revision');
 update office_test.state set v=outcome->'file' where k='file';
 perform office_test.expect_rpc_error('foreign job association denied',office_test.id(1001),jsonb_build_object('op','link','id',f->>'id','expectedRevision',3,'type','job','entityId',office_test.id(2002),'idempotencyKey','foreign-job'),'NOT_FOUND');
 outcome:=public.office_request(office_test.id(1001),jsonb_build_object('op','link','id',f->>'id','expectedRevision',3,'type','job','entityId',office_test.id(2001),'idempotencyKey','own-job'));
 perform office_test.assert(outcome#>>'{file,link,label}'='Job A' and outcome#>>'{file,link,type}'='job','authorized job association label');
 perform office_test.expect_rpc_error('foreign customer association denied',office_test.id(1001),jsonb_build_object('op','link','id',f->>'id','expectedRevision',4,'type','customer','entityId',office_test.id(3002),'idempotencyKey','foreign-customer'),'NOT_FOUND');
 outcome:=public.office_request(office_test.id(1001),jsonb_build_object('op','link','id',f->>'id','expectedRevision',4,'type','customer','entityId',office_test.id(3001),'idempotencyKey','own-customer'));
 perform office_test.assert(outcome#>>'{file,link,label}'='Customer A','authorized customer association');
 update office_test.state set v=outcome->'file' where k='file';
end;$$;
do $$
declare original jsonb;outcome jsonb;fid text;copied jsonb;downloaded jsonb;
begin
 original:=jsonb_build_object('name','original.txt','mime','text/plain','size',8,'base64','b3JpZ2luYWw=','sha256',encode(sha256(convert_to('original','UTF8')),'hex'));
 outcome:=public.office_request(office_test.id(1001),jsonb_build_object('op','import','title','Imported','content',office_test.doc('Converted'),'original',original,'idempotencyKey','import-original'));
 fid:=outcome#>>'{file,id}';
 perform office_test.assert(outcome#>'{file,original}'=original-'base64','import metadata excludes original bytes');
 perform public.office_request(office_test.id(1001),jsonb_build_object('op','save','id',fid,'expectedRevision',1,'content',office_test.doc('Edited'),'idempotencyKey','edit-import'));
 downloaded:=public.office_request(office_test.id(1001),jsonb_build_object('op','original','id',fid));
 perform office_test.assert(downloaded->>'base64'='b3JpZ2luYWw=','original unchanged after editing');
 copied:=public.office_request(office_test.id(1001),jsonb_build_object('op','copy','id',fid,'title','Imported copy','idempotencyKey','copy-import'));
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','original','id',copied#>>'{file,id}'))=downloaded,'copy preserves original');
 perform public.office_request(office_test.id(1001),jsonb_build_object('op','restore','id',fid,'expectedRevision',2,'revision',1,'idempotencyKey','restore-import'));
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','original','id',fid))=downloaded,'restore preserves original');
 perform office_test.expect_rpc_error('original hash mismatch rejected',office_test.id(1001),jsonb_build_object('op','import','title','Tampered','content',office_test.doc('Converted'),'original',original||jsonb_build_object('sha256',repeat('0',64)),'idempotencyKey','import-bad-hash'),'INVALID_ORIGINAL');
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','recordExport','id',fid,'format','docx'))='{}'::jsonb,'authorized export audit RPC');
end;$$;
select office_test.login(3,true);
do $$
declare f jsonb:=(select v from office_test.state where k='file');p jsonb;
begin
 perform office_test.expect_rpc_error('signed AI cannot claim human save',office_test.id(1001),jsonb_build_object('op','save','id',f->>'id','expectedRevision',5,'content',office_test.doc('Unsafe direct AI'),'idempotencyKey','ai-save'),'HUMAN_APPROVAL_REQUIRED','human');
 p:=public.office_request(office_test.id(1001),jsonb_build_object('op','propose','id',f->>'id','expectedRevision',5,'content',office_test.doc('Approved AI draft'),'summary','Proposed update','idempotencyKey','ai-propose'),'human');
 insert into office_test.state values('proposal',p->'proposal');
 perform office_test.assert(p#>>'{proposal,status}'='pending' and p#>>'{proposal,createdBy}'=office_test.id(103)::text,'AI produces attributed pending proposal');
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'))#>'{file,content}'=office_test.doc('Version one'),'proposal does not change document');
 perform office_test.expect_rpc_error('signed AI cannot self approve via human argument',office_test.id(1001),jsonb_build_object('op','approve','id',f->>'id','proposalId',p#>>'{proposal,id}','expectedRevision',5,'idempotencyKey','ai-approve'),'HUMAN_APPROVAL_REQUIRED','human');
end;$$;
select office_test.login(2);
do $$
declare f jsonb:=(select v from office_test.state where k='file');p jsonb:=(select v from office_test.state where k='proposal');req jsonb;outcome jsonb;stale jsonb;
begin
 req:=jsonb_build_object('op','approve','id',f->>'id','proposalId',p->>'id','expectedRevision',5,'idempotencyKey','human-approve');
 outcome:=public.office_request(office_test.id(1001),req);
 perform office_test.assert(outcome#>>'{proposal,status}'='applied' and outcome#>>'{file,revision}'='6' and outcome#>'{file,content}'=office_test.doc('Approved AI draft'),'human approval applies exact content transactionally');
 perform office_test.assert(public.office_request(office_test.id(1001),req)=outcome,'approval idempotent retry');
 perform office_test.expect_rpc_error('proposal cannot apply twice',office_test.id(1001),req||'{"expectedRevision":6,"idempotencyKey":"approve-again"}','PROPOSAL_FINAL');
 stale:=public.office_request(office_test.id(1001),jsonb_build_object('op','propose','id',f->>'id','expectedRevision',6,'content',office_test.doc('Stale draft'),'summary','Stale','idempotencyKey','stale-propose'),'ai');
 outcome:=public.office_request(office_test.id(1001),jsonb_build_object('op','save','id',f->>'id','expectedRevision',6,'content',office_test.doc('New human content'),'idempotencyKey','human-newer'));
 perform office_test.expect_rpc_error('stale proposal approval CAS',office_test.id(1001),jsonb_build_object('op','approve','id',f->>'id','proposalId',stale#>>'{proposal,id}','expectedRevision',7,'idempotencyKey','approve-stale'),'CONFLICT');
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','reject','id',f->>'id','proposalId',stale#>>'{proposal,id}','idempotencyKey','reject-stale'))#>>'{proposal,status}'='rejected','human rejection resolves proposal without applying');
 update office_test.state set v=outcome->'file' where k='file';
end;$$;
do $$
declare f jsonb:=(select v from office_test.state where k='file');folder jsonb;child jsonb;other jsonb;
begin
 perform office_test.expect_rpc_error('unexpected fields rejected',office_test.id(1001),'{"op":"list","tenantId":"other"}','INVALID_REQUEST');
 perform office_test.expect_rpc_error('invalid principal rejected',office_test.id(1001),'{"op":"list"}','INVALID_REQUEST','service');
 perform office_test.expect_rpc_error('prototype identifier rejected',office_test.id(1001),'{"op":"read","id":"__proto__"}','INVALID_ID');
 perform office_test.expect_rpc_error('negative revision rejected',office_test.id(1001),jsonb_build_object('op','save','id',f->>'id','expectedRevision',-1,'content',office_test.doc('Bad'),'idempotencyKey','negative-rev'),'INVALID_REVISION');
 perform office_test.expect_rpc_error('unsafe document URL rejected',office_test.id(1001),jsonb_build_object('op','save','id',f->>'id','expectedRevision',7,'content',jsonb_set(office_test.doc('x'),'{doc,content,0,content,0,marks}','[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]'),'idempotencyKey','bad-link'),'INVALID_CONTENT');
 folder:=public.office_request(office_test.id(1001),'{"op":"create","title":"Folder","kind":"folder","idempotencyKey":"folder-create"}')->'file';
 child:=public.office_request(office_test.id(1001),jsonb_build_object('op','create','title','Child','kind','folder','parentId',folder->>'id','idempotencyKey','child-create'))->'file';
 perform office_test.expect_rpc_error('nonempty folder deletion refused',office_test.id(1001),jsonb_build_object('op','delete','id',folder->>'id','expectedRevision',1,'idempotencyKey','delete-folder'),'FOLDER_NOT_EMPTY');
 perform office_test.expect_rpc_error('folder descendant cycle refused',office_test.id(1001),jsonb_build_object('op','move','id',folder->>'id','expectedRevision',1,'parentId',child->>'id','idempotencyKey','cycle-folder'),'FOLDER_CYCLE');
 other:=public.office_request(office_test.id(1001),jsonb_build_object('op','copy','id',f->>'id','title','Temporary copy','idempotencyKey','copy-for-delete'))->'file';
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','delete','id',other->>'id','expectedRevision',1,'idempotencyKey','delete-copy'))='{"deleted":true}'::jsonb,'owner may delete');
 perform office_test.expect_rpc_error('deleted file cannot be read',office_test.id(1001),jsonb_build_object('op','read','id',other->>'id'),'NOT_FOUND');
end;$$;
do $$
declare content jsonb;created jsonb;fid text;invalid jsonb;
begin
 content:='{"schemaVersion":1,"kind":"spreadsheet","workbook":{"id":"test-book","name":"SQL workbook","sheetOrder":["sheet-a","sheet-b"],"sheets":{"sheet-a":{"id":"sheet-a","name":"First","rowCount":100,"columnCount":10,"cellData":{"0":{"0":{"v":10,"t":2},"1":{"v":20,"t":2},"2":{"f":"=SUM(A1:B1)","v":30,"m":"30","t":2}}}},"sheet-b":{"id":"sheet-b","name":"Second","rowCount":100,"columnCount":10,"cellData":{"0":{"0":{"f":"=First!C1","v":30,"t":2}}}}}}}'::jsonb;
 created:=public.office_request(office_test.id(1001),jsonb_build_object('op','create','kind','spreadsheet','title','SQL workbook','content',content,'idempotencyKey','spreadsheet-create'));
 fid:=created#>>'{file,id}';
 perform office_test.assert(created#>'{file,content}'=content,'spreadsheet stores all sheets values formulas and display cache');
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',fid))#>'{file,content}'=content,'spreadsheet round trip retains canonical content');
 invalid:=jsonb_set(content,'{workbook,sheets,sheet-a,cellData,0,2,f}',to_jsonb('=WEBSERVICE("https://internal.test")'::text));
 perform office_test.expect_rpc_error('SQL blocks network formula',office_test.id(1001),jsonb_build_object('op','save','id',fid,'expectedRevision',1,'content',invalid,'idempotencyKey','sheet-network'),'INVALID_CONTENT');
 invalid:=jsonb_set(content,'{workbook,sheets,sheet-a,cellData,0,0,v}',to_jsonb('<span onclick="bad()">x</span>'::text));
 perform office_test.expect_rpc_error('SQL blocks active cell markup',office_test.id(1001),jsonb_build_object('op','save','id',fid,'expectedRevision',1,'content',invalid,'idempotencyKey','sheet-markup'),'INVALID_CONTENT');
 invalid:=jsonb_set(content,'{workbook,sheets,sheet-a,cellData,0,0,v}','{"nested":"value"}'::jsonb);
 perform office_test.expect_rpc_error('SQL blocks object cell values',office_test.id(1001),jsonb_build_object('op','save','id',fid,'expectedRevision',1,'content',invalid,'idempotencyKey','sheet-object'),'INVALID_CONTENT');
 invalid:=jsonb_set(content,'{workbook,sheetOrder}','["sheet-a","sheet-a"]'::jsonb);
 perform office_test.expect_rpc_error('SQL blocks duplicate sheet ids',office_test.id(1001),jsonb_build_object('op','save','id',fid,'expectedRevision',1,'content',invalid,'idempotencyKey','sheet-duplicate'),'INVALID_CONTENT');
 perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',fid))#>>'{file,revision}'='1','invalid spreadsheet writes are atomic');
end;$$;
do $$
declare f jsonb:=(select v from office_test.state where k='file');original jsonb;
begin
 perform office_test.expect_rpc_error('invalid linked UUID has structured Office error',office_test.id(1001),jsonb_build_object('op','link','id',f->>'id','expectedRevision',7,'type','job','entityId','not-a-uuid','idempotencyKey','invalid-link-uuid'),'INVALID_ID');
 original:=jsonb_build_object('name','invalid.txt','mime','text/plain','size',1,'base64','=','sha256',repeat('0',64));
 perform office_test.expect_rpc_error('invalid base64 padding has structured Office error',office_test.id(1001),jsonb_build_object('op','import','title','Bad encoding','content',office_test.doc('Converted'),'original',original,'idempotencyKey','invalid-base64-padding'),'INVALID_ORIGINAL');
 original:=original||jsonb_build_object('size',8,'base64','b3JpZ2luYWw===');
 perform office_test.expect_rpc_error('excess base64 padding has structured Office error',office_test.id(1001),jsonb_build_object('op','import','title','Bad encoding','content',office_test.doc('Converted'),'original',original,'idempotencyKey','excess-base64-padding'),'INVALID_ORIGINAL');
end;$$;
select office_test.login(8);
do $$
begin
 if current_setting('office_test.host')='diriqo' then
  perform office_test.expect_rpc_error('Diriqo mismatched profile identity rejected',office_test.id(1001),'{"op":"list"}','FORBIDDEN');
 else
  perform office_test.assert(public.office_is_member(office_test.id(1001)),'Hub preserves existing auth identity mapping contract');
 end if;
end;$$;
select office_test.login(9);
do $$
begin
 if current_setting('office_test.host')='diriqo' then
  perform office_test.expect_rpc_error('Diriqo legacy user_id only identity rejected',office_test.id(1001),'{"op":"list"}','FORBIDDEN');
 else
  perform office_test.assert(public.office_is_member(office_test.id(1001)),'Hub legacy user_id mapping retained');
 end if;
end;$$;
reset role;
update private.office_test_capabilities set allowed=false where company_id=office_test.id(1001);
set role authenticated;
select office_test.login(2);
do $$
declare f jsonb:=(select v from office_test.state where k='file');
begin
 if current_setting('office_test.host')='diriqo' then
  perform office_test.expect_rpc_error('Diriqo capability denial blocks write',office_test.id(1001),jsonb_build_object('op','save','id',f->>'id','expectedRevision',7,'content',office_test.doc('Denied'),'idempotencyKey','cap-denied'),'FORBIDDEN');
  perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'))#>>'{file,id}'=f->>'id','Diriqo capability denial preserves read');
  perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','permissions','id',f->>'id'))#>>'{permissions,canWrite}'='false','Diriqo permission output reflects capability denial');
 end if;
end;$$;
select office_test.login(1);
select office_test.assert(not public.office_set_enabled(office_test.id(1001),false),'module disabled by authorized actor');
select office_test.login(2);
do $$
declare f jsonb:=(select v from office_test.state where k='file');op text;
begin
 foreach op in array array['read','versions','proposals','permissions','original'] loop
  perform office_test.expect_rpc_error('module off blocks: '||op,office_test.id(1001),jsonb_build_object('op',op,'id',f->>'id'),'MODULE_DISABLED');
 end loop;
 perform office_test.expect_rpc_error('module off blocks export',office_test.id(1001),jsonb_build_object('op','recordExport','id',f->>'id','format','docx'),'MODULE_DISABLED');
 perform office_test.expect_rpc_error('module off blocks save',office_test.id(1001),jsonb_build_object('op','save','id',f->>'id','expectedRevision',7,'content',office_test.doc('Denied'),'idempotencyKey','off-save'),'MODULE_DISABLED');
end;$$;
reset role;
do $$
declare s jsonb;f jsonb:=(select v from office_test.state where k='file');
begin
 -- Same observable assertions in either persistence mode; only the privileged
 -- test-only read of physical storage differs. No assertion is skipped.
 if current_setting('office_test.persistence',true)='normalized' then
  s:=office_private.normalized_snapshot(office_test.id(1001));
 else
  select ts.state into s from office_private.tenant_state ts where ts.company_id=office_test.id(1001);
 end if;
 perform office_test.assert(s#>array['files',f->>'id','content']=office_test.doc('New human content'),'denied operations did not mutate accepted content');
 perform office_test.assert(exists(select 1 from jsonb_array_elements(s->'audit')a where a->>'operation'='idempotency.replay'),'idempotency replay audit exists');
 perform office_test.assert(exists(select 1 from jsonb_array_elements(s->'audit')a where a->>'operation'='propose' and a->>'principal'='ai'),'AI proposal audit retains principal');
 perform office_test.assert(exists(select 1 from jsonb_array_elements(s->'audit')a where a->>'operation'='approve' and a->>'principal'='human'),'approval audit retains human principal');
 perform office_test.assert(exists(select 1 from jsonb_array_elements(s->'audit')a where a->>'operation'='recordExport' and a#>>'{details,format}'='docx'),'export audit records format');
 perform office_test.assert((select count(*)>=3 from office_private.settings_events where company_id=office_test.id(1001)),'settings changes audited');
 perform office_test.assert(not has_schema_privilege('authenticated','office_private','USAGE'),'authenticated has no private schema usage');
 perform office_test.assert(not has_table_privilege('authenticated','office_private.tenant_state','SELECT,INSERT,UPDATE,DELETE'),'authenticated has no state table grants');
 perform office_test.assert(not has_function_privilege('anon','public.office_request(uuid,jsonb,text)','EXECUTE'),'anonymous has no RPC execution');
 perform office_test.assert(has_function_privilege('authenticated','public.office_request(uuid,jsonb,text)','EXECUTE'),'authenticated RPC grant exists');
 perform office_test.assert((select bool_and(relrowsecurity) from pg_class where oid in ('public.office_settings'::regclass,'office_private.tenant_state'::regclass,'office_private.settings_events'::regclass)),'Office tables have RLS enabled');
end;$$;
select current_setting('office_test.host') as host,count(*)::integer as assertions from office_test.results;
