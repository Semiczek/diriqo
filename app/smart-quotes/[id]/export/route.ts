import { readWorkspace } from '@/lib/smart-quotes/server'
import { customerSnapshot } from '@/lib/smart-quotes/domain'
export async function GET(request:Request,{ params }:{params:Promise<{id:string}>}) {
  try {
    const { id }=await params
    const data=await readWorkspace(id, 'export')
    const versionParam=new URL(request.url).searchParams.get('version')
    const version=versionParam===null ? data.quote!.current_version : Number(versionParam)
    const snapshot=version===0 && versionParam===null ? customerSnapshot(data.quote!.draft,'') : data.versions?.find(v=>v.version===version)?.snapshot
    if(!snapshot) return Response.json({ error:'Verze není dostupná.' },{ status:404 })
    return new Response(JSON.stringify({ document:'Cenová nabídka',version,status:version===0?'Nevydaný návrh':undefined,snapshot },null,2),{ headers:{ 'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="nabidka-${id}-v${version}.json"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff' } })
  } catch { return Response.json({error:'Export není dostupný.'},{status:403}) }
}
