import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { CORE_QUOTE_CONTENT_KEYS, type CoreQuoteDraftFormValues, type CoreQuoteWorkspace } from '../lib/core-quote-lifecycle'
import { quoteOperationKey } from '../components/quote-lifecycle-state'
const hooks = vi.hoisted(() => {
  let slots: unknown[] = [], cursor = 0
  const effects = new Map<number, { deps: unknown[]; cleanup?: () => void }>()
  let queued: Array<() => void> = []
  return {
    reset() { effects.forEach(effect => effect.cleanup?.()); effects.clear(); slots = []; cursor = 0; queued = [] },
    render<T>(component: () => T) {
      cursor = 0; let tree = component()
      const work = queued; queued = []; work.forEach(effect => effect())
      if (work.length) { cursor = 0; tree = component() }
      return tree
    },
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [slots[index], (value: unknown) => { slots[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(slots[index]) : value }]
    },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] },
    useEffect(run: () => (() => void) | undefined, deps: unknown[]) {
      const index = cursor++, previous = effects.get(index)
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) queued.push(() => {
        previous?.cleanup?.(); const cleanup = run(); effects.set(index, { deps, cleanup })
      })
    },
  }
})

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), publish: vi.fn(), sync: vi.fn(), open: vi.fn(), decision: vi.fn(), revoke: vi.fn(), archive: vi.fn(), remove: vi.fn(), push: vi.fn(), refresh: vi.fn(), fetch: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...hooks, useLayoutEffect: hooks.useEffect }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('@/app/business-actions', () => ({ updateQuoteAction: mocks.update, createQuoteFromCalculationAction: mocks.create, publishQuoteAction: mocks.publish, syncQuotePricingFromCalculationAction: mocks.sync, openQuoteRevisionAction: mocks.open, recordQuoteDecisionAction: mocks.decision, revokeQuotePublicationAction: mocks.revoke, archiveQuoteAction: mocks.archive, deleteQuoteAction: mocks.remove }))
import QuoteEditForm from '../components/QuoteEditForm'
import QuoteActionsPanel from '../components/QuoteActionsPanel'
import CreateQuoteFromCalculationButton from '../components/CreateQuoteFromCalculationButton'
import QuoteSendForm from '../components/QuoteSendForm'

const companyId='11111111-1111-4111-8111-111111111111', profileId='22222222-2222-4222-8222-222222222222', quoteId='33333333-3333-4333-8333-333333333333'
const versionId='44444444-4444-4444-8444-444444444444', calculationId='55555555-5555-4555-8555-555555555555', otherCompany='66666666-6666-4666-8666-666666666666'
const content=Object.fromEntries(Object.keys(CORE_QUOTE_CONTENT_KEYS).map(key=>[key,key+' stored'])) as CoreQuoteDraftFormValues['content']
const initial: CoreQuoteDraftFormValues = {companyId,profileId,quoteId,expectedRevision:'1',operationId:'77777777-7777-4777-8777-777777777777',title:'Synthetic quote',quoteDate:'2026-10-21',validUntil:null,currency:'CZK',pricingMode:'net',discountAmount:'0',customerNote:'Visible',internalNote:'Private',content,items:[{name:'Free item',description:'Complete',quantity:'1',unit:'ks',unitPrice:'0',vatRate:'21',note:'Customer note'}]}
const scope={companyId,profileId,entityId:quoteId,slot:'edit'}
let store:Map<string,string>
function elements(value:unknown):Array<{type:unknown;props:Record<string,unknown>}>{if(Array.isArray(value))return value.flatMap(elements);if(!React.isValidElement<Record<string,unknown>>(value))return [];return [{type:value.type,props:value.props},...elements(value.props.children)]}
function text(value:unknown):string{if(typeof value==='string'||typeof value==='number')return String(value);if(Array.isArray(value))return value.map(text).join(' ');return React.isValidElement<{children?:unknown}>(value)?text(value.props.children):''}
function one(tree:unknown,find:(node:ReturnType<typeof elements>[number])=>boolean){const node=elements(tree).find(find);expect(node).toBeDefined();return node!}
function change(tree:unknown,id:string,value:string){(one(tree,node=>node.props.id===id).props.onChange as (event:unknown)=>void)({target:{value}})}
function click(tree:unknown,label:string){return(one(tree,node=>node.type==='button'&&text(node.props.children)===label).props.onClick as ()=>Promise<void>)()}
function submit(tree:unknown){return(one(tree,node=>node.type==='form').props.onSubmit as (event:unknown)=>Promise<void>)({preventDefault(){}})}
const render=(values=initial)=>hooks.render(()=>QuoteEditForm({customerId:null,initialValues:values}))
function receipt(input:{companyId:string;operationId:string;expectedRevision?:string},extra={}){return{companyId:input.companyId,operationId:input.operationId,quoteId,revision:String(BigInt(input.expectedRevision??'0')+BigInt(1)),replayed:false,...extra}}
beforeEach(()=>{vi.resetAllMocks();hooks.reset();store=new Map();vi.stubGlobal('React',React);vi.stubGlobal('window',{sessionStorage:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value),removeItem:(key:string)=>store.delete(key)},location:{origin:'https://app.diriqo.com'},confirm:()=>true});vi.stubGlobal('fetch',mocks.fetch);mocks.fetch.mockResolvedValue({ok:true,json:async()=>({companyId,profileId})});mocks.update.mockImplementation(async input=>({ok:true,data:receipt(input)}));mocks.create.mockImplementation(async input=>({ok:true,data:receipt(input)}));mocks.revoke.mockImplementation(async input=>({ok:true,data:receipt(input,{versionId:input.versionId})}));for(const key of ['publish','sync','open','decision','archive'] as const)mocks[key].mockImplementation(async input=>({ok:true,data:receipt(input,{versionId,...(key==='publish'?{versionNumber:1,shareToken:'a'.repeat(64),publishedAt:'2026-10-21T10:00:00Z'}:{}),...(key==='decision'?{decisionId:'88888888-8888-4888-8888-888888888888',decision:input.decision,recordedAt:'2026-10-21T11:00:00Z'}:{})})}));})
afterEach(()=>{hooks.reset();vi.unstubAllGlobals()})
describe('Core quote real UI handlers',()=>{
  it('saves every visible field, customer zero and internal note without editable lifecycle fields',async()=>{
    const tree=render();change(tree,'quote-title','Changed');change(tree,'quote-paymentTerms','Net 30');change(tree,'quote-customer-note','Customer edited');change(tree,'quote-internal-note','Private edited');await submit(render());
    const input=mocks.update.mock.calls[0][0];expect(input).toMatchObject({title:'Changed',customerNote:'Customer edited',internalNote:'Private edited',discountAmount:'0.00',items:[{unitPrice:'0.00'}]});expect(input.content).toEqual({...content,paymentTerms:'Net 30'});for(const key of ['status','acceptedAt','sentAt','rejectedAt','shareToken'])expect(input).not.toHaveProperty(key);expect(mocks.push).toHaveBeenCalledWith('/cenove-nabidky/'+quoteId);
  })
  it('persists before dispatch and blocks same-render double submit',async()=>{
    let finish!:(value:unknown)=>void;mocks.update.mockImplementation(input=>{expect(JSON.parse(store.get(quoteOperationKey(scope))!).command).toEqual(input);return new Promise(resolve=>finish=resolve)});
    const tree=render();const first=submit(tree);await submit(tree);expect(mocks.update).toHaveBeenCalledOnce();finish({ok:true,data:receipt(mocks.update.mock.calls[0][0])});await first;
  })
  it('pins initial revision to initial unsaved fields across server refresh',async()=>{
    const tree=render();change(tree,'quote-title','My unsaved edit');mocks.update.mockResolvedValue({ok:false,code:'conflict',uncertain:false,error:'New revision exists'});
    await submit(render({...initial,expectedRevision:'2',title:'Other writer'}));expect(mocks.update.mock.calls[0][0]).toMatchObject({expectedRevision:'1',title:'My unsaved edit'});expect(text(render())).toContain('New revision exists');expect(one(render(),node=>node.props.id==='quote-title').props.value).toBe('My unsaved edit');expect(store.size).toBe(0);
  })
  it('restores exact unknown payload on reload and preserves it after retry refusal',async()=>{
    mocks.update.mockRejectedValueOnce(new Error('lost'));await submit(render());const saved=store.get(quoteOperationKey(scope));hooks.reset();mocks.update.mockResolvedValueOnce({ok:false,code:'forbidden',uncertain:false,error:'Role removed'});await click(render({...initial,title:'New server title',expectedRevision:'8'}),'Ověřit stejný požadavek');expect(mocks.update.mock.calls[1][0]).toEqual(mocks.update.mock.calls[0][0]);expect(store.get(quoteOperationKey(scope))).toBe(saved);expect(one(render(),node=>node.type==='fieldset').props.disabled).toBe(true);
  })
  it('reuses pending command after unknown completion even before React rerenders',async()=>{
    mocks.update.mockRejectedValueOnce(new Error('lost'));
    const tree=render();await submit(tree);await submit(tree);
    expect(mocks.update).toHaveBeenCalledTimes(2);expect(mocks.update.mock.calls[1][0]).toEqual(mocks.update.mock.calls[0][0]);
  })
  it('does not navigate a late result after the component unmounts',async()=>{
    let finish!:(value:unknown)=>void;mocks.update.mockImplementation(()=>new Promise(resolve=>finish=resolve));
    const first=submit(render());const input=mocks.update.mock.calls[0][0];hooks.reset();finish({ok:true,data:receipt(input)});await first;
    expect(mocks.push).not.toHaveBeenCalled();expect(mocks.fetch).not.toHaveBeenCalled();expect(JSON.parse(store.get(quoteOperationKey(scope))!).receipt.revision).toBe('2');
  })
  it('does not navigate a late result after company props change on the same component',async()=>{
    let finish!:(value:unknown)=>void;mocks.update.mockImplementation(()=>new Promise(resolve=>finish=resolve));
    const first=submit(render());const input=mocks.update.mock.calls[0][0];render({...initial,companyId:otherCompany});finish({ok:true,data:receipt(input)});await first;
    expect(mocks.push).not.toHaveBeenCalled();expect(mocks.fetch).not.toHaveBeenCalled();expect(store.has(quoteOperationKey(scope))).toBe(true);
  })
  it('checks scope again after an in-flight active-company response',async()=>{
    let finish!:(value:unknown)=>void;mocks.fetch.mockImplementation(()=>new Promise(resolve=>finish=resolve));
    const first=submit(render());await Promise.resolve();await Promise.resolve();expect(mocks.fetch).toHaveBeenCalledOnce();
    render({...initial,companyId:otherCompany});finish({ok:true,json:async()=>({companyId,profileId})});await first;
    expect(mocks.push).not.toHaveBeenCalled();expect(store.has(quoteOperationKey(scope))).toBe(true);
  })
  it('keeps malformed success pending and does not navigate',async()=>{
    mocks.update.mockImplementation(async input=>({ok:true,data:receipt(input,{revision:'99'})}));await submit(render());expect(store.size).toBe(1);expect(mocks.push).not.toHaveBeenCalled();expect(text(render())).toContain('Výsledek zatím nelze potvrdit');
  })
  it('blocks saving when session storage cannot persist the operation',async()=>{
    window.sessionStorage.setItem=()=>{throw new Error('quota')};await submit(render());expect(mocks.update).not.toHaveBeenCalled();expect(text(render())).toContain('Ukládání je pozastavené');expect(one(render(),node=>node.type==='fieldset').props.disabled).toBe(true);
  })
  it('blocks malformed saved operation without replacing it',()=>{
    store.set(quoteOperationKey(scope),'{broken');expect(text(render())).toContain('nelze bezpečně obnovit');expect(store.get(quoteOperationKey(scope))).toBe('{broken');expect(one(render(),node=>node.type==='fieldset').props.disabled).toBe(true);
  })
  it('retains confirmed receipt when active company changed and reconciles without another write',async()=>{
    mocks.fetch.mockResolvedValueOnce({ok:true,json:async()=>({companyId:otherCompany,profileId})});await submit(render());expect(mocks.push).not.toHaveBeenCalled();expect(JSON.parse(store.get(quoteOperationKey(scope))!).receipt.revision).toBe('2');await click(render(),'Otevřít uloženou nabídku');expect(mocks.update).toHaveBeenCalledOnce();expect(mocks.push).toHaveBeenCalledOnce();
  })
  it('does not pair a known company with an absent profile after success',async()=>{
    mocks.fetch.mockResolvedValueOnce({ok:true,json:async()=>({companyId})});await submit(render());expect(mocks.push).not.toHaveBeenCalled();expect(store.size).toBe(1);
  })
  it('keeps missing historical VAT blank and requires explicit completion',async()=>{
    const historical={...initial,items:[{...initial.items[0],vatRate:''}],pricingMode:''};const tree=render(historical);expect(one(tree,node=>node.props.id==='quote-item-0-vatRate').props.value).toBe('');await submit(tree);expect(mocks.update).not.toHaveBeenCalled();expect(store.size).toBe(0);
  })
  it('supports a full saved discount rather than ignoring the input',async()=>{
    const tree=render({...initial,items:[{...initial.items[0],unitPrice:'10'}]});change(tree,'quote-discount','2,50');await submit(render());expect(mocks.update.mock.calls[0][0].discountAmount).toBe('2.50');
  })
  it('source creation uses pinned source revision and restores one operation',async()=>{
    const props={companyId,profileId,calculationId,customerId:null,expectedCalculationRevision:'3'};
    const create=(revision='3')=>hooks.render(()=>CreateQuoteFromCalculationButton({...props,expectedCalculationRevision:revision}));
    mocks.create.mockRejectedValueOnce(new Error('timeout'));await click(create(),'Vytvořit cenovou nabídku');hooks.reset();await click(create('4'),'Ověřit stejný požadavek');expect(mocks.create.mock.calls[0][0]).toEqual(mocks.create.mock.calls[1][0]);expect(mocks.create.mock.calls[1][0].expectedCalculationRevision).toBe('3');
  })
})

function workspace():CoreQuoteWorkspace{return{companyId,quoteId,customerId:null,sourceCalculationId:calculationId,sourceCalculationRevision:'1',currentCalculationRevision:'4',revision:'3',draftOpen:false,archivedAt:null,currentVersionId:versionId,acceptedVersionId:null,customerIdentityState:'captured',customerSnapshot:{},draft:{title:'Draft',quote_date:'2026-10-21',valid_until:null,currency:'CZK',pricing_mode:'net',discount_amount:'0',customer_note:null,internal_note:'Private',content:Object.fromEntries(Object.values(CORE_QUOTE_CONTENT_KEYS).map(key=>[key,null])) as CoreQuoteWorkspace['draft']['content'],items:[]},versions:[{versionId,versionNumber:1,sourceRevision:'2',contentHash:'a'.repeat(64),publishedAt:'2026-10-21T10:00:00Z',status:'published',acceptedAt:null,rejectedAt:null,shareToken:'a'.repeat(64),decision:null}],responses:[],legacy:null}}
const panel=(state=workspace(),selection:string|null=versionId)=>hooks.render(()=>QuoteActionsPanel({workspace:state,actorProfileId:profileId,selectedVersionId:selection,selectedKind:selection?'issued':'draft',quoteTitle:'Offer'}))
describe('Version actions',()=>{
  it('offers explicit new revision and exact issued PDF instead of editing published content',async()=>{
    const tree=panel();expect(text(tree)).toContain('Připravit novou verzi');expect(text(tree)).not.toContain('Upravit koncept');expect(one(tree,node=>node.type==='a'&&String(node.props.href).includes('/pdf')).props.href).toBe('/api/quotes/'+quoteId+'/pdf?versionId='+versionId);await click(tree,'Připravit novou verzi');expect(mocks.open.mock.calls[0][0]).toMatchObject({versionId,expectedRevision:'3'});expect(mocks.push).toHaveBeenCalledWith('/cenove-nabidky/'+quoteId+'/edit');
  })
  it('publishes the current revision and opens the issued receipt version',async()=>{
    await click(panel({...workspace(),draftOpen:true},null),'Vydat a zpřístupnit verzi');expect(mocks.publish.mock.calls[0][0]).toMatchObject({quoteId,expectedRevision:'3'});expect(mocks.push).toHaveBeenCalledWith('/cenove-nabidky/'+quoteId+'?version='+versionId);
  })
  it('draft sync uses current source revision, not original source revision',async()=>{
    const state={...workspace(),draftOpen:true};await click(panel(state,null),'Převzít položky z kalkulace');expect(mocks.sync.mock.calls[0][0]).toMatchObject({calculationId,expectedCalculationRevision:'4',expectedRevision:'3'});
  })
  it('manual decision records selected exact version plus evidence and never calls conversion',async()=>{
    await click(panel(),'Zaznamenat rozhodnutí');const tree=panel();change(tree,'quote-decision-evidence','Customer e-mail 21 October');await submit(panel());expect(mocks.decision.mock.calls[0][0]).toMatchObject({versionId,evidence:'Customer e-mail 21 October',decision:'accepted'});expect(mocks.decision.mock.calls[0][0]).not.toHaveProperty('expectedRevision');expect(mocks.push).toHaveBeenCalledWith('/cenove-nabidky/'+quoteId+'?version='+versionId);
  })
  it('blocks conversion before selected version is explicitly accepted',()=>{expect(one(panel(),node=>node.type==='button'&&text(node.props.children)==='Vytvořit zakázku z této verze').props.disabled).toBe(true)})
  it('archived issued history blocks content changes and still offers PDF',()=>{
    const tree=panel({...workspace(),archivedAt:'2026-10-21T11:00:00Z'});expect(text(tree)).not.toContain('Připravit novou verzi');expect(text(tree)).not.toContain('Archivovat nabídku');expect(text(tree)).toContain('Stáhnout PDF této verze');
  })
  it('keeps explicit legacy history distinct from an open draft',()=>{
    const tree=hooks.render(()=>QuoteActionsPanel({workspace:{...workspace(),draftOpen:true},actorProfileId:profileId,selectedVersionId:null,selectedKind:'legacy',quoteTitle:'Old offer'}));
    expect(text(tree)).not.toContain('Vydat a zpřístupnit verzi');expect(text(tree)).not.toContain('Upravit koncept');
    expect(text(tree)).toContain('Otevřít rozpracovaný koncept');expect(one(tree,node=>node.type==='a'&&String(node.props.href).includes('/pdf')).props.href).toBe('/api/quotes/'+quoteId+'/pdf?legacy=1');
  })
  it('opens a new revision explicitly from a preserved legacy baseline',async()=>{
    const state={...workspace(),versions:[],currentVersionId:null,legacy:{capturedAt:'2026-10-21T10:00:00Z',revokedAt:null,document:{} as NonNullable<CoreQuoteWorkspace['legacy']>['document']}};
    const tree=hooks.render(()=>QuoteActionsPanel({workspace:state,actorProfileId:profileId,selectedVersionId:null,selectedKind:'legacy',quoteTitle:'Old offer'}));
    await click(tree,'Připravit novou verzi');expect(mocks.open.mock.calls[0][0]).toMatchObject({versionId:null,expectedRevision:'3'});expect(mocks.push).toHaveBeenCalledWith('/cenove-nabidky/'+quoteId+'/edit');
  })
  it('keeps legacy read-only after a modern version was issued',()=>{
    const state={...workspace(),legacy:{capturedAt:'2026-10-21T10:00:00Z',revokedAt:null,document:{} as NonNullable<CoreQuoteWorkspace['legacy']>['document']}};
    const tree=hooks.render(()=>QuoteActionsPanel({workspace:state,actorProfileId:profileId,selectedVersionId:null,selectedKind:'legacy',quoteTitle:'Old offer'}));
    expect(text(tree)).not.toContain('Připravit novou verzi');expect(text(tree)).toContain('Stáhnout PDF této verze');
  })
  it('does not invent a legacy baseline when none is stored',()=>{
    const tree=hooks.render(()=>QuoteActionsPanel({workspace:{...workspace(),versions:[],currentVersionId:null},actorProfileId:profileId,selectedVersionId:null,selectedKind:'legacy',quoteTitle:'Old offer'}));
    expect(text(tree)).not.toContain('Připravit novou verzi');
  })
  it('draft PDF is pinned to expected revision',()=>{const tree=panel({...workspace(),draftOpen:true},null);expect(one(tree,node=>node.type==='a'&&String(node.props.href).includes('/pdf')).props.href).toBe('/api/quotes/'+quoteId+'/pdf?draftRevision=3')})
})

describe('Version mail delivery',()=>{
  it('retains unknown delivery and reuses operation to query state',async()=>{
    const renderMail=()=>hooks.render(()=>QuoteSendForm({companyId,profileId,quoteId,versionId,versionNumber:1,title:'Offer',contactEmail:'test@example.invalid',shareUrl:'/offer/'+('a'.repeat(64))}));
    mocks.fetch.mockResolvedValueOnce({ok:false,json:async()=>({ok:false,deliveryState:'uncertain',error:'Waiting provider'})});await submit(renderMail());const first=JSON.parse(mocks.fetch.mock.calls[0][1].body);expect(first).toMatchObject({companyId,versionId,relatedEntityId:quoteId});expect(first.profileId).toBe(profileId);
    mocks.fetch.mockResolvedValueOnce({ok:true,json:async()=>({ok:true,deliveryState:'sent',quoteId,versionId,operationId:first.operationId})});await click(renderMail(),'Ověřit stav stejné zprávy');expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual(first);expect(text(renderMail()).replace(/\s+/g, ' ')).toContain('Odeslání verze 1 bylo potvrzené');
  })
})


describe('version link revocation UI',()=>{
  const revokeLabel='Zneplatnit odkaz této verze'
  const legacyState=()=>({...workspace(),legacy:{capturedAt:'2026-10-21T10:00:00Z',revokedAt:null,document:{} as NonNullable<CoreQuoteWorkspace['legacy']>['document']}})
  const legacyPanel=(state:CoreQuoteWorkspace=legacyState())=>hooks.render(()=>QuoteActionsPanel({workspace:state,actorProfileId:profileId,selectedVersionId:null,selectedKind:'legacy',quoteTitle:'Old offer'}))
  it('revokes the exact selected issued version with CAS and preserves version navigation',async()=>{
    await click(panel(),revokeLabel)
    expect(mocks.revoke.mock.calls[0][0]).toMatchObject({companyId,profileId,quoteId,versionId,expectedRevision:'3'})
    expect(mocks.archive).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.push).toHaveBeenCalledWith('/cenove-nabidky/'+quoteId+'?version='+versionId)
  })
  it('explicitly revokes only legacy links even when a modern version exists',async()=>{
    await click(legacyPanel(),revokeLabel)
    expect(mocks.revoke.mock.calls[0][0]).toMatchObject({versionId:null,expectedRevision:'3'})
    expect(mocks.push).toHaveBeenCalledWith('/cenove-nabidky/'+quoteId+'?version=legacy')
  })
  it('restores the original unknown revoke operation without adopting a newly selected version',async()=>{
    mocks.revoke.mockRejectedValueOnce(new Error('response lost'));await click(panel(),revokeLabel)
    const original=mocks.revoke.mock.calls[0][0];hooks.reset();await click(legacyPanel(),'Ověřit stejný požadavek')
    expect(mocks.revoke.mock.calls[1][0]).toEqual(original)
    expect(mocks.push).toHaveBeenCalledWith('/cenove-nabidky/'+quoteId+'?version='+versionId)
  })
  it('retains a malformed revoke receipt as pending and blocks navigation',async()=>{
    mocks.revoke.mockImplementation(async input=>({ok:true,data:receipt(input,{versionId:null})}));await click(panel(),revokeLabel)
    expect(mocks.push).not.toHaveBeenCalled();expect(store.size).toBe(1);expect(text(panel())).toContain('Ověřit stejný požadavek')
  })
  it('retains confirmed revocation if the account changed before navigation',async()=>{
    mocks.fetch.mockResolvedValueOnce({ok:true,json:async()=>({companyId,profileId:otherCompany})});await click(panel(),revokeLabel)
    expect(mocks.push).not.toHaveBeenCalled();expect(store.size).toBe(1)
    await click(panel(),'Otevřít potvrzený výsledek');expect(mocks.revoke).toHaveBeenCalledOnce();expect(mocks.push).toHaveBeenCalledOnce()
  })
  it('does not offer revocation for draft or already revoked links',()=>{
    expect(text(panel({...workspace(),draftOpen:true},null))).not.toContain(revokeLabel);hooks.reset()
    const state=workspace();state.versions[0]={...state.versions[0],status:'accepted',shareToken:null}
    expect(text(panel(state))).not.toContain(revokeLabel);expect(text(panel(state))).toContain('Stáhnout PDF této verze');hooks.reset()
    const legacy=legacyState();expect(text(legacyPanel({...legacy,legacy:{...legacy.legacy,revokedAt:'2026-10-21T12:00:00Z'}}))).not.toContain(revokeLabel)
  })
  it.each(['issued','legacy'] as const)('can revoke an archived %s link without reopening its content',async kind=>{
    const state={...(kind==='issued'?workspace():legacyState()),archivedAt:'2026-10-21T12:00:00Z'}
    const tree=kind==='issued'?panel(state):legacyPanel(state)
    expect(text(tree)).not.toContain('Připravit novou verzi');expect(text(tree)).not.toContain('Vydat a zpřístupnit verzi');expect(text(tree)).not.toContain('Archivovat nabídku')
    await click(tree,revokeLabel)
    expect(mocks.revoke.mock.calls[0][0]).toMatchObject({companyId,profileId,quoteId,versionId:kind==='issued'?versionId:null,expectedRevision:'3'})
    expect(mocks.archive).not.toHaveBeenCalled();expect(mocks.open).not.toHaveBeenCalled();expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.push).toHaveBeenCalledWith('/cenove-nabidky/'+quoteId+'?version='+(kind==='issued'?versionId:'legacy'))
  })
  it('does not dispatch when the explicit confirmation is cancelled',async()=>{
    window.confirm=()=>false;await click(panel(),revokeLabel);expect(mocks.revoke).not.toHaveBeenCalled();expect(store.size).toBe(0)
  })
})
