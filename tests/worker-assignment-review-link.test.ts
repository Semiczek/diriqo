// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { csDictionary } from '../lib/i18n/dictionaries/cs'
import { enDictionary } from '../lib/i18n/dictionaries/en'
import { deDictionary } from '../lib/i18n/dictionaries/de'
import { laborSourceReviewHref, safeLaborSourceReviewHref } from '../lib/labor-source-navigation'
const mocks=vi.hoisted(()=>({save:vi.fn(),fetch:vi.fn(),locale:'cs' as 'cs'|'en'|'de'}))
vi.mock('@/app/business-actions',()=>({updateJobAssignmentEconomicsAction:mocks.save}))
vi.mock('@/components/I18nProvider',()=>({useI18n:()=>({locale:mocks.locale,dictionary:{cs:csDictionary,en:enDictionary,de:deDictionary}[mocks.locale]})}))
vi.mock('next/link',()=>({default:({children,href,...props}:{children:ReactNode;href:string})=>createElement('a',{href,...props},children)}))
import WorkerAssignmentsSection from '../app/workers/[workerId]/WorkerAssignmentsSection'
import type { JobAssignmentRow } from '../app/workers/[workerId]/worker-detail-helpers'
const companyId='11111111-1111-4111-8111-111111111111',actorProfileId='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444',workerProfileId='55555555-5555-4555-8555-555555555555',other='66666666-6666-4666-8666-666666666666'
const scope={companyId,actorProfileId,workerProfileId}
const item={id,job_id:jobId,profile_id:workerProfileId,labor_hours:8,hourly_rate:200,jobs:{id:jobId,title:'Test job',address:null,status:'done',is_paid:false}} as JobAssignmentRow
const href=laborSourceReviewHref({companyId,actorProfileId,jobId,profileId:workerProfileId,source:{kind:'assignment',id}})
const errorBody=(reviewHref=href)=>({error:'Raw server fallback',code:'LABOR_APPROVED_SOURCE_IMMUTABLE',reviewHref})
function response(body:unknown,status=409){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})}
let root:Root,container:HTMLDivElement
const dict=()=>({cs:csDictionary,en:enDictionary,de:deDictionary}[mocks.locale])
function button(text:string){const found=[...container.querySelectorAll('button')].find(el=>el.textContent===text);expect(found).toBeDefined();return found!}
async function click(text:string){await act(async()=>button(text).click())}
async function mount(reviewScope=scope){await act(async()=>root.render(createElement(WorkerAssignmentsSection,{reviewScope,jobAssignments:[item],defaultRate:200,workPeriodLabel:'2026-10'})))}
async function input(selector:string,value:string){await act(async()=>{const el=container.querySelector(selector) as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))})}
beforeEach(()=>{vi.resetAllMocks();mocks.locale='cs';mocks.fetch.mockResolvedValue(response(errorBody()));vi.stubGlobal('fetch',mocks.fetch);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.spyOn(window,'confirm').mockReturnValue(true);container=document.createElement('div');document.body.append(container);root=createRoot(container)})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
describe('Worker detail reset/archive protected review flow',()=>{
 it('accepts the exact canonical local source link',()=>{expect(safeLaborSourceReviewHref(href,{companyId,actorProfileId,jobId,profileId:workerProfileId,source:{kind:'assignment',id}})).toBe(href)})
 it.each(['reset_hours','archive'] as const)('shows the verified source link for %s without applying the rejected change',async action=>{
  await mount();await click(action==='reset_hours'?dict().jobs.detail.resetAssignmentHours:dict().jobs.detail.removeWorker)
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({action,companyId,actorProfileId})
  expect(mocks.fetch.mock.calls[0][0]).toBe(`/api/job-assignments/${id}`)
  expect([...container.querySelectorAll('a')].map(el=>({href:el.getAttribute('href'),text:el.textContent}))).toContainEqual({href,text:dict().jobs.detail.openAssignmentReview})
  expect(container.textContent).toContain(dict().jobs.detail.approvedAssignmentSource)
  expect(container.textContent).not.toContain('Raw server fallback')
  expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
  expect(container.querySelectorAll('tbody td')[4].textContent).toBe('8 h')
  expect(mocks.save).not.toHaveBeenCalled()
 })
 it('preserves a draft opened while reset is awaiting its response',async()=>{
  let complete!:(value:Response)=>void;mocks.fetch.mockReturnValueOnce(new Promise(resolve=>{complete=resolve}))
  await mount();await click(dict().jobs.detail.resetAssignmentHours);await click(dict().jobs.detail.edit)
  await input('input[type="number"]','7')
  await act(async()=>complete(response(errorBody())))
  expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('7')
  expect([...container.querySelectorAll('a')].find(el=>el.getAttribute('href')===href)).toBeDefined()
  expect(mocks.save).not.toHaveBeenCalled()
 })
 it.each(['company','actor','worker','job','source'] as const)('rejects a review link for another %s',async key=>{
  const url=new URL(href,'https://diriqo.invalid');url.searchParams.set(key,other)
  mocks.fetch.mockResolvedValueOnce(response(errorBody(url.pathname+url.search)))
  await mount();await click(dict().jobs.detail.resetAssignmentHours)
  expect(container.querySelector('a[href^="/labor"]')).toBeNull()
  expect(container.textContent).toContain(dict().jobs.detail.approvedAssignmentSource)
 })
 it.each([
  `https://attacker.invalid${href}`,`//attacker.invalid${href}`,`/other${href.slice(6)}`,`${href}#anything`,`${href}&actor=${actorProfileId}`,`${href}&extra=value`,href.replace('sourceKind=assignment','sourceKind=shift'),
 ])('rejects a malformed or untrusted destination %s',async unsafe=>{
  mocks.fetch.mockResolvedValueOnce(response(errorBody(unsafe)))
  await mount();await click(dict().jobs.detail.removeWorker)
  expect(container.querySelector('a[href^="/labor"]')).toBeNull()
  expect(container.textContent).toContain(dict().jobs.detail.approvedAssignmentSource)
 })
 it('does not trust a protected code on a non-conflict response',async()=>{
  mocks.fetch.mockResolvedValueOnce(response(errorBody(),500));await mount();await click(dict().jobs.detail.resetAssignmentHours)
  expect(container.querySelector('a[href^="/labor"]')).toBeNull()
  expect(container.textContent).toContain('Raw server fallback')
 })
 it('keeps ordinary errors visible without fabricating a review link or removing the row',async()=>{
  mocks.fetch.mockResolvedValueOnce(response({error:'Unable to save'},500));await mount();await click(dict().jobs.detail.removeWorker)
  expect(container.textContent).toContain('Unable to save');expect(container.querySelector('a[href^="/labor"]')).toBeNull();expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
 })
 it('recovers its controls after a network failure',async()=>{
  mocks.fetch.mockRejectedValueOnce(Error('offline'));await mount();await click(dict().jobs.detail.removeWorker)
  expect(container.textContent).toContain(dict().jobs.detail.saveFailed)
  expect(button(dict().jobs.detail.removeWorker).disabled).toBe(false)
 })
 it.each(['cs','en','de'] as const)('renders the protected explanation and link in %s',async locale=>{
  mocks.locale=locale;await mount();await click(dict().jobs.detail.resetAssignmentHours)
  expect(container.textContent).toContain(dict().jobs.detail.approvedAssignmentSource)
  expect([...container.querySelectorAll('a')].find(el=>el.getAttribute('href')===href)?.textContent).toBe(dict().jobs.detail.openAssignmentReview)
 })
 it('cannot apply an old response to a newly rendered company/account scope',async()=>{
  let complete!:(value:Response)=>void;mocks.fetch.mockReturnValueOnce(new Promise(resolve=>{complete=resolve}))
  await mount();await click(dict().jobs.detail.resetAssignmentHours)
  await mount({...scope,actorProfileId:other})
  await act(async()=>complete(response(errorBody())))
  expect(container.querySelector('a[href^="/labor"]')).toBeNull()
  expect(container.textContent).not.toContain(dict().jobs.detail.approvedAssignmentSource)
 })
 it('does not send a request for a row belonging to another worker',async()=>{
  await mount({...scope,workerProfileId:other});await click(dict().jobs.detail.resetAssignmentHours)
  expect(mocks.fetch).not.toHaveBeenCalled()
 })
})


describe('Worker detail Save protected review flow',()=>{
 it('pins the save to server-provided company/account/row and preserves edited hours after protected rejection',async()=>{
  mocks.save.mockResolvedValue({ok:false,...errorBody()});await mount();await click(dict().jobs.detail.edit);await input('input[type="number"]','7');await click(dict().common.save)
  expect(mocks.save).toHaveBeenCalledWith({companyId,actorProfileId,assignmentId:id,jobId,profileId:workerProfileId,laborHours:7,hourlyRate:200})
  expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('7')
  expect([...container.querySelectorAll('a')].find(el=>el.getAttribute('href')===href)?.textContent).toBe(dict().jobs.detail.openAssignmentReview)
  expect(container.textContent).toContain(dict().jobs.detail.approvedAssignmentSource)
 })
 it('rejects a foreign review link returned by Save and keeps the draft',async()=>{
  const unsafe=href.replace(`actor=${actorProfileId}`,`actor=${other}`)
  mocks.save.mockResolvedValue({ok:false,...errorBody(unsafe)});await mount();await click(dict().jobs.detail.edit);await input('input[type="number"]','7');await click(dict().common.save)
  expect(container.querySelector('a[href^="/labor"]')).toBeNull();expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('7')
 })
 it('keeps an ordinary Save error and its draft without a review link',async()=>{
  mocks.save.mockResolvedValue({ok:false,error:'Ordinary failure'});await mount();await click(dict().jobs.detail.edit);await input('input[type="number"]','7');await click(dict().common.save)
  expect(container.textContent).toContain('Ordinary failure');expect(container.querySelector('a[href^="/labor"]')).toBeNull();expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('7')
 })
 it('unlocks Save after a rejected network request while retaining the draft',async()=>{
  mocks.save.mockRejectedValue(Error('offline'));await mount();await click(dict().jobs.detail.edit);await input('input[type="number"]','7');await click(dict().common.save)
  expect(button(dict().common.save).disabled).toBe(false);expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('7')
 })
})
