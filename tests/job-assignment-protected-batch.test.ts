import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/server-guards', () => ({ requireCompanyRole: mocks.guard }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.client }))
import { POST, PUT, DELETE } from '../app/api/jobs/[jobId]/assignments/route'

const company = '11111111-1111-4111-8111-111111111111'
const actor = '22222222-1111-4111-8111-111111111111'
const worker = '33333333-1111-4111-8111-111111111111'
const job = '44444444-1111-4111-8111-111111111111'
const child = '55555555-1111-4111-8111-111111111111'
const assignment = '66666666-1111-4111-8111-111111111111'
const childAssignment = '77777777-1111-4111-8111-111111111111'
let children: string[], error: { message: string } | null, writes: string[]
let writePayloads: unknown[], hasAssignments: boolean
function builder(table: string) {
  let operation = 'select'
  let mutation: unknown
  const filters: Record<string, unknown> = {}
  const response = () => {
    if (operation !== 'select') { writes.push(operation); writePayloads.push(mutation); return { data: null, error } }
    if (table === 'jobs') return { data: filters.id ? { id: job, company_id: company, parent_job_id: null } : children.map(id => ({ id })), error: null }
    if (table === 'company_members') return { data: { id: 'membership' }, error: null }
    const rows = hasAssignments ? [{ id: assignment, job_id: job, profile_id: worker }, ...children.map(id => ({ id: childAssignment, job_id: id, profile_id: worker }))] : []
    return { data: filters.id ? rows.find(row => row.id === filters.id) : rows, error: null }
  }
  const query = {
    select() { return query }, eq(key: string, value: unknown) { filters[key] = value; return query },
    in() { return query }, update(value: unknown) { operation = 'update'; mutation = value; return query }, insert(value: unknown) { operation = 'insert'; mutation = value; return query },
    delete() { operation = 'delete'; return query }, maybeSingle() { return Promise.resolve(response()) },
    then(resolve: (value: unknown) => unknown) { return Promise.resolve(response()).then(resolve) },
  }
  return query
}
beforeEach(() => {
  vi.clearAllMocks(); children = []; writes = []; writePayloads = []; hasAssignments = true; error = { message: 'LABOR_APPROVED_SOURCE_IMMUTABLE' }
  mocks.guard.mockResolvedValue({ ok: true, value: { companyId: company, profileId: actor } })
  mocks.client.mockResolvedValue({ from: builder })
})
const context = { params: Promise.resolve({ jobId: job }) }
function request(method: string, row: unknown = { profile_id: worker, labor_hours: 7, hourly_rate: 200 }) {
  const body = method === 'PUT' ? { assignments: [row] } : method === 'POST' ? row : { assignmentId: assignment }
  return new NextRequest(`https://app.diriqo.test/api/jobs/${job}/assignments`, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}

describe('protected legacy assignment batch routes', () => {
  it.each([['POST', POST], ['PUT', PUT], ['DELETE', DELETE]] as const)('%s returns a recoverable domain conflict without further writes', async (method, handler) => {
    const response = await handler(request(method), context)
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('LABOR_APPROVED_SOURCE_IMMUTABLE')
    expect(body.error).toContain('Otevřete výkaz')
    const url = new URL(body.reviewHref, 'https://app.diriqo.test')
    expect(Object.fromEntries(url.searchParams)).toEqual({ company, actor, worker, job, sourceKind: 'assignment', source: assignment })
    expect(writes).toEqual([method === 'DELETE' ? 'delete' : 'update'])
  })
  it.each([['POST', POST], ['PUT', PUT], ['DELETE', DELETE]] as const)('%s does not guess which propagated child is protected', async (method, handler) => {
    children = [child]
    const response = await handler(request(method), context)
    expect(response.status).toBe(409)
    const url = new URL((await response.json()).reviewHref, 'https://app.diriqo.test')
    expect(Object.fromEntries(url.searchParams)).toEqual({ company, actor, worker })
    expect(writes).toHaveLength(1)
  })
  it('does not misclassify another database failure as approved source protection', async () => {
    error = { message: 'unrelated update failure' }
    const response = await PUT(request('PUT'), context)
    expect(response.status).toBe(500)
    expect((await response.json()).reviewHref).toBeUndefined()
  })
  it('keeps live company authorization before any lookup or write', async () => {
    mocks.guard.mockResolvedValue({ ok: false, error: 'Forbidden', status: 403 })
    const response = await PUT(request('PUT'), context)
    expect(response.status).toBe(403)
    expect(mocks.client).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })
})


describe('assignment numeric request validation', () => {
  const modes = [
    { name: 'employee', row: { profile_id: worker, worker_type_snapshot: 'employee', labor_hours: 8, hourly_rate: 200 }, required: ['labor_hours', 'hourly_rate'] },
    { name: 'hourly contractor', row: { profile_id: worker, worker_type_snapshot: 'contractor', assignment_billing_type: 'hourly', labor_hours: 8, hourly_rate: 200 }, required: ['labor_hours', 'hourly_rate'] },
    { name: 'fixed contractor', row: { profile_id: worker, worker_type_snapshot: 'contractor', assignment_billing_type: 'fixed', external_amount: 1500 }, required: ['external_amount'] },
    { name: 'invoiced contractor', row: { profile_id: worker, worker_type_snapshot: 'contractor', assignment_billing_type: 'invoice', external_amount: 1500 }, required: ['external_amount'] },
  ]
  const invalid = [undefined, null, '', ' ', 'invalid', -1, '-1', true, false, [], {}, '0x10', 'Infinity', 0.001, 10000000000]
  for (const [method, handler] of [['POST', POST], ['PUT', PUT]] as const) {
    it.each(modes)(`${method} rejects missing, malformed, negative, excess-precision and overflowing required numbers for $name before DB access`, async mode => {
      for (const field of mode.required) {
        for (const value of invalid) {
          const response = await handler(request(method, { ...mode.row, [field]: value }), context)
          expect(response.status, `${field} = ${String(value)}`).toBe(400)
          expect((await response.json()).error).toContain(field)
        }
      }
      expect(mocks.client).not.toHaveBeenCalled()
      expect(writes).toHaveLength(0)
    })
    it.each(modes)(`${method} preserves explicit zero for required $name numbers`, async mode => {
      error = null
      const row = { ...mode.row, ...Object.fromEntries(mode.required.map(field => [field, 0])) }
      const response = await handler(request(method, row), context)
      expect(response.status).toBe(200)
      expect(writePayloads).toHaveLength(1)
      for (const field of mode.required) expect(writePayloads[0]).toHaveProperty(field, 0)
    })
    it.each(['fixed', 'invoice'])(`${method} omits absent optional hourly values for %s instead of writing null or resetting them`, async billingType => {
      error = null
      const row = { profile_id: worker, worker_type_snapshot: 'contractor', assignment_billing_type: billingType, external_amount: '1200.50', labor_hours: null }
      expect((await handler(request(method, row), context)).status).toBe(200)
      expect(writePayloads[0]).toMatchObject({ external_amount: 1200.5, assignment_billing_type: billingType })
      expect(writePayloads[0]).not.toHaveProperty('labor_hours')
      expect(writePayloads[0]).not.toHaveProperty('hourly_rate')
      hasAssignments = false; writePayloads = []; writes = []
      expect((await handler(request(method, row), context)).status).toBe(200)
      expect(writes).toEqual(['insert'])
      const inserted = (writePayloads[0] as Record<string, unknown>[])[0]
      expect(inserted).toMatchObject({ company_id: company, external_amount: 1200.5 })
      expect(inserted).not.toHaveProperty('labor_hours')
      expect(inserted).not.toHaveProperty('hourly_rate')
    })
    it.each(['fixed', 'invoice'])(`${method} rejects an invalid supplied optional hourly field for %s`, async billingType => {
      for (const field of ['labor_hours', 'hourly_rate']) {
        for (const value of ['', ' ', -1, 'invalid', false, 0.001]) {
          const row = { profile_id: worker, worker_type_snapshot: 'contractor', assignment_billing_type: billingType, external_amount: 1200, [field]: value }
          expect((await handler(request(method, row), context)).status).toBe(400)
        }
      }
      expect(mocks.client).not.toHaveBeenCalled()
    })
    it(`${method} preserves supplied zero optional hours/rate for fixed-price work`, async () => {
      error = null
      expect((await handler(request(method, { profile_id: worker, worker_type_snapshot: 'contractor', assignment_billing_type: 'fixed', external_amount: 0, labor_hours: '0', hourly_rate: 0 }), context)).status).toBe(200)
      expect(writePayloads[0]).toMatchObject({ labor_hours: 0, hourly_rate: 0, external_amount: 0 })
    })
    it(`${method} rejects an unrecognized contractor billing basis before DB access`, async () => {
      for (const mode of [undefined, null, '', 'other']) {
        expect((await handler(request(method, { profile_id: worker, worker_type_snapshot: 'contractor', assignment_billing_type: mode, external_amount: 100 }), context)).status).toBe(400)
      }
      expect(mocks.client).not.toHaveBeenCalled()
    })
    it(`${method} accepts decimal strings and keeps the hourly financial basis`, async () => {
      error = null
      expect((await handler(request(method, { profile_id: worker, labor_hours: '7.25', hourly_rate: ' 150.50 ' }), context)).status).toBe(200)
      expect(writePayloads[0]).toMatchObject({ labor_hours: 7.25, hourly_rate: 150.5, worker_type_snapshot: 'employee', assignment_billing_type: null, external_amount: null })
    })
  }
  it('validates every PUT item before writing the first otherwise valid item', async () => {
    error = null
    const body = { assignments: [{ profile_id: worker, labor_hours: 8, hourly_rate: 200 }, { profile_id: actor, labor_hours: null, hourly_rate: 200 }] }
    const req = new NextRequest(`https://app.diriqo.test/api/jobs/${job}/assignments`, { method: 'PUT', body: JSON.stringify(body) })
    expect((await PUT(req, context)).status).toBe(400)
    expect(mocks.client).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })
  it.each([null, [], {}, { assignments: [] }, { assignments: [null] }])('rejects malformed PUT payload %j', async body => {
    const req = new NextRequest(`https://app.diriqo.test/api/jobs/${job}/assignments`, { method: 'PUT', body: JSON.stringify(body) })
    expect((await PUT(req, context)).status).toBe(400)
    expect(mocks.client).not.toHaveBeenCalled()
  })
})
