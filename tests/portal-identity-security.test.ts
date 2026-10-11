import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  guard: vi.fn(), admin: vi.fn(), getUser: vi.fn(), createUser: vi.fn(),
  updateUser: vi.fn(), deleteUser: vi.fn(), resetPassword: vi.fn(),
  insert: vi.fn(), update: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-guards', () => ({ requireCompanyRole: mocks.guard }))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))
vi.mock('@/lib/public-app-url', () => ({ getPublicAppBaseUrl: () => 'https://example.invalid' }))

import { POST } from '../app/api/customer-portal-users/route'

const COMPANY_A = '11111111-1111-4111-8111-111111111111'
const COMPANY_B = '22222222-2222-4222-8222-222222222222'
const CUSTOMER = '33333333-3333-4333-8333-333333333333'
const CONTACT = '44444444-4444-4444-8444-444444444444'
const AUTH_USER = '55555555-5555-4555-8555-555555555555'
const PORTAL_USER = '66666666-6666-4666-8666-666666666666'
const OWNER_EMAIL = 'owner@example.invalid'
const ATTACKER_EMAIL = 'attacker@example.invalid'
type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string } | null }
let customer: Row
let contact: Row
let portalRows: Row[]
let authUser: { id: string; email?: string | null; user_metadata: Row }
let insertError: string | null
let updateError: string | null
let rebindAfterUpdate: boolean

function request(overrides: Row = {}) {
  return new NextRequest('https://example.invalid/api/customer-portal-users', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: CUSTOMER, contactId: CONTACT, email: OWNER_EMAIL,
      fullName: 'Tenant-local contact name', ...overrides }),
  })
}

function expectNoIdentityWriteOrRecovery() {
  expect(mocks.updateUser).not.toHaveBeenCalled()
  expect(mocks.createUser).not.toHaveBeenCalled()
  expect(mocks.deleteUser).not.toHaveBeenCalled()
  expect(mocks.resetPassword).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetAllMocks()
  customer = { id: CUSTOMER, company_id: COMPANY_A, name: 'Synthetic company A customer' }
  contact = { id: CONTACT, customer_id: CUSTOMER, email: OWNER_EMAIL, full_name: 'Contact name' }
  portalRows = [{ id: PORTAL_USER, customer_id: CUSTOMER, contact_id: CONTACT,
    auth_user_id: AUTH_USER, email: OWNER_EMAIL, full_name: 'Contact name', is_active: true }]
  authUser = { id: AUTH_USER, email: OWNER_EMAIL, user_metadata: { full_name: 'Account owner' } }
  insertError = null
  updateError = null
  rebindAfterUpdate = false
  mocks.guard.mockResolvedValue({ ok: true, value: { companyId: COMPANY_A, role: 'company_admin' } })
  mocks.getUser.mockImplementation(async () => ({ data: { user: structuredClone(authUser) }, error: null }))
  // A faithful mutable sink makes the pre-fix takeover observable, not just a call-count check.
  mocks.updateUser.mockImplementation(async (_id: string, attributes: Partial<typeof authUser>) => {
    Object.assign(authUser, attributes)
    return { data: { user: structuredClone(authUser) }, error: null }
  })
  mocks.createUser.mockImplementation(async (attributes: Partial<typeof authUser>) => {
    Object.assign(authUser, attributes)
    return { data: { user: structuredClone(authUser) }, error: null }
  })
  mocks.deleteUser.mockResolvedValue({ data: {}, error: null })
  mocks.resetPassword.mockResolvedValue({ data: {}, error: null })
  mocks.admin.mockReturnValue({
    auth: {
      admin: { getUserById: mocks.getUser, createUser: mocks.createUser,
        updateUserById: mocks.updateUser, deleteUser: mocks.deleteUser },
      resetPasswordForEmail: mocks.resetPassword,
    },
    from: (table: string) => {
      const filters = new Map<string, unknown>()
      let operation = 'select'
      let values: Row = {}
      const execute = (): Result => {
        const rows = table === 'customers' ? [customer] : table === 'customer_contacts' ? [contact] : portalRows
        const matches = rows.filter(row => [...filters].every(([key, value]) => row[key] === value))
        if (operation === 'insert') {
          mocks.insert(table, values)
          if (insertError) return { data: null, error: { message: insertError } }
          const row = { id: PORTAL_USER, ...values }
          portalRows.push(row)
          return { data: [row], error: null }
        }
        if (operation === 'update') {
          mocks.update(table, values, Object.fromEntries(filters))
          if (updateError) return { data: null, error: { message: updateError } }
          for (const row of matches) Object.assign(row, values)
          if (rebindAfterUpdate) portalRows[0].auth_user_id = 'different-auth-user'
          return { data: null, error: null }
        }
        return { data: structuredClone(matches), error: null }
      }
      const single = async () => {
        const result = execute()
        return { ...result, data: Array.isArray(result.data) ? result.data[0] ?? null : result.data }
      }
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.set(key, value); return query },
        insert: (row: Row) => { operation = 'insert'; values = row; return query },
        update: (row: Row) => { operation = 'update'; values = row; return query },
        maybeSingle: single, single,
        then: (resolve: (value: Result) => unknown) => Promise.resolve(execute()).then(resolve),
      }
      return query
    },
  })
})

describe('portal invitations preserve the globally shared Auth identity', () => {
  it.each([ATTACKER_EMAIL, ' ATTACKER@EXAMPLE.INVALID ', 'owner+attacker@example.invalid',
    'owner@exаmple.invalid'])('rejects changing the shared account to %s', async (email) => {
    const companyBMembership = { company_id: COMPANY_B, auth_user_id: AUTH_USER, role: 'company_admin' }
    const originalIdentity = structuredClone(authUser)
    const response = await POST(request({ email }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('přihlašovacímu e-mailu') })
    expect(authUser).toEqual(originalIdentity)
    expect(companyBMembership.auth_user_id).toBe(authUser.id)
    expectNoIdentityWriteOrRecovery()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('does not trust a changed contact or stale portal email as the recovery identity', async () => {
    contact.email = ATTACKER_EMAIL
    portalRows[0].email = ATTACKER_EMAIL
    const response = await POST(request({ email: ATTACKER_EMAIL }))
    expect(response.status).toBe(409)
    expect(authUser.email).toBe(OWNER_EMAIL)
    expectNoIdentityWriteOrRecovery()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it.each([undefined, null, '', '   '])('fails closed when Auth has no canonical email (%s)', async (email) => {
    authUser.email = email
    const response = await POST(request())
    expect(response.status).toBe(409)
    expectNoIdentityWriteOrRecovery()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('preserves repeat invitations and local profile updates without changing global metadata', async () => {
    portalRows[0].is_active = false
    const originalIdentity = structuredClone(authUser)
    const response = await POST(request({ email: ' OWNER@EXAMPLE.INVALID ' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, created: false, authUserId: AUTH_USER })
    expect(mocks.guard).toHaveBeenCalledWith('super_admin', 'company_admin')
    expect(mocks.getUser).toHaveBeenCalledWith(AUTH_USER)
    expect(mocks.updateUser).not.toHaveBeenCalled()
    expect(authUser).toEqual(originalIdentity)
    expect(mocks.update).toHaveBeenCalledWith('customer_portal_users', expect.objectContaining({
      full_name: 'Tenant-local contact name', email: OWNER_EMAIL, is_active: true,
    }), { id: PORTAL_USER, customer_id: CUSTOMER, contact_id: CONTACT })
    expect(mocks.resetPassword).toHaveBeenCalledExactlyOnceWith(OWNER_EMAIL, {
      redirectTo: 'https://example.invalid/portal/reset-password',
    })
  })

  it('refreshes a stale local email only from the current Auth identity', async () => {
    authUser.email = ' CURRENT@EXAMPLE.INVALID '
    const response = await POST(request({ email: 'current@example.invalid', fullName: '' }))
    expect(response.status).toBe(200)
    expect(portalRows[0]).toMatchObject({ email: 'current@example.invalid', full_name: 'Contact name' })
    expect(mocks.updateUser).not.toHaveBeenCalled()
    expect(mocks.resetPassword).toHaveBeenCalledWith('current@example.invalid', expect.any(Object))
  })

  it('rejects an absent Auth identity without falling back to the local email', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Account missing' } })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expectNoIdentityWriteOrRecovery()
  })

  it('does not send recovery when updating the local account fails', async () => {
    updateError = 'Synthetic write failure'
    const response = await POST(request())
    expect(response.status).toBe(400)
    expectNoIdentityWriteOrRecovery()
  })

  it('does not send recovery after the contact has been rebound to another Auth identity', async () => {
    rebindAfterUpdate = true
    const response = await POST(request())
    expect(response.status).toBe(409)
    expectNoIdentityWriteOrRecovery()
  })

  it('reports a provider recovery failure without changing the identity', async () => {
    mocks.resetPassword.mockResolvedValue({ data: null, error: { message: 'Synthetic provider failure' } })
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect(authUser.email).toBe(OWNER_EMAIL)
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
})

describe('portal invitation authorization and new account compatibility', () => {
  it.each([401, 403])('preserves the role guard response %s before privileged access', async (status) => {
    mocks.guard.mockResolvedValue({ ok: false, status, error: 'Access denied' })
    const response = await POST(request())
    expect(response.status).toBe(status)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('rejects a customer belonging to a different company', async () => {
    customer.company_id = COMPANY_B
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expectNoIdentityWriteOrRecovery()
  })

  it('rejects a contact belonging to a different customer', async () => {
    contact.customer_id = 'foreign-customer'
    const response = await POST(request())
    expect(response.status).toBe(404)
    expectNoIdentityWriteOrRecovery()
  })

  it('rejects duplicate portal bindings without choosing an arbitrary global identity', async () => {
    portalRows.push({ ...portalRows[0], id: 'duplicate-portal', auth_user_id: 'other-auth-user' })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expectNoIdentityWriteOrRecovery()
  })

  it('creates and invites a new account while preserving the existing API response', async () => {
    portalRows = []
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, created: true,
      portalUserId: PORTAL_USER, authUserId: AUTH_USER })
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: OWNER_EMAIL,
      email_confirm: true, password: expect.any(String),
      user_metadata: { customer_id: CUSTOMER, customer_contact_id: CONTACT, full_name: 'Tenant-local contact name' },
    }))
    expect(mocks.insert).toHaveBeenCalledWith('customer_portal_users', expect.objectContaining({
      customer_id: CUSTOMER, contact_id: CONTACT, auth_user_id: AUTH_USER, email: OWNER_EMAIL,
    }))
    expect(mocks.updateUser).not.toHaveBeenCalled()
    expect(mocks.deleteUser).not.toHaveBeenCalled()
    expect(mocks.resetPassword).toHaveBeenCalledExactlyOnceWith(OWNER_EMAIL, expect.any(Object))
  })

  it('does not attach an already registered global account through the create path', async () => {
    portalRows = []
    mocks.createUser.mockResolvedValue({ data: { user: null }, error: { message: 'User already registered' } })
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.updateUser).not.toHaveBeenCalled()
    expect(mocks.deleteUser).not.toHaveBeenCalled()
    expect(mocks.resetPassword).not.toHaveBeenCalled()
  })

  it('cleans up only the newly created account after portal insertion fails', async () => {
    portalRows = []
    insertError = 'Synthetic insert failure'
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect(mocks.deleteUser).toHaveBeenCalledExactlyOnceWith(AUTH_USER)
    expect(mocks.updateUser).not.toHaveBeenCalled()
    expect(mocks.resetPassword).not.toHaveBeenCalled()
  })
})
