'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react'
import type { InventoryData, StockDocument, InventoryOrder } from '@/lib/inventory/data'
import { decimalToMinor, money, quantityValue } from '@/lib/inventory/domain'
import { inventoryCommand } from './actions'
import SearchSelect from './SearchSelect'
import s from './inventory.module.css'

const tabs=[['stock','Zásoby'],['documents','Doklady'],['orders','Objednávky'],['suppliers','Dodavatelé'],['movements','Historie'],['reservations','Rezervace'],['valuation','Ocenění']]
const labels:Record<string,string>={draft:'Koncept',approved:'Schváleno',sent:'Odesláno',partial:'Částečně přijato',received:'Přijato',closed:'Uzavřeno',cancelled:'Zrušeno',posted:'Potvrzeno',receipt:'Příjemka',issue:'Výdejka',transfer:'Převod',count:'Inventura',correction:'Oprava'}
function Field({label,children,wide=false}:{label:string;children:ReactNode;wide?:boolean}){return <label className={wide?s.wide:undefined}>{label}{children}</label>}
function Empty({children}:{children:ReactNode}){return <div className={s.empty}><strong>V tomto výběru nejsou žádné záznamy</strong>{children}</div>}
function Lines({data,withPrice=true}:{data:InventoryData;withPrice?:boolean}){
 const [rows,setRows]=useState(['first'])
 return <div className={s.wide}>{rows.map((id,index)=><div className={s.line} key={id}>
  <SearchSelect companyId={data.companyId} kind="items" name="item_id" label={`Položka ${index+1}`} placeholder="Vyberte položku"/>
  <label>Množství<input name="quantity" required inputMode="decimal" defaultValue="1" aria-label={`Množství položky ${index+1}`}/></label>
  {withPrice?<label>Cena za jednotku bez DPH (Kč)<input name="unit_cost" required inputMode="decimal" defaultValue="0"/></label>:<input type="hidden" name="unit_cost" value="0"/>}
  <button type="button" className={s.secondary} disabled={rows.length===1} onClick={()=>setRows(rows.filter(r=>r!==id))} aria-label={`Odebrat položku ${index+1}`}>×</button>
 </div>)}<button className={s.secondary} type="button" style={{marginTop:12}} disabled={rows.length>=100} onClick={()=>setRows([...rows,crypto.randomUUID()])}>+ Přidat položku</button></div>
}
export default function InventoryClient({data}:{data:InventoryData}){
 const router=useRouter();const [pending,start]=useTransition();const [notice,setNotice]=useState<{ok:boolean;message:string}|null>(null)
 const [editor,setEditor]=useState<string|null>(null);const [selected,setSelected]=useState<string|null>(null)
 const retries=useRef(new Map<string,string>())
 const itemName=(id:string)=>data.items.find(i=>i.id===id)?.name??'Položka'
 const warehouseName=(id:string)=>data.warehouses.find(i=>i.id===id)?.name??'Sklad'
 const doc=data.documents.find(d=>d.id===selected);const order=data.orders.find(d=>d.id===selected)
 function execute(operation:string,payload:Record<string,unknown>){
  if(pending)return
  const key=JSON.stringify([operation,payload]);const request=retries.current.get(key)??crypto.randomUUID();retries.current.set(key,request)
  start(async()=>{const result=await inventoryCommand(data.companyId,operation,payload,request);setNotice(result)
   if(result.ok){retries.current.delete(key);setEditor(null);router.refresh()}})
 }
 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const fd=new FormData(event.currentTarget);const get=(name:string)=>String(fd.get(name)??'')
  try{
   if(editor==='item')execute('item',{name:get('name'),sku:get('sku'),unit:get('unit'),kind:get('kind'),sale_price_minor:decimalToMinor(get('sale_price')),tax_rate:Number(get('tax_rate'))})
   else if(editor==='warehouse')execute('warehouse',{name:get('name')})
   else if(editor==='supplier')execute('supplier',{name:get('name'),email:get('email'),phone:get('phone'),address:get('address')})
   else if(editor==='reserve')execute('reserve',{warehouse_id:get('warehouse_id'),item_id:get('item_id'),job_id:get('job_id'),quantity:quantityValue(get('quantity'))})
   else if(editor==='revalue')execute('revalue',{lot_id:get('lot_id'),expected_unit_cost_minor:data.lots.find(l=>l.id===get('lot_id'))?.unit_cost_minor,unit_cost_minor:decimalToMinor(get('unit_cost')),reason:get('reason')})
   else if(editor==='receive'&&order){
    const lines=data.orderLines.filter(l=>l.order_id===order.id).map(l=>({line_id:l.id,quantity:quantityValue(get(l.id)||'0')})).filter(l=>Number(l.quantity)>0)
    execute('receive_order',{id:order.id,version:order.version,lines})
   }else{
    const ids=fd.getAll('item_id');const quantities=fd.getAll('quantity');const costs=fd.getAll('unit_cost')
    const lines=ids.map((id,index)=>({item_id:String(id),quantity:quantityValue(String(quantities[index])),unit_cost_minor:decimalToMinor(String(costs[index]))}))
    if(editor==='order')execute('order',{title:get('title'),supplier_id:get('supplier_id'),warehouse_id:get('warehouse_id'),lines})
    else execute('document',{kind:editor,warehouse_id:get('warehouse_id'),destination_id:get('destination_id')||null,job_id:get('job_id')||null,reason:get('reason'),lines})
   }
  }catch(error){setNotice({ok:false,message:error instanceof Error?error.message:'Zkontrolujte zadané údaje.'})}
 }
 function openEditor(name:string){setEditor(name);setNotice(null)}
 const filteredItems=data.items
 function orderActions(o:InventoryOrder){return <div className={s.actions}>
  {o.status==='draft'?<button className={s.button} disabled={pending} onClick={()=>execute('order_status',{id:o.id,version:o.version,status:'approved'})}>Schválit objednávku</button>:null}
  {o.status==='approved'?<button className={s.secondary} disabled={pending} onClick={()=>execute('order_status',{id:o.id,version:o.version,status:'sent'})}>Označit jako odeslanou</button>:null}
  {['approved','sent','partial'].includes(o.status)?<button className={s.button} onClick={()=>openEditor('receive')}>Přijmout dodávku</button>:null}
  {['sent','partial','received'].includes(o.status)?<button className={s.secondary} disabled={pending} onClick={()=>execute('order_status',{id:o.id,version:o.version,status:'closed'})}>Uzavřít</button>:null}
  {['draft','approved'].includes(o.status)?<button className={s.secondary} disabled={pending} onClick={()=>execute('order_status',{id:o.id,version:o.version,status:'cancelled'})}>Zrušit</button>:null}
 </div>}
 function documentDetail(d:StockDocument){return <section className={s.card}><div className={s.tools}><h2>{labels[d.kind]} · {labels[d.status]}</h2><button className={s.secondary} onClick={()=>setSelected(null)}>Zavřít detail</button></div><p>{warehouseName(d.warehouse_id)}{d.destination_id?` → ${warehouseName(d.destination_id)}`:''}</p><p>{d.reason}</p>
  <div className={s.tableWrap}><table className={s.table}><thead><tr><th>Položka</th><th>Množství</th><th>Cena bez DPH / jednotka</th></tr></thead><tbody>{d.lines.map((l,index)=><tr key={index}><td>{itemName(l.item_id??data.orderLines.find(x=>x.id===l.line_id)?.item_id??'')}</td><td>{l.quantity}</td><td>{l.unit_cost_minor!==undefined?money(l.unit_cost_minor):'Dle objednávky'}</td></tr>)}</tbody></table></div>
  {d.status==='draft'&&data.canWrite?<div className={s.actions}><button className={s.button} disabled={pending} onClick={()=>execute('post',{id:d.id,version:d.version})}>{pending?'Potvrzuji…':'Potvrdit a změnit zásobu'}</button><span className={s.muted}>Potvrzený pohyb se opravuje novým dokladem.</span></div>:null}
 </section>}
 return <>
 <nav className={s.tabs} aria-label="Skladové agendy">{tabs.map(([key,title])=><Link key={key} href={`/inventory?tab=${key}`} className={data.tab===key?s.active:undefined} aria-current={data.tab===key?'page':undefined} onClick={()=>{setEditor(null);setSelected(null)}}>{title}</Link>)}</nav>
 {!data.canWrite?<div className={s.notice}>Licence není aktivní. Zobrazuje se dostupná historie; nové pohyby jsou pozastavené.</div>:null}
 {notice?<div role={notice.ok?'status':'alert'} className={`${s.notice} ${!notice.ok?s.error:''}`}>{notice.message}</div>:null}
 <div className={s.tools}><form action="/inventory"><input type="hidden" name="tab" value={data.tab}/><input name="q" aria-label="Hledat ve skladu" placeholder={data.tab==='documents'?'Hledat podle poznámky…':'Hledat…'} defaultValue={data.q}/><button className={s.secondary}>Hledat</button></form>
 <div className={s.actions} style={{margin:0}}><a className={s.secondary} href={`/inventory/export?kind=${data.tab}`}>Export CSV</a>{data.canWrite?<>
  {data.tab==='stock'?<><button className={s.button} onClick={()=>openEditor('item')}>+ Nová položka</button><button className={s.secondary} onClick={()=>openEditor('warehouse')}>+ Sklad</button></>:null}
  {data.tab==='documents'?<select aria-label="Nový skladový doklad" value={editor&&['receipt','issue','transfer','count','correction'].includes(editor)?editor:''} onChange={e=>openEditor(e.target.value)}><option value="">+ Nový doklad</option>{['receipt','issue','transfer','count','correction'].map(k=><option value={k} key={k}>{labels[k]}</option>)}</select>:null}
  {data.tab==='orders'?<button className={s.button} onClick={()=>openEditor('order')}>+ Objednávka</button>:null}
  {data.tab==='suppliers'?<button className={s.button} onClick={()=>openEditor('supplier')}>+ Dodavatel</button>:null}
  {data.tab==='reservations'?<button className={s.button} onClick={()=>openEditor('reserve')}>+ Rezervace</button>:null}
  {data.tab==='valuation'?<button className={s.button} onClick={()=>openEditor('revalue')}>Upřesnit nákupní cenu</button>:null}
 </>:null}</div></div>
 {editor&&data.canWrite?<section className={s.card}><div className={s.tools}><h2>{editor==='item'?'Nová položka':editor==='warehouse'?'Nový sklad':editor==='supplier'?'Nový dodavatel':editor==='order'?'Nákupní objednávka':editor==='receive'?'Přijmout dodávku':editor==='reserve'?'Rezervovat pro zakázku':editor==='revalue'?'Upřesnění nákupní ceny':labels[editor]}</h2><button className={s.secondary} onClick={()=>setEditor(null)}>Zavřít</button></div>
 <form onSubmit={submit}><div className={s.formGrid}>
 {['item','warehouse','supplier'].includes(editor)?<Field label="Název"><input name="name" required maxLength={160}/></Field>:null}
 {editor==='item'?<><Field label="Kód / SKU"><input name="sku" maxLength={80}/></Field><Field label="Jednotka"><input name="unit" defaultValue="ks" required maxLength={20}/></Field><Field label="Typ položky"><select name="kind"><option value="stock">Skladové zboží</option><option value="nonstock">Neskladová položka</option><option value="service">Služba</option></select></Field><Field label="Prodejní cena s DPH (Kč)"><input name="sale_price" inputMode="decimal" defaultValue="0" required/></Field><Field label="DPH"><select name="tax_rate"><option value="21">21 %</option><option value="12">12 %</option><option value="0">0 %</option></select></Field></>:null}
 {editor==='supplier'?<><Field label="E-mail"><input type="email" name="email"/></Field><Field label="Telefon"><input name="phone" maxLength={80}/></Field><Field label="Adresa"><input name="address" maxLength={500}/></Field></>:null}
 {editor==='order'?<><Field label="Název objednávky"><input name="title" required maxLength={200}/></Field><SearchSelect companyId={data.companyId} kind="suppliers" name="supplier_id" label="Dodavatel" placeholder="Vyberte dodavatele"/></>:null}
 {['order','receipt','issue','transfer','count','correction','reserve'].includes(editor)?<SearchSelect companyId={data.companyId} kind="warehouses" name="warehouse_id" label="Sklad" placeholder="Vyberte sklad"/>:null}
 {editor==='transfer'?<SearchSelect companyId={data.companyId} kind="warehouses" name="destination_id" label="Cílový sklad" placeholder="Vyberte cílový sklad"/>:null}
 {['issue','reserve'].includes(editor)?<SearchSelect companyId={data.companyId} kind="jobs" name="job_id" label="Zakázka" required={editor==='reserve'} placeholder={editor==='reserve'?'Vyberte zakázku':'Bez zakázky'}/>:null}
 {editor==='reserve'?<><SearchSelect companyId={data.companyId} kind="items" name="item_id" label="Položka" placeholder="Vyberte položku"/><Field label="Množství"><input name="quantity" defaultValue="1" inputMode="decimal" required/></Field></>:null}
 {['receipt','issue','transfer','count','correction'].includes(editor)?<Field label={['count','correction'].includes(editor)?'Důvod / poznámka (povinné)':'Poznámka'} wide><input name="reason" required={['count','correction'].includes(editor)} minLength={['count','correction'].includes(editor)?3:0} maxLength={1000}/></Field>:null}
 {['order','receipt','issue','transfer','count','correction'].includes(editor)?<Lines key={editor} data={data} withPrice={!['issue','transfer'].includes(editor)}/>:null}
 {editor==='count'?<p className={`${s.wide} ${s.muted}`}>Zadejte skutečně spočítané množství. Pokud se zásoba před potvrzením změní, inventuru bude potřeba založit znovu.</p>:null}
 {editor==='correction'?<p className={`${s.wide} ${s.muted}`}>Tato oprava přidává množství. Pro odpis založte výdejku s důvodem opravy.</p>:null}
 {editor==='receive'&&order?<div className={s.wide}>{data.orderLines.filter(l=>l.order_id===order.id&&Number(l.received)<Number(l.quantity)).map(l=><label className={s.field} key={l.id} style={{marginBottom:14}}>{itemName(l.item_id)} · zbývá {Number(l.quantity)-Number(l.received)}<input name={l.id} inputMode="decimal" defaultValue={String(Number(l.quantity)-Number(l.received))}/></label>)}</div>:null}
 {editor==='revalue'?<><Field label="Původní příjem"><select name="lot_id" required><option value="">Vyberte příjem</option>{data.lots.map(l=><option value={l.id} key={l.id}>{itemName(l.item_id)} · {l.quantity} ks · {money(l.unit_cost_minor)}/jedn.</option>)}</select></Field><Field label="Správná jednotková cena bez DPH (Kč)"><input name="unit_cost" inputMode="decimal" required/></Field><Field label="Důvod změny / číslo dokladu" wide><input name="reason" required minLength={3} maxLength={1000}/></Field><p className={`${s.wide} ${s.muted}`}>Cena se promítne do zbývajících zásob i materiálu již vydaného ze stejného příjmu. Nevznikne druhý náklad.</p></>:null}
 </div><div className={s.actions}><button className={s.button} disabled={pending}>{pending?'Ukládám…':editor==='receive'?'Potvrdit příjem a změnit zásobu':['receipt','issue','transfer','count','correction'].includes(editor)?'Uložit koncept':'Uložit'}</button></div></form></section>:null}
 {doc?documentDetail(doc):null}
 {order?<section className={s.card}><div className={s.tools}><h2>{order.title} · {labels[order.status]}</h2><button className={s.secondary} onClick={()=>setSelected(null)}>Zavřít detail</button></div><div className={s.tableWrap}><table className={s.table}><thead><tr><th>Položka</th><th>Objednáno</th><th>Přijato</th><th>Zbývá</th><th>Cena bez DPH</th></tr></thead><tbody>{data.orderLines.filter(l=>l.order_id===order.id).map(l=><tr key={l.id}><td>{itemName(l.item_id)}</td><td>{l.quantity}</td><td>{l.received}</td><td>{Number(l.quantity)-Number(l.received)}</td><td>{money(l.unit_cost_minor)}</td></tr>)}</tbody></table></div>{data.canWrite?orderActions(order):null}</section>:null}
 <section className={s.card}><div className={s.tableWrap}>
 {data.tab==='stock'?(filteredItems.length?<table className={s.table}><thead><tr><th>Položka</th><th>Sklad</th><th>Fyzicky</th><th>Rezervováno</th><th>Dostupné</th><th>Ocenění bez DPH</th><th/></tr></thead><tbody>{filteredItems.map(i=>{const rows=data.balances.filter(b=>b.item_id===i.id);return (rows.length?rows:[null]).map((b,index)=><tr key={`${i.id}-${index}`}><td>{i.name}<small>{i.sku||i.unit}{i.archived?' · Archivováno':''}</small></td><td>{b?warehouseName(b.warehouse_id):'—'}</td><td>{b?.quantity??0} {i.unit}</td><td>{b?.reserved??0}</td><td>{Number(b?.quantity??0)-Number(b?.reserved??0)}</td><td>{money(b?.value_minor??0)}</td><td>{data.canWrite?<button className={s.secondary} disabled={pending} onClick={()=>execute('item',{...i,archived:!i.archived})}>{i.archived?'Obnovit':'Archivovat'}</button>:null}</td></tr>)})}</tbody></table>:<Empty>Začněte přidáním skladu a první položky.</Empty>):null}
 {data.tab==='documents'?(data.documents.length?<table className={s.table}><thead><tr><th>Doklad</th><th>Sklad</th><th>Stav</th><th>Vytvořeno</th><th/></tr></thead><tbody>{data.documents.map(d=><tr key={d.id}><td>{labels[d.kind]}<small>{d.reason||d.id.slice(0,8)}</small></td><td>{warehouseName(d.warehouse_id)}</td><td><span className={s.badge}>{labels[d.status]}</span></td><td>{new Date(d.created_at).toLocaleDateString('cs-CZ')}</td><td><button className={s.secondary} onClick={()=>setSelected(d.id)}>Otevřít</button></td></tr>)}</tbody></table>:<Empty>Příjemku nebo výdejku nejprve uložíte jako koncept. Zásobu změní až potvrzení.</Empty>):null}
 {data.tab==='orders'?(data.orders.length?<table className={s.table}><thead><tr><th>Objednávka</th><th>Sklad</th><th>Stav</th><th/></tr></thead><tbody>{data.orders.map(o=><tr key={o.id}><td>{o.title}</td><td>{warehouseName(o.warehouse_id)}</td><td><span className={s.badge}>{labels[o.status]}</span></td><td><button className={s.secondary} onClick={()=>setSelected(o.id)}>Otevřít</button></td></tr>)}</tbody></table>:<Empty>Vytvořte objednávku a přijímejte i částečné dodávky.</Empty>):null}
 {data.tab==='suppliers'?(data.suppliers.length?<table className={s.table}><thead><tr><th>Dodavatel</th><th>E-mail</th><th>Telefon</th><th>Kontakt</th></tr></thead><tbody>{data.suppliers.map(x=><tr key={x.id}><td>{x.customers?.name}</td><td>{x.customers?.email??'—'}</td><td>{x.customers?.phone??'—'}</td><td><Link href={`/customers/${x.customer_id}`}>Otevřít kontakt ↗</Link></td></tr>)}</tbody></table>:<Empty>Dodavatelé používají stejný adresář jako vaši zákazníci.</Empty>):null}
 {data.tab==='movements'?(data.movements.length?<table className={s.table}><thead><tr><th>Čas</th><th>Položka</th><th>Sklad</th><th>Pohyb</th><th>Původ</th></tr></thead><tbody>{data.movements.map(m=><tr key={m.id}><td>{new Date(m.created_at).toLocaleString('cs-CZ')}</td><td>{itemName(m.item_id)}</td><td>{warehouseName(m.warehouse_id)}</td><td>{Number(m.quantity)>0?'+':''}{m.quantity}</td><td>{{document:'Skladový doklad',order_receipt:'Příjem objednávky',transfer:'Převod',pos_sale_line:'Prodej',pos_return_line:'Vratka'}[m.reference_kind]??'Skladová operace'}</td></tr>)}</tbody></table>:<Empty>Potvrzené pohyby se zobrazí tady. Historie se nepřepisuje.</Empty>):null}
 {data.tab==='reservations'?(data.reservations.length?<table className={s.table}><thead><tr><th>Položka</th><th>Sklad</th><th>Zakázka</th><th>Rezervováno</th><th/></tr></thead><tbody>{data.reservations.map(r=><tr key={r.id}><td>{itemName(r.item_id)}</td><td>{warehouseName(r.warehouse_id)}</td><td>{data.jobs.find(j=>j.id===r.job_id)?.title??'Zakázka'}</td><td>{r.quantity}</td><td>{data.canWrite?<button className={s.secondary} disabled={pending} onClick={()=>execute('release',{id:r.id})}>Uvolnit</button>:null}</td></tr>)}</tbody></table>:<Empty>Rezervace drží materiál pro zakázku. Fyzickou zásobu ani náklady nemění.</Empty>):null}
 {data.tab==='valuation'?<><p className={s.muted}>Výdej používá pořadí příjmů (FIFO). Nákupní cena je bez DPH, měna CZK. Záporné zásoby nejsou povolené.</p>{data.lots.length?<table className={s.table}><thead><tr><th>Položka</th><th>Původní příjem</th><th>Zbývá</th><th>Cena / jednotka</th><th>Hodnota zásoby</th></tr></thead><tbody>{data.lots.map(l=><tr key={l.id}><td>{itemName(l.item_id)}</td><td>{l.quantity}</td><td>{l.remaining}</td><td>{money(l.unit_cost_minor)}</td><td>{money(Number(l.remaining)*Number(l.unit_cost_minor))}</td></tr>)}</tbody></table>:<Empty>Ocenění se vytvoří prvním příjmem.</Empty>}</>:null}
 </div></section>
 {data.total>25||data.page>1?<nav className={s.pager} aria-label="Stránkování">{data.page>1?<Link href={`/inventory?tab=${data.tab}&q=${encodeURIComponent(data.q)}&page=${data.page-1}`} onClick={()=>{setSelected(null);setEditor(null)}}>← Předchozí</Link>:null}<span>{data.page} / {Math.max(1,Math.ceil(data.total/25))} · {data.total} záznamů</span>{data.page*25<data.total?<Link href={`/inventory?tab=${data.tab}&q=${encodeURIComponent(data.q)}&page=${data.page+1}`} onClick={()=>{setSelected(null);setEditor(null)}}>Další →</Link>:null}</nav>:null}
 {data.tab==='valuation'?<p className={s.muted}>Upřesnění ceny nabízí příjmy z této stránky. Starší příjem najdete hledáním podle položky nebo na další stránce.</p>:null}
 <p className={s.muted}>Dodavatelská platba sama o sobě nemění zásobu. Každý příjem nebo výdej potvrzujete samostatně.</p>
 </>
}
