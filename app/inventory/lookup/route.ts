import { inventoryContext, inventorySearchTerm } from '@/lib/inventory/data'

export async function GET(request:Request){
 try{
  const ctx=await inventoryContext()
  if(!ctx.access?.can_read)return Response.json({error:'Sklad není dostupný.'},{status:403})
  const params=new URL(request.url).searchParams
  if(params.get('company')!==ctx.companyId)return Response.json({error:'Aktivní firma se změnila. Obnovte stránku.'},{status:409})
  const kind=params.get('kind');const term=inventorySearchTerm(params.get('q')??'')
  const requested=Number(params.get('page')??1)
  if(!Number.isSafeInteger(requested)||requested<1||requested>10000)return Response.json({error:'Neplatná stránka.'},{status:400})
  const offset=(requested-1)*25;const client=ctx.supabase;const company=ctx.companyId
  let result:{data:unknown[]|null;error:unknown;count:number|null}
  let options:{id:string;name:string}[]=[]
  if(kind==='items'){
   let query=client.from('gastro_items').select('id,name,sku,unit',{count:'exact'}).eq('company_id',company).eq('kind','stock').eq('archived',false)
   if(term)query=query.or(`name.ilike.%${term}%,sku.ilike.%${term}%`)
   const response=await query.order('name').order('id').range(offset,offset+24);result=response
   options=(response.data??[]).map(item=>({id:item.id,name:`${item.name}${item.sku?` · ${item.sku}`:''} (${item.unit})`}))
  }else if(kind==='suppliers'){
   let query=client.from('inventory_suppliers').select('id,customers!inner(name)',{count:'exact'}).eq('company_id',company).eq('archived',false)
   if(term)query=query.ilike('customers.name',`%${term}%`)
   const response=await query.order('id').range(offset,offset+24);result=response
   options=(response.data??[]).map(item=>({id:item.id,name:(item.customers as unknown as {name:string}).name}))
  }else if(kind==='jobs'){
   const response=await client.from('jobs').select('id,title',{count:'exact'}).eq('company_id',company).ilike('title',`%${term}%`).order('created_at',{ascending:false}).order('id').range(offset,offset+24);result=response
   options=(response.data??[]).map(item=>({id:item.id,name:item.title||'Zakázka'}))
  }else if(kind==='warehouses'){
   const response=await client.from('gastro_warehouses').select('id,name',{count:'exact'}).eq('company_id',company).eq('archived',false).ilike('name',`%${term}%`).order('name').order('id').range(offset,offset+24);result=response
   options=response.data??[]
  }else return Response.json({error:'Neplatný výběr.'},{status:400})
  if(result.error)throw new Error('lookup_failed')
  return Response.json({options,total:result.count??0,page:requested,companyId:company},{headers:{'Cache-Control':'private, no-store'}})
 }catch{return Response.json({error:'Výběr se nepodařilo načíst. Zkuste to znovu.'},{status:403})}
}
