import 'server-only'

import type { DalContext } from './auth'
import type {
  CalendarDeleteInput, CalendarEditorData, CalendarErrorCode, CalendarJob,
  CalendarListData, CalendarSnapshot, CalendarUpdateInput, CalendarWriteInput,
} from '@/lib/calendar/types'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const revision = /^(0|[1-9][0-9]{0,18})$/
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const maxRevision = BigInt('9223372036854775807')
type Row = Record<string, unknown>
type CalendarContext = Pick<DalContext, 'companyId' | 'supabase'>
type DbError = { message?: string; code?: string }

export class CalendarError extends Error {
  constructor(message: string, readonly code: CalendarErrorCode) { super(message); this.name = 'CalendarError' }
}

const messages: Record<string, [CalendarErrorCode, string]> = {
  CALENDAR_STALE: ['conflict', 'Událost mezitím změnil jiný uživatel. Váš návrh zůstal ve formuláři. Porovnejte ho s aktuální uloženou verzí.'],
  CALENDAR_FORBIDDEN: ['forbidden', 'K této akci nemáte oprávnění v aktivní firmě. Ověřte přihlášení a výběr firmy.'],
  CALENDAR_NOT_FOUND: ['not_found', 'Událost nebyla v aktivní firmě nalezena.'],
  CALENDAR_MODULE_REQUIRED: ['forbidden', 'Pro změny kalendáře je potřeba aktivní základ Diriqo.'],
  CALENDAR_DISABLED: ['forbidden', 'Kalendář je v aktivní firmě vypnutý.'],
  CALENDAR_INPUT_INVALID: ['validation', 'Zkontrolujte název, časový rozsah a přiřazené pracovníky.'],
  CALENDAR_SCOPE_INVALID: ['validation', 'Vybraná zakázka nebo pracovník nepatří do aktivní firmy. Obnovte dostupné možnosti.'],
  CALENDAR_ALIAS_CONFLICT: ['unavailable', 'Historické údaje události nejsou jednoznačné. Je potřeba kontrola správcem; záznam se nepřepsal.'],
}

export function calendarError(error: unknown): CalendarError {
  if (error instanceof CalendarError) return error
  const token = error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
  const known = messages[token]
  if (known) return new CalendarError(known[1], known[0])
  // A missing response may follow COMMIT. Never infer success or retry a write.
  return new CalendarError('Výsledek se nepodařilo potvrdit. Před dalším uložením načtěte aktuální stav události.', 'unknown')
}

function invalid(): never { throw calendarError({ message: 'CALENDAR_INPUT_INVALID' }) }
function unreadable(): never { throw new CalendarError('Údaje kalendáře se nepodařilo bezpečně načíst. Obnovte stránku.', 'unavailable') }
function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unreadable()
  return value as Row
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) return invalid()
  return value.toLowerCase()
}
function optionalId(value: unknown): string | null {
  return value == null || value === '' ? null : id(value)
}
function text(value: unknown, max: number, required = false): string | null {
  if (value != null && typeof value !== 'string') return invalid()
  const result = (value as string | null | undefined)?.trim() || null
  if ((required && !result) || (result && [...result].length > max)) return invalid()
  return result
}
function expectedRevision(value: unknown): string {
  if (typeof value !== 'string' || !revision.test(value) || BigInt(value) > maxRevision) return invalid()
  return value
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !iso.test(value)) return invalid()
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 9999) return invalid()
  // Date.parse normalizes impossible calendar days (e.g. February 30); refuse them.
  const day = value.slice(0, 10)
  const dayDate = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(dayDate.getTime()) || dayDate.toISOString().slice(0, 10) !== day) return invalid()
  return date.toISOString()
}
function nullableString(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return unreadable()
  return value
}
function profileIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500) return invalid()
  const ids = value.map(id)
  if (new Set(ids).size !== ids.length) return invalid()
  return ids.sort()
}
function writeInput(ctx: CalendarContext, input: CalendarWriteInput) {
  if (!input || typeof input !== 'object') return invalid()
  if (id(input.companyId) !== id(ctx.companyId)) throw calendarError({ message: 'CALENDAR_FORBIDDEN' })
  const start = timestamp(input.startAt), end = timestamp(input.endAt)
  if (Date.parse(end) <= Date.parse(start)) return invalid()
  return {
    title: text(input.title, 300, true)!, description: text(input.description, 10_000),
    start_at: start, end_at: end, job_id: optionalId(input.jobId),
    assigned_profile_ids: profileIds(input.selectedProfileIds ?? []),
  }
}

/** Validate identity and shape before a database result becomes browser state. */
function snapshot(value: unknown, companyId: string, eventId?: string): CalendarSnapshot {
  try {
    const result = object(value), event = object(result.event)
    const eventCompany = id(event.company_id), eventIdentity = id(event.id)
    if (eventCompany !== companyId || (eventId && eventIdentity !== eventId)) return unreadable()
    if (typeof event.title !== 'string') return unreadable()
    return {
      event: {
        id: eventIdentity, company_id: eventCompany, title: event.title,
        description: nullableString(event.description),
        start_at: event.start_at === null ? null : timestamp(event.start_at),
        end_at: event.end_at === null ? null : timestamp(event.end_at),
        job_id: optionalId(event.job_id), revision: expectedRevision(event.revision),
      },
      assigned_profile_ids: profileIds(result.assigned_profile_ids),
    }
  } catch { return unreadable() }
}

async function authenticate(ctx: CalendarContext) {
  id(ctx.companyId)
  const response = await ctx.supabase.auth.getUser()
  if (response.error || !response.data.user) throw calendarError({ message: 'CALENDAR_FORBIDDEN' })
}

async function rpc(ctx: CalendarContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  await authenticate(ctx)
  try {
    const result = await ctx.supabase.rpc(name, { p_company_id: id(ctx.companyId), ...args })
    if (result.error) throw calendarError(result.error)
    return result.data
  } catch (error) { throw calendarError(error) }
}

export async function readCalendarSnapshot(ctx: CalendarContext, eventId: string): Promise<CalendarSnapshot> {
  return snapshot(await rpc(ctx, 'get_calendar_event_snapshot', { p_event_id: id(eventId) }), id(ctx.companyId), id(eventId))
}
function savedSnapshot(data: unknown, companyId: string, input: ReturnType<typeof writeInput>, eventId?: string, previousRevision?: string) {
  try {
    const saved = snapshot(data, companyId, eventId)
    const event = saved.event
    if (event.title !== input.title || event.description !== input.description || event.start_at !== input.start_at
      || event.end_at !== input.end_at || event.job_id !== input.job_id
      || JSON.stringify(saved.assigned_profile_ids) !== JSON.stringify(input.assigned_profile_ids)
      || (previousRevision !== undefined && BigInt(event.revision) < BigInt(previousRevision))) {
      throw calendarError(null)
    }
    return saved
  } catch { throw calendarError(null) }
}
export async function createCalendarEvent(ctx: CalendarContext, input: CalendarWriteInput): Promise<CalendarSnapshot> {
  const normalized = writeInput(ctx, input)
  const data = await rpc(ctx, 'create_calendar_event_atomic', { p_input: normalized })
  return savedSnapshot(data, id(ctx.companyId), normalized)
}
export async function updateCalendarEvent(ctx: CalendarContext, input: CalendarUpdateInput): Promise<CalendarSnapshot> {
  const eventId = id(input?.eventId)
  const normalized = writeInput(ctx, input), previousRevision = expectedRevision(input.expectedRevision)
  const data = await rpc(ctx, 'update_calendar_event_atomic', {
    p_event_id: eventId, p_expected_revision: previousRevision, p_input: normalized,
  })
  return savedSnapshot(data, id(ctx.companyId), normalized, eventId, previousRevision)
}
export async function deleteCalendarEvent(ctx: CalendarContext, input: CalendarDeleteInput): Promise<void> {
  if (!input || id(input.companyId) !== id(ctx.companyId)) throw calendarError({ message: 'CALENDAR_FORBIDDEN' })
  const eventId = id(input.eventId)
  const data = await rpc(ctx, 'delete_calendar_event_atomic', {
    p_event_id: eventId, p_expected_revision: expectedRevision(input.expectedRevision),
  })
  try {
    const result = object(data)
    if (result.eventId !== eventId || result.deleted !== true) throw calendarError(null)
  } catch { throw calendarError(null) }
}

type ReadQuery = {
  eq: (column: string, value: unknown) => ReadQuery
  is: (column: string, value: null) => ReadQuery
  order: (column: string) => ReadQuery
  range: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: DbError | null }>
}
function query(ctx: CalendarContext, table: 'jobs' | 'calendar_events' | 'company_members' | 'companies', columns: string): ReadQuery {
  // Dynamic projection types stop at this small boundary; do not leak the SDK's recursive parser.
  return ctx.supabase.from(table).select(columns)
    .eq(table === 'companies' ? 'id' : 'company_id', id(ctx.companyId)) as unknown as ReadQuery
}
async function rows(source: ReadQuery): Promise<Row[]> {
  const result: Row[] = []
  for (let offset = 0; offset < 20_000; offset += 500) {
    const page = await source.range(offset, offset + 499)
    if (page.error || !Array.isArray(page.data)) return unreadable()
    result.push(...page.data)
    if (page.data.length < 500) return result
  }
  throw new CalendarError('Kalendář překračuje rozsah bezpečného načtení. Požádejte správce o zúžení přehledu.', 'unavailable')
}
function scopedRow(value: Row, companyId: string) {
  if (value.company_id !== companyId) return unreadable()
  return value
}

export async function readCalendarList(ctx: CalendarContext): Promise<CalendarListData> {
  await authenticate(ctx)
  const companyId = id(ctx.companyId)
  const [jobRows, events] = await Promise.all([
    rows(query(ctx, 'jobs', 'id,company_id,parent_job_id,title,description,status,start_at,end_at,customer_id,customers(name,company_id)').order('id')),
    rows(query(ctx, 'calendar_events', 'id,company_id,title,description,start_at,end_at,job_id').is('job_id', null).order('id')),
  ])
  const jobs: CalendarJob[] = jobRows.map(value => {
    const row = scopedRow(value, companyId)
    const customers = row.customers === null ? [] : Array.isArray(row.customers) ? row.customers : [row.customers]
    return {
      id: id(row.id), company_id: companyId, parent_job_id: optionalId(row.parent_job_id),
      title: nullableString(row.title), description: nullableString(row.description), status: nullableString(row.status),
      start_at: nullableString(row.start_at), end_at: nullableString(row.end_at), customer_id: optionalId(row.customer_id),
      customers: customers.map(object).filter(customer => customer.company_id === companyId)
        .map(customer => ({ name: nullableString(customer.name) })),
    }
  })
  return {
    companyId, jobs,
    eventRows: events.map(value => {
      const row = scopedRow(value, companyId)
      if (typeof row.title !== 'string') return unreadable()
      return { id: id(row.id), title: row.title, description: nullableString(row.description),
        start_at: nullableString(row.start_at), end_at: nullableString(row.end_at), job_id: optionalId(row.job_id) }
    }),
  }
}

export async function readCalendarEditor(ctx: CalendarContext, eventId?: string): Promise<CalendarEditorData> {
  await authenticate(ctx)
  const companyId = id(ctx.companyId)
  // Refuse a foreign event before loading any editor choices.
  const current = eventId !== undefined ? await readCalendarSnapshot(ctx, eventId) : null
  const [jobs, members, companies] = await Promise.all([
    rows(query(ctx, 'jobs', 'id,company_id,title').order('id')),
    rows(query(ctx, 'company_members', 'id,company_id,profile_id,profiles(id,full_name,is_active)').eq('is_active', true).order('id')),
    rows(query(ctx, 'companies', 'id,name').order('id')),
  ])
  if (companies.length !== 1 || companies[0].id !== companyId) return unreadable()
  const profiles = new Map<string, { id: string; full_name: string | null }>()
  for (const value of members) {
    const row = scopedRow(value, companyId)
    const related = Array.isArray(row.profiles) ? row.profiles : row.profiles ? [row.profiles] : []
    if (related.length !== 1) return unreadable()
    const profile = object(related[0]), profileId = id(row.profile_id)
    if (profile.id !== profileId) return unreadable()
    if (profile.is_active !== true) continue
    profiles.set(profileId, { id: profileId, full_name: nullableString(profile.full_name) })
  }
  return {
    companyId, companyName: nullableString(companies[0].name), snapshot: current,
    jobs: jobs.map(value => { const row = scopedRow(value, companyId); return { id: id(row.id), company_id: companyId, title: nullableString(row.title) } }),
    profiles: [...profiles.values()].sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '')),
  }
}
