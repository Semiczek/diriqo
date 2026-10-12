/** Actual PostgreSQL deferred-trigger regression, not a mocked database.
 * Uses ONLY the already approved PGlite 0.5.8 named by OFFICE_PGLITE_MODULE.
 * No network, dependency install, persistent database or application writes.
 * Auth fixture claims model host contracts; this does not verify Supabase JWTs.
 * Crucially, each RPC transaction stays SET LOCAL ROLE authenticated through COMMIT.
 */
import {readFile,realpath,stat,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const document=text=>({schemaVersion:1,kind:'document',page:{marginMm:20,header:'',footer:''},doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]}});
const report={checkedAt:new Date().toISOString(),engine:'PostgreSQL via existing PGlite 0.5.8',scope:'isolated local in-memory explicit authenticated COMMIT',hosts:[],limitations:['Fixture Auth/host contracts, not real JWT verification','No remote database or production proof','Sequential transactions, not a multisession race test']};
try{
 if(process.argv.length!==2)throw Error('No CLI target or network arguments are accepted');
 const requested=process.env.OFFICE_PGLITE_MODULE;
 if(!requested||!path.isAbsolute(requested))throw Error('Set OFFICE_PGLITE_MODULE to an approved existing absolute local module path');
 const modulePath=await realpath(requested);
 if(!modulePath.split(path.sep).join('/').endsWith('/@electric-sql/pglite/dist/index.js')||!(await stat(modulePath)).isFile())throw Error('Expected installed @electric-sql/pglite/dist/index.js');
 const packagePath=path.resolve(path.dirname(modulePath),'..');
 const metadata=JSON.parse(await readFile(path.join(packagePath,'package.json'),'utf8'));
 assert.equal(metadata.name,'@electric-sql/pglite');assert.equal(metadata.version,'0.5.8');assert.equal(metadata.license,'Apache-2.0');await readFile(path.join(packagePath,'LICENSE'),'utf8');
 const {PGlite}=await import(pathToFileURL(modulePath).href);
 const files=['tests/database-fixture.sql','database/office-core.sql','database/office-hub-adapter.sql','database/office-diriqo-adapter.sql','database/office-normalized.sql','database/office-normalized-receipt-commit.sql'];
 const sources=Object.fromEntries(await Promise.all(files.map(async file=>[file,await readFile(path.join(root,file),'utf8')])));
 report.sourceSha256=Object.fromEntries(Object.entries(sources).map(([file,source])=>[file,hash(source)]));
 for(const host of ['hub','diriqo']){
  const db=new PGlite(),labels=[];let phase='initialize';
  const result={host,status:'RUNNING',labels};report.hosts.push(result);
  const check=(label,ok)=>{assert.ok(ok,label);labels.push(label);};
  async function scalar(sql,args=[]){return (await db.query(sql,args)).rows[0];}
  async function transaction(user,tenant,request){
   let at='BEGIN';
   try{
    await db.exec('BEGIN; SET LOCAL ROLE authenticated;');
    await db.query('SELECT office_test.login($1)',[user]);
    assert.equal((await scalar('SELECT current_user AS actor')).actor,'authenticated');
    at='RPC';const response=(await scalar('SELECT public.office_request($1::uuid,$2::jsonb) AS result',[id(tenant),JSON.stringify(request)])).result;
    assert.equal((await scalar('SELECT current_user AS actor')).actor,'authenticated','RPC must restore caller role before COMMIT');
    at='COMMIT';await db.exec('COMMIT;');return response;
   }catch(error){await db.exec('ROLLBACK;');Object.assign(error,{testPhase:at});throw error;}
  }
  try{
   await db.waitReady;await db.exec("SET statement_timeout='20s'; SET lock_timeout='2s';");
   await db.query("SELECT set_config('office_test.host',$1,false)",[host]);
   for(const file of ['tests/database-fixture.sql','database/office-core.sql',`database/office-${host}-adapter.sql`,'database/office-normalized.sql']){phase=file;await db.exec(sources[file]);}
   await db.exec('INSERT INTO public.office_settings(company_id,enabled) VALUES(office_test.id(1001),true),(office_test.id(1002),true);');
   const before=await scalar("SELECT p.prosecdef AS definer,p.proconfig AS config FROM pg_proc p WHERE p.oid='office_private.receipt_complete_v2()'::regprocedure");
   check('baseline receipt trigger is invoker',before.definer===false);
   const create={op:'create',kind:'document',title:'Deferred receipt regression',content:document('Původní obsah'),idempotencyKey:'explicit-commit-create'};
   phase='baseline: authenticated caller COMMIT';let baselineCommitted=0;
   try{
    await transaction(2,1001,{...create,idempotencyKey:'explicit-commit-baseline'});baselineCommitted=1;
    result.red={status:'NOT_REPRODUCED_IN_PGLITE',phase:'COMMIT',message:'Explicit BEGIN / SET LOCAL ROLE authenticated / RPC / COMMIT succeeded in PGlite although the source trigger was INVOKER. No claim of local RED reproduction.'};
    report.limitations.push(host+': PGlite did not reproduce the independently observed live staging 42501. This local run proves the fixed path/security assertions only.');
   }catch(error){
    assert.ok(error.testPhase==='COMMIT'&&error.code==='42501'&&/permission denied for schema office_private/i.test(error.message),'Baseline must fail at COMMIT with the precise private-schema permission error');
    result.red={status:'REPRODUCED',phase:error.testPhase,sqlstate:error.code,message:String(error.message)};
    labels.push('RED reproduced: RPC succeeded but authenticated COMMIT failed 42501');
    const rolledBack=await scalar('SELECT (SELECT count(*)::integer FROM office_private.files) AS files,(SELECT count(*)::integer FROM office_private.receipts) AS receipts');
    check('failed deferred COMMIT rolled back file and receipt',rolledBack.files===0&&rolledBack.receipts===0);
   }
   const functionsBefore=(await db.query("SELECT oid::text AS id,proname,prosecdef,proconfig,proacl::text FROM pg_proc WHERE pronamespace='office_private'::regnamespace ORDER BY oid")).rows;
   phase='apply exact additive fix';await db.exec(sources['database/office-normalized-receipt-commit.sql']);
   const functionsAfter=(await db.query("SELECT oid::text AS id,proname,prosecdef,proconfig,proacl::text FROM pg_proc WHERE pronamespace='office_private'::regnamespace ORDER BY oid")).rows;
   const changed=functionsAfter.filter((fn,index)=>JSON.stringify(fn)!==JSON.stringify(functionsBefore[index]));
   check('only receipt_complete_v2 function authority changed',changed.length===1&&changed[0].proname==='receipt_complete_v2');
   const fixed=await scalar("SELECT p.prosecdef AS definer,p.proconfig AS config FROM pg_proc p WHERE p.oid='office_private.receipt_complete_v2()'::regprocedure");
   check('fixed definer uses only pg_catalog search_path',fixed.definer===true&&JSON.stringify(fixed.config)===JSON.stringify(['search_path=pg_catalog']));
   const grants=(await db.query("SELECT r,has_schema_privilege(r,'office_private','USAGE') AS schema_access,has_table_privilege(r,'office_private.receipts','SELECT,INSERT,UPDATE,DELETE') AS table_access,has_function_privilege(r,'office_private.receipt_complete_v2()','EXECUTE') AS fn_access FROM unnest(ARRAY['anon','authenticated','service_role']) r")).rows;
   check('all client roles still lack private schema/table/trigger execute',grants.every(row=>!row.schema_access&&!row.table_access&&!row.fn_access));
   phase='GREEN: authenticated create COMMIT';const created=await transaction(2,1001,create);
   check('GREEN create committed as authenticated caller',created.file.revision===1&&created.file.tenantId===id(1001));
   const replay=await transaction(2,1001,create);check('same create receipt replays across committed transactions',JSON.stringify(replay)===JSON.stringify(created));
   const save={op:'save',id:created.file.id,expectedRevision:1,content:document('Nová verze'),idempotencyKey:'explicit-commit-save'};
   phase='GREEN: authenticated save COMMIT';const saved=await transaction(3,1001,save);
   check('manager save committed revision 2',saved.file.revision===2&&saved.file.content.doc.content[0].content[0].text==='Nová verze');
   const savedReplay=await transaction(3,1001,save);check('same save receipt replays without another revision',JSON.stringify(savedReplay)===JSON.stringify(saved));
   const counts=await scalar('SELECT (SELECT count(*)::integer FROM office_private.files) AS files,(SELECT count(*)::integer FROM office_private.versions) AS versions,(SELECT count(*)::integer FROM office_private.receipts WHERE response IS NULL) AS incomplete');
   check('committed storage has exactly one new file, two new versions and no placeholder',counts.files===baselineCommitted+1&&counts.versions===baselineCommitted+2&&counts.incomplete===0);
   const second=await transaction(5,1002,create);check('same operation key in another company remains isolated',second.file.id!==created.file.id&&second.file.tenantId===id(1002));
   await assert.rejects(transaction(2,1002,{op:'read',id:second.file.id}),error=>error.testPhase==='RPC'&&error.code==='P0001'&&JSON.parse(error.message).code==='FORBIDDEN');labels.push('definer trigger does not widen cross-company RPC access');
   phase='incomplete receipt negative COMMIT';
   await db.exec('BEGIN;');await db.query("INSERT INTO office_private.receipts(company_id,actor_id,key,fingerprint,response) VALUES($1::uuid,$2,'incomplete-owner-fixture',$3,NULL)",[id(1001),id(102),'a'.repeat(64)]);
   await assert.rejects(db.exec('COMMIT;'),error=>error.code==='P0001'&&error.message==='OFFICE_INCOMPLETE_RECEIPT');await db.exec('ROLLBACK;');labels.push('deferred completeness check still rejects a real incomplete receipt');
   check('incomplete receipt was not committed',(await scalar("SELECT count(*)::integer AS n FROM office_private.receipts WHERE key='incomplete-owner-fixture'")).n===0);
   result.status='PASS';result.assertions=labels.length;console.log(JSON.stringify({host,status:result.status,assertions:labels.length,red:result.red}));
  }catch(error){result.status='FAIL';result.phase=phase;result.error={message:String(error.message).slice(0,2000),code:error.code??null};console.error(JSON.stringify(result));process.exitCode=1;}
  finally{try{await db.exec('ROLLBACK; RESET ROLE;');}catch{}await db.close();}
  if(process.exitCode)break;
 }
}catch(error){report.error={message:String(error.message).slice(0,2000),code:error.code??null};console.error(JSON.stringify(report.error));process.exitCode=1;}
report.status=process.exitCode?'FAIL':report.hosts.some(host=>host.red?.status==='NOT_REPRODUCED_IN_PGLITE')?'PASS_FIXED_PATH_WITH_BASELINE_LIMITATION':'PASS';await mkdir(path.join(root,'reports'),{recursive:true});await writeFile(path.join(root,'reports/database-receipt-commit-validation.json'),JSON.stringify(report,null,2)+'\n');
