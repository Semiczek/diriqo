import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {readBoundedOfficeMultipart} from '../../src/server/multipart.ts';
import {assertOfficeRequestOrigin} from '../../src/server/origin.ts';
import {blankDocument} from '../../src/core/templates.ts';

const root=new URL('../../',import.meta.url),origin='https://office-preview.vercel.app';
const actor={tenantId:'10000000-0000-4000-8000-000000000001',actorId:'20000000-0000-4000-8000-000000000001',role:'owner',principal:'human',enabled:true};
const id='30000000-0000-4000-8000-000000000001',proposalId='40000000-0000-4000-8000-000000000001';
async function authored(host,file,bindings,result){
 const source=(await readFile(new URL('integrations/'+host+'/'+file,root),'utf8'))
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm,'').replace(/^export /gm,'');
 return vm.runInNewContext(stripTypeScriptTypes(source)+'\n;('+result+')',
  {Error,URL,TextEncoder,File,Request,FormData,Uint8Array,Buffer,crypto:{randomUUID},...bindings},{filename:host+'/'+file});
}
const limits=host=>authored(host,'lib/office/http-limits.ts',{process:{env:{OFFICE_PUBLIC_ORIGIN:origin}}},
 '({assertOfficeHostPayload,assertOfficeHostUpload,officePublicOrigin,OFFICE_HOST_REQUEST_BYTES,OFFICE_HOST_UPLOAD_BYTES,OFFICE_HOST_RESPONSE_BYTES,OFFICE_HOST_MUTATION_BYTES})');
const file=content=>({id,tenantId:actor.tenantId,ownerId:actor.actorId,title:'Example',kind:'document',revision:3,content,parentId:null,link:null,updatedAt:'2026-10-11T12:00:00Z'});
function documentOfSize(length){const content=blankDocument();content.doc.content=[];for(let left=length;left>0;left-=1_000_000)content.doc.content.push({type:'paragraph',content:[{type:'text',text:'a'.repeat(Math.min(left,1_000_000))}]});return content;}
async function actionHarness(host,options={}){
 const calls=[],contextWrites=[],current=file(options.current??blankDocument()),proposal={id:proposalId,fileId:id,baseRevision:3,status:'pending',summary:'Change',content:options.proposed??blankDocument(),createdBy:actor.actorId,createdAt:current.updatedAt};
 const service=class {async request(_actor,request){calls.push(request);if(request.op==='read')return {file:current};if(request.op==='readVersion')return {version:{revision:1,title:'Old title',content:options.historical??blankDocument()}};if(request.op==='readProposal')return {proposal};return options.result??(request.op==='approve'?{file:{...current,content:proposal.content,revision:4},proposal:{...proposal,status:'applied'}}:{file:current});}};
 const h=await limits(host);const officeAction=await authored(host,'app/office/actions.ts',{...h,SupabaseOfficeService:service,requireOfficeContext:async(write)=>{contextWrites.push(write);if(options.reader&&write)throw Error('OFFICE_FORBIDDEN');return {actor:options.reader?{...actor,role:'reader'}:actor,supabase:{},active:{}};}},'officeAction');
 return {calls,contextWrites,officeAction,writes:()=>calls.filter(request=>!['read','readVersion','readProposal'].includes(request.op))};
}
async function routeHarness(host,options={}){
 const h=await limits(host),events=[];
 const service=class {
  async import(_actor,input){events.push('import');return {file:file(input.content)};}
  async request(){events.push('read');return {file:file(blankDocument())};}
  async original(){events.push('original');return {name:'ž'.repeat(240),mime:'application/octet-stream',bytes:new Uint8Array(options.originalBytes??h.OFFICE_HOST_UPLOAD_BYTES)};}
  async recordExport(){events.push('exportAudit');}
 };
 const routes=await authored(host,'app/api/office/files/route.ts',{
  ...h,SupabaseOfficeService:service,readBoundedOfficeMultipart,assertOfficeRequestOrigin,resolve,pathToFileURL,
  process:{cwd:()=>process.cwd()},NextResponse:{json:(body,init)=>({body,status:init?.status??200,headers:init?.headers})},
  requireOfficeContext:async()=>{events.push('context');return {actor,supabase:{}};},
  importOfficeFileBounded:async()=>{events.push('parse');return {content:options.content??blankDocument(),warnings:options.warnings??[],original:{mime:'text/plain'}};},
  exportOfficeFile:async()=>({name:'example.pdf',mime:'application/pdf',base64:'x'.repeat(options.exportBytes??100),warnings:[]}),
 },'({POST,GET})');
 const get=format=>({headers:new Headers({'x-office-tenant':actor.tenantId}),nextUrl:new URL(origin+'/api/office/files?id='+id+'&format='+format)});
 async function upload(size,extraHeaders={}){const form=new FormData();form.set('file',new File([new Uint8Array(size)],'example.txt'));form.set('idempotencyKey',randomUUID());return new Request(origin+'/api/office/files',{method:'POST',headers:{origin,host:new URL(origin).host,'x-office-tenant':actor.tenantId,...extraHeaders},body:form});}
 return {...h,...routes,events,get,upload};
}

for(const host of ['hub','diriqo']){
 test(host+': paginated metadata and individual version/proposal reads remain available to readers',async()=>{
  const h=await actionHarness(host,{reader:true});
  for(const request of [{op:'listFiles',limit:50},{op:'listVersions',id,limit:50},{op:'readVersion',id,revision:1},{op:'listProposals',id,limit:50},{op:'readProposal',id,proposalId}]){
   const response=await h.officeAction(actor.tenantId,request);assert.equal(response.ok,true,request.op+' must use read authorization');
  }
  assert.equal(h.calls.length,5);assert.deepEqual(h.contextWrites,[false,false,false,false,false]);
  const denied=await h.officeAction(actor.tenantId,{op:'save',id,expectedRevision:3,content:blankDocument(),idempotencyKey:randomUUID()});
  assert.equal(denied.error,'OFFICE_FORBIDDEN');assert.equal(h.calls.length,5);
 });
 test(host+': byte limits use UTF-8 and include serialization; invalid values and budgets fail closed',async()=>{
  const h=await limits(host);assert.doesNotThrow(()=>h.assertOfficeHostPayload('ž',4));assert.throws(()=>h.assertOfficeHostPayload('ž',3),/OFFICE_HOST_LIMIT/);
  assert.doesNotThrow(()=>h.assertOfficeHostPayload('💶',6));assert.throws(()=>h.assertOfficeHostPayload('💶',5),/OFFICE_HOST_LIMIT/);
  const exact={v:'a'.repeat(h.OFFICE_HOST_REQUEST_BYTES-8)};assert.doesNotThrow(()=>h.assertOfficeHostPayload(exact));exact.v+='a';assert.throws(()=>h.assertOfficeHostPayload(exact),/OFFICE_HOST_LIMIT/);
  const cyclic={};cyclic.self=cyclic;for(const value of [undefined,()=>{},1n,cyclic])assert.throws(()=>h.assertOfficeHostPayload(value),/OFFICE_HOST_LIMIT/);
  for(const budget of [NaN,Infinity,0,-1,1.5])assert.throws(()=>h.assertOfficeHostPayload({},budget),/OFFICE_HOST_LIMIT/);
 });

 test(host+': trusted origin metadata rejects aliases and malformed explicit configuration',async()=>{
  const get=env=>authored(host,'lib/office/http-limits.ts',{process:{env}},'officePublicOrigin');
  for(const configured of [origin,'http://localhost:3100','http://127.0.0.1:3100','http://[::1]:3100'])assert.equal((await get({OFFICE_PUBLIC_ORIGIN:configured}))(),configured);
  for(const configured of ['',origin+'/',origin+'?x=1',origin+'#x',' '+origin,'https://user:password@office-preview.vercel.app','http://external.example'])assert.throws(await get({OFFICE_PUBLIC_ORIGIN:configured,VERCEL:'1',VERCEL_URL:'office-preview.vercel.app'}),/OFFICE_ORIGIN_CONFIGURATION/);
  assert.equal((await get({VERCEL:'1',VERCEL_URL:'office-preview.vercel.app'}))(),origin);
  for(const env of [{},{VERCEL_URL:'office-preview.vercel.app'},{VERCEL:'1',NEXT_PUBLIC_APP_URL:origin,SITE_URL:origin},...['office-preview.vercel.app.evil.test','office-preview.vercel.app/path','evil@office-preview.vercel.app','office-preview.vercel.app:443'].map(VERCEL_URL=>({VERCEL:'1',VERCEL_URL}))])assert.equal((await get(env))(),undefined);
  const expected=(await get({OFFICE_PUBLIC_ORIGIN:origin}))();
  for(const headers of [{origin:origin+'/',host:'office-preview.vercel.app'},{origin,host:'evil.example','x-forwarded-host':'office-preview.vercel.app'},{origin:'https://alias.vercel.app',host:'alias.vercel.app'},{origin,host:'office-preview.vercel.app','sec-fetch-site':'cross-site'}])assert.throws(()=>assertOfficeRequestOrigin({headers:new Headers(headers)},expected),/OFFICE_FORBIDDEN/);
 });

 test(host+': upload and base64 response budgets support the full 3 MiB original',async()=>{
  const h=await routeHarness(host);h.assertOfficeHostUpload(new File([new Uint8Array(h.OFFICE_HOST_UPLOAD_BYTES)],'boundary.txt'));
  assert.throws(()=>h.assertOfficeHostUpload(new File([new Uint8Array(h.OFFICE_HOST_UPLOAD_BYTES+1)],'too-large.txt')),/OFFICE_HOST_LIMIT/);
  assert.throws(()=>h.assertOfficeHostUpload({size:1}),/OFFICE_HOST_LIMIT/);
  const response=await h.GET(h.get('original'));assert.equal(response.status,200);assert.equal(Buffer.from(response.body.base64,'base64').length,h.OFFICE_HOST_UPLOAD_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(response.body))<h.OFFICE_HOST_RESPONSE_BYTES);
 });

 test(host+': actual multipart stream defeats absent or forged Content-Length before parsing/import',async()=>{
  for(const claimed of [undefined,'1']){
   const h=await routeHarness(host);let cancelled=false;
   const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1_100_000));},cancel(){cancelled=true;}});
   const headers={origin,host:'office-preview.vercel.app','x-office-tenant':actor.tenantId,'content-type':'multipart/form-data; boundary=test'};
   if(claimed!==undefined)headers['content-length']=claimed;
   const response=await h.POST(new Request(origin+'/api/office/files',{method:'POST',headers,body,duplex:'half'}));
   assert.equal(response.status,413);assert.equal(response.body.error,'OFFICE_HOST_LIMIT');assert.equal(cancelled,true);assert.deepEqual(h.events,['context']);
  }
 });

 test(host+': multipart file and normalized import size are rejected before persistence',async()=>{
  const fileLimit=await routeHarness(host);assert.equal((await fileLimit.POST(await fileLimit.upload(fileLimit.OFFICE_HOST_UPLOAD_BYTES+1))).status,413);assert.deepEqual(fileLimit.events,['context']);
  for(const options of [{content:documentOfSize(3_800_000)},{warnings:['w'.repeat(4_300_000)]}]){
   const h=await routeHarness(host,options);const result=await h.POST(await h.upload(10));assert.equal(result.status,413);assert.deepEqual(h.events,['context','parse']);
  }
  const valid=await routeHarness(host);assert.equal((await valid.POST(await valid.upload(valid.OFFICE_HOST_UPLOAD_BYTES))).status,200);assert.deepEqual(valid.events,['context','parse','import']);
 });

 test(host+': oversize export is rejected before export audit and errors reveal only stable codes',async()=>{
  const h=await routeHarness(host,{exportBytes:4_350_000});const response=await h.GET(h.get('pdf'));
  assert.equal(response.status,413);assert.equal(response.body.error,'OFFICE_HOST_LIMIT');assert.deepEqual(h.events,['context','read']);
  const forged=await routeHarness(host);const denial=await forged.POST(await forged.upload(1,{origin:'https://evil.example'}));assert.equal(denial.body.error,'OFFICE_FORBIDDEN');assert.deepEqual(forged.events,[]);
 });

 test(host+': oversize action requests include UTF-8 framing and never reach a service operation',async()=>{
  const h=await actionHarness(host);const response=await h.officeAction(actor.tenantId,{op:'create',title:'Large',kind:'document',content:documentOfSize(3_800_000),idempotencyKey:randomUUID()});
  assert.equal(response.error,'OFFICE_HOST_LIMIT');assert.equal(h.calls.length,0);
 });

 test(host+': oversized current/history/proposal content is refused before mutation',async()=>{
  const large=documentOfSize(4_350_000);
  for(const op of ['rename','move','copy','link','restore','approve','reject']){
   const h=await actionHarness(host,{current:large,historical:large,proposed:large});
   const response=await h.officeAction(actor.tenantId,{op,id,title:'Rename',parentId:null,type:'job',entityId:id,revision:1,proposalId,expectedRevision:3,idempotencyKey:randomUUID()});
   assert.equal(response.error,'OFFICE_HOST_LIMIT',op);assert.equal(h.writes().length,0,op);
  }
 });

 test(host+': a large approval fits by returning its installed file without duplicated proposal content',async()=>{
  const h=await actionHarness(host,{proposed:documentOfSize(2_700_000)});
  const response=await h.officeAction(actor.tenantId,{op:'approve',id,proposalId,expectedRevision:3,idempotencyKey:randomUUID()});
  assert.equal(response.ok,true);assert.equal(response.result.file.revision,4);assert.equal(response.result.proposal,undefined);assert.equal(h.writes().length,1);
  assert.ok(Buffer.byteLength(JSON.stringify(response))<4_350_000);
 });

 test(host+': a post-commit response limit is reported as a delivery failure, not a rollback',async()=>{
  // An external concurrent copy change can grow after preflight. No HTTP guard can
  // roll back an already committed RPC; its idempotency key must be retained.
  const h=await actionHarness(host,{result:{file:file(documentOfSize(4_350_000))}}),key=randomUUID();
  const response=await h.officeAction(actor.tenantId,{op:'copy',id,title:'Copy',idempotencyKey:key});
  assert.equal(response.error,'OFFICE_HOST_LIMIT');assert.equal(h.writes().length,1);assert.equal(h.writes()[0].idempotencyKey,key);
 });
}
