-- LOCAL TEST ONLY. Run after the synthetic Office fixture and real migrations.
-- Every fixture/action/assertion below is rolled back; no real company IDs or data.
begin;
create function office_test.expect_preview_error(label text,request jsonb)
returns void language plpgsql as $$
declare error_text text; caught boolean:=false;
begin
  begin
    perform public.office_request(office_test.id(1001),request);
  exception when sqlstate 'P0001' then
    caught:=true; get stacked diagnostics error_text=message_text;
    if error_text::jsonb->>'code' is distinct from 'SPREADSHEET_PREVIEW_ONLY'
       or error_text::jsonb->>'status' is distinct from '409' then
      raise exception 'Unexpected preview error: %',error_text;
    end if;
  end;
  perform office_test.assert(caught,label);
end;
$$;
set local role authenticated;
select office_test.login(2);
do $$
declare
  normal jsonb:='{"schemaVersion":1,"kind":"spreadsheet","workbook":{"id":"book","name":"Synthetic","sheetOrder":["sheet"],"sheets":{"sheet":{"id":"sheet","name":"List","rowCount":10,"columnCount":5,"cellData":{"0":{"0":{"v":12,"f":"=6+6"}}}}}}}'::jsonb;
  preview jsonb; changed jsonb; f jsonb; folder jsonb; copied jsonb; r jsonb; small jsonb; proposed jsonb; legacy jsonb;
begin
  preview:=jsonb_set(normal,'{workbook,officeCalculationMode}','"cached-readonly-v1"');
  changed:=jsonb_set(normal,'{workbook,sheets,sheet,cellData,0,0,v}','99');
  f:=public.office_request(office_test.id(1001),jsonb_build_object('op','import','title','Synthetic cached preview','content',preview,
    'original',jsonb_build_object('name','synthetic.xlsx','mime','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','size',3,'sha256',encode(sha256(convert_to('abc','UTF8')),'hex'),'base64','YWJj'),
    'idempotencyKey','preview-import'))->'file';
  perform office_test.assert(f->'content'=preview,'import preserves preview marker and cached snapshot');
  perform office_test.expect_preview_error('direct save cannot strip marker',jsonb_build_object('op','save','id',f->>'id','expectedRevision',1,'content',normal,'idempotencyKey','preview-blocked-strip'));
  perform office_test.expect_preview_error('direct save cannot edit values while retaining marker',jsonb_build_object('op','save','id',f->>'id','expectedRevision',1,'content',jsonb_set(changed,'{workbook,officeCalculationMode}','"cached-readonly-v1"'),'idempotencyKey','preview-blocked-value'));
  perform office_test.expect_preview_error('direct proposal cannot bypass preview using stripped marker',jsonb_build_object('op','propose','id',f->>'id','expectedRevision',1,'content',changed,'summary','Must not create','idempotencyKey','preview-blocked-propose'));
  r:=public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'));
  perform office_test.assert(r->'file'=f,'failed edits preserve content and revision');
  r:=jsonb_build_object('op','rename','id',f->>'id','expectedRevision',1,'title','Renamed preview','idempotencyKey','preview-rename');
  f:=public.office_request(office_test.id(1001),r)->'file';
  perform office_test.assert(f->>'title'='Renamed preview' and f->'content'=preview and f->>'revision'='2','metadata rename succeeds with identical content');
  perform office_test.assert(public.office_request(office_test.id(1001),r)->'file'=f,'metadata rename remains idempotent');
  folder:=public.office_request(office_test.id(1001),'{"op":"create","kind":"folder","title":"Preview folder","idempotencyKey":"preview-folder"}')->'file';
  f:=public.office_request(office_test.id(1001),jsonb_build_object('op','move','id',f->>'id','expectedRevision',2,'parentId',folder->>'id','idempotencyKey','preview-move'))->'file';
  perform office_test.assert(f->>'parentId'=folder->>'id' and f->'content'=preview,'metadata move preserves cached content');
  f:=public.office_request(office_test.id(1001),jsonb_build_object('op','link','id',f->>'id','expectedRevision',3,'type','job','entityId',office_test.id(2001),'idempotencyKey','preview-link'))->'file';
  perform office_test.assert(f#>>'{link,id}'=office_test.id(2001)::text and f->'content'=preview,'metadata job link preserves cached content');
  copied:=public.office_request(office_test.id(1001),jsonb_build_object('op','copy','id',f->>'id','title','Preview copy','idempotencyKey','preview-copy'))->'file';
  perform office_test.assert(copied->'content'=preview and copied->>'id'<>f->>'id','copy retains preview protection');
  perform office_test.expect_preview_error('copy cannot become editable by stripping marker',jsonb_build_object('op','save','id',copied->>'id','expectedRevision',1,'content',normal,'idempotencyKey','preview-blocked-copy-save'));
  r:=public.office_request(office_test.id(1001),jsonb_build_object('op','original','id',copied->>'id'));
  perform office_test.assert(r->>'base64'='YWJj' and r->>'name'='synthetic.xlsx','copy retains exact original bytes');
  r:=public.office_request(office_test.id(1001),jsonb_build_object('op','original','id',f->>'id'));
  perform office_test.assert(r->>'base64'='YWJj','original download remains available');
  perform public.office_request(office_test.id(1001),jsonb_build_object('op','recordExport','id',f->>'id','format','xlsx'));
  perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'))->'file'=f,'export audit leaves snapshot unchanged');
  r:=public.office_request(office_test.id(1001),jsonb_build_object('op','listVersions','id',f->>'id'));
  perform office_test.assert(jsonb_array_length(r->'versionSummaries')=4,'preview metadata history remains readable');
  r:=public.office_request(office_test.id(1001),jsonb_build_object('op','readVersion','id',f->>'id','revision',1));
  perform office_test.assert(r#>'{version,content}'=preview,'original preview version remains readable');
  perform public.office_request(office_test.id(1001),jsonb_build_object('op','delete','id',copied->>'id','expectedRevision',1,'idempotencyKey','preview-delete'));
  perform office_test.expect_rpc_error('preview copy soft delete succeeds',office_test.id(1001),jsonb_build_object('op','read','id',copied->>'id'),'NOT_FOUND');
  perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','original','id',f->>'id'))->>'base64'='YWJj','deleting copy preserves source original');

  small:=public.office_request(office_test.id(1001),jsonb_build_object('op','create','kind','spreadsheet','title','Editable control','content',normal,'idempotencyKey','preview-control-create'))->'file';
  small:=public.office_request(office_test.id(1001),jsonb_build_object('op','save','id',small->>'id','expectedRevision',1,'content',changed,'idempotencyKey','preview-control-save'))->'file';
  perform office_test.assert(small->'content'=changed,'ordinary spreadsheet saves remain editable');
  proposed:=public.office_request(office_test.id(1001),jsonb_build_object('op','propose','id',small->>'id','expectedRevision',2,'content',normal,'summary','Control proposal','idempotencyKey','preview-control-propose'))->'proposal';
  small:=public.office_request(office_test.id(1001),jsonb_build_object('op','approve','id',small->>'id','expectedRevision',2,'proposalId',proposed->>'id','idempotencyKey','preview-control-approve'))->'file';
  perform office_test.assert(small->'content'=normal,'ordinary proposals and approvals still work');

  -- Simulate an already pending proposal when the file is first marked read-only.
  legacy:=public.office_request(office_test.id(1001),jsonb_build_object('op','create','kind','spreadsheet','title','Existing proposal fixture','content',normal,'idempotencyKey','preview-existing-create'))->'file';
  proposed:=public.office_request(office_test.id(1001),jsonb_build_object('op','propose','id',legacy->>'id','expectedRevision',1,'content',changed,'summary','Existing pending change','idempotencyKey','preview-existing-propose'))->'proposal';
  insert into office_test.state values('preview.file',f),('preview.legacy',legacy),('preview.pending',proposed),('preview.content',preview);
end;
$$;
reset role;
update office_private.files set content=jsonb_set(content,'{workbook,officeCalculationMode}','"cached-readonly-v1"')
  where company_id=office_test.id(1001) and id=(select v->>'id' from office_test.state where k='preview.legacy');
set local role authenticated;
do $$
declare f jsonb:=(select v from office_test.state where k='preview.legacy'); p jsonb:=(select v from office_test.state where k='preview.pending');
begin
  perform office_test.expect_preview_error('preexisting proposal cannot overwrite preview',jsonb_build_object('op','approve','id',f->>'id','expectedRevision',1,'proposalId',p->>'id','idempotencyKey','preview-blocked-approve'));
  perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','readProposal','id',f->>'id','proposalId',p->>'id'))#>>'{proposal,status}'='pending','failed approval rolls back proposal transition');
  perform office_test.expect_preview_error('restore cannot replace snapshot with unmarked older version',jsonb_build_object('op','restore','id',f->>'id','expectedRevision',1,'revision',1,'idempotencyKey','preview-blocked-restore'));
  perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'))#>'{file,content}'=(select v from office_test.state where k='preview.content'),'failed approval and restore preserve snapshot');
end;
$$;
select office_test.login(5);
do $$
declare f jsonb:=(select v from office_test.state where k='preview.file');
begin
  perform office_test.expect_rpc_error('other company member cannot read preview',office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'),'FORBIDDEN');
  perform office_test.expect_rpc_error('other company scope cannot resolve preview ID',office_test.id(1002),jsonb_build_object('op','original','id',f->>'id'),'NOT_FOUND');
  perform office_test.expect_rpc_error('other company scope cannot copy preview',office_test.id(1002),jsonb_build_object('op','copy','id',f->>'id','title','Forbidden','idempotencyKey','preview-cross-copy'),'NOT_FOUND');
end;
$$;
select office_test.login(4);
do $$
declare f jsonb:=(select v from office_test.state where k='preview.file');
begin
  perform office_test.assert(public.office_request(office_test.id(1001),jsonb_build_object('op','read','id',f->>'id'))->'file'=f,'authorized reader keeps preview access');
  perform office_test.expect_rpc_error('reader cannot rename preview',office_test.id(1001),jsonb_build_object('op','rename','id',f->>'id','expectedRevision',4,'title','Denied','idempotencyKey','preview-reader-rename'),'FORBIDDEN');
end;
$$;
select office_test.expect_sqlstate('authenticated cannot bypass guard using table writes','update office_private.files set content=null','42501');
set constraints all immediate;
reset role;
do $$
begin
  perform office_test.assert(not exists(select 1 from office_private.receipts where key like 'preview-blocked-%'),'blocked writes leave no idempotency receipts');
  perform office_test.assert((select count(*) from office_private.versions where company_id=office_test.id(1001) and file_id=(select v->>'id' from office_test.state where k='preview.legacy'))=1,'blocked restore and approval leave no history entries');
  perform office_test.assert((select count(*) from office_private.audit_events where event->>'operation'='recordExport' and file_id=(select v->>'id' from office_test.state where k='preview.file'))=1,'preview export audit still recorded');
  perform office_test.assert(not has_function_privilege('authenticated','office_private.guard_cached_preview_content()','EXECUTE') and not has_function_privilege('anon','office_private.guard_cached_preview_proposal()','EXECUTE') and not has_function_privilege('service_role','office_private.guard_cached_preview_content()','EXECUTE'),'new private functions are not API-callable');
end;
$$;
select jsonb_build_object('count',count(*),'cases',jsonb_agg(label order by label)) as result from office_test.results;
rollback;
