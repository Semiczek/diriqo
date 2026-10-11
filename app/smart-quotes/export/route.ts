import { readWorkspace } from '@/lib/smart-quotes/server'
export async function GET() {
  try {
    const data=await readWorkspace(undefined, 'export')
    return Response.json({ exportedAt:new Date().toISOString(),companyId:data.companyId,templates:data.templates,library:data.library,quotes:data.quotes },{
      headers:{'Content-Disposition':'attachment; filename="chytre-nabidky-interni-knihovna.json"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'},
    })
  } catch { return Response.json({error:'Export není dostupný.'},{status:403}) }
}
