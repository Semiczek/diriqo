import 'server-only'
import {createHash} from 'node:crypto'
import {requireCompanyRoleDalContext} from '@/lib/dal/auth'
import {createSupabaseAdminClient} from '@/lib/supabase-admin'
import {quoteError} from '@/lib/smart-quotes/server'
import {detectDocumentType,imageDimensions,isAiKind,MAX_FILE_BYTES,MAX_PROMPT,parseChatResult,parseOcrResult,type AiKind,type ChatResult,type OcrResult,type JobDraft} from './domain'
import {createResponse,providerConfigured,ProviderRejectedError,requestBody,responseText,responseUsage,retrieveResponse,type ProviderResponse} from './provider'

export type Operation={id:string;company_id:string;profile_id:string;conversation_id:string|null;kind:AiKind;prompt:string;state:'reserved'|'running'|'unknown'|'completed'|'failed';reserved_units:number;charged_units:number;result:ChatResult|OcrResult|null;source_name:string|null;source_path:string|null;source_mime:string|null;created_at:string;error_code:string|null;context_snapshot:{scope?:string;asOf?:string;jobs?:{id:string;title:string}[];customers?:{id:string;name:string}[]}|null;providerResponseId?:string;providerAttemptId?:string}
export type Proposal={operation_id:string;payload:JobDraft&{customerName?:string|null};payload_hash:string;expires_at:string;job_id:string|null}
export type AiWorkspace={companyId:string;profileId:string;roleScope:string|null;canRun:boolean;canCreateJobs:boolean;availableUnits:number;rateVersion:string;conversations:{id:string;title:string}[];operations:Operation[];proposals:Proposal[]}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function aiContext(expectedCompanyId?:string) {
  const context=await requireCompanyRoleDalContext('super_admin','company_admin','manager','worker')
  if(expectedCompanyId!==undefined&&context.companyId!==expectedCompanyId)throw new Error('Aktivní firma se změnila. Obnovte stránku.')
  return context
}
export function aiError(error:unknown){
  const message=error instanceof Error?error.message:'Požadavek se nepodařilo dokončit.'
  if(/SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|NEXT_PUBLIC_SUPABASE/.test(message))return 'AI služba čeká na dokončení serverové konfigurace. Kredit se nyní nespotřebuje.'
  if(message.includes('MODULE_REQUIRED'))return 'Pro tuto službu potřebujete její aktivní modul a oprávnění k historii. Kredit sám modul neodemkne.'
  return quoteError(error)
}
export function publicOperation(operation:Operation):Operation {
  // Provider identifiers remain server-side; an operation ID only identifies this own-company record.
  const {providerResponseId,providerAttemptId,...safe}=operation
  void providerResponseId;void providerAttemptId
  return safe
}
export async function aiWorkspace(kind:AiKind='chat'):Promise<AiWorkspace> {
  const ctx=await aiContext()
  const {data,error}=await ctx.supabase.rpc('diriqent_read',{c:ctx.companyId,k:kind})
  if(error)throw new Error(error.message)
  return {...data,roleScope:ctx.role,canCreateJobs:['super_admin','company_admin'].includes(ctx.role??'')} as AiWorkspace
}
async function ownOperation(ctx:Awaited<ReturnType<typeof aiContext>>,id:string):Promise<Operation> {
  if(!UUID.test(id))throw new Error('Neplatný požadavek.')
  const {data,error}=await ctx.supabase.rpc('diriqent_operation',{c:ctx.companyId,operation:id})
  if(error||!data)throw new Error(error?.message??'Požadavek není dostupný.')
  return data as Operation
}
export async function readOwnAiOperation(companyId:string,id:string) {
  return ownOperation(await aiContext(companyId),id)
}
async function settle(operation:Operation,attemptId:string,response:ProviderResponse) {
  const usage=responseUsage(response)
  if(!usage)return // Unknown actual usage stays reserved for reconciliation; never invent zero cost.
  let result:ChatResult|OcrResult|null=null
  let errorCode:string|null=null
  try {
    if(response.status!=='completed')throw new Error('provider_incomplete')
    result=operation.kind.endsWith('.ocr')?parseOcrResult(responseText(response)):parseChatResult(responseText(response))
  } catch {errorCode='unusable_result'}
  const {error}=await createSupabaseAdminClient().rpc('diriqent_settle',{operation:operation.id,attempt:attemptId,result,success:result!==null,input_tokens:usage.inputTokens,output_tokens:usage.outputTokens,cached_tokens:usage.cachedTokens,error_code:errorCode})
  if(error)throw new Error('Výsledek je připravený, ale vypořádání se ještě nepodařilo ověřit. Použijte Ověřit výsledek.')
}
export type StartInput={companyId:string;requestId:string;kind:AiKind;prompt:string;conversationId:string|null;maxUnits:number}
export async function startAi(input:StartInput,file?:File):Promise<Operation> {
  const ctx=await aiContext(input.companyId)
  if(!providerConfigured())throw new Error('AI služba zatím nemá nastavený serverový klíč.')
  const admin=createSupabaseAdminClient()
  if(!isAiKind(input.kind)||!UUID.test(input.requestId)||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>MAX_PROMPT||!Number.isSafeInteger(input.maxUnits)||input.maxUnits<100||input.maxUnits>5000)throw new Error('Zkontrolujte zadání a limit od 1 do 50 Kč.')
  if(input.conversationId&&!UUID.test(input.conversationId))throw new Error('Neplatný rozhovor.')
  const ocr=input.kind.endsWith('.ocr')
  let bytes:Buffer|undefined,mime:string|undefined
  if(ocr) {
    if(!file||file.size===0||file.size>MAX_FILE_BYTES)throw new Error('Vyberte obrázek do 3 MB.')
    bytes=Buffer.from(await file.arrayBuffer());mime=detectDocumentType(bytes)??undefined
    if(!mime||mime==='application/pdf')throw new Error('Použijte jednu stránku jako obrázek PNG, JPEG nebo WebP.')
    const dimensions=imageDimensions(bytes,mime)
    if(!dimensions||dimensions.width<1||dimensions.height<1||dimensions.width>4096||dimensions.height>4096||dimensions.width*dimensions.height>4200000)throw new Error('Použijte čitelný obrázek do 4 megapixelů a rozměru nejvýše 4096 px.')
  } else if(file)throw new Error('Přílohu zpracujte v samostatném OCR.')
  const fingerprint=createHash('sha256').update(JSON.stringify({kind:input.kind,prompt:input.prompt,conversationId:input.conversationId,maxUnits:input.maxUnits,fileHash:bytes?createHash('sha256').update(bytes).digest('hex'):null})).digest('hex')
  const {data:reserved,error:reserveError}=await ctx.supabase.rpc('diriqent_reserve',{c:ctx.companyId,request_id:input.requestId,k:input.kind,conversation:input.conversationId,prompt:input.prompt.trim(),fingerprint,max_units:input.maxUnits,source_name:file?.name.slice(0,160)??null})
  if(reserveError)throw new Error(reserveError.message)
  const operation=reserved as Operation
  const {data:claim,error:claimError}=await admin.rpc('diriqent_provider_claim',{operation:operation.id,c:ctx.companyId,p:ctx.profileId})
  if(claimError){await ctx.supabase.rpc('diriqent_cancel_unstarted',{c:ctx.companyId,operation:operation.id});throw new Error(claimError.message)}
  if(!claim.claimed)return publicOperation(await ownOperation(ctx,operation.id))
  const attemptId=String(claim.attemptId)
  let sourcePath:string|null=null
  let externalStarted=false
  try {
    if(bytes&&mime) {
      const ext=mime==='image/png'?'png':mime==='image/jpeg'?'jpg':'webp'
      sourcePath=`${ctx.companyId}/${ctx.profileId}/${operation.id}/source.${ext}`
      const upload=await admin.storage.from('diriqent-documents').upload(sourcePath,bytes,{contentType:mime,upsert:false})
      if(upload.error)throw new Error('Podklad se nepodařilo bezpečně uložit.')
    }
    const body=requestBody(input.kind,input.prompt.trim(),claim.context,claim.history,bytes&&mime?{mime,base64:bytes.toString('base64')}:undefined)
    externalStarted=true
    const response=await createResponse(operation.id,body)
    if(!/^resp_[a-zA-Z0-9_-]+$/.test(response.id))throw new Error('Poskytovatel nevrátil ověřitelnou referenci.')
    const record=await admin.rpc('diriqent_provider_record',{operation:operation.id,attempt:attemptId,response_id:response.id,source_path:sourcePath,source_mime:mime??null})
    if(record.error)throw new Error('Nepodařilo se uložit referenci výsledku.')
    if(['completed','failed','cancelled','incomplete'].includes(response.status))await settle(operation,attemptId,response)
  } catch(error) {
    if(!externalStarted||error instanceof ProviderRejectedError) {
      const failed=await admin.rpc('diriqent_settle',{operation:operation.id,attempt:attemptId,result:null,success:false,input_tokens:0,output_tokens:0,cached_tokens:0,error_code:externalStarted?'provider_rejected':'source_upload_failed'})
      if(failed.error)throw new Error('Kreditní rezervaci je nutné ověřit. Požadavek znovu neposílejte.')
    } else {
      // A known response ID may already exist. Never erase it or repeat the provider POST.
      const existing=await ownOperation(ctx,operation.id)
      if(!existing.providerResponseId)await admin.rpc('diriqent_provider_record',{operation:operation.id,attempt:attemptId,response_id:null,source_path:sourcePath,source_mime:mime??null})
    }
  }
  return publicOperation(await ownOperation(ctx,operation.id))
}
export async function pollAi(companyId:string,id:string):Promise<Operation> {
  const ctx=await aiContext(companyId)
  const operation=await ownOperation(ctx,id)
  if(operation.state==='completed'||operation.state==='failed')return publicOperation(operation)
  if(operation.state==='reserved'){
    const {error}=await ctx.supabase.rpc('diriqent_cancel_unstarted',{c:ctx.companyId,operation:id})
    if(error)throw new Error(error.message)
    return publicOperation(await ownOperation(ctx,id))
  }
  if(operation.providerResponseId&&operation.providerAttemptId) {
    const response=await retrieveResponse(operation.providerResponseId)
    if(['completed','failed','cancelled','incomplete'].includes(response.status))await settle(operation,operation.providerAttemptId,response)
  }
  return publicOperation(await ownOperation(ctx,id))
}
export async function sourceUrl(companyId:string,id:string) {
  const ctx=await aiContext(companyId),operation=await ownOperation(ctx,id)
  if(!operation.source_path||!operation.source_path.startsWith(`${ctx.companyId}/${ctx.profileId}/${id}/`))throw new Error('Originál není dostupný.')
  const {data,error}=await createSupabaseAdminClient().storage.from('diriqent-documents').createSignedUrl(operation.source_path,60)
  if(error||!data.signedUrl)throw new Error('Originál nyní nelze otevřít.')
  return data.signedUrl
}
