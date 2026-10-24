import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DalContext } from '../lib/dal/auth'
vi.mock('server-only',()=>({}))
const mocks=vi.hoisted(()=>({member:vi.fn()}))
vi.mock('@/lib/dal/companies',()=>({assertProfileInCompany:mocks.member,TenantScopeError:class extends Error{}}))
import { updateJobAssignmentEconomics } from '../lib/dal/jobs'
const companyId='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333',assignmentId='44444444-4444-4444-8444-444444444444',profileId='55555555-5555-4555-8555-555555555555',other='66666666-6666-4666-8666-666666666666'
const input={assignmentId,jobId,profileId,laborHours:7,hourlyRate:200}
let row:Record<string,unknown>,calls:Array<{table:string;filters:Record<string,unknown>;payload?:unknown}>,failure:unknown,jobExists:boolean
function db(){return {from(table:string){const call:{table:string;filters:Record<string,unknown>;payload?:unknown}={table,filters:{}};calls.push(call);const q={select:()=>q,eq:(key:string,value:unknown)=>{call.filters[key]=value;return q},update:(payload:unknown)=>{call.payload=payload;return q},maybeSingle:async()=>table==='jobs'?{data:jobExists?{id:jobId}:null,error:null}:Object.entries(call.filters).every(([key,value])=>row[key]===value)?{data:failure?null:{id:assignmentId},error:failure}:{data:null,error:null}};return q}}}
function ctx(){return {companyId,profileId:actor,role:'company_admin',supabase:db()} as unknown as DalContext}
beforeEach(()=>{vi.resetAllMocks();row={id:assignmentId,company_id:companyId,job_id:jobId,profile_id:profileId};calls=[];failure=null;jobExists=true})
describe('Worker assignment Save row scope',()=>{
 it('updates exactly one authorized company/job/worker/source record',async()=>{await updateJobAssignmentEconomics(ctx(),input);expect(calls.find(call=>call.payload)).toMatchObject({filters:{id:assignmentId,company_id:companyId,job_id:jobId,profile_id:profileId},payload:{labor_hours:7,hourly_rate:200}});expect(mocks.member).toHaveBeenCalledWith(expect.objectContaining({companyId}),profileId)})
 it.each(['id','company_id','job_id','profile_id'])('rejects a mismatched database %s instead of false success',async key=>{row[key]=other;await expect(updateJobAssignmentEconomics(ctx(),input)).rejects.toThrow('Přiřazení není v aktivní firmě dostupné.')})
 it('rejects a foreign job before attempting update',async()=>{jobExists=false;await expect(updateJobAssignmentEconomics(ctx(),input)).rejects.toThrow('Zakázka nepatří');expect(calls.some(call=>call.payload)).toBe(false)})
 it('rejects lost worker membership before update',async()=>{mocks.member.mockRejectedValue(Error('membership revoked'));await expect(updateJobAssignmentEconomics(ctx(),input)).rejects.toThrow('membership revoked');expect(calls.some(call=>call.payload)).toBe(false)})
 it('preserves the immutable-source database error for structured action mapping',async()=>{failure={code:'23514',message:'LABOR_APPROVED_SOURCE_IMMUTABLE'};await expect(updateJobAssignmentEconomics(ctx(),input)).rejects.toEqual(failure)})
})
