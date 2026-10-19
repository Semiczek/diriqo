import 'server-only'
import { uuidPattern, type WarehouseKind } from './domain'
import { requireCompanyRoleDalContext } from '@/lib/dal/auth'
export type InventoryItem={id:string;name:string;sku:string;unit:string;kind:string;sale_price_minor:number;tax_rate:number;archived:boolean;version:number}
export type Warehouse={id:string;name:string;version:number;warehouse_kind:WarehouseKind;job_id:string|null;location:string;notes:string;archived:boolean}
export type InventoryOrder={id:string;title:string;status:string;version:number;warehouse_id:string;created_at:string}
export type OrderLine={id:string;order_id:string;item_id:string;quantity:number;received:number;unit_cost_minor:number}
export type StockDocument={id:string;kind:string;status:string;warehouse_id:string;destination_id:string|null;job_id:string|null;reason:string;version:number;created_at:string;lines:{item_id?:string;line_id?:string;quantity:number;unit_cost_minor?:number}[]}
export type InventoryData={companyId:string;canWrite:boolean;items:InventoryItem[];warehouses:Warehouse[];warehouseOptions:Warehouse[];orders:InventoryOrder[];orderLines:OrderLine[];documents:StockDocument[];
 suppliers:{id:string;customer_id:string;customers:{name:string;email:string|null;phone:string|null}|null}[];
 balances:{item_id:string;warehouse_id:string;quantity:number;reserved:number;value_minor:number}[];
 movements:{id:string;item_id:string;warehouse_id:string;quantity:number;reference_kind:string;created_at:string}[];
 jobs:{id:string;title:string}[];reservations:{id:string;item_id:string;warehouse_id:string;job_id:string;quantity:number}[];
 lots:{id:string;item_id:string;warehouse_id:string;quantity:number;remaining:number;unit_cost_minor:number}[];total:number;page:number;q:string;tab:string;warehouseId:string;documentKind:string;initialAction:string;initialDocument:string}

export const inventoryPageSize=25
const itemFields='id,name,sku,unit,kind,sale_price_minor,tax_rate,archived,version'
export function inventorySearchTerm(q:string){return q.replace(/[%_,()."'\\]/g,' ').trim().slice(0,100)}
type Rows<T>={data:T[]|null;error:unknown;count?:number|null}
function requireRows<T>(result:Rows<T>):T[]{if(result.error)throw new Error('Data skladu se nepodařilo načíst.');return result.data??[]}

// Page dependencies can exceed one response: 25 orders can contain 2,500 lines.
export async function inventoryRelatedRows<T>(load:(from:number,to:number)=>PromiseLike<Rows<T>>):Promise<T[]>{
 const result:T[]=[]
 for(let from=0;;from+=500){const rows=requireRows(await load(from,from+499));result.push(...rows);if(rows.length<500)return result}
}
async function byIds<T>(ids:string[],load:(ids:string[])=>PromiseLike<Rows<T>>):Promise<T[]>{
 const unique=[...new Set(ids.filter(Boolean))];const chunks:string[][]=[]
 for(let i=0;i<unique.length;i+=100)chunks.push(unique.slice(i,i+100))
 return (await Promise.all(chunks.map(async chunk=>requireRows(await load(chunk))))).flat()
}
export async function inventoryContext(){
 const ctx=await requireCompanyRoleDalContext('super_admin','company_admin','manager')
 const access=await ctx.supabase.rpc('get_module_workspace_access',{company:ctx.companyId,product:'inventory'})
 if(access.error)throw new Error('Dostupnost skladu se nepodařilo ověřit.')
 return {...ctx,access:access.data as {can_read?:boolean;can_write?:boolean;can_export?:boolean}|null}
}
export async function getInventoryData(tab:string,q:string,page:number,warehouseId='',documentKind='',initialAction='',initialDocument=''):Promise<InventoryData|null>{
 if(warehouseId&&!uuidPattern.test(warehouseId))throw new Error('Neplatný sklad.')
 const ctx=await inventoryContext()
 if(!ctx.access?.can_read)return null
 const client=ctx.supabase;const c=ctx.companyId;const offset=(page-1)*inventoryPageSize;const term=inventorySearchTerm(q)
 const data:InventoryData={companyId:c,canWrite:ctx.access.can_write===true,items:[],warehouses:[],warehouseOptions:[],orders:[],orderLines:[],documents:[],suppliers:[],balances:[],movements:[],jobs:[],reservations:[],lots:[],total:0,page,q,tab,warehouseId,documentKind,initialAction,initialDocument}
 if(tab==='warehouses'){
  let query=client.from('gastro_warehouses').select('id,name,version,warehouse_kind,job_id,location,notes,archived',{count:'exact'}).eq('company_id',c)
  if(term)query=query.ilike('name',`%${term}%`)
  const result=await query.order('name').order('id').range(offset,offset+24)
  data.warehouses=requireRows(result);data.total=result.count??0
 }else if(tab==='stock'){
  let query=client.from('gastro_items').select(itemFields,{count:'exact'}).eq('company_id',c)
  if(term)query=query.or(`name.ilike.%${term}%,sku.ilike.%${term}%`)
  const result=await query.order('name').order('id').range(offset,offset+24)
  data.items=requireRows(result);data.total=result.count??0
  if(data.items.length)data.balances=await inventoryRelatedRows((from,to)=>client.from('gastro_stock_balances').select('item_id,warehouse_id,quantity,reserved,value_minor').eq('company_id',c).in('item_id',data.items.map(i=>i.id)).match(warehouseId?{warehouse_id:warehouseId}:{}).order('item_id').order('warehouse_id').range(from,to))
 }else if(tab==='orders'){
  const result=await client.from('inventory_orders').select('*',{count:'exact'}).eq('company_id',c).match(warehouseId?{warehouse_id:warehouseId}:{}).ilike('title',`%${term}%`).order('created_at',{ascending:false}).order('id').range(offset,offset+24)
  data.orders=requireRows(result);data.total=result.count??0
  if(data.orders.length)data.orderLines=await inventoryRelatedRows((from,to)=>client.from('inventory_order_lines').select('id,order_id,item_id,quantity,received,unit_cost_minor').eq('company_id',c).in('order_id',data.orders.map(o=>o.id)).order('id').range(from,to))
 }else if(tab==='documents'){
  let query=client.from('inventory_documents').select('*',{count:'exact'}).eq('company_id',c).ilike('reason',`%${term}%`)
  if(warehouseId)query=query.or(`warehouse_id.eq.${warehouseId},destination_id.eq.${warehouseId}`)
  if(documentKind)query=query.eq('kind',documentKind)
  if(initialDocument)query=query.eq('id',initialDocument)
  const result=await query.order('created_at',{ascending:false}).order('id').range(offset,offset+24)
  data.documents=requireRows(result);data.total=result.count??0
  data.orderLines=await byIds(data.documents.flatMap(d=>d.lines.flatMap(l=>l.line_id?[l.line_id]:[])),ids=>client.from('inventory_order_lines').select('id,order_id,item_id,quantity,received,unit_cost_minor').eq('company_id',c).in('id',ids))
 }else if(tab==='suppliers'){
  let query=client.from('inventory_suppliers').select('id,customer_id,customers!inner(name,email,phone)',{count:'exact'}).eq('company_id',c).eq('archived',false)
  if(term)query=query.ilike('customers.name',`%${term}%`)
  const result=await query.order('id').range(offset,offset+24)
  data.suppliers=requireRows(result) as unknown as InventoryData['suppliers'];data.total=result.count??0
 }else if(tab==='movements'){
  let query=client.from('gastro_stock_movements').select('id,item_id,warehouse_id,quantity,reference_kind,created_at,item:gastro_items!inner(name)',{count:'exact'}).eq('company_id',c).match(warehouseId?{warehouse_id:warehouseId}:{})
  if(term)query=query.ilike('item.name',`%${term}%`)
  const result=await query.order('created_at',{ascending:false}).order('id').range(offset,offset+24)
  data.movements=requireRows(result);data.total=result.count??0
 }else if(tab==='reservations'){
  let query=client.from('inventory_reservations').select('id,item_id,warehouse_id,job_id,quantity,item:gastro_items!inner(name)',{count:'exact'}).eq('company_id',c).match(warehouseId?{warehouse_id:warehouseId}:{}).is('released_at',null)
  if(term)query=query.ilike('item.name',`%${term}%`)
  const result=await query.order('created_at',{ascending:false}).order('id').range(offset,offset+24)
  data.reservations=requireRows(result);data.total=result.count??0
 }else if(tab==='valuation'){
  let query=client.from('gastro_stock_lots').select('id,item_id,warehouse_id,quantity,remaining,unit_cost_minor,item:gastro_items!inner(name)',{count:'exact'}).eq('company_id',c).match(warehouseId?{warehouse_id:warehouseId}:{})
  if(term)query=query.ilike('item.name',`%${term}%`)
  const result=await query.order('created_at',{ascending:false}).order('id').range(offset,offset+24)
  data.lots=requireRows(result);data.total=result.count??0
 }
 if(tab!=='stock')data.items=await byIds([
  ...data.orderLines.map(l=>l.item_id),...data.documents.flatMap(d=>d.lines.flatMap(l=>l.item_id?[l.item_id]:[])),
  ...data.movements.map(m=>m.item_id),...data.reservations.map(r=>r.item_id),...data.lots.map(l=>l.item_id),
 ],ids=>client.from('gastro_items').select(itemFields).eq('company_id',c).in('id',ids))
 // Include empty and archived warehouses so history and settings never lose their context.
 const warehouses=await inventoryRelatedRows<Warehouse>((from,to)=>client.from('gastro_warehouses').select('id,name,version,warehouse_kind,job_id,location,notes,archived').eq('company_id',c).order('name').order('id').range(from,to))
 if(warehouseId&&!warehouses.some(w=>w.id===warehouseId))throw new Error('Sklad není dostupný v aktivní firmě.')
 data.warehouseOptions=warehouses
 if(tab!=='warehouses')data.warehouses=warehouses
 data.jobs=await byIds([...data.reservations.map(r=>r.job_id),...data.documents.flatMap(d=>d.job_id?[d.job_id]:[]),...warehouses.flatMap(w=>w.job_id?[w.job_id]:[])],ids=>client.from('jobs').select('id,title').eq('company_id',c).in('id',ids))
 return data
}
