import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({context:vi.fn(),rpc:vi.fn(),from:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/dal/auth',()=>({requireCompanyRoleDalContext:mocks.context}))
import { getInventoryData, inventoryRelatedRows } from '../lib/inventory/data'
import { GET as lookup } from '../app/inventory/lookup/route'

type Row=Record<string,unknown>
type Query={table:string;equal:[string,unknown][];included:[string,string[]][];from:number;to:number;search:string;select:ReturnType<typeof vi.fn>;eq:ReturnType<typeof vi.fn>;in:ReturnType<typeof vi.fn>;order:ReturnType<typeof vi.fn>;range:ReturnType<typeof vi.fn>;ilike:ReturnType<typeof vi.fn>;or:ReturnType<typeof vi.fn>;is:ReturnType<typeof vi.fn>;then:PromiseLike<{data:Row[];error:null;count:number}>['then']}
const queries:Query[]=[]
let records:Record<string,Row[]>
const company='test-company'
beforeEach(()=>{
 vi.clearAllMocks();queries.length=0;records={}
 mocks.context.mockResolvedValue({companyId:company,supabase:{rpc:mocks.rpc,from:mocks.from}})
 mocks.rpc.mockResolvedValue({data:{can_read:true,can_write:true},error:null})
 mocks.from.mockImplementation((table:string)=>{
  const query:Query={table,equal:[],included:[],from:0,to:Infinity,search:'',select:vi.fn(),eq:vi.fn(),in:vi.fn(),order:vi.fn(),range:vi.fn(),ilike:vi.fn(),or:vi.fn(),is:vi.fn(),then(resolve,reject){
   let data=records[table]??[]
   for(const [key,ids] of query.included)data=data.filter(row=>ids.includes(String(row[key])))
   return Promise.resolve({data:data.slice(query.from,query.to+1),error:null,count:data.length}).then(resolve,reject)
  }}
  query.select.mockReturnValue(query);query.eq.mockImplementation((key,value)=>{query.equal.push([key,value]);return query});query.in.mockImplementation((key,values)=>{query.included.push([key,values]);return query})
  query.order.mockReturnValue(query);query.range.mockImplementation((from,to)=>{query.from=from;query.to=to;return query});query.ilike.mockReturnValue(query);query.is.mockReturnValue(query);query.or.mockImplementation(value=>{query.search=value;return query})
  queries.push(query);return query
 })
})

describe('inventory lookup boundary',()=>{
 it('rejects a stale company selector without reading business rows',async()=>{
  const response=await lookup(new Request('https://example.invalid/inventory/lookup?company=other&kind=items'))
  expect(response.status).toBe(409);expect(mocks.from).not.toHaveBeenCalled()
 })
 it('denies a missing history entitlement and invalid paging',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{can_read:false},error:null})
  expect((await lookup(new Request(`https://example.invalid/inventory/lookup?company=${company}&kind=items`))).status).toBe(403)
  expect((await lookup(new Request(`https://example.invalid/inventory/lookup?company=${company}&kind=items&page=1.5`))).status).toBe(400)
  expect(mocks.from).not.toHaveBeenCalled()
 })
 it('searches and pages active stock choices under the authenticated company',async()=>{
  records.gastro_items=Array.from({length:30},(_,i)=>({id:`item-${i}`,name:`Screw ${i}`,sku:`SKU-${i}`,unit:'ks'}))
  const response=await lookup(new Request(`https://example.invalid/inventory/lookup?company=${company}&kind=items&page=2&q=screw`))
  const body=await response.json()
  expect(response.status).toBe(200);expect(body.options).toHaveLength(5);expect(body.total).toBe(30);expect(body.companyId).toBe(company)
  expect(queries[0].equal).toEqual([['company_id',company],['kind','stock'],['archived',false]])
  expect(queries[0].search).toBe('name.ilike.%screw%,sku.ilike.%screw%')
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
 })
})

describe('inventory page dependencies',()=>{
 it('loads every line for the current 25 orders beyond the API response cap, without unrelated orders',async()=>{
  records.inventory_orders=Array.from({length:26},(_,i)=>({id:`order-${i}`,warehouse_id:'warehouse'}))
  records.inventory_order_lines=Array.from({length:1201},(_,i)=>({id:`line-${i}`,order_id:`order-${i%25}`,item_id:`item-${i}`}))
  records.inventory_order_lines.push({id:'foreign-page-line',order_id:'order-25',item_id:'unrelated'})
  records.gastro_items=records.inventory_order_lines.map(line=>({id:line.item_id,name:line.item_id}))
  const data=await getInventoryData('orders','',1)
  expect(data?.orders).toHaveLength(25);expect(data?.orderLines).toHaveLength(1201);expect(data?.items).toHaveLength(1201)
  expect(data?.orderLines.some(line=>line.id==='foreign-page-line')).toBe(false)
  const lineQueries=queries.filter(q=>q.table==='inventory_order_lines')
  expect(lineQueries).toHaveLength(3)
  expect(lineQueries.map(q=>q.from)).toEqual([0,500,1000])
  for(const q of queries)expect(q.equal).toContainEqual(['company_id',company])
  for(const q of lineQueries)expect(q.included[0][1]).not.toContain('order-25')
 })
 it('searches the full item catalog on the server and fetches balances only for the requested page',async()=>{
  records.gastro_items=Array.from({length:30},(_,i)=>({id:`item-${i}`,name:`Name ${i}`}))
  records.gastro_stock_balances=[{item_id:'item-0',warehouse_id:'warehouse-a'},{item_id:'item-29',warehouse_id:'warehouse-b'}]
  const data=await getInventoryData('stock','screw',2)
  expect(data?.items).toHaveLength(5);expect(data?.total).toBe(30)
  expect(queries[0].search).toBe('name.ilike.%screw%,sku.ilike.%screw%')
  expect(data?.balances).toEqual([{item_id:'item-29',warehouse_id:'warehouse-b'}])
  expect(queries.some(q=>q.table==='inventory_orders')).toBe(false)
 })
 it('resolves receipt item names from referenced order lines outside the current order page',async()=>{
  records.inventory_documents=[{id:'receipt',warehouse_id:'warehouse',lines:[{line_id:'old-line',quantity:1}]}]
  records.inventory_order_lines=[{id:'old-line',order_id:'old-order',item_id:'old-item'}]
  records.gastro_items=[{id:'old-item',name:'Older material'}]
  const data=await getInventoryData('documents','',1)
  expect(data?.items[0].name).toBe('Older material')
  expect(data?.orderLines[0].id).toBe('old-line')
 })
 it('returns the correct total and page for valuation, not the document count',async()=>{
  records.gastro_stock_lots=Array.from({length:51},(_,i)=>({id:`lot-${i}`,item_id:'item',warehouse_id:'warehouse'}))
  records.inventory_documents=Array.from({length:2},(_,i)=>({id:String(i)}))
  const data=await getInventoryData('valuation','',3)
  expect(data?.lots.map(l=>l.id)).toEqual(['lot-50']);expect(data?.total).toBe(51)
 })
 it('fails closed instead of showing a partially loaded dependency',async()=>{
  const load=vi.fn().mockResolvedValueOnce({data:Array(500).fill({id:'row'}),error:null}).mockResolvedValueOnce({data:null,error:{message:'failed'}})
  await expect(inventoryRelatedRows(load)).rejects.toThrow('nepodařilo načíst')
 })
})
