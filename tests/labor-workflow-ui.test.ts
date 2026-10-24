// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import type { LaborCommand,LaborWorkspace } from '../app/labor/workflow'
import type { LaborSubmissionDto } from '../lib/labor-history'
const mocks=vi.hoisted(()=>({run:vi.fn(),preview:vi.fn(),refresh:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}))
vi.mock('@/components/I18nProvider',()=>({useI18n:()=>({locale:'cs'})}))
vi.mock('@/app/labor/actions',()=>({runLaborCommandAction:mocks.run,previewLaborAction:mocks.preview}))
import LaborWorkspaceClient from '../app/labor/LaborWorkspaceClient'
const companyId='11111111-1111-4111-8111-111111111111',actorProfileId='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333',sourceId='44444444-4444-4444-8444-444444444444',sid='55555555-5555-4555-8555-555555555555',vid='66666666-6666-4666-8666-666666666666'
const workspace:LaborWorkspace={companyId,actorProfileId,companyName:'Test company',role:'worker',items:[],sources:[{kind:'shift',id:sourceId,profileId:actorProfileId,profileName:'Jana Worker',jobId,jobTitle:'Test job',workDate:'2026-10-24',actualHours:'8.0000',startedAt:null,endedAt:null,submissionId:null}]}
const line={workDate:'2026-10-24',actualHours:'8.0000',payHours:'7.5000',billedHours:'6.0000',startedAt:null,endedAt:null,lineNo:1}
function item(state:'draft'|'submitted'|'approved'='draft'):LaborSubmissionDto{return {id:sid,companyId,profileId:actorProfileId,jobId,revision:state==='draft'?'1':state==='submitted'?'2':'3',currentVersionId:vid,approvedVersionId:state==='approved'?vid:null,sources:[{kind:'shift',id:sourceId}],versions:[{id:vid,version:'1',state,revisionOf:null,correctionReason:null,createdAt:'2026-10-24T08:00:00Z',submittedAt:state==='draft'?null:'2026-10-24T08:00:00Z',reviewedAt:state==='approved'?'2026-10-24T08:00:00Z':null,reviewReason:null,lines:[line]}]}}
function success(command:LaborCommand){const data=item(command.kind==='draft'?'draft':command.kind==='submit'?'submitted':command.input.decision==='approve'?'approved':'draft');data.revision=(BigInt(command.input.expectedRevision)+BigInt(1)).toString();data.operationId=command.input.operationId;data.actorProfileId=command.input.actorProfileId;return {ok:true,data}}
const storageKey=`diriqo:labor-operation:v1:${companyId}:${actorProfileId}`
let root:Root,container:HTMLDivElement
function button(text:string){const b=[...container.querySelectorAll('button')].find(value=>value.textContent===text);expect(b).toBeDefined();return b!}
async function click(text:string){await act(async()=>button(text).click())}
async function mount(data=workspace,key='one'){await act(async()=>root.render(createElement(LaborWorkspaceClient,{key,workspace:data})))}
async function input(selector:string,value:string){await act(async()=>{const el=container.querySelector(selector) as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))})}
async function newDraft(){await click('Nový výkaz');await act(async()=>{(container.querySelector('input[type=checkbox]') as HTMLInputElement).click()});await input('[name="payHours-0"]','7.5');await input('[name="billedHours-0"]','6')}
async function save(){await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))}
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);sessionStorage.clear();mocks.run.mockImplementation(async command=>success(command));container=document.createElement('div');document.body.append(container);root=createRoot(container)})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();sessionStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals()})
describe('Labor workflow with real React and browser storage',()=>{
 it('creates a draft from verified source options and distinct hours',async()=>{await mount();await newDraft();await save();expect(mocks.run).toHaveBeenCalledOnce();expect(mocks.run.mock.calls[0][0].input).toMatchObject({companyId,actorProfileId,profileId:actorProfileId,jobId,sources:[{kind:'shift',id:sourceId}],lines:[{actualHours:'8.0000',payHours:'7.5000',billedHours:'6.0000'}]});expect(sessionStorage.getItem(storageKey)).toBeNull();expect(container.textContent).toContain('Změna byla potvrzena.')})
 it('replays identical unknown operations after remount and retains them after permission failure',async()=>{mocks.run.mockRejectedValueOnce(Error('lost'));await mount();await newDraft();await save();const original=mocks.run.mock.calls[0][0];await mount(workspace,'restored');mocks.run.mockResolvedValueOnce({ok:false,code:'forbidden',uncertain:false});await click('Ověřit stejné uložení');expect(mocks.run.mock.calls[1][0]).toEqual(original);expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual(original);expect(button('Nový výkaz').disabled).toBe(true)})
 it('blocks direct duplicate submit while a request is unresolved',async()=>{let finish!:(value:ReturnType<typeof success>)=>void;mocks.run.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));await mount();await newDraft();await save();await save();expect(mocks.run).toHaveBeenCalledOnce();await act(async()=>finish(success(mocks.run.mock.calls[0][0])))})
 it('does not dispatch when operation storage fails',async()=>{await mount();await newDraft();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('denied')});await save();expect(mocks.run).not.toHaveBeenCalled();expect(container.textContent).toContain('Úložiště této karty')})
 it('cannot submit saved hours while an edited draft is unsaved',async()=>{await mount({...workspace,items:[item()]});await act(async()=>{[...container.querySelectorAll('aside li button')][0].dispatchEvent(new MouseEvent('click',{bubbles:true}))});expect(button('Odeslat ke schválení').disabled).toBe(false);await input('[name="payHours-0"]','7');expect(button('Odeslat ke schválení').disabled).toBe(true);await click('Odeslat ke schválení');expect(mocks.run).not.toHaveBeenCalled()})
 it('requires a current preview before a manager approves and never shows costs to the manager',async()=>{const data=item('submitted');await mount({...workspace,role:'manager',items:[data]});await act(async()=>{[...container.querySelectorAll('aside li button')][0].dispatchEvent(new MouseEvent('click',{bubbles:true}))});expect(button('Schválit výkaz').disabled).toBe(true);mocks.preview.mockResolvedValueOnce({ok:true,data:{companyId,submissionId:sid,versionId:vid,previewHash:'a'.repeat(64),completeness:'complete',reasons:[],cost:{currency:'CZK',amount:'1600.00',lines:[]}}});await click('Ověřit před schválením');expect(container.textContent).not.toContain('1600');await click('Schválit výkaz');expect(mocks.run.mock.calls[0][0]).toMatchObject({kind:'review',input:{decision:'approve',expectedCostPreviewHash:'a'.repeat(64),expectedRevision:'2'}})})
 it('reloads an approval preview after a known conflict without changing the submission revision',async()=>{
  const scoped:LaborWorkspace={...workspace,role:'manager',items:[item('submitted')]}
  await mount(scoped)
  await act(async()=>{(container.querySelector('aside li button') as HTMLButtonElement).click()})
  const preview=(hash:string)=>({ok:true,data:{companyId,submissionId:sid,versionId:vid,previewHash:hash.repeat(64),completeness:'complete',reasons:[]}})
  mocks.preview.mockResolvedValueOnce(preview('a')).mockResolvedValueOnce(preview('b'))
  await click('Ověřit před schválením')
  // A rate change rejects approval but does not increment the timesheet revision.
  mocks.run.mockResolvedValueOnce({ok:false,code:'conflict',uncertain:false})
  await click('Schválit výkaz')
  const rejected=mocks.run.mock.calls[0][0]
  expect(sessionStorage.getItem(storageKey)).toBeNull()
  expect(button('Schválit výkaz').disabled).toBe(true)
  expect(container.textContent).not.toContain('Podklady a ocenění jsou připravené ke schválení.')
  await click('Načíst aktuální stav')
  await mount(structuredClone(scoped))
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(button('Ověřit před schválením').disabled).toBe(false)
  expect(button('Nový výkaz').disabled).toBe(false)
  await click('Schválit výkaz')
  expect(mocks.run).toHaveBeenCalledOnce()
  await click('Ověřit před schválením')
  expect(button('Schválit výkaz').disabled).toBe(false)
  await click('Schválit výkaz')
  const retried=mocks.run.mock.calls[1][0]
  expect(retried.input).toMatchObject({expectedRevision:'2',expectedCostPreviewHash:'b'.repeat(64)})
  expect(retried.input.operationId).not.toBe(rejected.input.operationId)
  expect(mocks.preview).toHaveBeenCalledTimes(2)
 })
 it('retains an unknown approval when a retry reports conflict instead of starting a fresh approval',async()=>{
  await mount({...workspace,role:'manager',items:[item('submitted')]})
  await act(async()=>{(container.querySelector('aside li button') as HTMLButtonElement).click()})
  mocks.preview.mockResolvedValueOnce({ok:true,data:{companyId,submissionId:sid,versionId:vid,previewHash:'a'.repeat(64),completeness:'complete',reasons:[]}})
  await click('Ověřit před schválením')
  mocks.run.mockRejectedValueOnce(Error('response lost after commit'))
  await click('Schválit výkaz')
  const original=mocks.run.mock.calls[0][0]
  mocks.run.mockResolvedValueOnce({ok:false,code:'conflict',uncertain:false})
  await click('Ověřit stejné uložení')
  expect(mocks.run.mock.calls[1][0]).toEqual(original)
  await click('Načíst aktuální stav')
  await mount({...workspace,role:'manager',items:[item('submitted')]})
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual(original)
  expect(button('Ověřit před schválením').disabled).toBe(true)
  expect(button('Schválit výkaz').disabled).toBe(true)
  expect(button('Nový výkaz').disabled).toBe(true)
 })
 it('recovers a source-changed submission after an explicit fresh read without replacing its draft or CAS',async()=>{
  const scoped:LaborWorkspace={...workspace,items:[item()]}
  await mount(scoped)
  await act(async()=>{(container.querySelector('aside li button') as HTMLButtonElement).click()})
  // Editing the original shift causes LABOR_SOURCE_CHANGED without advancing this revision.
  mocks.run.mockResolvedValueOnce({ok:false,code:'conflict',uncertain:false})
  await click('Odeslat ke schválení')
  const rejected=mocks.run.mock.calls[0][0]
  expect(sessionStorage.getItem(storageKey)).toBeNull()
  const current:LaborWorkspace={...structuredClone(scoped),sources:scoped.sources.map(source=>({...source,actualHours:'9.0000'}))}
  await mount(current)
  expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
  await click('Načíst aktuální stav');await mount(current)
  expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
  expect(mocks.run).toHaveBeenCalledOnce()
  await mount(structuredClone(current))
  expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false)
  expect(button('Nový výkaz').disabled).toBe(false)
  expect((container.querySelector('[name="actualHours-0"]') as HTMLInputElement).value).toBe('8.0000')
  expect((container.querySelector('[name="payHours-0"]') as HTMLInputElement).value).toBe('7.5000')
  expect(button('Odeslat ke schválení').disabled).toBe(true)
  expect(mocks.run).toHaveBeenCalledOnce()
  await input('[name="actualHours-0"]','9')
  await save()
  const saved=mocks.run.mock.calls[1][0]
  expect(saved).toMatchObject({kind:'draft',input:{submissionId:sid,expectedRevision:'1',lines:[{actualHours:'9.0000',payHours:'7.5000',billedHours:'6.0000'}]}})
  expect(saved.input.operationId).not.toBe(rejected.input.operationId)
  expect(mocks.run).toHaveBeenCalledTimes(2)
 })
 it('rejects late success after switching to another scoped workspace',async()=>{let finish!:(value:ReturnType<typeof success>)=>void;mocks.run.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));await mount();await newDraft();await save();const original=mocks.run.mock.calls[0][0];await mount({...workspace,companyId:jobId},'other');await act(async()=>finish(success(original)));expect(mocks.refresh).not.toHaveBeenCalled();expect(sessionStorage.getItem(storageKey)).not.toBeNull()})
 it('does not replay a stored command from another actor',async()=>{sessionStorage.setItem(storageKey,JSON.stringify({kind:'submit',input:{companyId,actorProfileId:jobId,operationId:sourceId,submissionId:sid,versionId:vid,expectedRevision:'1'}}));await mount();expect(container.textContent).toContain('Uložený požadavek nelze ověřit');expect(mocks.run).not.toHaveBeenCalled();expect(button('Nový výkaz').disabled).toBe(true)})
 it('can submit immediately after a confirmed draft on the same URL',async()=>{await mount();await newDraft();await save();expect(button('Odeslat ke schválení').disabled).toBe(false);await click('Odeslat ke schválení');expect(mocks.run).toHaveBeenCalledTimes(2);expect(mocks.run.mock.calls[1][0]).toMatchObject({kind:'submit',input:{submissionId:sid,expectedRevision:'1'}});expect(mocks.run.mock.calls[1][0].input.operationId).not.toBe(mocks.run.mock.calls[0][0].input.operationId)})
 it('blocks approval when a documented rate is missing',async()=>{await mount({...workspace,role:'manager',items:[item('submitted')]});await act(async()=>{[...container.querySelectorAll('aside li button')][0].dispatchEvent(new MouseEvent('click',{bubbles:true}))});mocks.preview.mockResolvedValueOnce({ok:true,data:{companyId,submissionId:sid,versionId:vid,previewHash:'b'.repeat(64),completeness:'incomplete',reasons:['missing_rate']}});await click('Ověřit před schválením');expect(button('Schválit výkaz').disabled).toBe(true);expect(container.textContent).toContain('Chybí doložená sazba.');await click('Schválit výkaz');expect(mocks.run).not.toHaveBeenCalled()})
 it('requires an explicit comparison when a stored draft belongs to an older revision',async()=>{sessionStorage.setItem(`diriqo:labor-draft:v1:${companyId}:${actorProfileId}:${sid}`,JSON.stringify({revision:'0',fields:{sources:[`shift:${sourceId}`],reason:'',lines:[{...line,payHours:'5'}]}}));await mount({...workspace,items:[item()]});await act(async()=>{[...container.querySelectorAll('aside li button')][0].dispatchEvent(new MouseEvent('click',{bubbles:true}))});expect(container.textContent).toContain('Rozepsaný návrh pochází ze starší verze');expect(button('Uložit koncept').disabled).toBe(true);expect((container.querySelector('[name="payHours-0"]') as HTMLInputElement).value).toBe('5');expect(button('Odeslat ke schválení').disabled).toBe(true)})
})
