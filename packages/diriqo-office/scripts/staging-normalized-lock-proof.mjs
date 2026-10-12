/** Real independent PostgREST sessions, observed PostgreSQL lock chain.
 * Only preinstalled disposable-branch probes; no DDL/provisioning/production fallback.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateTarget} from './staging-target.mjs';
import {validateStagingConfig} from './staging-run.mjs';
import {createStagingTransport} from './staging-transport.mjs';
const host=process.argv[2];assert.ok(['hub','diriqo'].includes(host)&&process.argv[3]==='--execute'&&process.argv.length===4);
const target=validateTarget(JSON.parse(await readFile('reports/staging-targets.json','utf8')),host);
assert.ok(['amuhcvnvubsrvsfclqtg','pkjzoplczxqqmmstnqgy'].includes(target.projectRef));
assert.ok(Date.now()<Date.parse('2026-10-12T17:00:00Z'),'Authorized staging window expired');
const config=validateStagingConfig(JSON.parse(await readFile(`.staging/${host}.credentials.json`,'utf8')),target);
const admin=JSON.parse(await readFile(`.staging/${host}.admin.json`,'utf8'));
const operatorConfig=JSON.parse(await readFile(`.staging/${host}.operator.json`,'utf8'));
assert.equal(admin.projectRef,target.projectRef);assert.equal(operatorConfig.projectRef,target.projectRef);
const claims=JSON.parse(Buffer.from(admin.secretKey.split('.')[1],'base64url'));assert.equal(claims.role,'service_role');assert.equal(claims.ref,target.projectRef);
const report={schemaVersion:1,host,projectRef:target.projectRef,runId:randomUUID(),startedAt:new Date().toISOString(),status:'RUNNING',productionTouched:false,checks:[],observations:[],requests:[],files:[],moduleState:'ENABLED'};
const transport=createStagingTransport({target,publishableKey:config.publishableKey,onRequest:r=>report.requests.push(r)});
const owner=await transport.login({...config.actors.ownerA,label:'ownerA'}),other=await transport.login({...config.actors.ownerB,label:'ownerB'}),operator=await transport.login({...operatorConfig,label:'operator'});
const check=(label,value)=>{report.checks.push({label,passed:value===true});assert.equal(value,true,label);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const content=text=>({schemaVersion:1,kind:'document',page:{marginMm:20,header:'',footer:''},doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]}});
async function rpc(name,body,token){
 assert.ok(['office_staging_normalized_hold','office_staging_normalized_observe','office_set_enabled'].includes(name));
 const r=await fetch(target.origin+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
 const bytes=await r.arrayBuffer();assert.ok(bytes.byteLength<64000,'Bounded probe response');
 const data=JSON.parse(new TextDecoder().decode(bytes));return {status:r.status,data:r.ok?data:null,errorCode:!r.ok&&/^[0-9A-Z]{5}$/.test(data?.code??'')?data.code:null};
}
const observe=async()=>{const r=await rpc('office_staging_normalized_observe',{},admin.secretKey);assert.equal(r.status,200);report.observations.push({at:new Date().toISOString(),sessions:r.data});return r.data;};
async function observed(predicate){for(let i=0;i<20;i++){const rows=await observe();if(predicate(rows))return rows;await wait(100);}throw Error('Required PostgreSQL lock schedule not observed');}
const setEnabled=enabled=>rpc('office_set_enabled',{p_company_id:owner.tenantId,p_enabled:enabled},operator.accessToken);
async function create(actor,label){const r=await transport.request(actor,{op:'create',kind:'document',title:`Normalized lock ${report.runId} ${label}`,content:content('initial '+label),idempotencyKey:randomUUID()});assert.equal(r.status,200);report.files.push({label,id:r.data.file.id,companyId:actor.tenantId});return r.data.file;}
const pending=[];let restore=false;
try{
 const a=await create(owner,'A locked'),b=await create(owner,'A independent'),foreign=await create(other,'B independent');
 const held=rpc('office_staging_normalized_hold',{p_company_id:owner.tenantId,p_file_id:a.id},admin.secretKey);pending.push(held);
 await observed(rows=>rows.some(r=>r.operation==='blocker'&&r.wait==='PgSleep'));
 const save=transport.request(owner,{op:'save',id:a.id,expectedRevision:1,content:content('saved while blocked'),idempotencyKey:randomUUID()});pending.push(save);
 const rows=await observed(rows=>{const blocker=rows.find(r=>r.operation==='blocker');return rows.some(r=>r.operation==='office-request'&&r.waitType==='Lock'&&r.blockers.includes(blocker?.pid));});
 const blocker=rows.find(r=>r.operation==='blocker'),savePid=rows.find(r=>r.operation==='office-request'&&r.blockers.includes(blocker.pid)).pid;
 check('Save waits on the exact document row in PostgreSQL',Boolean(savePid));
 const independent=await transport.request(owner,{op:'save',id:b.id,expectedRevision:1,content:content('independent save completes'),idempotencyKey:randomUUID()});
 check('Different document in same company saves during blocked save',independent.status===200&&independent.data.file.revision===2);
 const still=await observe();check('Blocker and first save still active when independent save completed',still.some(r=>r.pid===blocker.pid&&r.wait==='PgSleep')&&still.some(r=>r.pid===savePid&&r.waitType==='Lock'));
 restore=true;const disable=setEnabled(false);pending.push(disable);
 const chain=await observed(rows=>rows.some(r=>r.operation==='module-toggle'&&r.waitType==='Lock'&&r.blockers.includes(savePid)));
 check('Module disable waits for authenticated in-flight save',chain.some(r=>r.operation==='module-toggle'&&r.blockers.includes(savePid)));
 const settled=await Promise.all(pending);report.blockerRelease={status:settled[0].status,errorCode:settled[0].errorCode,mode:settled[0].status===200?'sleep completed':'database statement timeout'};
 check('Read-only blocker releases normally or at the database statement deadline',settled[0].status===200&&settled[0].data===true||settled[0].errorCode==='57014');
 check('Application save and module disable both commit',settled.slice(1).every(r=>r.status===200));
 check('Saved revision exactly 2',settled[1].data.file.revision===2);check('Module disabled only after save',settled[2].data===false);report.moduleState='DISABLED';
 const denied=await transport.request(owner,{op:'save',id:a.id,expectedRevision:2,content:content('must be rejected'),idempotencyKey:randomUUID()});check('New save after disable is denied',denied.errorCode==='MODULE_DISABLED');
 const deniedRead=await transport.request(owner,{op:'readVersion',id:a.id,revision:1});check('New paged-detail read after disable is denied',deniedRead.errorCode==='MODULE_DISABLED');
 const separate=await transport.request(other,{op:'save',id:foreign.id,expectedRevision:1,content:content('company B still works'),idempotencyKey:randomUUID()});check('Other company remains writable',separate.status===200&&separate.data.file.revision===2);
 report.status='PASS';
}catch(error){report.status='FAIL';report.error={name:error.name,message:String(error.message).slice(0,400)};process.exitCode=1;}
finally{
 await Promise.allSettled(pending);
 if(restore){const enabled=await setEnabled(true);report.moduleState=enabled.status===200&&enabled.data===true?'ENABLED':'UNKNOWN';if(report.moduleState!=='ENABLED'){report.status='FAIL';process.exitCode=1;}}
 report.finishedAt=new Date().toISOString();await writeFile(`reports/staging-${host}-normalized-lock-proof.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({host,status:report.status,checks:report.checks.length,moduleState:report.moduleState,...(report.error?{error:report.error}:{})}));
}
