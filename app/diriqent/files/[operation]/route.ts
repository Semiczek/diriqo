import {aiContext,sourceUrl} from '@/lib/diriqent/server'
export async function GET(_request:Request,{params}:{params:Promise<{operation:string}>}) {
  try{const [{operation},ctx]=await Promise.all([params,aiContext()]);return new Response(null,{status:302,headers:{Location:await sourceUrl(ctx.companyId,operation),'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}})}catch{return Response.json({error:'Originál není dostupný.'},{status:403,headers:{'Cache-Control':'no-store'}})}
}
