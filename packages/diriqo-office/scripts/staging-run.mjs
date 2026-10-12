/** Explicit staging runner. No provisioning, migrations, deployments or production access. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {validateTarget} from './staging-target.mjs';
import {createStagingTransport} from './staging-transport.mjs';
import {runIsolationTests} from './staging-isolation.mjs';
import {runRaceTests} from './staging-races.mjs';

const names=['ownerA','editorA','readerA','ownerB','editorB','readerB','aiA'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireValue(condition,code){if(!condition)throw new Error(code);}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));}

export function validateStagingConfig(config,target){
 requireValue(exactKeys(config,['schemaVersion','projectRef','publishableKey','actors'])&&config.schemaVersion===1,'STAGING_CONFIG_INVALID');
 requireValue(config.projectRef===target.projectRef,'STAGING_CONFIG_TARGET_MISMATCH');
 requireValue(typeof config.publishableKey==='string'&&config.publishableKey.length>20,'STAGING_PUBLIC_KEY_REQUIRED');
 requireValue(exactKeys(config.actors,names),'STAGING_ACTORS_INVALID');
 const ids=new Set(),emails=new Set();
 for(const name of names){
  const actor=config.actors[name];
  requireValue(exactKeys(actor,['email','password','userId','tenantId','principal']),'STAGING_ACTOR_FIELDS_INVALID');
  requireValue(typeof actor.userId==='string'&&uuid.test(actor.userId)&&typeof actor.tenantId==='string'&&uuid.test(actor.tenantId),'STAGING_ACTOR_IDS_INVALID');
  requireValue(typeof actor.email==='string'&&/^office-[a-z0-9._+-]+@office-staging\.invalid$/.test(actor.email),'STAGING_SYNTHETIC_EMAIL_REQUIRED');
  requireValue(typeof actor.password==='string'&&actor.password.length>=16&&actor.password.length<=128,'STAGING_PASSWORD_INVALID');
  requireValue(actor.principal===(name==='aiA'?'ai':'human'),'STAGING_PRINCIPAL_INVALID');
  requireValue(!ids.has(actor.userId.toLowerCase())&&!emails.has(actor.email),'STAGING_DISTINCT_USERS_REQUIRED');
  ids.add(actor.userId.toLowerCase());emails.add(actor.email);
 }
 const a=config.actors.ownerA.tenantId.toLowerCase(),b=config.actors.ownerB.tenantId.toLowerCase();
 requireValue(a!==b,'STAGING_TWO_COMPANIES_REQUIRED');
 for(const name of names)requireValue(config.actors[name].tenantId.toLowerCase()===(name.endsWith('B')?b:a),'STAGING_ACTOR_TENANT_MISMATCH');
 return config;
}

export function parseArguments(args){
 const result={host:null,execute:false,raceRounds:3,help:false};
 const seen=new Set();
 for(let i=0;i<args.length;i++){
  const arg=args[i];requireValue(!seen.has(arg),'STAGING_DUPLICATE_ARGUMENT');seen.add(arg);
  if(arg==='--help')result.help=true;
  else if(arg==='--execute')result.execute=true;
  else if(arg==='--host'){result.host=args[++i];requireValue(['hub','diriqo'].includes(result.host),'STAGING_HOST_REQUIRED');}
  else if(arg==='--race-rounds'){const count=args[++i];requireValue(/^[1-5]$/.test(count??''),'STAGING_ROUNDS_INVALID');result.raceRounds=Number(count);}
  else throw new Error('STAGING_UNKNOWN_ARGUMENT');
 }
 requireValue(result.help||result.host,'STAGING_HOST_REQUIRED');return result;
}

async function jsonFile(path){
 const bytes=await readFile(path);requireValue(bytes.length<=128*1024,'STAGING_CONFIG_TOO_LARGE');return JSON.parse(bytes.toString('utf8'));
}
async function sourceHashes(){
 const files=['scripts/staging-target.mjs','scripts/staging-transport.mjs','scripts/staging-run.mjs','scripts/staging-isolation.mjs','scripts/staging-races.mjs','database/office-core.sql','database/office-diriqo-adapter.sql'];
 const hashes={};for(const file of files)hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');return hashes;
}

export async function executeStaging({target,config,raceRounds=3,transportFactory=createStagingTransport,onProgress=async()=>{}}){
 validateStagingConfig(config,target);
 requireValue(Number.isInteger(raceRounds)&&raceRounds>=1&&raceRounds<=5,'STAGING_ROUNDS_INVALID');
 const report={schemaVersion:1,runId:randomUUID(),host:target.host,projectRef:target.projectRef,parentRef:target.parentRef,
  startedAt:new Date().toISOString(),finishedAt:null,status:'RUNNING',productionTouched:false,
  scope:'Real password login, verified Supabase Auth users and authenticated Office RPC requests. No host HTTP/UI proof.',
  actors:[],checks:[],requests:[],isolation:null,races:[],acceptanceReady:false,
  pendingAcceptance:['Host HTTP/browser session and active-company flows','Disable module during an in-flight operation',
   'Direct private-table grants/RLS inspection','Job/customer links with real staging fixtures','Hosted DOCX/XLSX worker and PDF print verification']};
 let requestCount=0;
 const transport=transportFactory({target,publishableKey:config.publishableKey,onRequest:entry=>{
  report.requests.push(entry);
 }});
 const actors={};
 const check=async(label,passed,detail={})=>{
  const evidence={};
  for(const name of ['runId','prefix','status','errorCode','expected','fileId','tenantId']){
   if(typeof detail[name]==='string'&&detail[name].length<=300||typeof detail[name]==='number')evidence[name]=detail[name];
  }
  report.checks.push({label,passed:passed===true,...evidence});
  if(passed!==true)throw new Error('STAGING_ASSERTION_FAILED');
 };
 // No retry or serialization: every concurrent mutation has its own authenticated HTTP request.
 const request=async(actor,body)=>{
  if(++requestCount>1200)throw new Error('STAGING_REQUEST_BUDGET_EXCEEDED');
  return transport.request(actor,body);
 };
 try{
  for(const name of names){
   actors[name]=await transport.login({...config.actors[name],label:name});
   report.actors.push({label:name,userId:actors[name].userId,tenantId:actors[name].tenantId,principal:actors[name].principal});
  }
  await onProgress(report);
  report.isolation=await runIsolationTests({request,actors,check});await onProgress(report);
  for(let i=0;i<raceRounds;i++){
   try{report.races.push(await runRaceTests({request,actors,check}));}
   catch(error){if(error.stagingRaceReport)report.races.push(error.stagingRaceReport);throw error;}
   await onProgress(report);
  }
  report.status='RPC_PASS_ACCEPTANCE_PENDING';
 }catch(error){
  // Error messages from providers can contain credentials; persist only known static codes.
  const message=typeof error?.message==='string'?error.message:'';
  report.status='FAIL';report.failure=/^(?:STAGING_|AUTH_|TRANSPORT_)[A-Z_]+$/.test(message)?message:'STAGING_SCENARIO_FAILED';
 }finally{
  report.finishedAt=new Date().toISOString();report.requestCount=requestCount;
  report.assertions={passed:report.checks.filter(x=>x.passed).length,failed:report.checks.filter(x=>!x.passed).length};
  await onProgress(report);
 }
 return report;
}

async function main(){
 const options=parseArguments(process.argv.slice(2));
 if(options.help){console.log('node scripts/staging-run.mjs --host hub|diriqo [--execute] [--race-rounds 1..5]\nDefault: local validation only. See docs/STAGING_RUNBOOK.md.');return;}
 // Neither path is overridable by environment variables or CLI URLs.
 const manifest=await jsonFile('reports/staging-targets.json');
 const target=validateTarget(manifest,options.host);
 const config=validateStagingConfig(await jsonFile('.staging/'+options.host+'.credentials.json'),target);
 // Validate the publishable key even in dry-run mode; constructor must never perform I/O.
 createStagingTransport({target,publishableKey:config.publishableKey});
 if(!options.execute){console.log(JSON.stringify({status:'LOCAL_PREFLIGHT_PASS',host:target.host,projectRef:target.projectRef,networkRequests:0,remoteTestsExecuted:false},null,2));return;}
 await mkdir('reports',{recursive:true});
 const sources=await sourceHashes();
 const path='reports/staging-'+options.host+'.json';
 const report=await executeStaging({target,config,raceRounds:options.raceRounds,
  onProgress:async current=>{
   const bytes=JSON.stringify({...current,sourceHashes:sources},null,2)+'\n';
   await writeFile('reports/staging-'+options.host+'-'+current.runId+'.json',bytes);
   await writeFile(path,bytes);
  }});
 console.log(JSON.stringify({status:report.status,report:path,assertions:report.assertions,requestCount:report.requestCount,acceptanceReady:false},null,2));
 if(report.status==='FAIL')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{
 console.error('STAGING_PREFLIGHT_BLOCKED: inspect the verified branch manifest and local synthetic credentials. No production fallback is supported.');
 process.exitCode=1;
});
