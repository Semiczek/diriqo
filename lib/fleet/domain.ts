export const vehicleStates = { active: 'Aktivní', service: 'V servisu', inactive: 'Neaktivní', archived: 'Archivované' } as const
export const tripStates = { draft: 'Koncept', submitted: 'Ke schválení', approved: 'Schválená', locked: 'Uzamčená' } as const
export const serviceStates = { planned: 'Naplánováno', in_progress: 'Probíhá', completed: 'Dokončeno', cancelled: 'Zrušeno' } as const
export const costKinds = { fuel: 'Tankování', charging: 'Nabíjení', service: 'Servis', other: 'Ostatní náklad' } as const
export type Vehicle = { id: string; company_id: string; name: string; plate: string; status: keyof typeof vehicleStates; initial_odometer: number; driver_id: string | null; cost_method: 'mileage' | 'actual'; km_rate: number; notes: string; version: number; created_at: string }
export type Trip = { id: string; vehicle_id: string; driver_id: string; started_at: string; ended_at: string; origin: string; destination: string; purpose: string; odometer_start: number; odometer_end: number; status: keyof typeof tripStates; job_id: string | null; cost_method: 'mileage' | 'actual'; km_rate: number; mileage_amount: number; return_reason: string | null; version: number }
export type Cost = { id: string; vehicle_id: string; kind: keyof typeof costKinds; incurred_on: string; description: string; amount: number; quantity: number | null; receipt_ref: string; supplier: string; service_id: string | null }
export type Service = { id: string; vehicle_id: string; title: string; due_on: string; status: keyof typeof serviceStates; notes: string; version: number }
export type Allocation = { id: string; cost_id: string; job_id: string; amount: number }
export type Document = { id: string; vehicle_id: string; file_name: string; object_path: string; created_at: string }
export type AuditEvent = { id: string; entity_id: string; operation: string; created_at: string; actor_id: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null }
export type Option = { id: string; name: string }
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function mileageAmount(start: number, end: number, rate: number): number {
  if (![start, end, rate].every(Number.isFinite) || start < 0 || end < start || rate < 0) throw new Error('Neplatný tachometr nebo sazba.')
  return Math.round((end - start) * Math.round(rate * 100)) / 100
}

export function tripConflict(candidate: Pick<Trip, 'id' | 'started_at' | 'ended_at' | 'odometer_start' | 'odometer_end'>, others: Pick<Trip, 'id' | 'started_at' | 'ended_at' | 'odometer_start' | 'odometer_end'>[], initial: number): string | null {
  const start = Date.parse(candidate.started_at), end = Date.parse(candidate.ended_at)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || candidate.odometer_end < candidate.odometer_start || candidate.odometer_start < initial) return 'Neplatný čas nebo tachometr.'
  const trips = others.filter(trip => trip.id !== candidate.id)
  if (trips.some(trip => Date.parse(trip.started_at) < end && Date.parse(trip.ended_at) > start)) return 'Jízda se časově překrývá s jinou jízdou.'
  const before = trips.filter(trip => Date.parse(trip.ended_at) <= start).sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at))[0]
  const after = trips.filter(trip => Date.parse(trip.started_at) >= end).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))[0]
  if (candidate.odometer_start !== (before?.odometer_end ?? initial) || (after && candidate.odometer_end !== after.odometer_start)) return 'Tachometr nenavazuje na sousední jízdu.'
  return null
}

export function canTransitionTrip(from: Trip['status'], to: Trip['status'], manager: boolean): boolean {
  return (from === 'draft' && to === 'submitted') || (manager && ((from === 'submitted' && ['draft', 'approved'].includes(to)) || (from === 'approved' && ['draft', 'locked'].includes(to))))
}

export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value)
  if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function allocationTotal(amounts: number[], sourceAmount: number, method: Vehicle['cost_method']): number {
  if (method !== 'actual') throw new Error('Kilometrová sazba už zahrnuje provozní náklady. Nelze je přidat podruhé.')
  const cents = amounts.map(amount => Math.round(amount * 100))
  if (amounts.some(amount => !Number.isFinite(amount) || amount <= 0) || cents.reduce((sum, amount) => sum + amount, 0) > Math.round(sourceAmount * 100)) throw new Error('Rozdělení přesahuje částku původního nákladu.')
  return cents.reduce((sum, amount) => sum + amount, 0) / 100
}
