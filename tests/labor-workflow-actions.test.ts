import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({context:vi.fn(),save:vi.fn(),submit:vi.fn(),review:vi.fn(),preview:vi.fn(),refresh:vi.fn()}))
vi.mock('@/lib/dal/auth',()=>({requireCompanyRoleDalContext:mocks.context}))
vi.mock('@/lib/dal/labor-history',()=>({saveLaborSubmissionDraft:mocks.save,submitLaborSubmission:mocks.submit,reviewLaborSubmission:mocks.review,getLaborCostPreview:mocks.preview}))
vi.mock('next/cache',()=>({revalidatePath:mocks.refresh}))
import { runLaborCommandAction, previewLaborAction } from '../app/labor/actions'
import { LaborHistoryError } from '../lib/labor-history'
const companyId='11111111-1111-4111-8111-111111111111',actorProfileId='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333'
const command={kind:'submit',input:{companyId,actorProfileId,operationId:id,submissionId:id,versionId:id,expectedRevision:'1'}}
beforeEach(()=>{vi.resetAllMocks();mocks.context.mockResolvedValue({companyId,profileId:actorProfileId,role:'worker'});mocks.submit.mockResolvedValue({id})})
describe('Labor server actions',()=>{
 it('rejects invalid input before authorization or dispatch',async()=>{expect(await runLaborCommandAction({...command,input:{}})).toMatchObject({ok:false,code:'validation',uncertain:false});expect(mocks.context).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled()})
 it('revalidates server identity and delegates the pinned scope to DAL',async()=>{expect(await runLaborCommandAction(command)).toEqual({ok:true,data:{id}});expect(mocks.context).toHaveBeenCalledWith('worker','manager','company_admin','super_admin');expect(mocks.submit).toHaveBeenCalledWith({companyId,profileId:actorProfileId,role:'worker'},command.input)})
 it('does not call mutations after auth rejection',async()=>{mocks.context.mockRejectedValue(new Error('revoked'));expect(await runLaborCommandAction(command)).toMatchObject({ok:false,uncertain:false,code:'forbidden'});expect(mocks.submit).not.toHaveBeenCalled()})
 it('preserves an unknown outcome after mutation dispatch',async()=>{mocks.submit.mockRejectedValue(new Error('response lost'));expect(await runLaborCommandAction(command)).toMatchObject({ok:false,uncertain:true,code:'unknown'})})
 it('does not turn a confirmed mutation into failure when refresh throws',async()=>{mocks.refresh.mockImplementation(()=>{throw Error('refresh')});expect(await runLaborCommandAction(command)).toEqual({ok:true,data:{id}})})
 it('keeps typed database conflicts distinct from unknown outcomes',async()=>{mocks.submit.mockRejectedValue(new LaborHistoryError('stale','conflict'));expect(await runLaborCommandAction(command)).toMatchObject({ok:false,uncertain:false,code:'conflict'})})
 it('does not preview another company or actor',async()=>{expect(await previewLaborAction({companyId:id,actorProfileId,submissionId:id,versionId:id})).toMatchObject({ok:false,code:'forbidden'});expect(mocks.preview).not.toHaveBeenCalled();expect(mocks.context).toHaveBeenCalledWith('manager','company_admin','super_admin')})
})
