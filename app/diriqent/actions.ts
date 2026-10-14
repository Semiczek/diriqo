'use server'
import {revalidatePath} from 'next/cache'
import {aiContext,aiError,pollAi,readOwnAiOperation,startAi,type Operation,type Proposal,type StartInput} from '@/lib/diriqent/server'
import {validateJobDraft} from '@/lib/diriqent/domain'
import {validateDraft} from '@/lib/smart-quotes/domain'
import {runQuoteCommand} from '@/app/smart-quotes/actions'
import {answerSupport,type SupportAnswer} from '@/lib/diriqent/support'
import {advancedWorkMode,type WorkMode} from '@/lib/diriqent/work'
type Result<T>={ok:true;value:T}|{ok:false;error:string}
export async function startChat(input:StartInput):Promise<Result<Operation>|{ok:true;support:SupportAnswer}|{ok:true;advanced:WorkMode}> {
  try {
    if(!input || (input.kind!=='chat'&&input.kind!=='proposal'))throw new Error('Použijte formulář OCR.')
    if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>4000)throw new Error('Vyplňte zadání do 4 000 znaků.')
    const context=await aiContext(input.companyId)
    const guide=answerSupport(input.prompt,context.role)
    // Even in the paid workspace, a known how-to must not spend a credit reservation.
    if(guide.kind!=='needs_data')return {ok:true,support:guide}
    const advanced=advancedWorkMode(input.prompt)
    if(advanced)return {ok:true,advanced}
    const value=await startAi(input)
    revalidatePath('/diriqent')
    return {ok:true,value}
  }catch(error){return {ok:false,error:aiError(error)}}
}
export async function checkAiOperation(companyId:string,id:string):Promise<Result<Operation>> {
  try{return {ok:true,value:await pollAi(companyId,id)}}catch(error){return {ok:false,error:aiError(error)}}
}
export async function prepareAiJob(companyId:string,operationId:string,payload:unknown):Promise<Result<Proposal>> {
  try {
    const ctx=await aiContext(companyId),checked=validateJobDraft(payload,true)
    const {data,error}=await ctx.supabase.rpc('diriqent_prepare_job',{c:ctx.companyId,operation:operationId,payload:checked})
    if(error)throw new Error(error.message)
    revalidatePath('/diriqent');return {ok:true,value:data as Proposal}
  }catch(error){return {ok:false,error:aiError(error)}}
}
export async function confirmAiJob(companyId:string,operationId:string,hash:string):Promise<Result<string>> {
  try {
    const ctx=await aiContext(companyId)
    if(!/^[0-9a-f]{64}$/.test(hash))throw new Error('Neplatné potvrzení.')
    const {data,error}=await ctx.supabase.rpc('diriqent_confirm_job',{c:ctx.companyId,operation:operationId,expected_hash:hash})
    if(error)throw new Error(error.message)
    revalidatePath('/diriqent');revalidatePath('/jobs');return {ok:true,value:String(data)}
  }catch(error){return {ok:false,error:aiError(error)}}
}
export async function createReviewedOcrQuote(companyId:string,operationId:string,value:unknown,confirmed:boolean):Promise<Result<string>> {
  try {
    if(confirmed!==true)throw new Error('Nejdřív potvrďte kontrolu rozpoznaných údajů.')
    const operation=await readOwnAiOperation(companyId,operationId)
    if(operation.kind!=='smart_quotes.ocr'||operation.state!=='completed')throw new Error('Podklad nabídky není dostupný.')
    const draft=validateDraft(value)
    const result=await runQuoteCommand(companyId,'save',{draft})
    if(!result.ok)throw new Error(result.error)
    return {ok:true,value:result.id!}
  }catch(error){return {ok:false,error:aiError(error)}}
}
