import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({guard:vi.fn(),client:vi.fn()}))
vi.mock('@/lib/server-guards',()=>({requireCompanyRole:mocks.guard}))
vi.mock('@/lib/supabase-server',()=>({createSupabaseServerClient:mocks.client}))
import { PATCH, DELETE } from '../app/api/job-assignments/[assignmentId]/route'
const companyId='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444',worker='55555555-5555-4555-8555-555555555555'
let error:unknown,data:unknown,assignment:unknown,filters:unknown[][],writes:number,updatePayload:Record<string,unknown> | null
function from(){let write=false;const q={select:()=>q,eq:(...args:unknown[])=>{filters.push(args);return q},update:(payload:Record<string,unknown>)=>{write=true;writes++;updatePayload=payload;return q},delete:()=>{write=true;writes++;return q},maybeSingle:async()=>write?{data,error}:{data:assignment,error:null}};return q}
function run(method:'PATCH'|'DELETE', action:'reset_hours'|'archive'='reset_hours', pins:Record<string,unknown>={companyId,actorProfileId:actor}){const request=new NextRequest('https://app.diriqo.com/api/job-assignments/'+id,{method,...(method==='PATCH'?{body:JSON.stringify({action,...pins})}:{})});return (method==='PATCH'?PATCH:DELETE)(request,{params:Promise.resolve({assignmentId:id})})}
beforeEach(()=>{vi.resetAllMocks();error=null;data={id};filters=[];writes=0;updatePayload=null;assignment={id,job_id:job,profile_id:worker,jobs:{company_id:companyId}};mocks.guard.mockResolvedValue({ok:true,value:{companyId,profileId:actor}});mocks.client.mockResolvedValue({from})})
describe.each(['PATCH','DELETE'] as const)('%s approved assignment protection',method=>{
 it('returns 409 with scoped review destination',async()=>{error={code:'23514',message:'LABOR_APPROVED_SOURCE_IMMUTABLE'};const response=await run(method);expect(response.status).toBe(409);const body=await response.json();expect(body.code).toBe('LABOR_APPROVED_SOURCE_IMMUTABLE');const url=new URL(body.reviewHref,'https://app.diriqo.com');expect(url.pathname).toBe('/labor');expect(Object.fromEntries(url.searchParams)).toEqual({company:companyId,actor,job,worker,sourceKind:'assignment',source:id});expect(filters).toContainEqual(['jobs.company_id',companyId]);expect(filters).toContainEqual(['job_id',job])})
 it('does not turn zero mutated rows into success',async()=>{data=null;expect((await run(method)).status).toBe(404)})
 it('does not expose database error details',async()=>{error={message:'secret internal table detail'};const response=await run(method);expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain('secret')})
 it('rejects foreign-company assignment before write or link',async()=>{assignment={id,job_id:job,profile_id:worker,jobs:{company_id:worker}};expect((await run(method)).status).toBe(404);expect(writes).toBe(0)})
 it('rechecks admin authorization',async()=>{mocks.guard.mockResolvedValue({ok:false,status:403,error:'Denied'});expect((await run(method)).status).toBe(403);expect(mocks.client).not.toHaveBeenCalled()})
})


describe('Explicit reset and non-destructive archive',()=>{
 it('resets NOT NULL hours to explicit zero and clears the reset interval with actor audit',async()=>{
  const response=await run('PATCH','reset_hours')
  expect(response.status).toBe(200)
  expect(updatePayload).toEqual({labor_hours:0,work_started_at:null,work_completed_at:null,reset_at:expect.any(String),reset_by:actor,reset_reason:null})
 })
 it('archives without overwriting recorded hours, timestamps, rate or cost',async()=>{
  const response=await run('PATCH','archive')
  expect(response.status).toBe(200)
  expect(updatePayload).toEqual({archived_at:expect.any(String),archived_by:actor,archive_reason:null})
 })
 it.each(['reset_hours','archive'] as const)('does not bypass approved source protection for %s',async action=>{
  error={code:'23514',message:'LABOR_APPROVED_SOURCE_IMMUTABLE'}
  expect((await run('PATCH',action)).status).toBe(409)
 })
})


describe('Rendered PATCH company/account pin',()=>{
 it.each([{companyId:worker,actorProfileId:actor},{companyId,actorProfileId:worker},{}])('rejects changed or missing identity %j before querying assignment',async pins=>{
  const response=await run('PATCH','reset_hours',pins)
  expect(response.status).toBe(403);expect(mocks.client).not.toHaveBeenCalled();expect(writes).toBe(0)
 })
})
