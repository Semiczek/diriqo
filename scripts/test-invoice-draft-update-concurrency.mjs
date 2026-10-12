// Authorized Diriqo TEST only. Two edits of ONE synthetic draft use ONE revision.
// Usage: node scripts/test-invoice-draft-update-concurrency.mjs --fixture=<private.json>
//   --output=<evidence.json> --request-delay-ms=15000
// Private JSON: {email,password,fixture:{companyId,invoiceId,itemA,itemB}}.
// Email: invoice-draft-concurrency-...@example.invalid. Exactly two draft lines.
// Root separately locks the parent FOR UPDATE, observes two waiting backend PIDs,
// then releases the barrier. HTTP overlap alone is not database-overlap evidence.
// This never issues an invoice. Root owns fixture setup and eventual cleanup.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const project = 'wfcpfraxiuhuglnuaxqj'
const url = `https://${project}.supabase.co`
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const separator = arg.indexOf('=')
  assert(separator > 0, 'Use --name=value arguments')
  return [arg.slice(0, separator), arg.slice(separator + 1)]
}))
assert(args['--fixture'] && args['--output'], 'Provide private fixture and evidence output paths')
assert(path.resolve(args['--fixture']) !== path.resolve(args['--output']), 'Do not overwrite credentials with evidence')
const requestDelayMs = Number(args['--request-delay-ms'] ?? 15000)
assert(Number.isInteger(requestDelayMs) && requestDelayMs >= 0 && requestDelayMs <= 45000, 'Delay must be 0..45000ms')
const auth = JSON.parse(await fs.readFile(args['--fixture'], 'utf8'))
assert(typeof auth.email === 'string' && /^invoice-draft-concurrency-[^@]+@example\.invalid$/.test(auth.email),
  'Dedicated synthetic account required')
assert(typeof auth.password === 'string' && auth.password.length > 0, 'Private fixture password required')
const f = auth.fixture
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
assert(f && [f.companyId, f.invoiceId, f.itemA, f.itemB].every(value => typeof value === 'string' && uuid.test(value)),
  'Company, invoice and both item UUIDs required')
assert(f.itemA !== f.itemB, 'Two different item IDs required')
const env = Object.fromEntries((await fs.readFile(path.join(root, '.env.local'), 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
  .map(([, key, value]) => [key, value.trim().replace(/^["']|["']$/g, '')]))
assert(env.NEXT_PUBLIC_SUPABASE_URL === url, 'Wrong test project')
assert(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Missing public Supabase API key')
const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Connection: 'close' }
const tokens = []
const sessionIds = []
let userId
let report
const supplierKeys = ['name', 'billingName', 'companyNumber', 'vatNumber', 'billingStreet', 'billingCity',
  'billingPostalCode', 'billingCountry', 'bankAccountNumber', 'bankCode', 'iban', 'swiftBic']
const customerKeys = ['name', 'billingName', 'companyNumber', 'vatNumber', 'billingStreet', 'billingCity',
  'billingPostalCode', 'billingCountry', 'email', 'phone']
const textFields = (source, keys) => Object.fromEntries(keys.map(key => [key, typeof source?.[key] === 'string' ? source[key] : null]))
const money = value => Math.round(Number(value) * 100)
const metadata = item => Object.fromEntries(Object.entries(item).filter(([key]) => ![
  'sort_order', 'item_name', 'description', 'quantity', 'unit', 'unit_price_without_vat',
  'vat_rate', 'vat_amount', 'total_without_vat', 'total_with_vat',
].includes(key)))
try {
  for (let index = 0; index < 2; index++) {
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers, body: JSON.stringify({ email: auth.email, password: auth.password }),
      signal: AbortSignal.timeout(30000),
    })
    assert(response.status === 200, `Synthetic login failed (HTTP ${response.status})`)
    const session = await response.json()
    assert(typeof session.access_token === 'string' && session.user?.id, 'Incomplete Auth response')
    tokens.push(session.access_token)
    assert(!userId || userId === session.user.id, 'Both sessions must belong to the same synthetic user')
    userId = session.user.id
    const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8'))
    assert(claims.role === 'authenticated' && typeof claims.session_id === 'string', 'Expected authenticated session')
    sessionIds.push(claims.session_id)
  }
  assert(sessionIds[0] !== sessionIds[1], 'Two different Auth sessions required')
  async function snapshot(token) {
    const response = await fetch(`${url}/rest/v1/rpc/get_invoice_edit_snapshot`, {
      method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ target_company_id: f.companyId, target_invoice_id: f.invoiceId }),
      signal: AbortSignal.timeout(30000),
    })
    assert(response.status === 200, `Snapshot failed (HTTP ${response.status})`)
    const value = await response.json()
    assert(value.invoice?.id === f.invoiceId && value.invoice.company_id === f.companyId
      && value.invoice.status === 'draft' && value.invoice.issued_at === null, 'Only the configured unissued draft may be tested')
    assert(Array.isArray(value.items) && value.items.length === 2
      && [f.itemA, f.itemB].every(id => value.items.some(item => item.id === id && item.invoice_id === f.invoiceId && item.company_id === f.companyId)),
    'Exactly both configured invoice items must be present')
    assert(typeof value.revision === 'string' && /^[a-f0-9]{64}$/.test(value.revision), 'Expected opaque SHA256 revision')
    return value
  }
  const before = await snapshot(tokens[0])
  const ids = [f.itemA, f.itemB]
  const commonHeader = {
    invoiceNumber: before.invoice.invoice_number, variableSymbol: before.invoice.variable_symbol,
    issueDate: before.invoice.issue_date, taxableSupplyDate: before.invoice.taxable_supply_date, dueDate: before.invoice.due_date,
    supplier: textFields(before.invoice.supplier_snapshot, supplierKeys),
    customer: textFields(before.invoice.customer_snapshot, customerKeys),
  }
  const attempts = ['A', 'B'].map((label, index) => ({
    label,
    prices: index === 0 ? ['11.11', '22.22'] : ['33.33', '44.44'],
    note: `atomic-draft-concurrency:${label}`,
  }))
  console.log(JSON.stringify({ ready: true, project, requestDelayMs, at: new Date().toISOString() }))
  await delay(requestDelayMs)
  async function edit(index) {
    const attempt = attempts[index]
    const started = new Date().toISOString()
    const start = performance.now()
    try {
      const response = await fetch(`${url}/rest/v1/rpc/update_invoice_draft_atomic`, {
        method: 'POST', headers: { ...headers, Authorization: `Bearer ${tokens[index]}` },
        body: JSON.stringify({ target_company_id: f.companyId, target_invoice_id: f.invoiceId,
          expected_revision: before.revision, expected_item_ids: ids,
          header_input: { ...commonHeader, note: attempt.note },
          item_inputs: ids.map((id, line) => ({ id, itemName: `Atomic ${attempt.label} line ${line + 1}`,
            description: `Complete attempt ${attempt.label}`, quantity: '1', unit: 'ks',
            unitPriceWithoutVat: attempt.prices[line], vatRate: '0' })),
        }), signal: AbortSignal.timeout(45000),
      })
      const data = await response.json()
      const success = response.status === 200 && data.updated === true && data.invoice_id === f.invoiceId
        && data.status === 'draft' && typeof data.revision === 'string' && /^[a-f0-9]{64}$/.test(data.revision)
      return { label: attempt.label, started, finished: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start),
        status: response.status, success, stale: response.status === 400 && data.code === '23514' && data.message === 'INVOICE_DRAFT_STALE',
        ...(!success && typeof data.code === 'string' ? { errorCode: data.code } : {}),
        ...(success ? { revision: data.revision } : {}) }
    } catch {
      return { label: attempt.label, started, finished: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start), transportError: true }
    }
  }
  // Both operations settle before either token is logged out, including failures.
  const responses = await Promise.all([edit(0), edit(1)])
  console.log(JSON.stringify({ responses }))
  assert(responses.filter(response => response.success).length === 1, 'Expected exactly one complete successful edit')
  assert(responses.filter(response => response.stale).length === 1, 'Expected exactly one 400/23514 INVOICE_DRAFT_STALE')
  const winnerIndex = responses.findIndex(response => response.success)
  const winner = attempts[winnerIndex]
  const after = await snapshot(tokens[1])
  assert(after.revision === responses[winnerIndex].revision && after.revision !== before.revision,
    'Final revision must match the winning commit')
  const payer = typeof commonHeader.supplier.vatNumber === 'string' && commonHeader.supplier.vatNumber.trim().length > 0
  assert(after.invoice.note === winner.note + (payer ? '' : '\nDodavatel není plátcem DPH.'), 'Final header must belong wholly to the winning edit')
  const expectedNet = winner.prices.reduce((sum, value) => sum + money(value), 0)
  assert(money(after.invoice.subtotal_without_vat) === expectedNet && money(after.invoice.total_with_vat) === expectedNet
    && money(after.invoice.vat_total) === 0, 'Final header totals must equal the winning lines')
  for (let line = 0; line < ids.length; line++) {
    const item = after.items.find(row => row.id === ids[line])
    assert(item.item_name === `Atomic ${winner.label} line ${line + 1}` && item.description === `Complete attempt ${winner.label}`
      && Number(item.quantity) === 1 && item.unit === 'ks' && item.sort_order === line + 1
      && money(item.unit_price_without_vat) === money(winner.prices[line]) && money(item.total_without_vat) === money(winner.prices[line])
      && money(item.total_with_vat) === money(winner.prices[line]) && Number(item.vat_rate) === 0 && money(item.vat_amount) === 0,
    'Every final line must belong wholly to the winning edit')
    assert(isDeepStrictEqual(metadata(item), metadata(before.items.find(row => row.id === ids[line]))), 'Source and identity metadata must remain unchanged')
  }
  assert(['id', 'company_id', 'customer_id', 'created_at', 'created_by'].every(key => isDeepStrictEqual(after.invoice[key], before.invoice[key])),
    'Invoice identity and creation metadata must remain unchanged')
  report = { project, mode: 'edit-edit', twoAuthenticatedHttpSessions: true, distinctAuthSessions: true,
    role: 'authenticated', requestDelayMs, sameExpectedRevision: true, successCount: 1, staleCount: 1,
    errorCode: '23514', errorMessage: 'INVOICE_DRAFT_STALE', responses, winner: winner.label,
    completeWinningHeaderAndItems: true, noMixedAttemptValues: true, sourceMetadataPreserved: true,
    invoiceRemainsDraft: true, databaseOverlapEvidence: 'Must be supplied separately by the owner barrier session' }
} finally {
  const logout = await Promise.allSettled(tokens.map(token => fetch(`${url}/auth/v1/logout?scope=local`, {
    method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  })))
  const loggedOutSessions = logout.filter(result => result.status === 'fulfilled' && result.value.ok).length
  if (report) {
    report.loggedOutSessions = loggedOutSessions
    report.passed = loggedOutSessions === tokens.length
    await fs.writeFile(args['--output'], JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
    assert(report.passed, 'One or more synthetic Auth sessions could not be logged out')
  }
}
