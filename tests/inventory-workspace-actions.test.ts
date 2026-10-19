import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({context:vi.fn(),rpc:vi.fn(),read:vi.fn(),revalidate:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/dal/auth',()=>({requireCompanyRoleDalContext:mocks.context}))
vi.mock('@/lib/diriqent/server',()=>({readOwnAiOperation:mocks.read}))
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}))
import { inventoryCommand,createReviewedInventoryReceipt } from '../app/inventory/actions'
import { inventoryHref,validateWarehouseSettings } from '../lib/inventory/domain'
const company='10000000-0000-4000-8000-000000000001',warehouse='10000000-0000-4000-8000-000000000002',operation='10000000-0000-4000-8000-000000000003',item='10000000-0000-4000-8000-000000000004'
const settings={id:null,name:'Hlavní sklad',warehouse_kind:'main',job_id:null,location:'Provozovna',notes:'',archived:false}
const draft={warehouse_id:warehouse,reason:'DL 2026',lines:[{item_id:item,quantity:'2.500',unit_cost_minor:1234}]}
beforeEach(()=>{vi.clearAllMocks();mocks.context.mockResolvedValue({companyId:company,supabase:{rpc:mocks.rpc}});mocks.rpc.mockResolvedValue({data:{id:warehouse},error:null});mocks.read.mockResolvedValue({company_id:company,kind:'inventory.ocr',state:'completed',result:{items:[]}})})
describe('warehouse settings boundaries',()=>{
 it('creates settings through guarded warehouse RPC without requiring an update version',async()=>{expect((await inventoryCommand(company,'warehouse',settings,operation)).ok).toBe(true);expect(mocks.rpc).toHaveBeenCalledWith('inventory_warehouse_write',{company,payload:settings,request_id:operation})})
 it('denies a stale active company without calling the database',async()=>{mocks.context.mockResolvedValue({companyId:warehouse,supabase:{rpc:mocks.rpc}});expect((await inventoryCommand(company,'warehouse',settings,operation)).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled()})
 it.each([{warehouse_kind:'job',job_id:null},{warehouse_kind:'mobile',job_id:item},{warehouse_kind:'unknown'},{name:''},{location:'x'.repeat(301)},{notes:'x'.repeat(1001)},{archived:'true'},{id:warehouse},{id:warehouse,version:0}])('rejects invalid settings %j',delta=>expect(()=>validateWarehouseSettings({...settings,...delta})).toThrow())
 it('keeps a selected warehouse through navigation and encodes search terms',()=>{const url=new URL(inventoryHref('documents',warehouse,{kind:'transfer',q:'A&B'}),'https://example.invalid');expect(url.searchParams.get('warehouse')).toBe(warehouse);expect(url.searchParams.get('q')).toBe('A&B');expect(url.searchParams.get('kind')).toBe('transfer')})
})
describe('reviewed OCR receipt',()=>{
 it('requires explicit human review before reading the source',async()=>{expect((await createReviewedInventoryReceipt(company,operation,draft,false)).ok).toBe(false);expect(mocks.read).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled()})
 it.each([{company_id:warehouse},{kind:'invoicing.ocr'},{state:'running'},{result:null}])('denies unavailable or wrong source %j',async(delta)=>{mocks.read.mockResolvedValue({company_id:company,kind:'inventory.ocr',state:'completed',result:{},...delta});expect((await createReviewedInventoryReceipt(company,operation,draft,true)).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('surfaces inaccessible own-operation failure without any inventory mutation',async()=>{mocks.read.mockRejectedValue(new Error('forbidden'));expect((await createReviewedInventoryReceipt(company,operation,draft,true)).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('creates only a draft and binds the reviewed source, never a post operation',async()=>{expect((await createReviewedInventoryReceipt(company,operation,{...draft,kind:'issue',job_id:item},true)).ok).toBe(true);expect(mocks.read).toHaveBeenCalledWith(company,operation);const [rpc,args]=mocks.rpc.mock.calls[0];expect(rpc).toBe('inventory_write');expect(args.operation).toBe('document');expect(args.payload).toEqual({...draft,kind:'receipt',reason:'DL 2026 | OCR '+operation});expect(mocks.rpc).toHaveBeenCalledTimes(1)})
 it('uses one stable request id across retries and changed user input',async()=>{await createReviewedInventoryReceipt(company,operation,draft,true);await createReviewedInventoryReceipt(company,operation,{...draft,reason:'Changed'},true);expect(mocks.rpc.mock.calls[0][1].request_id).toBe(mocks.rpc.mock.calls[1][1].request_id)})
 it('rejects duplicate item mapping and malformed line identities',async()=>{expect((await createReviewedInventoryReceipt(company,operation,{...draft,lines:[draft.lines[0],draft.lines[0]]},true)).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled()})
})