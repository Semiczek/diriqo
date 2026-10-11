'use server'
import { revalidatePath } from 'next/cache'
import { requireCompanyRoleDalContext } from '@/lib/dal/auth'
import { inventoryError, validateInventoryCommand, uuidPattern } from '@/lib/inventory/domain'
export async function inventoryCommand(companyId:string,operation:string,payload:unknown,requestId:string):Promise<{ok:boolean;message:string;id?:string}>{
 try{
  if(!uuidPattern.test(companyId))return {ok:false,message:'Neplatná firma.'}
  validateInventoryCommand(operation,payload,requestId)
  const ctx=await requireCompanyRoleDalContext('super_admin','company_admin','manager')
  if(ctx.companyId!==companyId)return {ok:false,message:'Aktivní firma se změnila. Obnovte stránku.'}
  const result=await ctx.supabase.rpc('inventory_write',{company:ctx.companyId,operation,payload,request_id:requestId})
  if(result.error)return {ok:false,message:inventoryError(result.error.message)}
  revalidatePath('/inventory');revalidatePath('/jobs');revalidatePath('/pos')
  return {ok:true,message:'Uloženo.',id:result.data?.id}
 }catch(error){return {ok:false,message:error instanceof Error && !error.message.includes('Supabase')?error.message:'Změnu se nepodařilo uložit.'}}
}
