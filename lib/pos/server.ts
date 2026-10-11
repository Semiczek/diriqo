import 'server-only'
import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { posError, UUID } from './domain'

export class PosError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}
export async function posContext(expectedCompany: string | null) {
  if (!expectedCompany || !UUID.test(expectedCompany)) throw new PosError('Chybí aktivní firma. Obnovte stránku.', 400)
  const company = await getActiveCompanyContext({ allowedRoles: ['super_admin', 'company_admin', 'manager', 'worker'] })
  if (!company) throw new PosError('Přihlaste se jako člen firmy.', 403)
  if (company.companyId !== expectedCompany) throw new PosError('Aktivní firma se změnila. Obnovte celou stránku; původní požadavek nebyl odeslán.', 409)
  return { company, supabase: await createSupabaseServerClient() }
}
export function databaseError(error: { message: string; code?: string }): never {
  if (error.code === '23505' && error.message.includes('gastro_items_company_sku_idx')) throw new PosError('Položka se stejným kódem SKU už v této firmě existuje.', 409)
  const status = error.code === '42501' ? 403 : ['23505', '40001'].includes(error.code ?? '') || (error.code === 'P0001' && error.message.startsWith('INVENTORY_')) ? 409 : error.code?.startsWith('22') ? 400 : 503
  throw new PosError(posError(error.message), status)
}
export async function readPos(companyId: string, registerId: string | null, mode: string, params: Record<string, unknown> = {}) {
  const { supabase } = await posContext(companyId)
  if (registerId !== null && !UUID.test(registerId)) throw new PosError('Neplatná pokladna.', 400)
  const { data, error } = await supabase.rpc('pos_read', { company_id: companyId, register_id: registerId, mode, params })
  if (error) databaseError(error)
  return data
}
