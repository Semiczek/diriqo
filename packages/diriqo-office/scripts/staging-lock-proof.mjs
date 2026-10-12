// Disposable branch only. Temporary probe functions must be removed after this test.
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateTarget} from './staging-target.mjs';
import {createStagingTransport} from './staging-transport.mjs';
import {runInflightScenario} from './staging-inflight.mjs';
const host=process.argv[2]??'diriqo';
assert.ok(['hub','diriqo'].includes(host)&&process.argv.length<=3,'Usage: staging-lock-proof.mjs [hub|diriqo]');
const target=validateTarget(JSON.parse(await readFile('reports/staging-targets.json','utf8')),host);
const config=JSON.parse(await readFile(`.staging/${host}.credentials.json`,'utf8'));
const admin=JSON.parse(await readFile(`.staging/${host}.admin.json`,'utf8'));
const operatorConfig=JSON.parse(await readFile(`.staging/${host}.operator.json`,'utf8'));
for(const item of [config,admin,operatorConfig])assert.equal(item.projectRef,target.projectRef);
const claims=JSON.parse(Buffer.from(admin.secretKey.split('.')[1],'base64url'));
assert.equal(claims.role,'service_role');assert.equal(claims.ref,target.projectRef);
const transport=createStagingTransport({target,publishableKey:config.publishableKey});
const owner=await transport.login({...config.actors.ownerA,label:'ownerA'});
const operator=await transport.login({...operatorConfig,label:'operator'});
async function rpc(name,body,token){
 assert.ok(['office_staging_test_hold','office_staging_test_observe','office_set_enabled'].includes(name));
 const r=await fetch(target.origin+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
 const data=await r.json();return {status:r.status,data:r.ok?data:null};
}
const runId=randomUUID(),content={schemaVersion:1,kind:'document',page:{marginMm:20,header:'',footer:''},doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Office staging in-flight '+runId+' / initial'}]}]}};
const created=await transport.request(owner,{op:'create',kind:'document',title:'Office staging lock proof '+runId,content,idempotencyKey:randomUUID()});
assert.equal(created.status,200);
const fixture={schemaVersion:1,host,projectRef:target.projectRef,runId,tenantId:owner.tenantId,ownerUserId:owner.userId,operatorUserId:operator.userId,fileId:created.data.file.id,createdAt:new Date().toISOString()};
const observations=[];
const observe=async()=>{const result=await rpc('office_staging_test_observe',{},admin.secretKey);assert.equal(result.status,200);observations.push({at:new Date().toISOString(),sessions:result.data});return result.data;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const hold=rpc('office_staging_test_hold',{p_company_id:owner.tenantId},admin.secretKey);
let proof,report;
try{
 let ready=false;for(let i=0;i<10;i++){const rows=await observe();if(rows.some(r=>r.operation==='temporary_row_lock'&&r.wait==='PgSleep')){ready=true;break;}await wait(150);}
 assert.ok(ready,'DB blocker not observed: will not claim overlap');
 const scenario=runInflightScenario({fixture,request:body=>transport.request(owner,body),setEnabled:enabled=>rpc('office_set_enabled',{p_company_id:owner.tenantId,p_enabled:enabled},operator.accessToken)});
 await wait(1800);const rows=await observe();
 const blocker=rows.find(r=>r.operation==='temporary_row_lock');
 const save=rows.find(r=>r.operation==='save'&&r.waitType==='Lock'&&r.blockers.includes(blocker?.pid));
 const disable=rows.find(r=>r.operation==='disable'&&r.waitType==='Lock'&&r.blockers.includes(save?.pid));
 proof=Boolean(blocker&&save&&disable);
 report=await scenario;
 const held=await hold;assert.equal(held.status,200);assert.equal(held.data,true);
 report.databaseOverlapVerified=proof;
 report.observations=observations;
 report.status=report.status==='HTTP_SCENARIO_PASS_DB_EVIDENCE_REQUIRED'&&proof?'PASS':'FAIL';
 await writeFile(`reports/staging-${host}-inflight-lock-proof.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,assertions:report.assertions,databaseOverlapVerified:proof,moduleState:report.moduleState}));
 if(report.status!=='PASS')process.exitCode=1;
}finally{await hold;}
