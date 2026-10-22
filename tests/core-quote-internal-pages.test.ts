import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { CORE_QUOTE_CONTENT_KEYS, type CoreQuoteWorkspace } from '../lib/core-quote-lifecycle'
import { quoteDocumentFixture, QUOTE_FIXTURE_ID as quoteId, VERSION_FIXTURE_ID as versionId } from './fixtures/core-quote-document'
const mocks = vi.hoisted(() => ({ active: vi.fn(), server: vi.fn(), workspace: vi.fn(), version: vi.fn(), draft: vi.fn(), mail: vi.fn(), from: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/active-company', () => ({ getActiveCompanyContext: mocks.active }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.server }))
vi.mock('@/lib/dal/quotes', () => ({ getCoreQuoteWorkspace: mocks.workspace, getCoreQuoteVersion: mocks.version, getCoreQuoteDraftDocument: mocks.draft }))
vi.mock('@/lib/email/listEntityThreadMessages', () => ({ listEntityThreadMessages: mocks.mail }))
vi.mock('@/components/DashboardShell', () => ({ default: () => null }))
vi.mock('@/components/QuoteActionsPanel', () => ({ default: () => null }))
vi.mock('@/components/QuoteEditForm', () => ({ default: () => null }))
vi.mock('@/components/EntityCommunicationTimeline', () => ({ default: () => null }))
import QuoteActionsPanel from '../components/QuoteActionsPanel'
import QuoteEditForm from '../components/QuoteEditForm'
import Detail from '../app/customers/[customerId]/quotes/[quoteId]/page'
import Edit from '../app/customers/[customerId]/quotes/[quoteId]/edit/page'
const companyId='44444444-4444-4444-8444-444444444444',profileId='55555555-5555-4555-8555-555555555555',customerId='66666666-6666-4666-8666-666666666666'
let workspace:CoreQuoteWorkspace
function elements(value:unknown):React.ReactElement<Record<string,unknown>>[]{if(Array.isArray(value))return value.flatMap(elements);if(!React.isValidElement<Record<string,unknown>>(value))return [];return[value,...elements(value.props.children)]}
function text(value:unknown):string{if(typeof value==='string'||typeof value==='number')return String(value);if(Array.isArray(value))return value.map(text).join(' ');return React.isValidElement<{children?:unknown}>(value)?text(value.props.children):''}
const params=()=>Promise.resolve({customerId,quoteId})
const detail=(version?:string)=>Detail({params:params(),searchParams:Promise.resolve({version})})
beforeEach(()=>{
  vi.resetAllMocks();vi.stubGlobal('React',React)
  const read=quoteDocumentFixture(15)
  workspace={companyId,quoteId,customerId,sourceCalculationId:null,sourceCalculationRevision:null,currentCalculationRevision:null,revision:'5',draftOpen:false,archivedAt:null,currentVersionId:versionId,acceptedVersionId:versionId,customerIdentityState:'captured',customerSnapshot:{},draft:{title:'Current draft title',quote_date:'2026-10-21',valid_until:null,currency:'EUR',pricing_mode:'net',discount_amount:'0',customer_note:'Draft customer note',internal_note:'DO NOT SHOW INTERNAL',content:Object.fromEntries(Object.values(CORE_QUOTE_CONTENT_KEYS).map(key=>[key,key+' saved'])) as CoreQuoteWorkspace['draft']['content'],items:[{name:'Zero',description:'Desc',quantity:'1',unit:'ks',unit_price:'0',vat_rate:null,note:'Saved note'}]},versions:[{versionId,versionNumber:1,sourceRevision:'3',contentHash:'a'.repeat(64),publishedAt:read.publishedAt!,status:'accepted',acceptedAt:'2026-10-21T10:00:00Z',rejectedAt:null,shareToken:'a'.repeat(64),decision:{id:'77777777-7777-4777-8777-777777777777',decision:'accepted',evidence:'Phone approval, recorded by Jane',decidedAt:'2026-10-21T10:00:00Z',recordedAt:'2026-10-21T11:00:00Z',actorId:profileId,actorKind:'manual'}}],responses:[],legacy:null}
  mocks.active.mockResolvedValue({companyId,profileId,role:'company_admin'});mocks.server.mockResolvedValue({from:mocks.from});mocks.workspace.mockImplementation(async()=>workspace);mocks.version.mockResolvedValue({...read,status:'accepted'});mocks.draft.mockResolvedValue({...read,kind:'draft'});mocks.mail.mockResolvedValue({feedItems:[]});mocks.from.mockImplementation((table:string)=>{expect(['offer_responses','offer_events']).toContain(table);const chain={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockResolvedValue({data:[],error:null})};return chain})
})
afterEach(()=>vi.unstubAllGlobals())
describe('Internal version pages',()=>{
  it('reads exact issued version, all 15 customer rows and original identity with saved decision',async()=>{
    const tree=await detail(versionId),nodes=elements(tree),plain=text(tree)
    expect(mocks.version).toHaveBeenCalledWith(expect.objectContaining({companyId,profileId}),quoteId,versionId)
    expect(mocks.draft).not.toHaveBeenCalled();expect(nodes.filter(node=>node.type==='tr')).toHaveLength(16)
    expect(plain).toContain('Bezplatná položka');expect(plain).toContain('Položka 15');expect(plain).toContain('Původní zákazník s.r.o.');expect(plain).toContain('Phone approval, recorded by Jane');expect(plain).toContain(profileId)
    expect(plain).not.toContain('DO NOT SHOW INTERNAL');expect(plain).not.toContain('Current draft title')
    expect(nodes.find(node=>node.type===QuoteActionsPanel)?.props).toMatchObject({selectedVersionId:versionId,selectedKind:'issued'})
  })
  it('requires draft document at the loaded revision, without substituting issued data',async()=>{
    workspace.draftOpen=true;const tree=await detail('draft')
    expect(mocks.draft).toHaveBeenCalledWith(expect.objectContaining({companyId}),quoteId,'5');expect(mocks.version).not.toHaveBeenCalled();expect(elements(tree).find(node=>node.type===QuoteActionsPanel)?.props).toMatchObject({selectedVersionId:null,selectedKind:'draft'});expect(text(tree)).toContain('DO NOT SHOW INTERNAL')
  })
  it('keeps selected legacy document distinct while a draft exists',async()=>{
    workspace.draftOpen=true;workspace.legacy={capturedAt:'2026-10-21T09:00:00Z',revokedAt:null,document:{...quoteDocumentFixture().document,title:'Preserved legacy title',customer_identity_state:'legacy_unknown',customer:{name:null}}}
    const tree=await detail('legacy');expect(mocks.draft).not.toHaveBeenCalled();expect(mocks.version).not.toHaveBeenCalled();expect(text(tree)).toContain('Preserved legacy title');expect(text(tree)).toContain('Původní údaje zákazníka nejsou uložené.');expect(elements(tree).find(node=>node.type===QuoteActionsPanel)?.props).toMatchObject({selectedVersionId:null,selectedKind:'legacy'})
  })
  it('does not replace empty issued items with current calculation data',async()=>{
    mocks.version.mockResolvedValue({...quoteDocumentFixture(0),status:'accepted'});const tree=await detail(versionId);expect(text(tree)).toContain('Položky tohoto dokumentu nejsou uložené');expect(elements(tree).filter(node=>node.type==='tr')).toHaveLength(0);expect(mocks.from.mock.calls.map(call=>call[0])).not.toContain('calculations')
  })
  it.each(['foreign-customer','unknown-version','read-failure'])('fails closed for %s without a current-data fallback',async mode=>{
    if(mode==='foreign-customer')workspace.customerId=companyId;if(mode==='read-failure')mocks.version.mockRejectedValue(new Error('Denied'))
    const tree=await detail(mode==='unknown-version'?companyId:versionId);expect(text(tree)).toContain('Nabídku nebo vybranou verzi nelze načíst');expect(elements(tree).some(node=>node.type===QuoteActionsPanel)).toBe(false);expect(mocks.draft).not.toHaveBeenCalled();expect(mocks.from).not.toHaveBeenCalled()
  })
  it('shows new reactions only for the exact selected version, separately from old events',async()=>{
    const base={actionType:'revision_requested' as const,customerName:'Customer A',customerEmail:'a@example.invalid',customerPhone:'+420 111 222 333',note:'Change scope on version one',recordedAt:'2026-10-21T12:00:00Z',actorKind:'public' as const,actorId:null};
    workspace.responses=[{...base,responseId:companyId,versionId},{...base,responseId:profileId,versionId:customerId,note:'Other version secret to this panel'}];
    const plain=text(await detail(versionId));expect(plain).toContain('Reakce k této verzi');expect(plain).toContain('Požadavek na úpravu');expect(plain).toContain('Change scope on version one');expect(plain).toContain('a@example.invalid');expect(plain).not.toContain('Other version secret to this panel');expect(plain).toContain('Starší reakce bez vazby na vydanou verzi');
  })
  it('does not label issued-version reactions as draft reactions',async()=>{
    workspace.draftOpen=true;workspace.responses=[{responseId:companyId,versionId,actionType:'interested',customerName:null,customerEmail:null,customerPhone:null,note:'Issued-only interest',recordedAt:'2026-10-21T12:00:00Z',actorKind:'portal',actorId:profileId}];
    const plain=text(await detail('draft'));expect(plain).not.toContain('Reakce k této verzi');expect(plain).not.toContain('Issued-only interest');
  })
  it('denies unauthorized pages before creating a database client',async()=>{mocks.active.mockResolvedValue(null);expect(text(await detail())).toContain('není pro aktuální firmu');expect(mocks.server).not.toHaveBeenCalled()})
  it('edit loads every existing field and preserves unknown VAT for explicit completion',async()=>{
    workspace.draftOpen=true;const tree=await Edit({params:params()}),form=elements(tree).find(node=>node.type===QuoteEditForm)
    expect(form?.props.initialValues).toMatchObject({companyId,profileId,quoteId,expectedRevision:'5',currency:'EUR',internalNote:'DO NOT SHOW INTERNAL',content:{contactName:'contact_name saved',paymentTerms:'payment_terms saved'},items:[{name:'Zero',unitPrice:'0',vatRate:'',note:'Saved note'}]})
    expect(form?.key).toBe([companyId,profileId,quoteId].join(':'))
  })
  it('published edit points to explicit new draft instead of opening a write form',async()=>{const tree=await Edit({params:params()});expect(elements(tree).some(node=>node.type===QuoteEditForm)).toBe(false);expect(text(tree)).toContain('Připravit novou verzi')})
})
