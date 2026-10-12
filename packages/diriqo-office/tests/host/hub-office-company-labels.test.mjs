import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const root=new URL('../../',import.meta.url);
async function module(file,bindings,name){
 let source=await readFile(new URL(file,root),'utf8');
 source=source.replace(/^import ['"]server-only['"]\r?\n/gm,'').replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm,'').replace(/^export /gm,'');
 return vm.runInNewContext(stripTypeScriptTypes(source)+'\n;('+name+')',bindings,{filename:file});
}
const A='00000000-0000-4000-8000-000000001001',B='00000000-0000-4000-8000-000000001002',FOREIGN='00000000-0000-4000-8000-000000001003';
const U='00000000-0000-4000-8000-000000000004',P='00000000-0000-4000-8000-000000000104';
const active=(role='manager')=>({companyId:A,companyName:null,profileId:P,role,companyMemberships:[{companyId:A,companyName:null,role,isActive:true},{companyId:B,companyName:null,role,isActive:false}]});
async function harness({current=active(),rows=[{company_id:A,name:'Verified A'},{company_id:B,name:'Verified B'}],error=null,enabled=true,user={id:U}}={}){
 const calls=[];
 const supabase={auth:{getUser:async()=>({data:{user},error:null})},
  from(table){assert.equal(table,'office_settings');return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{enabled},error:null})}},
  async rpc(name,args){calls.push({name,args:JSON.parse(JSON.stringify(args))});return {data:rows,error}}
 };
 const run=await module('integrations/hub/lib/office/context.ts',{cookies:async()=>({get:()=>({value:A})}),getActiveCompanyContext:async()=>current,createSupabaseServerClient:async()=>supabase},'requireOfficeContext');
 return {run,calls};
}
test('Hub manager labels use the current tenant and only existing authorized membership IDs',async()=>{
 const h=await harness(),result=await h.run();
 assert.deepEqual(h.calls,[{name:'office_company_labels',args:{p_company_id:A,p_company_ids:[A,B]}}]);
 assert.equal(result.active.companyName,'Verified A');assert.equal(result.active.companyMemberships[1].companyName,'Verified B');
 assert.equal(result.actor.role,'editor');assert.equal(result.actor.tenantId,A);assert.equal(result.actor.actorId,P);
});
test('labels cannot introduce foreign companies or change worker rights',async()=>{
 const h=await harness({current:active('worker'),rows:[{company_id:A,name:'Reader company'},{company_id:FOREIGN,name:'Foreign leak',role:'owner'}]}),result=await h.run();
 assert.equal(result.actor.role,'reader');assert.equal(result.active.companyMemberships.length,2);
 assert.equal(result.active.companyMemberships.some(row=>row.companyId===FOREIGN),false);
 assert.equal(result.active.companyMemberships[1].companyName,null);
 await assert.rejects(h.run(true),/OFFICE_FORBIDDEN/);assert.equal(h.calls.length,1);
});
test('missing names retain safe fallback on RPC failure and malformed returned fields',async()=>{
 for(const options of [{error:{message:'missing RPC'}},{rows:null},{rows:[null,{company_id:A,name:42},{company_id:B,name:'  '}]}]){
  const result=await (await harness(options)).run();assert.equal(result.active.companyName,null);assert.equal(result.actor.role,'editor');
 }
});
test('disabled or unauthenticated Office context cannot request company labels',async()=>{
 for(const [options,error] of [[{enabled:false},/OFFICE_DISABLED/],[{user:null},/OFFICE_UNAUTHENTICATED/]]){
  const h=await harness(options);await assert.rejects(h.run(),error);assert.equal(h.calls.length,0);
 }
});
test('known names need no privileged label RPC; unknown collections are bounded per call',async()=>{
 const known=active();known.companyName='Known A';for(const company of known.companyMemberships)company.companyName='Known';
 const noRpc=await harness({current:known});await noRpc.run();assert.equal(noRpc.calls.length,0);
 const many=active();many.companyMemberships=Array.from({length:205},(_,n)=>({companyId:'00000000-0000-4000-8000-'+String(n+2000).padStart(12,'0'),companyName:null,role:'manager',isActive:false}));
 const h=await harness({current:many,rows:[]});await h.run();assert.deepEqual(h.calls.map(call=>call.args.p_company_ids.length),[100,100,6]);assert.ok(h.calls.every(call=>call.args.p_company_id===A));
});
test('Hub templates use the verified name and fail explicitly when unavailable or tenant changed',async()=>{
 let current={actor:{tenantId:A},active:{companyName:'Verified Company'},supabase:{}};
 const run=await module('integrations/hub/app/office/actions.ts',{requireOfficeContext:async()=>current},'officeTemplateVariables');
 assert.equal((await run(A)).companyName,'Verified Company');
 await assert.rejects(run(B),/OFFICE_TENANT_CHANGED/);
 for(const companyName of [null,'','   ']){current={...current,active:{companyName}};await assert.rejects(run(A),/OFFICE_REQUEST_FAILED/)}
});
