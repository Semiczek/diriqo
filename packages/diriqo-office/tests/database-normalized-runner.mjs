/** Local-only normalized persistence verification. No network, remote DB, install or persistent DB directory.
 * Requires the same already reviewed PGlite 0.5.8 runtime as database-runner.mjs.
 * Run with OFFICE_PGLITE_MODULE pointing to its existing absolute dist/index.js.
 * The exact authored migration is loaded after core + the actual host adapter.
 * A deliberately injected pre-COMMIT exception tests transaction rollback in an
 * isolated DB; the on-disk migration is never modified. This does not establish
 * native multisession scheduling, deployed JWT/Auth/RLS or live migration success.
 */
import {readFile,realpath,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const report={schemaVersion:1,startedAt:new Date().toISOString(),status:'RUNNING',scope:'Local PGlite fresh in-memory host fixtures; legacy migration rollback/backfill, normalized tenant boundaries and logical capacity. No network or production.',hosts:[],limitations:['No native multisession or DB lock scheduling proof.','No full Supabase JWT/gateway or host entitlement evaluator proof.','Logical JSON size is measured; physical TOAST/disk compression and production capacity are not benchmarked.']};
const seed=String.raw`
insert into public.office_settings(company_id,enabled) values(office_test.id(1001),true),(office_test.id(1002),true);
set role authenticated;
select office_test.login(2);
do $$
declare req jsonb;first jsonb;latest jsonb;original jsonb;
begin
 req:=jsonb_build_object('op','create','title','Legacy normalized test','kind','document','content',office_test.doc('Legacy version one'),'idempotencyKey','normalized-legacy-create');
 first:=public.office_request(office_test.id(1001),req);
 insert into office_test.state values('normalized.legacy.create-request',req),('normalized.legacy.create-response',first);
 latest:=public.office_request(office_test.id(1001),jsonb_build_object('op','save','id',first#>>'{file,id}','expectedRevision',1,'content',office_test.doc('Legacy version two'),'idempotencyKey','normalized-legacy-save'));
 insert into office_test.state values('normalized.legacy.file',latest->'file');
 perform public.office_request(office_test.id(1001),jsonb_build_object('op','propose','id',first#>>'{file,id}','expectedRevision',2,'content',office_test.doc('Legacy pending proposal'),'summary','Review legacy proposal','idempotencyKey','normalized-legacy-propose'));
 original:=jsonb_build_object('name','legacy.txt','mime','text/plain','size',3,'sha256',encode(sha256(convert_to('abc','UTF8')),'hex'),'base64','YWJj');
 latest:=public.office_request(office_test.id(1001),jsonb_build_object('op','import','title','Legacy original','content',office_test.doc('Legacy imported text'),'original',original,'idempotencyKey','normalized-legacy-import'));
 insert into office_test.state values('normalized.legacy.import-response',latest);
end;$$;
reset role;
create function office_test.migration_tripwire() returns void language plpgsql as $$begin raise exception 'NORMALIZED_MIGRATION_TEST_TRIPWIRE';end;$$;
`;
function chunks(source){
 const blocks=[];let lines=[];
 for(const line of source.split('\n')){
  if(lines.length&&/^(?:do \$\$|select office_test\.|reset role;|set role |insert into public\.)/.test(line)){blocks.push(lines.join('\n'));lines=[];}
  lines.push(line);
 }
 if(lines.length)blocks.push(lines.join('\n'));return blocks;
}
async function snapshot(db){
 const state=(await db.query('select company_id::text,state from office_private.tenant_state order by company_id')).rows;
 const rpc=(await db.query("select pg_get_functiondef('public.office_request(uuid,jsonb,text)'::regprocedure) as definition")).rows[0].definition;
 const settings=(await db.query('select company_id::text,enabled,updated_at::text,updated_by::text from public.office_settings order by company_id')).rows;
 return {state,stateHash:hash(JSON.stringify(state)),rpcHash:hash(rpc),settingsHash:hash(JSON.stringify(settings))};
}
async function rejectedMigration(db,source,want){
 let error;
 try{await db.exec(source);}catch(found){error=found;}
 await db.exec('ROLLBACK; RESET ROLE;');
 assert.ok(error,'Migration was expected to reject and roll back');
 if(want)assert.ok(String(error.message).includes(want),'Expected controlled migration tripwire');
 return error.code??null;
}
try{
 const configured=process.env.OFFICE_PGLITE_MODULE;
 if(!configured||!path.isAbsolute(configured))throw Error('OFFICE_PGLITE_MODULE must name the approved existing absolute PGlite runtime.');
 const file=await realpath(configured);
 if(!file.split(path.sep).join('/').endsWith('/@electric-sql/pglite/dist/index.js')||!(await stat(file)).isFile())throw Error('Expected existing PGlite dist/index.js');
 const metadata=JSON.parse(await readFile(path.resolve(path.dirname(file),'..','package.json'),'utf8'));
 if(metadata.name!=='@electric-sql/pglite'||metadata.version!=='0.5.8'||metadata.license!=='Apache-2.0')throw Error('Only the reviewed existing PGlite 0.5.8 runtime is allowed.');
 await readFile(path.resolve(path.dirname(file),'..','LICENSE'),'utf8');
 const {PGlite}=await import(pathToFileURL(file).href);
 const names=['tests/database-fixture.sql','database/office-core.sql','database/office-hub-adapter.sql','database/office-diriqo-adapter.sql','database/office-normalized.sql','tests/database-normalized-security.sql'];
 const sources=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(path.join(root,name),'utf8')])));
 report.sourceSha256=Object.fromEntries(Object.entries(sources).map(([name,source])=>[name,hash(source)]));
 const migration=sources['database/office-normalized.sql'];
 assert.equal((migration.match(/^\s*begin;\s*$/gim)??[]).length,1,'Migration must have one explicit top-level transaction');
 assert.equal((migration.match(/^\s*commit;\s*$/gim)??[]).length,1,'Migration must have one final commit');
 assert.match(migration,/commit;\s*$/i,'Migration commit must be final');
 const tripwire=migration.replace(/commit;\s*$/i,'select office_test.migration_tripwire();\ncommit;\n');
 for(const host of ['hub','diriqo']){
  const db=new PGlite();let phase='initialize';
  const result={host,status:'RUNNING',checks:[],labels:[]};report.hosts.push(result);
  const check=(label,ok)=>{assert.equal(ok,true,label);result.checks.push(label);};
  try{
   await db.waitReady;await db.exec("SET statement_timeout='120s'; SET lock_timeout='2s';");
   await db.query("select set_config('office_test.host',$1,false)",[host]);
   for(const name of ['tests/database-fixture.sql','database/office-core.sql','database/office-'+host+'-adapter.sql']){phase=name;await db.exec(sources[name]);}
   phase='legacy seed';await db.exec(seed);const before=await snapshot(db);
   phase='migration rollback after complete backfill and RPC replacement';
   await rejectedMigration(db,tripwire,'NORMALIZED_MIGRATION_TEST_TRIPWIRE');
   const rolledBack=await snapshot(db);
   check('migration rollback preserves exact legacy state',rolledBack.stateHash===before.stateHash);
   check('migration rollback preserves legacy RPC definition',rolledBack.rpcHash===before.rpcHash);
   check('migration rollback preserves module settings',rolledBack.settingsHash===before.settingsHash);
   check('migration rollback removes newly created normalized relations',(await db.query("select to_regclass('office_private.files') is null as absent")).rows[0].absent===true);
   const corruptions=[
    ['foreign tenant',"jsonb_set(state,array['files',(select v->>'id' from office_test.state where k='normalized.legacy.file'),'tenantId'],to_jsonb(office_test.id(1002)::text))",'OFFICE_MIGRATION_INVALID_FILE_SCOPE'],
    ['missing tenant',"state #- array['files',(select v->>'id' from office_test.state where k='normalized.legacy.file'),'tenantId']",'OFFICE_MIGRATION_INVALID_FILE_SCOPE'],
    ['foreign receipt tenant',"jsonb_set(state,array['receipts',office_test.id(102)::text||':normalized-legacy-create','response','file','tenantId'],to_jsonb(office_test.id(1002)::text))",'OFFICE_MIGRATION_RECEIPT_SCOPE'],
    ['nonexistent receipt version',"jsonb_set(state,array['receipts',office_test.id(102)::text||':normalized-legacy-create','response','file','revision'],'999'::jsonb)",'OFFICE_MIGRATION_RECEIPT_SCOPE'],
    ['foreign receipt proposal file',"jsonb_set(state,array['receipts',office_test.id(102)::text||':normalized-legacy-propose','response','proposal','fileId'],to_jsonb(office_test.id(1002)::text))",'OFFICE_MIGRATION_RECEIPT_SCOPE'],
    ['changed original digest',"jsonb_set(state,array['files',(select v#>>'{file,id}' from office_test.state where k='normalized.legacy.import-response'),'original','sha256'],to_jsonb(repeat('0',64)))",'OFFICE_MIGRATION_ORIGINAL_INTEGRITY'],
   ];
   for(const [name,expression,rejection]of corruptions){
    phase='corrupted legacy '+name+' rejection';
    await db.exec('update office_private.tenant_state set state='+expression+' where company_id=office_test.id(1001)');
    const corrupted=await snapshot(db);await rejectedMigration(db,migration,rejection);
    check(name+' legacy metadata makes migration fail without losing snapshot',(await snapshot(db)).stateHash===corrupted.stateHash);
    check(name+' validation leaves legacy RPC authoritative',(await snapshot(db)).rpcHash===before.rpcHash);
    check(name+' validation leaves no partial normalized tables',(await db.query("select to_regclass('office_private.files') is null as absent")).rows[0].absent===true);
    for(const row of before.state)await db.query('update office_private.tenant_state set state=$2::jsonb where company_id=$1::uuid',[row.company_id,JSON.stringify(row.state)]);
   }
   phase='normalized migration';await db.exec(migration);
   check('successful migration retains frozen legacy snapshot',(await snapshot(db)).stateHash===before.stateHash);
   const migratedCounts=(await db.query('select (select count(*) from office_private.files)::int files,(select count(*) from office_private.versions)::int versions,(select count(*) from office_private.proposals)::int proposals,(select count(*) from office_private.receipts)::int receipts')).rows[0];
   check('legacy files and versions were backfilled',migratedCounts.files===2&&migratedCounts.versions===3&&migratedCounts.proposals===1&&migratedCounts.receipts===4);
   phase='controlled pre-activity maintenance rollback';
   await db.exec('BEGIN; SELECT office_private.rollback_normalized_company(office_test.id(1001)); SET ROLE authenticated; SELECT office_test.login(2);');
   const rollbackResult=(await db.query("select public.office_request(office_test.id(1001),jsonb_build_object('op','create','title','Rollback routing','kind','document','content',office_test.doc('Legacy after rollback'),'idempotencyKey','rollback-window')) as result")).rows[0].result;
   check('maintenance rollback before activity routes to genuine legacy implementation',rollbackResult?.file?.revision===1);
   await db.exec('ROLLBACK; RESET ROLE;');
   check('isolated rollback exercise leaves snapshot unchanged',(await snapshot(db)).stateHash===before.stateHash);
   console.log(JSON.stringify({host,phase:'normalized security and capacity suite'}));
   for(const [index,block]of chunks(sources['tests/database-normalized-security.sql']).entries()){
    phase='normalized suite block '+(index+1);await db.exec(block);
   }
   result.labels=(await db.query('select label from office_test.results order by label')).rows.map(row=>row.label);
   result.capacity=(await db.query("select v from office_test.state where k='normalized.capacity.metrics'")).rows[0].v;
   check('capacity suite verified all rereads and growth',result.labels.length>=140);
   const metrics=async()=> (await db.query("select (select count(*) from office_private.files)::int files,(select count(*) from office_private.versions)::int versions,(select count(*) from office_private.original_blobs)::int blobs,(select count(*) from office_private.receipts)::int receipts,(select max(revision) from office_private.versions where file_id=(select v->>'id' from office_test.state where k='normalized.capacity.first'))::int latest_revision")).rows[0];
   const after=await metrics();phase='migration reapply after new normalized writes';await db.exec(migration);
   check('reapplying migration does not overwrite or duplicate normalized writes',JSON.stringify(await metrics())===JSON.stringify(after));
   check('normalized operations never rewrite the legacy snapshot',(await snapshot(db)).stateHash===before.stateHash);
   phase='rollback refuses to discard new activity';let rollbackError;
   try{await db.exec('select office_private.rollback_normalized_company(office_test.id(1001))');}catch(error){rollbackError=error;}
   check('maintenance rollback after activity fails without silently losing data',String(rollbackError?.message).includes('OFFICE_ROLLBACK_NEW_ACTIVITY'));
   check('refused rollback preserves normalized rows',JSON.stringify(await metrics())===JSON.stringify(after));
   result.status='PASS';result.assertions=result.labels.length+result.checks.length;
   console.log(JSON.stringify({host,status:'PASS',assertions:result.assertions,capacity:result.capacity}));
  }catch(error){
   result.status='FAIL';result.phase=phase;result.error={code:error.code??null,message:String(error.message).slice(0,500)};process.exitCode=1;
   try{await db.exec('ROLLBACK; RESET ROLE;');result.labels=(await db.query('select label from office_test.results order by label')).rows.map(row=>row.label);}catch{}
   console.error(JSON.stringify({host,status:'FAIL',phase,error:result.error}));
  }finally{await db.close();}
  if(result.status==='FAIL')break;
 }
 report.status=report.hosts.length===2&&report.hosts.every(host=>host.status==='PASS')?'PASS':'FAIL';
}catch(error){report.status='FAIL';report.error={code:error.code??null,message:String(error.message).slice(0,500)};process.exitCode=1;console.error(JSON.stringify(report.error));}
report.finishedAt=new Date().toISOString();await writeFile(path.join(root,'reports/database-normalized-security.json'),JSON.stringify(report,null,2)+'\n');
