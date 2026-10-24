import { NextRequest } from 'next/server'
import { beforeEach,describe,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(()=>({guard:vi.fn(),client:vi.fn(),rpc:vi.fn(),from:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/server-guards',()=>({requireCompanyRole:mocks.guard}))
vi.mock('@/lib/supabase-server',()=>({createSupabaseServerClient:mocks.client}))
import { GET,POST,PUT,DELETE,PATCH } from '../app/api/jobs/[jobId]/assignments/route'
const company='11111111-1111-4111-8111-111111111111',actor='22222222-1111-4111-8111-111111111111',worker='33333333-1111-4111-8111-111111111111',job='44444444-1111-4111-8111-111111111111',child='55555555-1111-4111-8111-111111111111',assignment='66666666-1111-4111-8111-111111111111',operation='77777777-1111-4111-8111-111111111111'
const scopeToken='a'.repeat(64),metadata={companyId:company,actorProfileId:actor,operationId:operation,scopeToken}
const row={id:assignment,company_id:company,job_id:job,profile_id:worker,labor_hours:7,hourly_rate:200,worker_type_snapshot:'employee',assignment_billing_type:null,external_amount:null,note:null,work_started_at:null,work_completed_at:null,archived_at:null}
const workspace={company_id:company,actor_id:actor,job_id:job,scope_token:scopeToken,target_job_ids:[job,child],assignments:[row]}
const receipt={...workspace,operation_id:operation,kind:'upsert',deleted_ids:[]}
const context={params:Promise.resolve({jobId:job})}
function raw(method:string,body:unknown){return new NextRequest(`https://app.diriqo.test/api/jobs/${job}/assignments`,{method,body:JSON.stringify(body),headers:{'Content-Type':'application/json'}})}
function request(method:string,value:unknown={profile_id:worker,labor_hours:7,hourly_rate:200}) {
  const body=method==='PUT'?{...metadata,assignments:[value]}:method==='POST'?{...metadata,...value as object}:{...metadata,assignmentId:assignment}
  return raw(method,body)
}
beforeEach(()=>{
 vi.resetAllMocks()
 mocks.guard.mockResolvedValue({ok:true,value:{companyId:company,profileId:actor,role:'company_admin'}})
 mocks.client.mockResolvedValue({rpc:mocks.rpc,from:mocks.from})
 mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='get_job_assignment_batch_workspace')return {data:workspace,error:null}
  if(name==='get_job_assignment_batch_receipt')return {data:receipt,error:null}
  const p=args.payload as {kind:string}
  return {data:p.kind==='delete'?{...receipt,kind:'delete',assignments:[],deleted_ids:[assignment]}:receipt,error:null}
 })
})
describe('actual atomic assignment API and DAL',()=>{
 it.each([['POST',POST],['PUT',PUT],['DELETE',DELETE]] as const)('%s makes exactly one scoped RPC and no direct table writes',async(method,handler)=>{
  const response=await handler(request(method),context)
  expect(response.status).toBe(200);expect(await response.json()).toHaveProperty('receipt.operation_id',operation)
  expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.rpc.mock.calls[0]).toMatchObject(['mutate_job_assignments_atomic',{target_company_id:company,target_job_id:job,payload:{actor_id:actor,operation_id:operation,scope_token:scopeToken,kind:method==='DELETE'?'delete':'upsert'}}])
  expect(mocks.from).not.toHaveBeenCalled()
 })
 it.each([['POST',POST],['PUT',PUT],['DELETE',DELETE]] as const)('%s maps a protected child using actual trusted RPC detail',async(method,handler)=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'PT409',message:'LABOR_APPROVED_SOURCE_IMMUTABLE',details:JSON.stringify({assignment_id:assignment,profile_id:worker,job_id:child})}})
  const response=await handler(request(method),context),body=await response.json()
  expect(response.status).toBe(409);expect(body).toMatchObject({code:'LABOR_APPROVED_SOURCE_IMMUTABLE',category:'protected',uncertain:false})
  expect(Object.fromEntries(new URL(body.reviewHref,'https://app.diriqo.test').searchParams)).toEqual({company,actor,worker,job:child,sourceKind:'assignment',source:assignment})
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
 })
 it('never fabricates a source from malformed protected detail',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'PT409',message:'LABOR_APPROVED_SOURCE_IMMUTABLE',details:'not JSON'}})
  const body=await (await PUT(request('PUT'),context)).json()
  expect(Object.fromEntries(new URL(body.reviewHref,'https://app.diriqo.test').searchParams)).toEqual({company,actor})
 })
 it.each(['JOB_ASSIGNMENT_SCOPE_CONFLICT','JOB_ASSIGNMENT_OPERATION_CONFLICT'])('returns confirmed conflict for %s',async message=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'PT409',message}})
  const response=await PUT(request('PUT'),context)
  expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'conflict',uncertain:false})
 })
 it('keeps transport/database uncertainty and hides internal detail',async()=>{
  mocks.rpc.mockRejectedValue(Error('secret internal database host'))
  const response=await PUT(request('PUT'),context),body=await response.json()
  expect(response.status).toBe(500);expect(body).toMatchObject({code:'unknown',uncertain:true});expect(JSON.stringify(body)).not.toContain('secret')
 })
 it.each([null,{...receipt,actor_id:worker},{...receipt,operation_id:worker},{...receipt,kind:'delete'},{...receipt,assignments:[{...row,job_id:child}]}])('does not confirm malformed or foreign mutation receipt %j',async data=>{
  mocks.rpc.mockResolvedValue({data,error:null})
  const response=await PUT(request('PUT'),context)
  expect(response.status).toBe(500);expect(await response.json()).toMatchObject({uncertain:true})
 })
 it('checks role before creating a database client',async()=>{
  mocks.guard.mockResolvedValue({ok:false,error:'Forbidden',status:403})
  expect((await PUT(request('PUT'),context)).status).toBe(403);expect(mocks.client).not.toHaveBeenCalled()
 })
 it.each(['companyId','actorProfileId'] as const)('rejects changed %s before RPC',async field=>{
  expect((await PUT(raw('PUT',{...metadata,[field]:worker,assignments:[{profile_id:worker,labor_hours:8,hourly_rate:200}]}),context)).status).toBe(403)
  expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('returns unavailability only when the RPC is known missing',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'missing'}})
  const response=await PUT(request('PUT'),context)
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'unavailable',uncertain:false})
 })
 it('reads a pinned workspace with no cache',async()=>{
  const req=new NextRequest(`https://app.diriqo.test/api/jobs/${job}/assignments?companyId=${company}&actorProfileId=${actor}`)
  const response=await GET(req,context)
  expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toMatchObject({ok:true,workspace})
 })
 it('looks up a missing receipt explicitly without executing any mutation',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:null})
  const response=await GET(new NextRequest(`https://app.diriqo.test/api/jobs/${job}/assignments?companyId=${company}&actorProfileId=${actor}&operationId=${operation}`),context)
  expect(await response.json()).toEqual({ok:true,receipt:null})
  expect(mocks.rpc).toHaveBeenCalledWith('get_job_assignment_batch_receipt',{target_company_id:company,target_job_id:job,target_operation_id:operation})
 })
 it('rejects repeated GET identity parameters',async()=>{
  const response=await GET(new NextRequest(`https://app.diriqo.test/api/jobs/${job}/assignments?companyId=${company}&companyId=${company}&actorProfileId=${actor}`),context)
  expect(response.status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()
 })
})
describe('batch numeric input preflight',()=>{
 const modes=[
  {row:{profile_id:worker,worker_type_snapshot:'employee',labor_hours:8,hourly_rate:200},required:['labor_hours','hourly_rate']},
  {row:{profile_id:worker,worker_type_snapshot:'contractor',assignment_billing_type:'hourly',labor_hours:8,hourly_rate:200},required:['labor_hours','hourly_rate']},
  {row:{profile_id:worker,worker_type_snapshot:'contractor',assignment_billing_type:'fixed',external_amount:1200},required:['external_amount']},
  {row:{profile_id:worker,worker_type_snapshot:'contractor',assignment_billing_type:'invoice',external_amount:1200},required:['external_amount']},
 ]
 const invalid=[undefined,null,'',' ','invalid',-1,'-1',true,false,[],{},'0x10','Infinity',0.001,10000000000]
 for(const [method,handler] of [['POST',POST],['PUT',PUT]] as const) {
  it.each(modes)(method+' rejects every invalid required value before RPC: %j',async mode=>{
   for(const field of mode.required)for(const value of invalid)expect((await handler(request(method,{...mode.row,[field]:value}),context)).status).toBe(400)
   expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(modes)(method+' preserves explicit zero: %j',async mode=>{
   expect((await handler(request(method,{...mode.row,...Object.fromEntries(mode.required.map(field=>[field,0]))}),context)).status).toBe(200)
   const p=mocks.rpc.mock.calls[0][1].payload.assignments[0]
   for(const field of mode.required)expect(p[field]).toBe(0)
  })
  it.each(['fixed','invoice'])(method+' omits absent optional hourly values for %s',async billing=>{
   expect((await handler(request(method,{profile_id:worker,worker_type_snapshot:'contractor',assignment_billing_type:billing,external_amount:'1200.50',labor_hours:null}),context)).status).toBe(200)
   const p=mocks.rpc.mock.calls[0][1].payload.assignments[0]
   expect(p).toMatchObject({external_amount:1200.5});expect(p).not.toHaveProperty('labor_hours');expect(p).not.toHaveProperty('hourly_rate')
  })
  it.each(['fixed','invoice'])(method+' rejects invalid supplied optional numbers %s',async billing=>{
   for(const field of ['labor_hours','hourly_rate'])for(const value of ['',-1,false,0.001])expect((await handler(request(method,{profile_id:worker,worker_type_snapshot:'contractor',assignment_billing_type:billing,external_amount:0,[field]:value}),context)).status).toBe(400)
   expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it(method+' rejects unknown contractor mode and accepts decimal strings',async()=>{
   expect((await handler(request(method,{profile_id:worker,worker_type_snapshot:'contractor',assignment_billing_type:'other',external_amount:1}),context)).status).toBe(400)
   expect((await handler(request(method,{profile_id:worker,labor_hours:'7.25',hourly_rate:' 150.50 '}),context)).status).toBe(200)
   expect(mocks.rpc.mock.calls[0][1].payload.assignments[0]).toMatchObject({labor_hours:7.25,hourly_rate:150.5})
  })
 }
 it('validates all PUT rows before making a database call',async()=>{
  const response=await PUT(raw('PUT',{...metadata,assignments:[{profile_id:worker,labor_hours:8,hourly_rate:200},{profile_id:actor,labor_hours:null,hourly_rate:200}]}),context)
  expect(response.status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('rejects duplicate workers instead of double editing them',async()=>{
  const input={profile_id:worker,labor_hours:8,hourly_rate:200}
  expect((await PUT(raw('PUT',{...metadata,assignments:[input,input]}),context)).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it.each([null,[],{},{assignments:[]},{assignments:[null]}])('rejects malformed batch %j',async input=>{
  expect((await PUT(raw('PUT',input),context)).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('bounds streamed request size without relying on Content-Length',async()=>{
  expect((await PUT(raw('PUT',{...metadata,note:'x'.repeat(1024*1024),assignments:[]}),context)).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()
 })
})


describe('terminal cancellation HTTP recovery',()=>{
 const command={...metadata,jobId:job,kind:'upsert',assignments:[{profile_id:worker,labor_hours:7,hourly_rate:200}]}
 const cancelled={company_id:company,actor_id:actor,job_id:job,operation_id:operation,kind:'upsert',cancelled:true}
 it('sends the original canonical command to one cancellation RPC with no business table writes',async()=>{
  mocks.rpc.mockResolvedValue({data:cancelled,error:null})
  const response=await PATCH(raw('PATCH',command),context)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ok:true,receipt:cancelled})
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
  expect(mocks.rpc).toHaveBeenCalledWith('cancel_job_assignment_batch_operation',{target_company_id:company,target_job_id:job,payload:{
   actor_id:actor,operation_id:operation,scope_token:scopeToken,kind:'upsert',assignments:[{
    profile_id:worker,labor_hours:7,hourly_rate:200,worker_type_snapshot:'employee',assignment_billing_type:null,external_amount:null,note:null
   }]
  }})
  expect(mocks.from).not.toHaveBeenCalled()
 })
 it('returns the original applied receipt if mutation won before cancellation',async()=>{
  mocks.rpc.mockResolvedValue({data:receipt,error:null})
  const response=await PATCH(raw('PATCH',command),context)
  expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,receipt})
 })
 it('preserves a delete cancellation as cancellation without claiming rows were removed',async()=>{
  const marker={...cancelled,kind:'delete'}
  mocks.rpc.mockResolvedValue({data:marker,error:null})
  const response=await PATCH(raw('PATCH',{...metadata,jobId:job,kind:'delete',assignmentId:assignment}),context)
  expect(await response.json()).toEqual({ok:true,receipt:marker})
  expect(mocks.rpc.mock.calls[0][1].payload).toMatchObject({kind:'delete',assignment_id:assignment})
 })
 it('returns a terminal marker on late mutation without claiming it was applied',async()=>{
  mocks.rpc.mockResolvedValue({data:cancelled,error:null})
  const response=await PUT(request('PUT'),context)
  expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,receipt:cancelled})
 })
 it('allows receipt lookup to recover a lost cancellation response',async()=>{
  mocks.rpc.mockResolvedValue({data:cancelled,error:null})
  const response=await GET(new NextRequest(`https://app.diriqo.test/api/jobs/${job}/assignments?companyId=${company}&actorProfileId=${actor}&operationId=${operation}`),context)
  expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,receipt:cancelled})
  expect(mocks.rpc.mock.calls[0][0]).toBe('get_job_assignment_batch_receipt')
 })
 it.each([null,{...cancelled,company_id:worker},{...cancelled,actor_id:worker},{...cancelled,job_id:child},{...cancelled,operation_id:worker},{...cancelled,kind:'delete'},{...cancelled,assignments:[]}])('does not confirm cancellation from invalid evidence %j',async data=>{
  mocks.rpc.mockResolvedValue({data,error:null})
  const response=await PATCH(raw('PATCH',command),context)
  expect(response.status).toBe(500);expect(await response.json()).toMatchObject({code:'unknown',uncertain:true})
 })
 it('keeps a lost cancellation response uncertain',async()=>{
  mocks.rpc.mockRejectedValue(Error('private transport detail'))
  const response=await PATCH(raw('PATCH',command),context),body=await response.json()
  expect(response.status).toBe(500);expect(body).toMatchObject({uncertain:true})
  expect(JSON.stringify(body)).not.toContain('private transport')
 })
 it.each(['companyId','actorProfileId'] as const)('rejects a changed cancellation %s before RPC',async key=>{
  expect((await PATCH(raw('PATCH',{...command,[key]:worker}),context)).status).toBe(403)
  expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('rejects mismatched URL job and malformed original commands before RPC',async()=>{
  for(const value of [{...command,jobId:child},{...command,operationId:null},{...command,scopeToken:'wrong'},{...command,assignments:[]}]){
   expect((await PATCH(raw('PATCH',value),context)).status).toBe(400)
  }
  expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('cannot use cancellation after administrative authority was removed',async()=>{
  mocks.guard.mockResolvedValue({ok:false,error:'Forbidden',status:403})
  expect((await PATCH(raw('PATCH',command),context)).status).toBe(403)
  expect(mocks.client).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled()
 })
})
