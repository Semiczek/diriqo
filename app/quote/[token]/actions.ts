'use server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { quoteError } from '@/lib/smart-quotes/server'

export async function respondToQuote(token:string,version:number,formData:FormData):Promise<{ok:true}|{ok:false;error:string}> {
  try {
    if(!/^[0-9a-f]{64}$/.test(token) || !Number.isSafeInteger(version) || version<1) throw new Error('Odkaz není platný.')
    const supabase=await createSupabaseServerClient()
    const { error }=await supabase.rpc('smart_quote_public_respond',{
      access_token:token,target_version:version,variant_id:String(formData.get('variant')??''),customer_name:String(formData.get('name')??''),
      customer_email:String(formData.get('email')??''),decision:String(formData.get('decision')??''),consent:formData.get('consent')==='on',
    })
    if(error) throw new Error(error.message)
    revalidatePath(`/quote/${token}`)
    revalidatePath('/smart-quotes','layout')
    return {ok:true}
  } catch(error) { return {ok:false,error:quoteError(error)} }
}
