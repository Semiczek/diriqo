import { fleetContext } from '@/lib/fleet/server'
import { csvCell, uuidPattern } from '@/lib/fleet/domain'

const exports = {
  vehicles: { table: 'fleet_vehicles', fields: ['id', 'name', 'plate', 'status', 'initial_odometer', 'cost_method', 'km_rate', 'created_at'] },
  trips: { table: 'fleet_trips', fields: ['id', 'vehicle_id', 'driver_id', 'started_at', 'ended_at', 'origin', 'destination', 'purpose', 'odometer_start', 'odometer_end', 'status', 'job_id', 'cost_method', 'km_rate', 'mileage_amount'] },
  costs: { table: 'fleet_costs', fields: ['id', 'vehicle_id', 'kind', 'incurred_on', 'description', 'amount', 'quantity', 'supplier', 'receipt_ref', 'service_id'] },
  services: { table: 'fleet_services', fields: ['id', 'vehicle_id', 'title', 'due_on', 'status', 'notes'] },
  allocations: { table: 'fleet_cost_allocations', fields: ['id', 'cost_id', 'job_id', 'amount'] },
  audit: { table: 'fleet_audit_events', fields: ['id', 'vehicle_id', 'entity_id', 'operation', 'actor_id', 'created_at', 'before_data', 'after_data'] },
} as const

export async function GET(request: Request) {
  try {
    const context = await fleetContext()
    const { data: access, error: accessError } = await context.supabase.rpc('get_module_workspace_access', { company: context.companyId, product: 'fleet' })
    if (accessError || access?.can_export !== true) return Response.json({ error: 'Pro export potřebujete oprávnění k exportu historie vozidel.' }, { status: 403 })
    const params = new URL(request.url).searchParams
    const type = params.get('type') ?? 'vehicles'
    if (!Object.hasOwn(exports, type)) return Response.json({ error: 'Neplatný typ exportu.' }, { status: 400 })
    if (!context.manager && ['costs', 'allocations', 'audit'].includes(type)) return Response.json({ error: 'Nemáte oprávnění.' }, { status: 403 })
    const definition = exports[type as keyof typeof exports]
    const vehicle = params.get('vehicle')
    if (vehicle && !uuidPattern.test(vehicle)) return Response.json({ error: 'Neplatné vozidlo.' }, { status: 400 })
    const records: Record<string, unknown>[] = []
    for (let offset = 0; offset <= 10000; offset += 500) {
      let query = context.supabase.from(definition.table).select(definition.fields.join(',')).eq('company_id', context.companyId).order('id').range(offset, offset + 499)
      if (vehicle) query = query.eq(type === 'vehicles' ? 'id' : 'vehicle_id', vehicle)
      const { data, error } = await query
      if (error) throw new Error('export_failed')
      records.push(...(data as unknown as Record<string, unknown>[]))
      if (records.length > 10000) return Response.json({ error: 'Export obsahuje více než 10 000 záznamů. Vyberte konkrétní vozidlo.' }, { status: 422 })
      if (data.length < 500) break
    }
    const csv = '\uFEFF' + [definition.fields.map(csvCell).join(';'), ...records.map(record => definition.fields.map(field => csvCell(typeof record[field] === 'object' ? JSON.stringify(record[field]) : record[field])).join(';'))].join('\r\n')
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="vozidla-${type}.csv"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch { return Response.json({ error: 'Export není dostupný. Zkontrolujte přihlášení a oprávnění.' }, { status: 403 }) }
}
