-- Authorized test project wfcpfraxiuhuglnuaxqj only; execute AFTER cached-preview guard migration.
-- No DDL or helper functions. Synthetic identities and Office rows live only in the
-- forced-rollback subtransaction. Direct authenticated RPC proof, not HTTP/JWT verification.
-- Original is the repository's real synthetic formula-demo.xlsx (2289 bytes), SHA256 b917c7b6c4ff30550b534728c7af7c06a1d66024ed6d3d263915ae742c3b5221.
-- Canonical fixture is imported through the RPC with an explicit preview marker;
-- this tests persistence/authorization, not the XLSX decoder or automatic large-file threshold.
do $test$
declare
  u uuid:=gen_random_uuid(); foreign_u uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); foreign_actor uuid:=gen_random_uuid();
  c uuid:=gen_random_uuid(); foreign_c uuid:=gen_random_uuid();
  normal jsonb:=$fixture${"schemaVersion":1,"kind":"spreadsheet","workbook":{"id":"64261596-6f31-4019-9d0b-a50272e1f08f","name":"Vzorce a více listů","locale":"enUS","appVersion":"1.0.4","sheetOrder":["sheet-1","rates"],"styles":{},"sheets":{"sheet-1":{"id":"sheet-1","name":"Výpočty","rowCount":200,"columnCount":26,"cellData":{"0":{"0":{"v":10,"t":2},"1":{"v":20,"t":2},"2":{"f":"=SUM(A1:B1)","t":2}},"1":{"0":{"f":"=AVERAGE(A1:B1)","t":2},"1":{"f":"=IF(C1=30,\"ANO\",\"NE\")","t":1}},"2":{"0":{"f":"=ROUND(12.345,2)","t":2},"1":{"f":"=COUNTIF(A1:B1,\">10\")","t":2}},"3":{"0":{"f":"='Sazby'!$A$1*A1","t":2}}},"rowData":{},"columnData":{},"mergeData":[]},"rates":{"id":"rates","name":"Sazby","rowCount":200,"columnCount":26,"cellData":{"0":{"0":{"v":250,"t":2}}},"rowData":{},"columnData":{},"mergeData":[]}}}}$fixture$::jsonb;
  original_base64 text:='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'; preview jsonb; changed jsonb; f jsonb; small jsonb; result jsonb; request jsonb;
  failure text; failure_state text; cases jsonb:='[]'::jsonb;
begin
  assert exists(select 1 from pg_trigger where tgrelid='office_private.files'::regclass and tgname='office_cached_preview_content' and tgenabled='O'), 'cached-preview content guard must be installed';
  assert exists(select 1 from pg_trigger where tgrelid='office_private.proposals'::regclass and tgname='office_cached_preview_proposal' and tgenabled='O'), 'cached-preview proposal guard must be installed';
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (u,'office-preview-'||u||'@example.invalid','{}'),(foreign_u,'office-preview-'||foreign_u||'@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (actor,u,u,'Synthetic Office preview admin'),(foreign_actor,foreign_u,foreign_u,'Synthetic Office preview foreign admin');
    insert into public.companies(id,name) values(c,'Synthetic Office preview test'),(foreign_c,'Synthetic Office preview foreign');
    insert into public.company_members(id,company_id,profile_id,role,is_active) values
      (gen_random_uuid(),c,actor,'company_admin',true),(gen_random_uuid(),foreign_c,foreign_actor,'company_admin',true);
    insert into public.office_settings(company_id,enabled) values(c,true),(foreign_c,true) on conflict(company_id) do update set enabled=true;
    perform set_config('request.jwt.claim.sub',u::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    preview:=jsonb_set(jsonb_set(normal,'{workbook,officeCalculationMode}','"cached-readonly-v1"'),'{workbook,sheets,sheet-1,cellData,0,2,v}','30');
    changed:=jsonb_set(preview,'{workbook,sheets,sheet-1,cellData,0,2,v}','99');
    request:=jsonb_build_object('op','import','title','Synthetic real XLSX preview','content',preview,
      'original',jsonb_build_object('name','formula-demo.xlsx','mime','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'size',2289,'sha256','b917c7b6c4ff30550b534728c7af7c06a1d66024ed6d3d263915ae742c3b5221','base64',original_base64), 'idempotencyKey','preview-import-'||c);
    f:=public.office_request(c,request)->'file';
    assert f->'content'=preview and f->>'revision'='1','RPC import must retain marker and complete snapshot';cases:=cases||jsonb_build_array('real XLSX original and preview snapshot imported through RPC');
    result:=public.office_request(c,jsonb_build_object('op','read','id',f->>'id'));
    assert result->'file'=f,'RPC read must return stored snapshot';cases:=cases||jsonb_build_array('RPC read returns persisted preview');

    failure:=null;failure_state:=null;
    begin
      perform public.office_request(c,jsonb_build_object('op','save','id',f->>'id','expectedRevision',1,'content',preview #- '{workbook,officeCalculationMode}','idempotencyKey','preview-blocked-strip-'||c));
    exception when others then failure:=sqlerrm;failure_state:=sqlstate;end;
    assert failure_state='P0001' and failure::jsonb->>'code'='SPREADSHEET_PREVIEW_ONLY' and failure::jsonb->>'status'='409','stripping marker must return preview-only 409';cases:=cases||jsonb_build_array('direct save with stripped marker denied 409');
    failure:=null;failure_state:=null;
    begin
      perform public.office_request(c,jsonb_build_object('op','save','id',f->>'id','expectedRevision',1,'content',changed,'idempotencyKey','preview-blocked-cache-'||c));
    exception when others then failure:=sqlerrm;failure_state:=sqlstate;end;
    assert failure_state='P0001' and failure::jsonb->>'code'='SPREADSHEET_PREVIEW_ONLY' and failure::jsonb->>'status'='409','changed cached snapshot must return preview-only 409';cases:=cases||jsonb_build_array('direct save with changed cache denied 409');
    failure:=null;failure_state:=null;
    begin
      perform public.office_request(c,jsonb_build_object('op','propose','id',f->>'id','expectedRevision',1,'content',normal,'summary','Must not create','idempotencyKey','preview-blocked-propose-'||c));
    exception when others then failure:=sqlerrm;failure_state:=sqlstate;end;
    assert failure_state='P0001' and failure::jsonb->>'code'='SPREADSHEET_PREVIEW_ONLY' and failure::jsonb->>'status'='409','proposal must return preview-only 409';cases:=cases||jsonb_build_array('direct proposal with stripped marker denied 409');
    assert public.office_request(c,jsonb_build_object('op','read','id',f->>'id'))->'file'=f,'failed writes must not change file or revision';cases:=cases||jsonb_build_array('blocked edits leave persisted file unchanged');

    request:=jsonb_build_object('op','rename','id',f->>'id','expectedRevision',1,'title','Renamed synthetic preview','idempotencyKey','preview-rename-'||c);
    f:=public.office_request(c,request)->'file';
    assert f->'content'=preview and f->>'title'='Renamed synthetic preview' and f->>'revision'='2','metadata rename must work';cases:=cases||jsonb_build_array('metadata rename succeeds and keeps snapshot');
    assert public.office_request(c,request)->'file'=f,'rename retry must be idempotent';cases:=cases||jsonb_build_array('rename retry preserves same revision');
    result:=public.office_request(c,jsonb_build_object('op','original','id',f->>'id'));
    assert result->>'base64'=original_base64 and encode(sha256(decode(result->>'base64','base64')),'hex')='b917c7b6c4ff30550b534728c7af7c06a1d66024ed6d3d263915ae742c3b5221','original download must return exact fixture bytes';cases:=cases||jsonb_build_array('original XLSX download SHA preserved');
    perform public.office_request(c,jsonb_build_object('op','recordExport','id',f->>'id','format','xlsx'));
    assert public.office_request(c,jsonb_build_object('op','read','id',f->>'id'))->'file'=f,'export audit cannot mutate snapshot';cases:=cases||jsonb_build_array('export audit keeps snapshot unchanged');
    result:=public.office_request(c,jsonb_build_object('op','readVersion','id',f->>'id','revision',1));
    assert result#>'{version,content}'=preview,'preview history must remain readable';cases:=cases||jsonb_build_array('preview original version remains readable');

    small:=public.office_request(c,jsonb_build_object('op','create','kind','spreadsheet','title','Synthetic editable control','content',normal,'idempotencyKey','preview-normal-create-'||c))->'file';
    normal:=jsonb_set(normal,'{workbook,sheets,sheet-1,cellData,0,0,v}','123');
    small:=public.office_request(c,jsonb_build_object('op','save','id',small->>'id','expectedRevision',1,'content',normal,'idempotencyKey','preview-normal-save-'||c))->'file';
    assert small->'content'=normal and small->>'revision'='2','ordinary spreadsheet must remain editable';cases:=cases||jsonb_build_array('ordinary spreadsheet save remains editable');

    perform set_config('request.jwt.claim.sub',foreign_u::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',foreign_u,'role','authenticated')::text,true);
    failure:=null;failure_state:=null;
    begin perform public.office_request(c,jsonb_build_object('op','read','id',f->>'id'));
    exception when others then failure:=sqlerrm;failure_state:=sqlstate;end;
    assert failure_state='P0001' and failure::jsonb->>'code'='FORBIDDEN','foreign member must not read tenant A';cases:=cases||jsonb_build_array('foreign company membership denied');
    failure:=null;failure_state:=null;
    begin perform public.office_request(foreign_c,jsonb_build_object('op','original','id',f->>'id'));
    exception when others then failure:=sqlerrm;failure_state:=sqlstate;end;
    assert failure_state='P0001' and failure::jsonb->>'code'='NOT_FOUND','foreign scope must not resolve tenant A original';cases:=cases||jsonb_build_array('foreign company cannot resolve original ID');
    execute 'set constraints all immediate';
    execute 'reset role';
    assert not exists(select 1 from office_private.receipts where company_id=c and key like 'preview-blocked-%'),'failed writes cannot leave receipts';cases:=cases||jsonb_build_array('blocked writes leave no receipts');
    assert not exists(select 1 from office_private.proposals where company_id=c),'denied proposal cannot remain';cases:=cases||jsonb_build_array('blocked proposal leaves no rows');
    raise exception using errcode='PT001',message='ROLLBACK_SYNTHETIC_OFFICE_PREVIEW';
  exception when sqlstate 'PT001' then
    if sqlerrm <> 'ROLLBACK_SYNTHETIC_OFFICE_PREVIEW' then raise;end if;
  end;
  assert not exists(select 1 from auth.users where id in (u,foreign_u)),'synthetic Auth rows rolled back';
  assert not exists(select 1 from public.profiles where id in (actor,foreign_actor)),'synthetic profiles rolled back';
  assert not exists(select 1 from public.companies where id in (c,foreign_c)),'synthetic companies rolled back';
  assert not exists(select 1 from public.company_members where company_id in (c,foreign_c)),'synthetic memberships rolled back';
  assert not exists(select 1 from public.office_settings where company_id in (c,foreign_c)),'synthetic Office settings rolled back';
  assert not exists(select 1 from office_private.files where company_id in (c,foreign_c)),'synthetic files rolled back';
  assert not exists(select 1 from office_private.versions where company_id in (c,foreign_c)),'synthetic history rolled back';
  assert not exists(select 1 from office_private.proposals where company_id in (c,foreign_c)),'synthetic proposals rolled back';
  assert not exists(select 1 from office_private.receipts where company_id in (c,foreign_c)),'synthetic receipts rolled back';
  assert not exists(select 1 from office_private.original_blobs where company_id in (c,foreign_c)),'synthetic original blobs rolled back';
  assert not exists(select 1 from office_private.file_originals where company_id in (c,foreign_c)),'synthetic original refs rolled back';
  assert not exists(select 1 from office_private.audit_events where company_id in (c,foreign_c)),'synthetic audit rows rolled back';
  assert not exists(select 1 from office_private.topology_locks where company_id in (c,foreign_c)),'synthetic topology rows rolled back';
  assert not exists(select 1 from office_private.persistence_migrations where company_id in (c,foreign_c)),'synthetic persistence rows rolled back';
  perform set_config('test.office_cached_preview_report',jsonb_build_object('fixtures','rolled_back','count',jsonb_array_length(cases),'cases',cases,'cleanup_assertions',14,'original_sha256','b917c7b6c4ff30550b534728c7af7c06a1d66024ed6d3d263915ae742c3b5221')::text,true);
end $test$;
select current_setting('test.office_cached_preview_report')::jsonb as result;
