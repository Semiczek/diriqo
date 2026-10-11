import test from 'node:test';
import assert from 'node:assert/strict';
import {OfficeService} from '../src/server/service.ts';
import {SupabaseOfficeService} from '../src/server/supabase-service.ts';
import {MemoryStore} from '../src/server/store.ts';
import {blankDocument} from '../src/core/templates.ts';
import {validateRequest} from '../src/core/validation.ts';
const a={tenantId:'company-a',actorId:'manager-a',role:'editor',enabled:true,principal:'human'};
const b={...a,tenantId:'company-b',actorId:'manager-b'};
const body=()=>({...blankDocument(),doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'x'.repeat(40_000)}]}]}});
async function fixture(){
 const store=new MemoryStore(),service=new OfficeService(store);
 for(const actor of [a,b])await store.transaction(actor.tenantId,s=>{
  for(let n=1;n<=105;n++){
   const id='file-'+String(n).padStart(3,'0');
   const f={id,tenantId:actor.tenantId,ownerId:actor.actorId,title:actor.tenantId+' '+n,kind:n<=5?'folder':'document',parentId:null,revision:105,content:n<=5?null:blankDocument(),updatedAt:'2026-10-11T10:00:00Z',link:null};
   s.files[id]=f;
  }
  s.versions['file-006']=Array.from({length:105},(_,n)=>({revision:n+1,createdAt:'2026-10-11T10:00:00Z',actorId:actor.actorId,title:actor.tenantId,content:body()}));
  for(let n=1;n<=105;n++){const id='proposal-'+String(n).padStart(3,'0');s.proposals[id]={id,fileId:'file-006',baseRevision:105,status:'pending',summary:actor.tenantId+' draft',content:body(),createdBy:actor.actorId,createdAt:'2026-10-11T10:00:00Z'};}
 });return {service,store};
}
test('metadata pagination reads more than 100 files once without leaking content or another company',async()=>{
 const {service}=await fixture();let afterId,seen=[];
 do{const r=await service.request(a,{op:'listFiles',limit:50,...(afterId?{afterId}:{})});assert.ok(r.files.every(f=>f.content===null&&f.tenantId===a.tenantId));seen.push(...r.files.map(f=>f.id));afterId=r.nextCursor;}while(afterId);
 assert.equal(seen.length,105);assert.equal(new Set(seen).size,105);
 const reader={...a,role:'reader'};assert.equal((await service.request(reader,{op:'listFiles',foldersOnly:true})).files.length,5);
 assert.deepEqual((await service.request(a,{op:'listFiles',query:'company-b'})).files,[]);
});
test('history metadata stays bounded while individual content can be loaded and restored',async()=>{
 const {service}=await fixture();let cursor,seen=[];
 do{const r=await service.request(a,{op:'listVersions',id:'file-006',limit:50,...(cursor?{beforeRevision:Number(cursor)}:{})});assert.ok(r.versionSummaries.every(v=>!Object.hasOwn(v,'content')));assert.ok(Buffer.byteLength(JSON.stringify(r))<15_000);seen.push(...r.versionSummaries.map(v=>v.revision));cursor=r.nextCursor;}while(cursor);
 assert.equal(seen.length,105);assert.deepEqual(seen,Array.from({length:105},(_,n)=>105-n));
 const old=await service.request(a,{op:'readVersion',id:'file-006',revision:1});assert.deepEqual(old.version.content,body());
 const restored=await service.request(a,{op:'restore',id:'file-006',revision:1,expectedRevision:105,idempotencyKey:'restore-first'});assert.equal(restored.file.revision,106);assert.deepEqual(restored.file.content,body());
});
test('proposal pages omit payloads and detail requires the exact tenant/file/proposal relation',async()=>{
 const {service}=await fixture();const r=await service.request(a,{op:'listProposals',id:'file-006',limit:2});assert.equal(r.nextCursor,'proposal-002');assert.ok(r.proposalSummaries.every(p=>!Object.hasOwn(p,'content')));
 const detail=await service.request(a,{op:'readProposal',id:'file-006',proposalId:r.proposalSummaries[0].id});assert.equal(detail.proposal.createdBy,a.actorId);
 await assert.rejects(service.request(a,{op:'readProposal',id:'file-007',proposalId:'proposal-001'}),e=>e.code==='NOT_FOUND');
 const other=await service.request(b,{op:'readProposal',id:'file-006',proposalId:'proposal-001'});assert.equal(other.proposal.createdBy,b.actorId);
});
test('new read endpoints preserve module denial, including AI and reader identities',async()=>{
 const {service}=await fixture();for(const r of [{op:'listFiles'},{op:'listVersions',id:'file-006'},{op:'readVersion',id:'file-006',revision:1},{op:'listProposals',id:'file-006'},{op:'readProposal',id:'file-006',proposalId:'proposal-001'}]){
  await assert.rejects(service.request({...a,enabled:false},r),e=>e.code==='MODULE_DISABLED');
  await assert.rejects(service.request({...a,tenantId:'missing-company'},r.op==='listFiles'?{op:'readVersion',id:'file-006',revision:1}:r),e=>e.code==='NOT_FOUND');
  await service.request({...a,role:'reader',principal:'ai'},r);
 }
});
test('page input validation refuses tenant overrides, invalid cursors and unbounded limits',()=>{
 for(const r of [{op:'listFiles',companyId:'other'},{op:'listFiles',foldersOnly:'true'},{op:'listFiles',afterId:'../other'},{op:'listVersions',id:'x',beforeRevision:0},{op:'listVersions',id:'x',beforeRevision:1.5},...[0,-1,101,1.5,Infinity,'50'].map(limit=>({op:'listProposals',id:'x',limit}))])assert.throws(()=>validateRequest(r));
 for(const r of [{op:'listFiles',limit:100,foldersOnly:true},{op:'listVersions',id:'x',beforeRevision:51},{op:'readVersion',id:'x',revision:1},{op:'readProposal',id:'x',proposalId:'p'}])assert.deepEqual(validateRequest(r),r);
});
test('Supabase adapter forwards only guarded company ID for every new read endpoint',async()=>{
 const calls=[],service=new SupabaseOfficeService({rpc:async(name,args)=>{calls.push({name,args});return {data:{},error:null};}});
 for(const request of [{op:'listFiles'},{op:'listVersions',id:'doc'},{op:'readVersion',id:'doc',revision:2},{op:'listProposals',id:'doc'},{op:'readProposal',id:'doc',proposalId:'p'}])await service.request({...a,role:'reader'},request);
 assert.equal(calls.length,5);assert.ok(calls.every(c=>c.name==='office_request'&&c.args.p_company_id===a.tenantId));
 await assert.rejects(service.request(a,{op:'listFiles',companyId:b.tenantId}));assert.equal(calls.length,5);
});
