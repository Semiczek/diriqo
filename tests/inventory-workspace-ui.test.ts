import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe,expect,it,vi } from 'vitest'
vi.stubGlobal('React',React)
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}))
vi.mock('../app/inventory/actions',()=>({inventoryCommand:vi.fn(),createReviewedInventoryReceipt:vi.fn()}))
import InventoryClient from '../app/inventory/InventoryClient'
import ReviewedReceipt from '../app/inventory/ReviewedReceipt'
import type { InventoryData,Warehouse } from '../lib/inventory/data'
import type { OcrResult } from '../lib/diriqent/domain'
const id='10000000-0000-4000-8000-000000000002'
const warehouse:Warehouse={id,name:'Hlavní sklad',version:1,warehouse_kind:'main',job_id:null,location:'Provozovna',notes:'',archived:false}
const data:InventoryData={companyId:'10000000-0000-4000-8000-000000000001',canWrite:true,items:[],warehouses:[warehouse],warehouseOptions:[warehouse],orders:[],orderLines:[],documents:[],suppliers:[],balances:[],movements:[],jobs:[],reservations:[],lots:[],total:0,page:1,q:'',tab:'stock',warehouseId:id,documentKind:'',initialAction:'',initialDocument:''}
const render=(change:Partial<InventoryData>={})=>renderToStaticMarkup(React.createElement(InventoryClient,{data:{...data,...change}}))
describe('inventory workspace UI rendering',()=>{
 it('shows empty warehouses and makes receipt/issue/transfer reachable from stock',()=>{const html=render();for(const text of ['Vybrat sklad','Hlavní sklad','Přijmout zboží','Vydat na zakázku','Převést mezi sklady','Nastavení skladů'])expect(html).toContain(text);expect(html).toContain('warehouse='+id)})
 it('shows saved warehouse kinds, locations and archive actions in settings',()=>{const html=render({tab:'warehouses'});expect(html).toContain('Vaše sklady');expect(html).toContain('Provozovna');expect(html).toContain('Upravit nastavení');expect(html).toContain('3 aktivní sklady')})
 it('opens the receipt form with selected warehouse and explicit draft submit',()=>{const html=render({initialAction:'receipt'});expect(html).toContain('value="'+id+'"');expect(html).toContain('Uložit koncept');expect(html).toContain('name="unit_cost"')})
 it('hides new-operation controls in history-only mode',()=>{const html=render({canWrite:false});expect(html).toContain('Licence není aktivní');expect(html).not.toContain('Přijmout zboží');expect(html).not.toContain('+ Nová položka')})
 it('preserves selected warehouse and transfer filter in next-page link and export',()=>{const html=render({tab:'documents',documentKind:'transfer',total:26});expect(html).toContain('kind=documents&amp;warehouse='+id+'&amp;documentKind=transfer');expect(html).toContain('page=2&amp;kind=transfer')})
 it('does not prefill OCR prices whose VAT/currency basis is uncertain',()=>{const result:OcrResult={documentType:'DL',supplierName:'Supplier',documentNumber:'123',date:null,currency:'EUR',total:20,warnings:[],extractedText:'',items:[{name:'Material',quantity:2,unit:'kg',unitPrice:10,vatRate:21,total:20,confidence:'high',source:'line1'}]};const html=renderToStaticMarkup(React.createElement(ReviewedReceipt,{companyId:data.companyId,operationId:id,result,warehouseId:id}));expect(html).toContain('Ceny převeďte do Kč');expect(html).toContain('Uložit koncept příjemky');expect(html).not.toContain('name="cost-0" value="10"');expect(html).toContain('name="checked"')})
})