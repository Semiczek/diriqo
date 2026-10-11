import {aiError,startAi} from '@/lib/diriqent/server'
import {isAiKind,MAX_FILE_BYTES} from '@/lib/diriqent/domain'
export const runtime='nodejs'
export const maxDuration=60
export async function POST(request:Request) {
  try {
    const origin=request.headers.get('origin')
    if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Neplatný původ požadavku.'},{status:403})
    if(!request.body)throw new Error('Chybí soubor.')
    const reader=request.body.getReader(),chunks:Uint8Array[]=[];let total=0
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_FILE_BYTES+65536){await reader.cancel();return Response.json({error:'Soubor je příliš velký.'},{status:413})}chunks.push(value)}
    const body=new Uint8Array(total);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length}
    const form=await new Response(body,{headers:{'Content-Type':request.headers.get('content-type')??''}}).formData()
    const kind=form.get('kind'),file=form.get('file')
    if(!isAiKind(kind)||!kind.endsWith('.ocr')||!(file instanceof File))throw new Error('Vyberte doménu OCR a obrázek.')
    const value=await startAi({companyId:String(form.get('companyId')),requestId:String(form.get('requestId')),kind,prompt:String(form.get('prompt')??'Přečti položky tohoto podkladu.'),conversationId:null,maxUnits:Number(form.get('maxUnits'))},file)
    return Response.json({ok:true,value},{headers:{'Cache-Control':'no-store'}})
  }catch(error){return Response.json({ok:false,error:aiError(error)},{status:400})}
}
