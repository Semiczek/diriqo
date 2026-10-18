import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ guard: vi.fn(), auth: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/server-guards', () => ({ requireHubAccess: mocks.guard }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.auth }, rpc: mocks.rpc, from: mocks.from }) }))
import {
  createCalendarEventAction, updateCalendarEventAction, deleteCalendarEventAction,
  readCalendarEditorAction, readCalendarListAction,
} from '../app/calendar/actions'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const otherCompany = 'a2222222-2222-4222-8222-222222222222'
const profileId = 'b1111111-1111-4111-8111-111111111111'
const otherProfile = 'b2222222-2222-4222-8222-222222222222'
const eventId = 'c1111111-1111-4111-8111-111111111111'
const jobId = 'd1111111-1111-4111-8111-111111111111'
const input = { companyId, eventId, expectedRevision: '3', title: 'Kontrola', description: 'Poznámka',
  startAt: '2026-10-18T08:00:00.000Z', endAt: '2026-10-18T09:00:00.000Z', jobId, selectedProfileIds: [profileId] }
const snapshot = () => ({ event: { id: eventId, company_id: companyId, title: input.title, description: input.description,
  start_at: input.startAt, end_at: input.endAt, job_id: jobId, revision: '4' }, assigned_profile_ids: [profileId] })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.guard.mockResolvedValue({ ok: true, value: { companyId, profileId, role: 'company_admin' } })
  mocks.auth.mockResolvedValue({ data: { user: { id: 'verified' } }, error: null })
  mocks.rpc.mockResolvedValue({ data: snapshot(), error: null })
  mocks.from.mockImplementation(() => { throw new Error('Split table writes are forbidden') })
})

describe('calendar atomic action boundary', () => {
  it('updates one scoped RPC with the original expected revision and all assignments', async () => {
    expect(await updateCalendarEventAction(input)).toMatchObject({ ok: true, event: { revision: '4' }, assignedProfileIds: [profileId] })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('update_calendar_event_atomic', {
      p_company_id: companyId, p_event_id: eventId, p_expected_revision: '3', p_input: {
        title: 'Kontrola', description: 'Poznámka', start_at: input.startAt, end_at: input.endAt,
        job_id: jobId, assigned_profile_ids: [profileId],
      },
    })
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0])
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledWith(`/calendar/events/${eventId}`)
  })
  it('creates the event and assignments through one transaction', async () => {
    expect(await createCalendarEventAction(input)).toMatchObject({ ok: true, eventId })
    expect(mocks.rpc.mock.calls[0][0]).toBe('create_calendar_event_atomic')
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('deletes only the explicitly loaded revision in the active company', async () => {
    mocks.rpc.mockResolvedValue({ data: { eventId, deleted: true }, error: null })
    expect(await deleteCalendarEventAction({ companyId, eventId, expectedRevision: '3' })).toEqual({ ok: true })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('delete_calendar_event_atomic', {
      p_company_id: companyId, p_event_id: eventId, p_expected_revision: '3',
    })
  })
  it.each(['create', 'update', 'delete'])('rejects a stale company selection before %s', async kind => {
    const changed = { ...input, companyId: otherCompany }
    const result = kind === 'create' ? await createCalendarEventAction(changed)
      : kind === 'update' ? await updateCalendarEventAction(changed) : await deleteCalendarEventAction(changed)
    expect(result).toMatchObject({ ok: false, code: 'forbidden' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(['worker', 'manager', null])('does not widen the existing writer role to %s', async role => {
    mocks.guard.mockResolvedValue({ ok: true, value: { companyId, profileId, role } })
    expect(await updateCalendarEventAction(input)).toMatchObject({ ok: false, code: 'forbidden' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects a denied guard and expired authentication without database writes', async () => {
    mocks.guard.mockResolvedValueOnce({ ok: false, error: 'Denied' })
    expect(await updateCalendarEventAction(input)).toMatchObject({ ok: false, code: 'forbidden' })
    mocks.auth.mockResolvedValue({ data: { user: null }, error: null })
    expect(await updateCalendarEventAction(input)).toMatchObject({ ok: false, code: 'forbidden' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(['update', 'delete'])('returns a resolvable %s conflict without retrying or changing the draft', async kind => {
    const before = structuredClone(input)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'CALENDAR_STALE' } })
    const result = kind === 'update' ? await updateCalendarEventAction(input) : await deleteCalendarEventAction(input)
    expect(result).toMatchObject({ ok: false, code: 'conflict', current: snapshot() })
    expect(input).toEqual(before)
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual([
      kind === 'update' ? 'update_calendar_event_atomic' : 'delete_calendar_event_atomic', 'get_calendar_event_snapshot',
    ])
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('does not disclose a conflict snapshot if authorization changed before the read', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'CALENDAR_STALE' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'CALENDAR_FORBIDDEN' } })
    const result = await updateCalendarEventAction(input)
    expect(result).toMatchObject({ ok: false, code: 'conflict' })
    expect(result).not.toHaveProperty('current')
  })
  it.each(['CALENDAR_MODULE_REQUIRED', 'CALENDAR_DISABLED', 'CALENDAR_FORBIDDEN'])('maps %s without returning provider details', async message => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message, details: 'private row' } })
    expect(await updateCalendarEventAction(input)).toMatchObject({ ok: false, code: 'forbidden' })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('refuses legacy alias conflicts without editing history', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'CALENDAR_ALIAS_CONFLICT' } })
    expect(await updateCalendarEventAction(input)).toMatchObject({ ok: false, code: 'unavailable' })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each(['create', 'update', 'delete'])('never retries a lost %s response or invents success', async kind => {
    mocks.rpc.mockRejectedValue(new Error('provider secret connection string'))
    const result = kind === 'create' ? await createCalendarEventAction(input)
      : kind === 'update' ? await updateCalendarEventAction(input) : await deleteCalendarEventAction(input)
    expect(result).toMatchObject({ ok: false, code: 'unknown' })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each([
    { expectedRevision: undefined }, { expectedRevision: '3.0' }, { expectedRevision: '9223372036854775808' },
    { title: '' }, { title: 'x'.repeat(301) }, { startAt: '2026-10-18T08:00' },
    { startAt: '2026-02-30T08:00:00Z' }, { endAt: '2026-10-18T07:00:00Z' },
    { selectedProfileIds: [profileId, profileId.toUpperCase()] }, { selectedProfileIds: ['not-a-uuid'] },
    { description: 'x'.repeat(10001) }, { jobId: 'bad-job' },
  ])('rejects invalid input before any mutation: %j', async change => {
    expect(await updateCalendarEventAction({ ...input, ...change })).toMatchObject({ ok: false, code: 'validation' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('normalizes explicit offsets to UTC without interpreting browser-local time on the server', async () => {
    expect(await updateCalendarEventAction({ ...input, startAt: '2026-10-18T10:00:00+02:00', endAt: '2026-10-18T11:00:00+02:00' })).toMatchObject({ ok: true })
    expect(mocks.rpc.mock.calls[0][1].p_input.start_at).toBe(input.startAt)
  })
  it.each([
    { company_id: otherCompany }, { id: jobId }, { revision: '2' }, { title: 'Different saved content' },
  ])('treats an inconsistent mutation response as unknown: %j', async delta => {
    const saved = snapshot()
    mocks.rpc.mockResolvedValue({ data: { ...saved, event: { ...saved.event, ...delta } }, error: null })
    expect(await updateCalendarEventAction(input)).toMatchObject({ ok: false, code: 'unknown' })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('rejects a mismatched assignment set in a successful write response', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...snapshot(), assigned_profile_ids: [otherProfile] }, error: null })
    expect(await updateCalendarEventAction(input)).toMatchObject({ ok: false, code: 'unknown' })
  })
})

type Row = Record<string, unknown>
function reader(tables: Record<string, Row[]>) {
  const filters: Array<{ table: string; column: string; value: unknown }> = []
  mocks.from.mockImplementation((table: string) => {
    const predicates: Array<(row: Row) => boolean> = []
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push({ table, column, value }); predicates.push(row => row[column] === value); return query },
      is: (column: string, value: unknown) => { predicates.push(row => row[column] === value); return query },
      order: () => query,
      range: (from: number, to: number) => Promise.resolve({ data: (tables[table] ?? []).filter(row => predicates.every(p => p(row))).slice(from, to + 1), error: null }),
    }
    return query
  })
  return filters
}
const job = (company = companyId): Row => ({ id: jobId, company_id: company, parent_job_id: null, title: 'Job', description: null,
  status: 'planned', start_at: input.startAt, end_at: input.endAt, customer_id: null, customers: null })

describe('calendar tenant-scoped readers', () => {
  it('isolates list reads for an administrator with memberships in A and B', async () => {
    const filters = reader({ jobs: [job(), job(otherCompany)], calendar_events: [
      { ...snapshot().event, job_id: null }, { ...snapshot().event, company_id: otherCompany, title: 'Foreign', job_id: null },
    ] })
    const result = await readCalendarListAction()
    expect(result).toMatchObject({ ok: true, data: { companyId, jobs: [expect.objectContaining({ company_id: companyId })], eventRows: [expect.objectContaining({ title: 'Kontrola' })] } })
    expect(filters).toEqual(expect.arrayContaining([{ table: 'jobs', column: 'company_id', value: companyId }, { table: 'calendar_events', column: 'company_id', value: companyId }]))
  })
  it('does not return a foreign customer relation even when a legacy job references it', async () => {
    reader({ jobs: [{ ...job(), customers: [{ company_id: otherCompany, name: 'Foreign customer' }] }], calendar_events: [] })
    const result = await readCalendarListAction()
    expect(result).toMatchObject({ ok: true, data: { jobs: [expect.objectContaining({ customers: [] })] } })
    expect(JSON.stringify(result)).not.toContain('Foreign customer')
  })
  it('loads beyond the PostgREST page cap rather than silently dropping calendar items', async () => {
    const jobs = Array.from({ length: 1001 }, (_, i) => ({ ...job(), id: `d1111111-1111-4111-8111-${String(i).padStart(12, '0')}` }))
    reader({ jobs, calendar_events: [] })
    const result = await readCalendarListAction()
    expect(result.ok && result.data.jobs.length).toBe(1001)
  })
  it('limits employee choices to active memberships in the actual selected company', async () => {
    reader({ jobs: [job(), job(otherCompany)], companies: [{ id: companyId, name: 'Company A' }, { id: otherCompany, name: 'Company B' }], company_members: [
      { id: '1', company_id: companyId, profile_id: profileId, is_active: true, profiles: { id: profileId, full_name: 'Active', is_active: true } },
      { id: '2', company_id: otherCompany, profile_id: otherProfile, is_active: true, profiles: { id: otherProfile, full_name: 'Foreign', is_active: true } },
      { id: '3', company_id: companyId, profile_id: otherProfile, is_active: false, profiles: { id: otherProfile, full_name: 'Revoked', is_active: true } },
      { id: '4', company_id: companyId, profile_id: otherProfile, is_active: true, profiles: { id: otherProfile, full_name: 'Disabled profile', is_active: false } },
    ] })
    const result = await readCalendarEditorAction({ eventId })
    expect(result).toMatchObject({ ok: true, data: { companyId, companyName: 'Company A', snapshot: snapshot(), profiles: [{ id: profileId, full_name: 'Active' }] } })
    expect(JSON.stringify(result)).not.toContain('Foreign')
    expect(JSON.stringify(result)).not.toContain('Revoked')
    expect(JSON.stringify(result)).not.toContain('Disabled profile')
  })
  it('refuses an inaccessible event before loading any editor choices', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'CALENDAR_NOT_FOUND' } })
    expect(await readCalendarEditorAction({ eventId })).toMatchObject({ ok: false, code: 'not_found' })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('does not turn a failed page into an empty successful calendar', async () => {
    mocks.from.mockImplementation(() => {
      const query = { select: () => query, eq: () => query, is: () => query, order: () => query,
        range: async () => ({ data: null, error: { message: 'private SQL error' } }) }
      return query
    })
    const result = await readCalendarListAction()
    expect(result).toMatchObject({ ok: false, code: 'unavailable' })
    expect(JSON.stringify(result)).not.toContain('private SQL')
  })
})
