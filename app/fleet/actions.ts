'use server'

import { revalidatePath } from 'next/cache'
import { fleetContext, fleetError } from '@/lib/fleet/server'
import { uuidPattern } from '@/lib/fleet/domain'

export type FleetActionState = { error: string | null; success?: string; id?: string }
const fields: Record<string, string[]> = {
  'vehicle.save': ['id', 'version', 'name', 'plate', 'status', 'initial_odometer', 'driver_id', 'cost_method', 'km_rate', 'notes'],
  'trip.save': ['id', 'version', 'vehicle_id', 'driver_id', 'started_at', 'ended_at', 'origin', 'destination', 'purpose', 'odometer_start', 'odometer_end', 'job_id'],
  'trip.transition': ['id', 'version', 'vehicle_id', 'status', 'return_reason'],
  'cost.create': ['vehicle_id', 'kind', 'incurred_on', 'description', 'amount', 'quantity', 'receipt_ref', 'supplier', 'service_id'],
  'cost.allocate': ['vehicle_id', 'cost_id', 'job_id', 'amount'],
  'service.save': ['id', 'version', 'vehicle_id', 'title', 'due_on', 'status', 'notes'],
}

export async function writeFleetAction(_state: FleetActionState, form: FormData): Promise<FleetActionState> {
  try {
    const context = await fleetContext()
    const operation = String(form.get('operation') ?? '')
    const requestId = String(form.get('request_id') ?? '')
    if (form.get('company_id') !== context.companyId || !uuidPattern.test(requestId) || !Object.hasOwn(fields, operation)) return { error: 'Formulář již neodpovídá aktivní firmě. Obnovte stránku.' }
    if (!context.manager && !operation.startsWith('trip.')) return { error: 'Tuto akci může provést jen správce vozidel.' }
    const payload = Object.fromEntries(fields[operation].map(key => [key, String(form.get(key) ?? '').trim()]))
    if (Object.values(payload).some(value => value.length > 4000)) return { error: 'Zadaný text je příliš dlouhý.' }
    for (const key of ['id', 'vehicle_id', 'driver_id', 'job_id', 'cost_id', 'service_id']) if (payload[key] && !uuidPattern.test(payload[key])) return { error: 'Neplatný odkaz na záznam.' }
    const { data, error } = await context.supabase.rpc('fleet_write', { target_company_id: context.companyId, target_operation: operation, target_payload: payload, target_request_id: requestId })
    if (error || typeof data !== 'string' || !uuidPattern.test(data)) return { error: fleetError(error) }
    revalidatePath('/fleet')
    revalidatePath(`/fleet/${payload.vehicle_id || data}`)
    return { error: null, success: 'Uloženo.', id: data }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Uložení se nepodařilo. Zkuste to znovu.' }
  }
}
