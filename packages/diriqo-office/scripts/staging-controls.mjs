import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateTarget} from './staging-target.mjs';
import {createStagingTransport} from './staging-transport.mjs';
const [host,phase]=process.argv.slice(2);
assert.ok(['hub','diriqo'].includes(host));
assert.ok(['default-enable','capability-denied','capability-granted','module-toggle'].includes(phase));
const target=validateTarget(JSON.parse(await readFile('reports/staging-targets.json','utf8')),host);
const config=JSON.parse(await readFile(`.staging/${host}.credentials.json`,'utf8'));
const operatorConfig=JSON.parse(await readFile(`.staging/${host}.operator.json`,'utf8'));
assert.equal(config.projectRef,target.projectRef);assert.equal(operatorConfig.projectRef,target.projectRef);
const transport=createStagingTransport({target,publishableKey:config.publishableKey});
const checks=[];const report={host,projectRef:target.projectRef,phase,startedAt:new Date().toISOString(),status:'RUNNING',checks};
const persist=()=>writeFile(`reports/staging-${host}-${phase}.json`,JSON.stringify(report,null,2)+'\n');
const check=(label,condition)=>{checks.push({label,passed:condition===true});assert.equal(condition,true,label);};
async function rpc(actor,name,args){
 assert.ok(['office_set_enabled','get_company_capability_access'].includes(name));
 const response=await fetch(target.origin+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer '+actor.accessToken,'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(20000)});
 const data=await response.json();return {status:response.status,data};
}
const denied=result=>result.status>=400;
try{
 const operator=await transport.login({...operatorConfig,label:'operator'});
 const actors={};for(const label of ['ownerA','editorA','readerA','ownerB','readerB'])actors[label]=await transport.login({...config.actors[label],label});
 if(phase==='default-enable'){
  for(const [label,actor] of Object.entries(actors)){
   const result=await transport.request(actor,{op:'list'});
   check(label+' default module disabled',denied(result)&&result.errorCode==='MODULE_DISABLED');
   const toggle=await rpc(actor,'office_set_enabled',{p_company_id:actor.tenantId,p_enabled:true});
   check(label+' cannot configure module',denied(toggle));
  }
  for(const label of ['ownerA','ownerB']){
   const result=await rpc(operator,'office_set_enabled',{p_company_id:actors[label].tenantId,p_enabled:true});
   check(label+' operator enables module',result.status===200&&result.data===true);
   check(label+' enabled read',(await transport.request(actors[label],{op:'list'})).status===200);
  }
 }else if(phase.startsWith('capability-')){
  assert.equal(host,'diriqo');const expected=phase==='capability-granted';
  for(const label of ['ownerA','ownerB']){
   const actor=actors[label];const result=await rpc(actor,'get_company_capability_access',{target_company_id:actor.tenantId,target_capability:'core.files.upload'});
   check(label+' enforced capability',result.status===200&&result.data.company_id===actor.tenantId&&result.data.capability==='core.files.upload'&&result.data.enforced===true&&result.data.allowed===expected&&result.data.reason===(expected?'test':'module_required')&&result.data.livemode===false);
   if(!expected){
    const result=await transport.request(actor,{op:'create',kind:'document',title:'Denied staging probe',content:{schemaVersion:1,kind:'document',doc:{type:'doc',content:[{type:'paragraph'}]},page:{marginMm:20,header:'',footer:''}},idempotencyKey:randomUUID()});
    check(label+' Office write denied without capability',denied(result)&&result.errorCode==='FORBIDDEN');
    check(label+' Office read remains available',(await transport.request(actor,{op:'list'})).status===200);
   }
  }
 }else{
  const actor=actors.ownerA;
  check('operator disables A',(await rpc(operator,'office_set_enabled',{p_company_id:actor.tenantId,p_enabled:false})).data===false);
  for(const label of ['ownerA','editorA','readerA']){
   const result=await transport.request(actors[label],{op:'list'});
   check(label+' existing session blocked while disabled',denied(result)&&result.errorCode==='MODULE_DISABLED');
  }
  check('B unaffected',(await transport.request(actors.ownerB,{op:'list'})).status===200);
  check('operator re-enables A',(await rpc(operator,'office_set_enabled',{p_company_id:actor.tenantId,p_enabled:true})).data===true);
  check('existing A session works after re-enable',(await transport.request(actor,{op:'list'})).status===200);
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error.message).slice(0,150);process.exitCode=1;}
report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({host,phase,status:report.status,checks:checks.length,error:report.error}));
