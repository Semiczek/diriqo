import { describe, expect, it } from 'vitest'
import { acceptanceBlockReason, customerSnapshot, validateDraft, variantTotals, type QuoteDraft } from '../lib/smart-quotes/domain'

export const draft = ():QuoteDraft => ({
  title:'Montáž dveří',customerName:'Testovací zákazník',customerEmail:'customer@example.test',validUntil:'2027-01-10',deliveryTerms:'Realizace po dohodě',terms:'Platba po předání.',
  variants:[{id:'basic',name:'Základní',discountPercent:10,items:[{id:'material',name:'Materiál',description:'Položka dle rozsahu',quantity:2.5,unit:'m',unitPrice:1200,vatRate:21,costPrice:800}]}],
})

describe('smart quote calculations and customer boundary',()=>{
  it('applies a variant discount before tax and keeps planned cost separate',()=>{
    expect(variantTotals(draft().variants[0])).toEqual({net:2700,vat:567,total:3267,cost:2000,margin:25.93})
  })
  it('calculates fractional quantity and tax by line, rounded to cents',()=>{
    const d=draft();d.variants[0].discountPercent=0;d.variants[0].items[0]={...d.variants[0].items[0],quantity:0.125,unitPrice:99.99,costPrice:0,vatRate:12}
    expect(variantTotals(d.variants[0])).toMatchObject({net:12.5,vat:1.5,total:14})
  })
  it('requires administrator review even for a free variant with costs',()=>{
    const d=draft();d.variants[0].discountPercent=100
    expect(variantTotals(d.variants[0])).toMatchObject({net:0,total:0,cost:2000,margin:-100})
  })
  it('allowlists customer fields at every nesting level without costs or margin',()=>{
    const internal={...draft(),secret:'salary',variants:draft().variants.map(v=>({...v,margin:25,approval:'internal',items:v.items.map(i=>({...i,secret:'wage',sourceDocument:'private://secret'}))}))}
    const snapshot=customerSnapshot(internal,'Dodavatel')
    expect(JSON.stringify(snapshot)).not.toMatch(/costPrice|margin|secret|salary|wage|private:|approval/)
    expect(snapshot.variants[0]).toMatchObject({id:'basic',total:3267})
    expect(snapshot.variants[0].items[0]).toMatchObject({quantity:2.5,unitPrice:1200,total:3267})
  })
  it('creates an independent snapshot that later draft changes cannot mutate',()=>{
    const d=draft(),snapshot=customerSnapshot(d,'Dodavatel')
    d.title='Upravená';d.variants[0].items[0].quantity=900
    expect(snapshot.title).toBe('Montáž dveří')
    expect(snapshot.variants[0].items[0].quantity).toBe(2.5)
  })
  it.each([NaN,Infinity,-1,100000001])('rejects unsafe prices %s',price=>{
    const d=draft();d.variants[0].items[0].unitPrice=price
    expect(()=>validateDraft(d)).toThrow()
  })
  it('rejects duplicated variant and line identifiers to avoid ambiguous acceptance',()=>{
    const d=draft();d.variants.push({...d.variants[0]})
    expect(()=>validateDraft(d)).toThrow(/jedinečné/)
    const other=draft();other.variants[0].items.push({...other.variants[0].items[0]})
    expect(()=>validateDraft(other)).toThrow(/jedinečné/)
  })
  it('rejects invalid dates, empty variants and extreme aggregate value',()=>{
    expect(()=>validateDraft({...draft(),validUntil:'2027-02-31'})).toThrow()
    expect(()=>validateDraft({...draft(),variants:[]})).toThrow()
    const d=draft();d.variants[0].items[0].quantity=1000000
    expect(()=>validateDraft(d)).toThrow(/příliš vysoká/)
  })
  it('strips forged computed totals and unknown fields at the action boundary',()=>{
    const d=draft()
    const checked=validateDraft({...d,companyId:'other-company',variants:d.variants.map(v=>({...v,total:1,items:v.items.map(i=>({...i,net:1}))}))})
    expect(checked).toEqual(d)
  })
})

describe('customer acceptance state',()=>{
  const open={current:true,expired:false,active:true,status:'sent'}
  it('offers acceptance only for an active current unexpired version',()=>expect(acceptanceBlockReason(open)).toBeNull())
  it('explains superseded version even if the module is later restored',()=>expect(acceptanceBlockReason({...open,current:false})).toMatch(/novější/))
  it('blocks new acceptance after licence off without hiding the saved version',()=>expect(acceptanceBlockReason({...open,active:false})).toMatch(/Kontaktujte/))
  it('does not cancel an already accepted version when entitlement expires',()=>expect(acceptanceBlockReason({...open,active:false,expired:true,status:'accepted'})).toMatch(/již byla přijata/))
  it.each(['rejected','accepted'])('blocks a second decision in state %s',status=>expect(acceptanceBlockReason({...open,status})).not.toBeNull())
})
