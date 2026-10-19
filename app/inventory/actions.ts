'use server'
import { createHash } from 'node:crypto'
import { readOwnAiOperation } from '@/lib/diriqent/server'
import { revalidatePath } from 'next/cache'
import { requireCompanyRoleDalContext } from '@/lib/dal/auth'
import { inventoryError, validateInventoryCommand, validateWarehouseSettings, uuidPattern } from '@/lib/inventory/domain'
export async function inventoryCommand(companyId:string,operation:string,payload:unknown,requestId:string):Promise<{ok:boolean;message:string;id?:string}>{
 try{
  if(!uuidPattern.test(companyId))return {ok:false,message:'Neplatná firma.'}
  validateInventoryCommand(operation,payload,requestId)
  if(operation==='warehouse')validateWarehouseSettings(payload)
  const ctx=await requireCompanyRoleDalContext('super_admin','company_admin','manager')
  if(ctx.companyId!==companyId)return {ok:false,message:'Aktivní firma se změnila. Obnovte stránku.'}
  const result=operation==='warehouse'
   ?await ctx.supabase.rpc('inventory_warehouse_write',{company:ctx.companyId,payload,request_id:requestId})
   :await ctx.supabase.rpc('inventory_write',{company:ctx.companyId,operation,payload,request_id:requestId})
  if(result.error)return {ok:false,message:inventoryError(result.error.message)}
  revalidatePath('/inventory');revalidatePath('/jobs');revalidatePath('/pos')
  return {ok:true,message:'Uloženo.',id:result.data?.id}
 }catch(error){return {ok:false,message:error instanceof Error && !error.message.includes('Supabase')?error.message:'Změnu se nepodařilo uložit.'}}
}

export async function createReviewedInventoryReceipt(companyId:string,operationId:string,draft:unknown,reviewed:boolean):Promise<{ok:boolean;message:string;id?:string}> {
 try {
  if(!reviewed||!uuidPattern.test(companyId)||!uuidPattern.test(operationId))return {ok:false,message:'Nejprve zkontrolujte podklad a potvrďte údaje.'}
  const operation=await readOwnAiOperation(companyId,operationId)
  if(operation.company_id!==companyId||operation.kind!=='inventory.ocr'||operation.state!=='completed'||!operation.result)return {ok:false,message:'Výsledek čtení tohoto podkladu není dostupný.'}
  if(!draft||typeof draft!=='object'||Array.isArray(draft))return {ok:false,message:'Neplatná příjemka.'}
  const input=draft as Record<string,unknown>
  const reason=typeof input.reason==='string'?input.reason.trim().slice(0,800):''
  // One reviewed receipt per OCR operation, including refresh/retries in another tab.
  const hash=createHash('sha256').update('inventory-ocr-receipt:'+companyId+':'+operationId).digest('hex')
  const requestId=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20,32)
  return inventoryCommand(companyId,'document',{kind:'receipt',warehouse_id:input.warehouse_id,reason:reason+' | OCR '+operationId,lines:input.lines},requestId)
 }catch{return {ok:false,message:'Příjemku se nepodařilo připravit. Ověřte přístup k firmě a původnímu podkladu.'}}
}
