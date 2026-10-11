import test from 'node:test';
import assert from 'node:assert/strict';
import { OfficeAIAdapter, approveOfficeProposal, compareOfficeContent } from '../src/server/ai-adapter.ts';
import { OfficeService } from '../src/server/service.ts';
import { MemoryStore } from '../src/server/store.ts';

const actor = (tenantId='tenant-a', principal='human', role='owner') => ({ tenantId, actorId: 'user-a', principal, role, enabled:true });
const doc = (value='Original') => ({schemaVersion:1,kind:'document',doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:value}]}]},page:{marginMm:20,header:'',footer:''}});
const sheet = () => ({schemaVersion:1,kind:'spreadsheet',workbook:{id:'book',name:'Book',sheetOrder:['s1'],sheets:{s1:{id:'s1',name:'Sheet',rowCount:100,columnCount:10,cellData:{0:{0:{v:'Work'},1:{v:2},2:{v:125}},1:{0:{v:'Materials'},1:{v:3},2:{v:40}},2:{3:{f:'=SUM(B1:B2)',v:5}}}}}}});
const rejects = (value,code) => assert.rejects(value,error=>error.code===code);

test('AI tool registry excludes approval and requires restricted principal',()=>{
  const service = new OfficeService(new MemoryStore());
  assert.throws(()=>new OfficeAIAdapter(service,actor()),error=>error.code==='INVALID_PRINCIPAL');
  assert.equal(OfficeAIAdapter.toolNames.includes('approve'),false);
});
test('AI proposal diff does not mutate the file and human approval applies exactly once',async()=>{
  const service = new OfficeService(new MemoryStore());
  const {file} = await service.request(actor(),{op:'create',kind:'document',title:'Offer',content:doc(),idempotencyKey:'create'});
  const adapter = new OfficeAIAdapter(service,actor('tenant-a','ai'));
  const result = await adapter.propose({fileId:file.id,expectedRevision:1,content:doc('Proposed'),summary:'Rewrite',idempotencyKey:'proposal'});
  assert.equal(result.requiresHumanApproval,true);
  assert.ok(result.diff.entries.some(entry=>entry.before.includes('Original')&&entry.after.includes('Proposed')));
  assert.deepEqual((await adapter.readContent(file.id)).content,doc());
  assert.equal((await adapter.readContent(file.id)).trust,'untrusted_document_data');
  const input = {fileId:file.id,proposalId:result.proposal.id,expectedRevision:1,idempotencyKey:'approve'};
  await rejects(approveOfficeProposal(service,actor('tenant-a','ai'),input),'HUMAN_APPROVAL_REQUIRED');
  assert.equal((await approveOfficeProposal(service,actor(),input)).file.revision,2);
  assert.equal((await approveOfficeProposal(service,actor(),input)).file.revision,2);
});
test('AI reads enforce tenant isolation, explicit range limits and formulas metadata',async()=>{
  const service = new OfficeService(new MemoryStore());
  const {file} = await service.request(actor(),{op:'create',kind:'spreadsheet',title:'Budget',content:sheet(),idempotencyKey:'sheet'});
  const adapter = new OfficeAIAdapter(service,actor('tenant-a','ai'));
  const range = {sheetId:'s1',startRow:0,endRow:2,startColumn:0,endColumn:3};
  const read = await adapter.readRange(file.id,range);
  assert.equal(read.cells.length,12);
  assert.equal(read.cells.at(-1).formula,'=SUM(B1:B2)');
  assert.equal((await adapter.metadata(file.id)).totalFormulas,1);
  await rejects(adapter.readRange(file.id,{...range,endRow:99999,endColumn:1999}),'RANGE_LIMIT');
  const foreign = new OfficeAIAdapter(service,actor('tenant-b','ai'));
  await rejects(foreign.readContent(file.id),'NOT_FOUND');
  assert.deepEqual((await foreign.search()).files,[]);
});
test('structured quote draft stays uncommitted and rejects cached formula results',async()=>{
  const service = new OfficeService(new MemoryStore());
  const {file} = await service.request(actor(),{op:'create',kind:'spreadsheet',title:'Budget',content:sheet(),idempotencyKey:'sheet'});
  const adapter = new OfficeAIAdapter(service,actor('tenant-a','ai'));
  const input = {fileId:file.id,range:{sheetId:'s1',startRow:0,endRow:1,startColumn:0,endColumn:2},currency:'CZK',descriptionColumn:0,quantityColumn:1,unitPriceColumn:2};
  const result = await adapter.prepareQuoteLines(input);
  assert.equal(result.rows.length,2);
  assert.equal(result.rows[0].unitPrice,125);
  assert.equal(result.committed,false);
  assert.equal(result.requiresHumanApproval,true);
  const changed=sheet();changed.workbook.sheets.s1.cellData[0][2]={f:'=100+25',v:125};
  await service.request(actor(),{op:'save',id:file.id,expectedRevision:1,content:changed,idempotencyKey:'save'});
  await rejects(adapter.prepareQuoteLines(input),'UNVERIFIED_FORMULA_RESULT');
});
test('diff is bounded and AI cannot export without a configured exporter',async()=>{
  const many=doc('before'),changed=doc('after');
  many.doc.content=Array.from({length:500},()=>({type:'paragraph',content:[{type:'text',text:'before'}]}));
  changed.doc.content=Array.from({length:500},()=>({type:'paragraph',content:[{type:'text',text:'after'}]}));
  const diff=compareOfficeContent(many,changed);assert.equal(diff.entries.length,200);assert.equal(diff.truncated,true);
  const adapter=new OfficeAIAdapter(new OfficeService(new MemoryStore()),actor('tenant-a','ai'));
  await rejects(adapter.export('missing','docx'),'UNSUPPORTED_OPERATION');
});
