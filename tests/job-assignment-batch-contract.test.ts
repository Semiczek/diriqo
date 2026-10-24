import {describe,expect,it} from 'vitest'
import {AssignmentBatchError,parseAssignmentBatchCommand,parseAssignmentBatchWorkspace,parseAssignmentBatchReceipt,parseAssignmentBatchOutcome,assignmentBatchPayload} from '../lib/job-assignment-batch'
const c='11111111-1111-4111-8111-111111111111',a='22222222-2222-4222-8222-222222222222',j='33333333-3333-4333-8333-333333333333',w='44444444-4444-4444-8444-444444444444',r='55555555-5555-4555-8555-555555555555',op='66666666-6666-4666-8666-666666666666',other='77777777-7777-4777-8777-777777777777'
const scope={companyId:c,actorProfileId:a,jobId:j}
const row={id:r,company_id:c,job_id:j,profile_id:w,labor_hours:'8.00',hourly_rate:'200.00',worker_type_snapshot:'employee',assignment_billing_type:null,external_amount:null,note:null,work_started_at:null,work_completed_at:null,archived_at:null}
const workspace={company_id:c,actor_id:a,job_id:j,scope_token:'a'.repeat(64),target_job_ids:[j],assignments:[row]}
const receipt={...workspace,operation_id:op,kind:'upsert',deleted_ids:[]}
const command={...scope,operationId:op,scopeToken:'a'.repeat(64),kind:'upsert',assignments:[{profile_id:w,labor_hours:'8.00',hourly_rate:200}]}
function unknown(call:()=>unknown){try{call();throw Error('expected rejection')}catch(error){expect(error).toBeInstanceOf(AssignmentBatchError);expect(error).toMatchObject({code:'unknown',uncertain:true})}}
describe('atomic assignment DTO evidence boundaries',()=>{
 it('parses complete numeric-string SQL DTOs',()=>{
  expect(parseAssignmentBatchWorkspace(workspace,scope).assignments[0]).toMatchObject({labor_hours:8,hourly_rate:200,external_amount:null})
  expect(parseAssignmentBatchReceipt(receipt,{...scope,operationId:op,kind:'upsert'}).operation_id).toBe(op)
 })
 it.each(['company_id','actor_id','job_id'] as const)('rejects foreign %s',field=>unknown(()=>parseAssignmentBatchWorkspace({...workspace,[field]:other},scope)))
 it.each([null,{}, {...workspace,assignments:null},{...workspace,target_job_ids:[]},{...workspace,target_job_ids:[other]},{...workspace,target_job_ids:[j,j]},{...workspace,scope_token:'fake'}])('never coerces missing/malformed workspace to empty success %j',value=>unknown(()=>parseAssignmentBatchWorkspace(value,scope)))
 it.each([{company_id:other},{job_id:other},{profile_id:''},{id:'invalid'},{labor_hours:null},{hourly_rate:''},{external_amount:'NaN'},{work_started_at:'bad'},{archived_at:undefined},{note:false},{worker_type_snapshot:'other'},{assignment_billing_type:'other'}])('rejects malformed row %j',patch=>unknown(()=>parseAssignmentBatchWorkspace({...workspace,assignments:[{...row,...patch}]},scope)))
 it('rejects repeated source IDs and duplicate worker/job tuples',()=>{
  unknown(()=>parseAssignmentBatchWorkspace({...workspace,assignments:[row,row]},scope))
  unknown(()=>parseAssignmentBatchWorkspace({...workspace,assignments:[row,{...row,id:other}]},scope))
 })
 it('rejects receipt for different command identity or action',()=>{
  unknown(()=>parseAssignmentBatchReceipt(receipt,{...scope,operationId:other}))
  unknown(()=>parseAssignmentBatchReceipt(receipt,{...scope,kind:'delete'}))
 })
 it('allows child rows only in workspace, not root receipt',()=>{
  const input={...workspace,target_job_ids:[j,other],assignments:[{...row,job_id:other}]}
  expect(parseAssignmentBatchWorkspace(input,scope).assignments).toHaveLength(1)
  unknown(()=>parseAssignmentBatchReceipt({...receipt,...input},scope))
 })
 it('rejects duplicate or contradictory removed IDs',()=>{
  unknown(()=>parseAssignmentBatchReceipt({...receipt,kind:'delete',deleted_ids:[r]},scope))
  unknown(()=>parseAssignmentBatchReceipt({...receipt,kind:'delete',assignments:[],deleted_ids:[r,r]},scope))
  unknown(()=>parseAssignmentBatchReceipt({...receipt,deleted_ids:[other]},scope))
 })
 it('keeps legacy negative recorded values visible for repair instead of rounding or fabricating zero',()=>{
  expect(parseAssignmentBatchWorkspace({...workspace,assignments:[{...row,labor_hours:'-1.25'}]},scope).assignments[0].labor_hours).toBe(-1.25)
 })
})
describe('persisted exact command validation',()=>{
 it('normalizes numbers once and emits only the reviewed RPC payload',()=>{
  const parsed=parseAssignmentBatchCommand(command)
  expect(assignmentBatchPayload(parsed)).toEqual({actor_id:a,operation_id:op,scope_token:'a'.repeat(64),kind:'upsert',assignments:[{profile_id:w,labor_hours:8,hourly_rate:200,worker_type_snapshot:'employee',assignment_billing_type:null,external_amount:null,note:null}]})
 })
 it.each(['companyId','actorProfileId','jobId','operationId'] as const)('rejects corrupted persisted %s',key=>expect(()=>parseAssignmentBatchCommand({...command,[key]:'bad'})).toThrow(AssignmentBatchError))
 it('rejects duplicates and refuses a corrupt or missing source token',()=>{
  expect(()=>parseAssignmentBatchCommand({...command,assignments:[command.assignments[0],command.assignments[0]]})).toThrow()
  expect(()=>parseAssignmentBatchCommand({...command,scopeToken:undefined})).toThrow()
 })
 it('does not coerce blank required numbers or negative writes into zero',()=>{
  for(const value of ['',null,false,-1])expect(()=>parseAssignmentBatchCommand({...command,assignments:[{...command.assignments[0],labor_hours:value}]})).toThrow()
 })
})


describe('terminal cancellation outcome validation',()=>{
 const cancelled={company_id:c,actor_id:a,job_id:j,operation_id:op,kind:'upsert',cancelled:true}
 const expected={...scope,operationId:op,kind:'upsert' as const}
 it('accepts a scoped cancellation without fabricating a workspace or an applied result',()=>{
  expect(parseAssignmentBatchOutcome(cancelled,expected)).toEqual(cancelled)
  unknown(()=>parseAssignmentBatchReceipt(cancelled,expected))
  unknown(()=>parseAssignmentBatchWorkspace(cancelled,scope))
 })
 it('keeps an already applied outcome as the complete original receipt',()=>{
  expect(parseAssignmentBatchOutcome(receipt,expected)).toEqual(parseAssignmentBatchReceipt(receipt,expected))
 })
 it.each(['company_id','actor_id','job_id','operation_id'] as const)('rejects a cancellation for another %s',key=>{
  unknown(()=>parseAssignmentBatchOutcome({...cancelled,[key]:other},expected))
 })
 it.each([{kind:'delete'},{cancelled:'true'},{cancelled:false},{cancelled:undefined},{assignments:[]},{scope_token:'a'.repeat(64)},{deleted_ids:[]}])('retains uncertainty for a forged or contradictory cancellation %j',patch=>{
  unknown(()=>parseAssignmentBatchOutcome({...cancelled,...patch},expected))
 })
 it('does not interpret an applied receipt with a cancellation marker as either kind of success',()=>{
  unknown(()=>parseAssignmentBatchOutcome({...receipt,cancelled:true},expected))
  unknown(()=>parseAssignmentBatchReceipt({...receipt,cancelled:true},expected))
 })
})
