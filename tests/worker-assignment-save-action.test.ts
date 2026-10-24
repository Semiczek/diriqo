import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({context:vi.fn(),update:vi.fn(),refresh:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('next/cache',()=>({revalidatePath:mocks.refresh}))
vi.mock('@/lib/dal/auth',()=>({requireCompanyRoleDalContext:mocks.context,DalAuthError:class extends Error{}}))
vi.mock('@/lib/dal/jobs',()=>({updateJobAssignmentEconomics:mocks.update}))
import { updateJobAssignmentEconomicsAction } from '../app/business-actions'
const companyId='11111111-1111-4111-8111-111111111111',actorProfileId='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333',assignmentId='44444444-4444-4444-8444-444444444444',profileId='55555555-5555-4555-8555-555555555555',other='66666666-6666-4666-8666-666666666666'
const command={companyId,actorProfileId,jobId,assignmentId,profileId,laborHours:7,hourlyRate:200}
beforeEach(()=>{vi.resetAllMocks();mocks.context.mockResolvedValue({companyId,profileId:actorProfileId,role:'company_admin'})})
describe('Worker assignment Save server action',()=>{
 it('uses fresh admin authorization and exact row identity',async()=>{
  expect(await updateJobAssignmentEconomicsAction(command)).toEqual({ok:true,data:undefined})
  expect(mocks.context).toHaveBeenCalledWith('company_admin','super_admin')
  expect(mocks.update).toHaveBeenCalledWith({companyId,profileId:actorProfileId,role:'company_admin'},{assignmentId,jobId,profileId,laborHours:7,hourlyRate:200})
  expect(mocks.refresh).toHaveBeenCalledWith(`/workers/${profileId}`)
 })
 it.each(['companyId','actorProfileId'] as const)('rejects a changed %s before mutation or returning a link',async field=>{
  const result=await updateJobAssignmentEconomicsAction({...command,[field]:other})
  expect(result.ok).toBe(false);expect(result).not.toHaveProperty('reviewHref');expect(mocks.update).not.toHaveBeenCalled()
 })
 it('cannot save after role revocation',async()=>{mocks.context.mockRejectedValue(Error('denied'));expect((await updateJobAssignmentEconomicsAction(command)).ok).toBe(false);expect(mocks.update).not.toHaveBeenCalled()})
 it.each(['assignmentId','jobId','profileId'] as const)('rejects invalid %s before mutation',async field=>{expect((await updateJobAssignmentEconomicsAction({...command,[field]:'invalid'})).ok).toBe(false);expect(mocks.update).not.toHaveBeenCalled()})
 it('maps only confirmed immutable-source errors to the current scoped review URL',async()=>{
  mocks.update.mockRejectedValue({code:'23514',message:'LABOR_APPROVED_SOURCE_IMMUTABLE'})
  const result=await updateJobAssignmentEconomicsAction(command)
  expect(result).toMatchObject({ok:false,code:'LABOR_APPROVED_SOURCE_IMMUTABLE'})
  expect(result).toHaveProperty('reviewHref')
  if(!('reviewHref' in result))throw Error('missing review link')
  expect(Object.fromEntries(new URL(result.reviewHref,'https://diriqo.invalid').searchParams)).toEqual({company:companyId,actor:actorProfileId,job:jobId,worker:profileId,sourceKind:'assignment',source:assignmentId})
  expect(mocks.refresh).not.toHaveBeenCalled()
 })
 it('returns ordinary failure without a misleading review URL',async()=>{mocks.update.mockRejectedValue({code:'42501',message:'permission denied'});const result=await updateJobAssignmentEconomicsAction(command);expect(result.ok).toBe(false);expect(result).not.toHaveProperty('reviewHref')})
})
