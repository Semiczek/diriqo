import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import React from 'react'
import { parsePublicOfferResponseContact } from '../lib/public-offer-security'
import { coreQuotePresentation } from '../lib/core-quote-presentation'
import { offerResponseKey, restoreOfferResponse, saveOfferResponse, type PendingOfferResponse } from '../components/public-offer/response-state'
const hooks = vi.hoisted(() => {
  let slots: unknown[] = [], cursor = 0
  return {
    reset() { slots = []; cursor = 0 },
    render<T>(component: () => T) { cursor = 0; return component() },
    useState(initial: unknown) { const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?(initial as ()=>unknown)():initial;return[slots[index],(value:unknown)=>{slots[index]=typeof value==='function'?(value as (old:unknown)=>unknown)(slots[index]):value}] },
    useRef(initial: unknown) { const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index] },
    useMemo: (read:()=>unknown)=>read(),useCallback:<T>(callback:T)=>callback,useEffect:()=>{},
    useSyncExternalStore: (_subscribe:unknown,snapshot:()=>unknown)=>snapshot(),
  }
})
vi.mock('react',async original=>({...await original<typeof import('react')>(),...hooks}))
vi.mock('@/components/public-offer/utils',async original=>({...await original<typeof import('../components/public-offer/utils')>(),postOfferEvent:vi.fn().mockResolvedValue(undefined)}))
const mocks = vi.hoisted(() => ({ publicRpc: vi.fn(), userRpc: vi.fn(), portalUser: vi.fn(), admin: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase-public', () => ({ createSupabasePublicClient: () => ({ rpc: mocks.publicRpc }) }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.userRpc }) }))
vi.mock('@/lib/customer-portal/auth', () => ({ getPortalUserContext: mocks.portalUser }))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))
import PublicOfferPage from '../components/PublicOfferPage'
import OfferNextStepsSection from '../components/public-offer/OfferNextStepsSection'
import OfferCtaModal from '../components/public-offer/OfferCtaModal'
import type { PublicOfferPageProps } from '../components/public-offer/types'
import { POST as publicRespond } from '../app/api/offers/respond/route'
import { POST as portalRespond } from '../app/api/portal/offers/respond/route'
import { GET as portalPdf } from '../app/api/portal/offers/[offerId]/pdf/route'
import { getPublicCoreQuote, getPortalCoreQuote, listPortalCoreQuotes, parsePortalQuoteSelector } from '../lib/dal/core-quote-customer-read'
import { quoteDocumentFixture, QUOTE_FIXTURE_ID, VERSION_FIXTURE_ID } from './fixtures/core-quote-document'
const OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ACTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const payload: PendingOfferResponse = { token: 'a'.repeat(64), context: 'public', actorId: null,
  versionId: VERSION_FIXTURE_ID, operationId: OP, actionType: 'interested', customerName: 'Synthetic',
  customerEmail: 'synthetic@example.invalid', customerPhone: '+420123456789', note: 'Prosím zavolat.',
  visitorId: 'v'.repeat(32), website: '', openedAt: 123,
}
const request = (body: unknown, url = 'https://example.invalid/api/offers/respond') => new NextRequest(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
beforeEach(() => {
  vi.resetAllMocks(); hooks.reset(); vi.stubGlobal('React',React)
  mocks.publicRpc.mockResolvedValue({ data: { success: true, quoteId: QUOTE_FIXTURE_ID, versionId: VERSION_FIXTURE_ID, operationId: OP, responseId: ACTOR }, error: null })
  mocks.userRpc.mockResolvedValue({ data: { success: true, quoteId: QUOTE_FIXTURE_ID, versionId: VERSION_FIXTURE_ID, operationId: OP, responseId: ACTOR }, error: null })
  mocks.portalUser.mockResolvedValue({ portalUserId: ACTOR, authUserId: ACTOR, customerId: ACTOR, companyId: QUOTE_FIXTURE_ID, email: 'verified@example.invalid' })
})
afterEach(()=>{hooks.reset();vi.unstubAllGlobals()})

describe('durable customer response', () => {
  it('keeps exactly the original operation, content and version through storage reload', () => {
    const values = new Map<string, string>()
    const storage = { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) || null }
    saveOfferResponse(storage, payload)
    expect(restoreOfferResponse(storage.getItem(offerResponseKey('public', payload.token, payload.versionId)), 'public', payload.token, payload.versionId)).toEqual(payload)
  })
  it('separates both version and portal actor boundaries', () => {
    expect(() => restoreOfferResponse(JSON.stringify(payload), 'public', payload.token, ACTOR)).toThrow()
    const portal = { ...payload, context: 'portal', actorId: ACTOR }
    expect(restoreOfferResponse(JSON.stringify(portal), 'portal', payload.token, payload.versionId, ACTOR)?.operationId).toBe(OP)
    expect(() => restoreOfferResponse(JSON.stringify(portal), 'portal', payload.token, payload.versionId, OP)).toThrow()
    expect(offerResponseKey('portal', payload.token, payload.versionId, OP)).not.toBe(offerResponseKey('portal', payload.token, payload.versionId, ACTOR))
  })
  it('fails before dispatch when storage fails to retain the operation', () => {
    expect(() => saveOfferResponse({ setItem() {}, getItem: () => null }, payload)).toThrow()
  })
  it('public reaction calls one version-bound RPC and never marks acceptance', async () => {
    const response = await publicRespond(request(payload))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, operationId: OP, versionId: VERSION_FIXTURE_ID })
    expect(mocks.publicRpc).toHaveBeenCalledExactlyOnceWith('respond_public_core_quote_version', expect.objectContaining({ input_token: payload.token, p_operation_id: OP,
      p_input: expect.objectContaining({ version_id: VERSION_FIXTURE_ID, action_type: 'interested' }) }))
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it.each(['versionId','operationId'] as const)('rejects a missing %s before RPC', async key => {
    expect((await publicRespond(request({ ...payload, [key]: undefined }))).status).toBeGreaterThanOrEqual(400)
    expect(mocks.publicRpc).not.toHaveBeenCalled()
  })
  it('does not trust a mismatched success receipt', async () => {
    mocks.publicRpc.mockResolvedValue({ data: { success: true, versionId: ACTOR, operationId: OP }, error: null })
    expect((await publicRespond(request(payload))).status).toBeGreaterThanOrEqual(400)
  })
  it('does not expose database error details for revoked or foreign tokens', async () => {
    mocks.publicRpc.mockResolvedValue({ data: null, error: { message: 'SECRET_DATABASE_DETAILS' } })
    const result = await publicRespond(request(payload))
    expect(result.status).toBe(409)
    expect(JSON.stringify(await result.json())).not.toContain('SECRET_DATABASE_DETAILS')
  })
  it('portal response uses actual session client and verified customer scope', async () => {
    const response = await portalRespond(request({ actorId: ACTOR, offerId: QUOTE_FIXTURE_ID, versionId: VERSION_FIXTURE_ID, operationId: OP,
      actionType: 'revision_requested', note: 'Prosím upravit.', companyId: 'forged', customerId: 'forged' }))
    expect(response.status).toBe(200)
    expect(mocks.userRpc).toHaveBeenCalledExactlyOnceWith('respond_portal_core_quote_version', {
      p_company_id: QUOTE_FIXTURE_ID, p_customer_id: ACTOR, p_quote_id: QUOTE_FIXTURE_ID,
      p_version_id: VERSION_FIXTURE_ID, p_operation_id: OP, p_input: { action_type: 'revision_requested', note: 'Prosím upravit.' },
    })
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('portal does not respond after logout', async () => {
    mocks.portalUser.mockResolvedValue(null)
    expect((await portalRespond(request({ offerId: QUOTE_FIXTURE_ID, versionId: VERSION_FIXTURE_ID, operationId: OP, actionType: 'interested' }))).status).toBe(401)
    expect(mocks.userRpc).not.toHaveBeenCalled()
  })
  it('rejects a stale actor A request after login as actor B without any RPC',async()=>{
    mocks.portalUser.mockResolvedValue({portalUserId:OP,authUserId:OP,customerId:ACTOR,companyId:QUOTE_FIXTURE_ID,email:'other@example.invalid'});
    const response=await portalRespond(request({actorId:ACTOR,offerId:QUOTE_FIXTURE_ID,versionId:VERSION_FIXTURE_ID,operationId:OP,actionType:'interested',note:'Saved while A was signed in'}));
    expect(response.status).toBe(409);expect(mocks.userRpc).not.toHaveBeenCalled();expect(mocks.admin).not.toHaveBeenCalled();
  })
  it('rejects a missing expected portal actor before any RPC',async()=>{
    const response=await portalRespond(request({offerId:QUOTE_FIXTURE_ID,versionId:VERSION_FIXTURE_ID,operationId:OP,actionType:'interested'}));
    expect(response.status).toBe(409);expect(mocks.userRpc).not.toHaveBeenCalled();expect(mocks.admin).not.toHaveBeenCalled();
  })
  it('both customer read paths reject draft data even if returned by a malformed backend', async () => {
    const read = quoteDocumentFixture()
    read.kind = 'draft'; read.publishedAt = null
    read.document.version_id = null; read.document.version_number = null
    mocks.publicRpc.mockResolvedValue({ data: read, error: null }); mocks.userRpc.mockResolvedValue({ data: read, error: null })
    expect(await getPublicCoreQuote(payload.token)).toBeNull()
    expect(await getPortalCoreQuote(QUOTE_FIXTURE_ID, ACTOR, QUOTE_FIXTURE_ID, null)).toBeNull()
  })
})

function elements(value:unknown):React.ReactElement<Record<string,unknown>>[]{if(Array.isArray(value))return value.flatMap(elements);if(!React.isValidElement<Record<string,unknown>>(value))return [];return[value,...elements(value.props.children)]}
function one(tree:unknown,type:unknown){const element=elements(tree).find(node=>node.type===type);expect(element).toBeDefined();return element!}
function renderOffer(){return hooks.render(()=>{const wrapper=PublicOfferPage(coreQuotePresentation({...quoteDocumentFixture(),status:'published'},payload.token,'public',null));return(wrapper.type as (props:PublicOfferPageProps)=>React.ReactNode)(wrapper.props)})}
function submitModal(tree:unknown,fields:Record<string,string>){return(one(tree,OfferCtaModal).props.onSubmit as (event:unknown)=>Promise<void>)({preventDefault(){},currentTarget:fields})}
describe('customer contact validation before durable dispatch',()=>{
  it.each([{customerPhone:'123'},{customerEmail:'bad@'},{note:'x'.repeat(2001)},{customerName:'x'.repeat(121)},{customerPhone:'x'.repeat(41)}])('rejects invalid or overlong input %j without truncation',patch=>{
    expect(()=>parsePublicOfferResponseContact({...payload,...patch})).toThrow()
  })
  it('preserves all corrected fields while normalizing whitespace and email case',()=>{
    expect(parsePublicOfferResponseContact({...payload,customerName:'  Jane Original  ',customerEmail:'  JANE@EXAMPLE.INVALID ',customerPhone:' +420 123 456 789 ',note:'  Corrected scope\nSecond line  '})).toEqual({customerName:'Jane Original',customerEmail:'jane@example.invalid',customerPhone:'+420 123 456 789',note:'Corrected scope\nSecond line'})
  })
  it('keeps the actual modal open after invalid phone, then persists the corrected form before dispatch',async()=>{
    const values=new Map<string,string>(),fetch=vi.fn().mockRejectedValue(new Error('Lost response'));
    const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};
    vi.stubGlobal('sessionStorage',storage);vi.stubGlobal('window',{dispatchEvent:vi.fn()});vi.stubGlobal('fetch',fetch);
    vi.stubGlobal('FormData',class {constructor(private fields:Record<string,string>){}get(key:string){return this.fields[key]??null}});
    let tree=renderOffer();(one(tree,OfferNextStepsSection).props.onInterested as ()=>void)();tree=renderOffer();
    const fields={customerName:'Jane kept',customerEmail:'jane@example.invalid',customerPhone:'123',note:'My original question',website:''};
    await submitModal(tree,fields);expect(values.size).toBe(0);expect(fetch).not.toHaveBeenCalled();tree=renderOffer();expect(one(tree,OfferCtaModal).props.submitError).toContain('telefonní');
    fields.customerPhone='+420 111 222 333';fields.note='My corrected question';
    fetch.mockImplementation(async(_url:string,options:{body:string})=>{expect(values.size).toBe(1);expect(JSON.parse([...values.values()][0])).toMatchObject(JSON.parse(options.body));throw new Error('Lost response')});
    await submitModal(tree,fields);expect(fetch).toHaveBeenCalledOnce();expect(elements(renderOffer()).some(node=>node.type===OfferCtaModal)).toBe(false);
    const restored=restoreOfferResponse([...values.values()][0],'public',payload.token,VERSION_FIXTURE_ID);
    expect(restored).toMatchObject({customerName:'Jane kept',customerPhone:'+420 111 222 333',note:'My corrected question',versionId:VERSION_FIXTURE_ID});
  })
  it('actual public API applies the same phone validation before database dispatch',async()=>{
    const response=await publicRespond(request({...payload,customerPhone:'123'}));expect(response.status).toBe(400);expect(mocks.publicRpc).not.toHaveBeenCalled()
  })
})
describe('legacy presentation preserves unknown amounts',()=>{
  it('keeps legacy null header and item totals distinct from zero',()=>{
    const read=quoteDocumentFixture();read.kind='legacy';read.document.subtotal_price=null;read.document.total_price=null;read.document.discount_amount=null;read.document.items[0].total_price=null;
    const props=coreQuotePresentation(read,payload.token,'public',null);expect(props.subtotal).toBeNull();expect(props.priceTotal).toBeNull();expect(props.discount).toBeNull();expect(props.items[0].totalPrice).toBeNull();expect(props.items[0].unitPrice).toBe(0)
  })
  it('retains true zero header and item values as zero',()=>{
    const read=quoteDocumentFixture();read.document.subtotal_price='0.00';read.document.total_price='0.00';read.document.discount_amount='0.00';
    const props=coreQuotePresentation(read,payload.token,'public',null);expect(props.subtotal).toBe(0);expect(props.priceTotal).toBe(0);expect(props.discount).toBe(0);expect(props.items[0].totalPrice).toBe(0)
  })
})

function legacyRead() { const read=quoteDocumentFixture();read.kind='legacy';read.status='legacy';read.publishedAt=null;read.legacyCapturedAt='2026-10-21T10:00:00Z';read.document.version_id=null;read.document.version_number=null;return read }
const requestPortalPdf=(query:string)=>portalPdf(new NextRequest('https://example.invalid/api/portal/offers/'+QUOTE_FIXTURE_ID+'/pdf'+query),{params:Promise.resolve({offerId:QUOTE_FIXTURE_ID})})
describe('explicit portal legacy selection',()=>{
  it('uses a UUID only for a modern version and null only for explicit legacy',()=>{
    expect(parsePortalQuoteSelector({versionId:VERSION_FIXTURE_ID})).toBe(VERSION_FIXTURE_ID);expect(parsePortalQuoteSelector({legacy:'1'})).toBeNull()
  })
  it.each([{}, {versionId:''}, {legacy:''}, {legacy:'true'}, {versionId:VERSION_FIXTURE_ID,legacy:'1'}, {versionId:[VERSION_FIXTURE_ID,VERSION_FIXTURE_ID]}, {legacy:['1','1']}])('rejects missing or ambiguous selector %j',value=>{expect(()=>parsePortalQuoteSelector(value)).toThrow()})
  it('refuses a newest modern version returned for an explicit null selector',async()=>{
    mocks.userRpc.mockResolvedValue({data:quoteDocumentFixture(),error:null});expect(await getPortalCoreQuote(QUOTE_FIXTURE_ID,ACTOR,QUOTE_FIXTURE_ID,null)).toBeNull()
  })
  it('refuses a legacy document returned for a selected modern version',async()=>{
    mocks.userRpc.mockResolvedValue({data:legacyRead(),error:null});expect(await getPortalCoreQuote(QUOTE_FIXTURE_ID,ACTOR,QUOTE_FIXTURE_ID,VERSION_FIXTURE_ID)).toBeNull()
  })
  it('returns only the preserved legacy document for null and retains its capture time',async()=>{
    mocks.userRpc.mockResolvedValue({data:legacyRead(),error:null});const read=await getPortalCoreQuote(QUOTE_FIXTURE_ID,ACTOR,QUOTE_FIXTURE_ID,null);expect(read).toMatchObject({kind:'legacy',publishedAt:null,legacyCapturedAt:'2026-10-21T10:00:00.000Z',document:{version_id:null}});expect(mocks.userRpc).toHaveBeenCalledWith('get_portal_core_quote_version',expect.objectContaining({p_version_id:null}))
  })
  it('rejects a legacy response that invents a publication time',async()=>{
    mocks.userRpc.mockResolvedValue({data:{...legacyRead(),publishedAt:'2026-10-21T08:00:00Z'},error:null});expect(await getPortalCoreQuote(QUOTE_FIXTURE_ID,ACTOR,QUOTE_FIXTURE_ID,null)).toBeNull()
  })
  it('lists both issued and legacy records without turning legacy into latest',async()=>{
    mocks.userRpc.mockResolvedValue({data:[quoteDocumentFixture(),legacyRead()],error:null});const list=await listPortalCoreQuotes(QUOTE_FIXTURE_ID,ACTOR);expect(list.map(read=>[read.kind,read.document.version_id])).toEqual([['issued',VERSION_FIXTURE_ID],['legacy',null]])
  })
  it.each(['','?versionId=','?legacy=0','?legacy=1&versionId='+VERSION_FIXTURE_ID,'?legacy=1&legacy=1','?versionId='+VERSION_FIXTURE_ID+'&versionId='+VERSION_FIXTURE_ID])('PDF rejects invalid selection before database access: %s',async query=>{
    expect((await requestPortalPdf(query)).status).toBe(400);expect(mocks.userRpc).not.toHaveBeenCalled()
  })
  it('legacy PDF is downloadable and marked as historical, never as a newer version',async()=>{
    mocks.userRpc.mockResolvedValue({data:legacyRead(),error:null});const response=await requestPortalPdf('?legacy=1');expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe('application/pdf');expect(response.headers.get('cache-control')).toBe('private, no-store');expect(mocks.userRpc).toHaveBeenCalledWith('get_portal_core_quote_version',expect.objectContaining({p_version_id:null}));
    const bytes=Buffer.from(await response.arrayBuffer()).toString('latin1'),hex=(text:string)=>Array.from(text).map(char=>char.charCodeAt(0).toString(16).padStart(4,'0')).join('');expect(bytes).toContain(hex('Starší nabídka'));expect(bytes).not.toContain(hex('Verze 1'))
  })
  it('legacy PDF fails closed if the server returns current issued content',async()=>{
    mocks.userRpc.mockResolvedValue({data:quoteDocumentFixture(),error:null});expect((await requestPortalPdf('?legacy=1')).status).toBe(404)
  })
})
