import { createElement, isValidElement, type ReactNode, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { csDictionary } from '../lib/i18n/dictionaries/cs'
const mocks = vi.hoisted(() => ({ context: vi.fn(), sources: vi.fn(), get: vi.fn(), redirect: vi.fn() }))
vi.mock('@/lib/dal/auth', () => ({ requireCompanyRoleDalContext: mocks.context }))
vi.mock('@/lib/dal/labor-history', () => ({ listLaborSourceOptions: mocks.sources, getLaborSubmission: mocks.get }))
vi.mock('@/lib/i18n/server', () => ({ getRequestDictionary: async () => csDictionary }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/components/DashboardShell', () => ({ default: ({ children }: { children: ReactNode }) => createElement('div', null, children) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children) }))
import Page from '../app/work-shifts/[shiftId]/edit/page'
const companyId='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444',worker='55555555-5555-4555-8555-555555555555',submission='66666666-6666-4666-8666-666666666666'
const shift={id,profile_id:worker,company_id:companyId,job_id:job,job_hours_override:8,shift_date:'2026-10-24',started_at:null,ended_at:null,hours_override:8,note:null,profiles:{id:worker,full_name:'Worker',email:null}}
type Call={table:string;filters:unknown[][];mutated:boolean;payload?:unknown}
let calls:Call[], updateResult: {data:unknown;error:unknown}, shiftResult: {data:unknown;error:unknown}
function from(table:string) {
 const call:Call={table,filters:[],mutated:false};calls.push(call)
 const chain={select:vi.fn(()=>chain),eq:vi.fn((...args:unknown[])=>{call.filters.push(args);return chain}),or:vi.fn(()=>chain),order:vi.fn(async()=>({data:[],error:null})),update:vi.fn((payload:unknown)=>{call.mutated=true;call.payload=payload;return chain}),maybeSingle:vi.fn(async()=>call.mutated?updateResult:table==='work_shifts'?shiftResult:{data:{id:job},error:null})}
 return chain
}
function findForm(node:ReactNode):ReactElement<{action:(form:FormData)=>Promise<void>}>|null {
 if(Array.isArray(node)){for(const child of node){const found=findForm(child);if(found)return found}return null}
 if(!isValidElement<{children?:ReactNode}>(node))return null
 return node.type==='form'?node as ReactElement<{action:(form:FormData)=>Promise<void>}>:findForm(node.props.children)
}
const page=()=>Page({params:Promise.resolve({shiftId:id}),searchParams:Promise.resolve({})})
function form(){const data=new FormData();data.set('shiftId',id);data.set('profileId','tampered');data.set('hours_override','7');return data}
beforeEach(()=>{vi.resetAllMocks();calls=[];updateResult={data:{id},error:null};shiftResult={data:shift,error:null};mocks.context.mockResolvedValue({companyId,profileId:actor,role:'company_admin',supabase:{from}});mocks.sources.mockResolvedValue({items:[]});mocks.get.mockResolvedValue({approvedVersionId:submission});mocks.redirect.mockImplementation((url:string)=>{throw new Error(`redirect:${url}`)})})
describe('Legacy shift editor approval and tenant boundary',()=>{
 it('scopes the initial read and skips cross-membership company inference',async()=>{await page();expect(calls[0].filters).toContainEqual(['company_id',companyId]);expect(calls.some(call=>call.table==='company_members')).toBe(false)})
 it('rejects render after lost admin permission before source queries',async()=>{mocks.context.mockRejectedValue(Error('denied'));await expect(page()).rejects.toThrow('redirect:/mobile/my');expect(calls).toHaveLength(0)})
 it('locks an approved source and opens its authorized alias-aware review link',async()=>{mocks.sources.mockResolvedValue({items:[{kind:'shift',id,profileId:worker,jobId:job,submissionId:submission}]});const node=await page();const html=renderToStaticMarkup(node);expect(html).toContain('fieldset disabled');expect(html).toContain('sourceKind=shift');expect(html).toContain(`actor=${actor}`);expect(html).toContain(csDictionary.workShiftEdit.openReview);await expect(findForm(node)!.props.action(form())).rejects.toThrow('error=approved-source');expect(calls.some(call=>call.mutated)).toBe(false)})
 it('fails closed while approval lookup is unavailable',async()=>{mocks.sources.mockRejectedValue(Error('timeout'));const node=await page();expect(renderToStaticMarkup(node)).toContain(csDictionary.workShiftEdit.reviewUnavailable);await expect(findForm(node)!.props.action(form())).rejects.toThrow('error=update-failed');expect(calls.some(call=>call.mutated)).toBe(false)})
 it.each(['companyId','profileId'] as const)('rejects a changed %s between rendering and saving',async key=>{const node=await page();mocks.context.mockResolvedValue({companyId,profileId:actor,role:'company_admin',supabase:{from},[key]:submission});await expect(findForm(node)!.props.action(form())).rejects.toThrow('error=scope-changed');expect(calls.some(call=>call.mutated)).toBe(false)})
 it('rejects a tampered shift identifier',async()=>{const node=await page();const data=form();data.set('shiftId',submission);await expect(findForm(node)!.props.action(data)).rejects.toThrow('missing-id');expect(calls.some(call=>call.mutated)).toBe(false)})
 it('maps approval occurring after render to a protected source, not success',async()=>{const node=await page();updateResult={data:null,error:{code:'23514',message:'LABOR_APPROVED_SOURCE_IMMUTABLE'}};await expect(findForm(node)!.props.action(form())).rejects.toThrow('error=approved-source');expect(calls.find(call=>call.mutated)?.filters).toEqual([['id',id],['company_id',companyId]])})
 it('never claims success for an RLS-filtered zero-row update',async()=>{const node=await page();updateResult={data:null,error:null};await expect(findForm(node)!.props.action(form())).rejects.toThrow('error=update-failed')})
 it('uses the server worker for successful return navigation',async()=>{const node=await page();await expect(findForm(node)!.props.action(form())).rejects.toThrow(`redirect:/workers/${worker}`)})
 it('rejects invalid timestamps before mutation',async()=>{const node=await page();const data=form();data.set('started_at','not-a-date');await expect(findForm(node)!.props.action(data)).rejects.toThrow('error=invalid-date');expect(calls.some(call=>call.mutated)).toBe(false)})
})


describe('Shift input constraints',()=>{
 it.each(['-1','NaN','Infinity'])('rejects manual hours %s with a specific message before any mutation',async value=>{
  const node=await page(),data=form();data.set('hours_override',value)
  await expect(findForm(node)!.props.action(data)).rejects.toThrow('error=invalid-hours')
  expect(calls.some(call=>call.mutated)).toBe(false)
  const errorPage=await Page({params:Promise.resolve({shiftId:id}),searchParams:Promise.resolve({error:'invalid-hours'})})
  expect(renderToStaticMarkup(errorPage)).toContain(csDictionary.workShiftEdit.invalidHours)
 })
 it('preserves explicitly entered zero as zero',async()=>{
  const node=await page(),data=form();data.set('hours_override','0')
  await expect(findForm(node)!.props.action(data)).rejects.toThrow(`redirect:/workers/${worker}`)
  expect(calls.find(call=>call.mutated)?.payload).toMatchObject({hours_override:0})
 })
 it('rejects an end before the start with a specific localized message',async()=>{
  const node=await page(),data=form();data.set('started_at','2026-10-24T10:00:00Z');data.set('ended_at','2026-10-24T09:00:00Z')
  await expect(findForm(node)!.props.action(data)).rejects.toThrow('error=invalid-time-order')
  expect(calls.some(call=>call.mutated)).toBe(false)
  const errorPage=await Page({params:Promise.resolve({shiftId:id}),searchParams:Promise.resolve({error:'invalid-time-order'})})
  expect(renderToStaticMarkup(errorPage)).toContain(csDictionary.workShiftEdit.invalidTimeOrder)
 })
 it('allows a shift finishing the following day',async()=>{
  const node=await page(),data=form();data.set('started_at','2026-10-24T22:00:00Z');data.set('ended_at','2026-10-25T06:00:00Z')
  await expect(findForm(node)!.props.action(data)).rejects.toThrow(`redirect:/workers/${worker}`)
  expect(calls.find(call=>call.mutated)?.payload).toMatchObject({started_at:'2026-10-24T22:00:00.000Z',ended_at:'2026-10-25T06:00:00.000Z'})
 })
})
