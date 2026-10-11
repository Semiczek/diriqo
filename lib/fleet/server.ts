import 'server-only'
import { requireCompanyRoleDalContext } from '@/lib/dal/auth'
import type { Allocation, AuditEvent, Cost, Document, Option, Service, Trip, Vehicle } from './domain'

export async function fleetContext() {
  const context = await requireCompanyRoleDalContext('super_admin', 'company_admin', 'manager', 'worker')
  const auth = await context.supabase.auth.getUser()
  if (auth.error || !auth.data.user) throw new Error('Přihlaste se znovu.')
  return { ...context, manager: context.role !== 'worker' }
}

export const fleetError = (error: { message?: string } | null) => {
  const message = error?.message ?? ''
  const messages: Record<string, string> = {
    FLEET_CONFLICT: 'Záznam mezitím změnil někdo jiný. Obnovte stránku a zopakujte úpravu.',
    FLEET_TRIP_OVERLAP: 'Jízda se překrývá s jinou jízdou tohoto vozidla nebo řidiče.',
    FLEET_ODOMETER_GAP: 'Tachometr nenavazuje. Počátek musí odpovídat konci předchozí jízdy (u první jízdy počátečnímu stavu vozidla).',
    FLEET_LOCKED: 'Schválenou jízdu nejprve vraťte k úpravě. Uzamčenou jízdu už nelze měnit.',
    FLEET_INVALID_TRANSITION: 'Tato změna stavu není povolená.',
    FLEET_CAPACITY: 'Základní kapacita je 5 aktivních vozidel včetně aut v servisu. Nejdříve navyšte schválenou kapacitu modulu.',
    FLEET_DUPLICATE: 'Tento doklad nebo registrační značka už je evidován. Zkontrolujte existující záznam.',
    FLEET_COST_METHOD: 'Kilometrová sazba zahrnuje palivo i další provozní náklady. Náklad nelze podruhé rozdělit do zakázek.',
    FLEET_ALLOCATION_EXCEEDED: 'Součet rozdělených částek nesmí překročit původní náklad.',
    FLEET_ARCHIVED: 'Vozidlo není aktivní. Pro novou jízdu jej nejdříve aktivujte.',
    FLEET_METHOD_LOCKED: 'Metodu nákladů a počáteční tachometr nelze měnit po založení jízd nebo nákladů.',
    FLEET_FORBIDDEN: 'K této operaci nebo vozidlu nemáte oprávnění.',
    FLEET_INVALID: 'Zkontrolujte vyplněné údaje, data a kladné částky.',
    MODULE_REQUIRED: 'Pro nové záznamy je potřeba aktivní základ Diriqa a modul Vozidla.',
    MODULE_ACCESS_DENIED: 'K modulu nemáte oprávnění.',
    MODULE_FORBIDDEN: 'K modulu nemáte oprávnění.',
    MODULE_CAPABILITY_FORBIDDEN: 'K modulu nemáte oprávnění.',
    MODULE_CAPABILITY_REQUIRED: 'Pro nové záznamy je potřeba aktivní modul Vozidla a základ Diriqa.',
  }
  return messages[message] ?? (message.includes('unique') ? messages.FLEET_DUPLICATE : 'Operaci se nepodařilo dokončit. Obnovte stránku a zkontrolujte přístup k modulu.')
}

export async function fleetList(search: string, status: string, page: number) {
  const context = await fleetContext()
  let query = context.supabase.from('fleet_vehicles').select('*', { count: 'exact' }).eq('company_id', context.companyId)
  const term = search.replace(/[%_,().]/g, ' ').trim().slice(0, 80)
  if (term) query = query.or(`name.ilike.%${term}%,plate.ilike.%${term}%`)
  if (['active', 'service', 'inactive', 'archived'].includes(status)) query = query.eq('status', status)
  const result = await query.order('created_at', { ascending: false }).order('id').range((page - 1) * 20, page * 20 - 1)
  if (result.error) throw new Error(fleetError(result.error))
  return { context, vehicles: result.data as Vehicle[], count: result.count ?? 0 }
}

export async function fleetOptions(context: Awaited<ReturnType<typeof fleetContext>>) {
  const [members, jobs] = await Promise.all([
    context.manager ? context.supabase.from('company_members').select('profile_id,profiles(id,full_name)').eq('company_id', context.companyId).eq('is_active', true) : Promise.resolve({ data: null, error: null }),
    context.supabase.from('jobs').select('id,title').eq('company_id', context.companyId).order('created_at', { ascending: false }).limit(500),
  ])
  if (members.error || jobs.error) throw new Error('Seznam řidičů nebo zakázek se nepodařilo načíst.')
  const drivers = (members.data ?? []).flatMap(member => {
    const profile = member.profiles as unknown as { id: string; full_name: string } | null
    return profile ? [{ id: profile.id, name: profile.full_name }] : []
  })
  return { drivers, jobs: (jobs.data ?? []).map(job => ({ id: job.id, name: job.title || 'Zakázka' })) as Option[] }
}

export async function fleetDetail(id: string, page: number) {
  const context = await fleetContext()
  const result = await context.supabase.from('fleet_vehicles').select('*').eq('company_id', context.companyId).eq('id', id).maybeSingle()
  if (result.error) throw new Error(fleetError(result.error))
  if (!result.data) return null
  const [trips, costs, services, documents, audit, allocations, options] = await Promise.all([
    context.supabase.from('fleet_trips').select('*', { count: 'exact' }).eq('company_id', context.companyId).eq('vehicle_id', id).order('started_at', { ascending: false }).order('id').range((page - 1) * 20, page * 20 - 1),
    context.supabase.from('fleet_costs').select('*').eq('company_id', context.companyId).eq('vehicle_id', id).order('incurred_on', { ascending: false }).limit(100),
    context.supabase.from('fleet_services').select('*').eq('company_id', context.companyId).eq('vehicle_id', id).order('due_on').limit(100),
    context.supabase.from('fleet_documents').select('*').eq('company_id', context.companyId).eq('vehicle_id', id).order('created_at', { ascending: false }).limit(100),
    context.supabase.from('fleet_audit_events').select('*').eq('company_id', context.companyId).eq('vehicle_id', id).order('created_at', { ascending: false }).limit(30),
    context.supabase.from('fleet_cost_allocations').select('*').eq('company_id', context.companyId).eq('vehicle_id', id).limit(1000),
    fleetOptions(context),
  ])
  for (const response of [trips, costs, services, documents, audit, allocations]) if (response.error) throw new Error(fleetError(response.error))
  return { context, vehicle: result.data as Vehicle, trips: trips.data as Trip[], tripCount: trips.count ?? 0, costs: costs.data as Cost[], services: services.data as Service[], documents: documents.data as Document[], audit: audit.data as AuditEvent[], allocations: allocations.data as Allocation[], ...options }
}
