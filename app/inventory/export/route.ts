import { NextRequest } from 'next/server'
import { requireCompanyRoleDalContext } from '@/lib/dal/auth'
const tables:Record<string,{table:string;columns:string}>={
 stock:{table:'gastro_stock_balances',columns:'item_id,warehouse_id,quantity,reserved,value_minor'},
 documents:{table:'inventory_documents',columns:'id,kind,status,reason,created_at,posted_at'},
 orders:{table:'inventory_orders',columns:'id,title,status,warehouse_id,created_at'},
 suppliers:{table:'inventory_suppliers',columns:'id,customer_id,archived'},
 movements:{table:'gastro_stock_movements',columns:'id,item_id,warehouse_id,quantity,unit_cost_minor,reference_kind,reference_id,created_at'},
 reservations:{table:'inventory_reservations',columns:'id,item_id,warehouse_id,job_id,quantity,released_at'},
 valuation:{table:'gastro_stock_lots',columns:'id,item_id,warehouse_id,quantity,remaining,unit_cost_minor'},
}
export async function GET(request:NextRequest){
 try{
  const ctx=await requireCompanyRoleDalContext('super_admin','company_admin','manager')
  const access=await ctx.supabase.rpc('get_module_workspace_access',{company:ctx.companyId,product:'inventory'})
  if(access.error||!access.data?.can_export)return new Response('Pro export potřebujete oprávnění k exportu skladu.',{status:403})
  const kind=request.nextUrl.searchParams.get('kind')??'movements';const source=tables[kind]
  if(!source)return new Response('Neplatný typ exportu.',{status:400})
  const rows:Record<string,unknown>[]=[]
  for(let offset=0;offset<10000;offset+=1000){
   let query=ctx.supabase.from(source.table).select(source.columns,{count:'exact'}).eq('company_id',ctx.companyId)
   query=kind==='stock'?query.order('warehouse_id').order('item_id'):query.order('id')
   const result=await query.range(offset,offset+999)
   if(result.error)return new Response('Export se nepodařilo vytvořit.',{status:503})
   if((result.count??0)>10000)return new Response('Export obsahuje přes 10 000 řádků. Požádejte správce o export období.',{status:413})
   rows.push(...(result.data??[]) as unknown as Record<string,unknown>[])
   if((result.data?.length??0)<1000)break
  }
  const columns=source.columns.split(',')
  const cell=(value:unknown)=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"'
  const csv='\uFEFF'+[columns.join(';'),...rows.map(row=>columns.map(c=>cell(row[c])).join(';'))].join('\r\n')
  return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="sklad-${kind}.csv"`,'Cache-Control':'private, no-store'}})
 }catch{return new Response('K exportu nemáte přístup.',{status:403})}
}
