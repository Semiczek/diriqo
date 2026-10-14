import {aiContext} from '@/lib/diriqent/server'
import {isAiKind} from '@/lib/diriqent/domain'
import {assertDiriqentPolicy,assertDiriqentRecords} from '@/lib/diriqent/access'
export async function GET(request:Request) {
  try {
    const query=new URL(request.url).searchParams,kind=query.get('kind')??'chat'
    if(!isAiKind(kind))return Response.json({error:'Neplatná doména.'},{status:400})
    const ctx=await aiContext(),operation=query.get('operation')
    if(operation&&!/^[0-9a-f-]{36}$/i.test(operation))return Response.json({error:'Neplatný výsledek.'},{status:400})
    const {data,error}=await ctx.supabase.rpc('diriqent_export',{c:ctx.companyId,k:kind,operation})
    if(error){if(error.message.includes('AI_EXPORT_LIMIT'))return Response.json({error:'Historie má více než 1000 záznamů. Exportujte jednotlivé výsledky.'},{status:413,headers:{'Cache-Control':'private, no-store'}});throw error}
    assertDiriqentPolicy(data)
    assertDiriqentRecords(ctx.role,data.operations)
    assertDiriqentRecords(ctx.role,data.proposals)
    return Response.json({exportedAt:new Date().toISOString(),...data},{headers:{'Content-Disposition':'attachment; filename="diriqent-soukroma-historie.json"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
  }catch{return Response.json({error:'Historie nebo oprávnění k jejímu exportu není dostupné.'},{status:403,headers:{'Cache-Control':'private, no-store'}})}
}
