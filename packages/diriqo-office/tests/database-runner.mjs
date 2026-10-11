/**
 * Actual PostgreSQL WASM tests. Uses an ALREADY approved local PGlite; no network,
 * external DB, persistent data directory, installation or production migration.
 * Only writes reports/database-validation.json, or with --normalized the separate
 * reports/database-normalized-regression.json in this workspace. The normalized
 * mode runs the SAME behavioral assertions against the new persistence RPC.
 *
 * Set OFFICE_PGLITE_MODULE to an approved absolute local path ending with
 * @electric-sql/pglite/dist/index.js, then run: node tests/database-runner.mjs
 *
 * Each host receives a fresh in-memory DB, closed before the next host. Fixtures
 * implement only host contracts, not full Supabase Auth/PostgREST/billing.
 * Sequential stale-CAS assertions DO NOT establish multisession lock behavior.
 *
 * Manual SQL replay requires a NEW disposable LOCAL PostgreSQL instance:
 * SET office_test.host='hub'; then fixture, office-core, database-office.
 * Diriqo additionally loads office-diriqo-adapter after core.
 * These fixtures are NEVER application migrations.
 */
import {readFile,realpath,stat,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const normalized=process.argv.includes('--normalized');
const LF=String.fromCharCode(10);
const limitation='Not tested: native multi-session race/lock scheduling, Supabase gateway/JWT verification, deployed migrations, live data, full host entitlement evaluator.';
const report={checkedAt:new Date().toISOString(),engine:'PostgreSQL via PGlite 0.5.8',scope:'isolated in-memory, sequential CAS',persistence:normalized?'normalized':'legacy',hosts:[],limitations:[limitation]};
function suiteBlocks(source){
 // Split only the explicit top-level layout of this authored test suite.
 // Each DO body is indented and remains intact. This is not a generic SQL parser.
 const starts=['do $$','select office_test.','reset role;','set role ','update private.','insert into public.office_settings'];
 const blocks=[];let lines=[];
 for(const line of source.split(LF)){
  if(lines.length&&starts.some(prefix=>line.startsWith(prefix))){blocks.push(lines.join(LF));lines=[];}
  lines.push(line);
 }
 if(lines.length)blocks.push(lines.join(LF));
 return blocks;
}
try{
 if(process.argv.slice(2).some(arg=>arg!=='--normalized'))throw new Error('Only optional --normalized is supported.');
 const requested=process.env.OFFICE_PGLITE_MODULE;
 if(!requested||!path.isAbsolute(requested))throw new Error('OFFICE_PGLITE_MODULE must name an approved, already installed LOCAL absolute PGlite dist/index.js path.');
 const moduleFile=await realpath(requested);
 if(!moduleFile.split(path.sep).join('/').endsWith('/@electric-sql/pglite/dist/index.js'))throw new Error('Expected @electric-sql/pglite/dist/index.js, not an arbitrary module.');
 if(!(await stat(moduleFile)).isFile())throw new Error('PGlite module is not a file.');
 const metadata=JSON.parse(await readFile(path.resolve(path.dirname(moduleFile),'..','package.json'),'utf8'));
 if(metadata.name!=='@electric-sql/pglite'||metadata.version!=='0.5.8'||metadata.license!=='Apache-2.0')throw new Error('Harness validated with existing @electric-sql/pglite 0.5.8; review other runtimes first.');
 await readFile(path.resolve(path.dirname(moduleFile),'..','LICENSE'),'utf8');
 const {PGlite}=await import(pathToFileURL(moduleFile).href);
 const sources=Object.fromEntries(await Promise.all([
  'tests/database-fixture.sql','database/office-core.sql','database/office-diriqo-adapter.sql','database/office-hub-adapter.sql','tests/database-office.sql','tests/database-hub-labels.sql',...(normalized?['database/office-normalized.sql']:[])
 ].map(async file=>[file,await readFile(path.join(workspace,file),'utf8')])));
 report.sourceSha256=Object.fromEntries(Object.entries(sources).map(([file,source])=>[file,createHash('sha256').update(source).digest('hex')]));
 for(const host of ['hub','diriqo']){
  const db=new PGlite();
  let phase='initialize',failed=false,labels=[];
  try{
   await db.waitReady;
   await db.exec("SET statement_timeout='20s'; SET lock_timeout='2s';");
   await db.query("SELECT set_config('office_test.host',$1,false)",[host]);
   await db.query("SELECT set_config('office_test.persistence',$1,false)",[normalized?'normalized':'legacy']);
   for(const file of ['tests/database-fixture.sql','database/office-core.sql','database/office-'+host+'-adapter.sql',...(normalized?['database/office-normalized.sql']:[]),'tests/database-office.sql',...(host==='hub'?['tests/database-hub-labels.sql']:[])]){
    phase=file;
    const chunks=file==='tests/database-office.sql'?suiteBlocks(sources[file]):[sources[file]];
    for(let block=0;block<chunks.length;block++){
     phase=file+':block-'+(block+1);
     await db.exec(chunks[block]);
    }
   }
   labels=(await db.query('SELECT label FROM office_test.results ORDER BY label')).rows.map(row=>row.label);
   assert.ok(labels.length>=80,'Expected full SQL assertion suite');
   report.hosts.push({host,status:'PASS',assertions:labels.length,labels});
   console.log(JSON.stringify({host,status:'PASS',assertions:labels.length}));
  }catch(error){
   failed=true;
   try{await db.exec('ROLLBACK; RESET ROLE;');labels=(await db.query('SELECT label FROM office_test.results ORDER BY label')).rows.map(row=>row.label);}catch{}
   const result={host,status:'FAIL',phase,message:String(error.message).slice(0,3000),code:error.code??null,assertions:labels.length,labels};
   report.hosts.push(result);
   console.error(JSON.stringify({...result,labels:undefined}));
   process.exitCode=1;
  }finally{await db.close();}
  if(failed)break;
 }
}catch(error){
 report.error={message:String(error.message).slice(0,3000),code:error.code??null};
 console.error(JSON.stringify(report.error));process.exitCode=1;
}
await mkdir(path.join(workspace,'reports'),{recursive:true});
await writeFile(path.join(workspace,normalized?'reports/database-normalized-regression.json':'reports/database-validation.json'),JSON.stringify(report,null,2)+LF,'utf8');
console.log(limitation);
