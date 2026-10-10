import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  CAPABILITIES, CAPABILITY_POLICY_VERSION, getCapability, isProductCode,
  evaluateCapabilityEntitlement,
} from '../lib/platform/capabilities.ts'
import {
  DRAFT_CATALOG, DRAFT_OFFERS, DRAFT_CORE_CAPABILITIES, getDraftOffer,
  annualPriceMinor, previewDraftPrice, validateDraftProductCombination,
} from '../lib/platform/catalog-czk-draft.ts'
import { plans } from '../lib/plans.ts'

// Vitest handles TS on the existing CI runtime; Node 24 also runs this without installed dependencies.
const { test } = process.env.VITEST === 'true' ? await import('vitest') : await import('node:test')

// Synthetic times and identities only. These tests do not exercise Auth or RLS.
const grant = (overrides = {}) => ({
  id: 'grant-A', companyId: 'company-A', product: 'pos', registerId: 'register-A',
  policyVersion: CAPABILITY_POLICY_VERSION, origin: 'paid', sourceRef: 'synthetic-invoice-A',
  state: 'active', revoked: false, validFrom: 1000, validUntil: 2000,
  historyUntil: 4000, graceUntil: null, graceCapabilities: [], cancelAtPeriodEnd: false,
  capabilities: ['pos.sale.create', 'pos.sale.settle', 'pos.history.read', 'pos.history.export'],
  ...overrides,
})
const request = (overrides = {}) => ({
  capability: 'pos.sale.create', companyId: 'company-A', registerId: 'register-A', now: 1500,
  snapshot: { status: 'ready', grants: [grant()] }, ...overrides,
})
const evaluate = (grantOverrides = {}, requestOverrides = {}) => evaluateCapabilityEntitlement(request({
  snapshot: { status: 'ready', grants: [grant(grantOverrides)] }, ...requestOverrides,
}))

test('annual draft prices follow the CZK proposal including the Mini exception', () => {
  assert.equal(previewDraftPrice('solo', 'yearly').amountMinor, 322920)
  assert.equal(previewDraftPrice('team', 'yearly').amountMinor, 754920)
  assert.equal(previewDraftPrice('company', 'yearly').amountMinor, 1402920)
  assert.equal(previewDraftPrice('pos_mini', 'yearly').amountMinor, 100000)
  assert.equal(previewDraftPrice('pos_classic', 'yearly').amountMinor, 430920)
  assert.equal(previewDraftPrice('pos_gastro', 'yearly').amountMinor, 754920)
  assert.equal(annualPriceMinor(1), 11)
  for (const invalid of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, '29900']) {
    assert.throws(() => annualPriceMinor(invalid), RangeError)
  }
})

test('legacy EUR prices and worker limits retain their original contract', () => {
  assert.deepEqual(Object.entries(plans).map(([key, value]) => [
    key, value.currency, value.priceMonthly, value.priceYearly, value.workerLimit,
  ]), [
    ['starter', 'EUR', 19, 190, 5], ['growth', 'EUR', 39, 390, 15],
    ['business', 'EUR', 79, 790, 30], ['scale', 'EUR', 149, 1490, 50],
  ])
  for (const key of Object.keys(plans)) assert.equal(getDraftOffer(key), null)
})

test('draft is immutable, unavailable for purchase and does not create a grant', () => {
  assert.equal(DRAFT_CATALOG.status, 'draft')
  assert.equal(DRAFT_CATALOG.purchasable, false)
  assert.equal(DRAFT_CATALOG.effectiveAt, null)
  assert.equal(previewDraftPrice('team', 'monthly').purchasable, false)
  assert.throws(() => { DRAFT_OFFERS.solo.monthlyMinor = 1 }, TypeError)
  assert.throws(() => DRAFT_OFFERS.team.proposedCapabilities.push('pos.sale.create'), TypeError)
  assert.equal(evaluateCapabilityEntitlement(request({ snapshot: { status: 'ready', grants: [] } })).entitled, false)
})

test('all core tiers keep the same core including simple quotes and manual costs', () => {
  for (const key of ['solo', 'team', 'company']) {
    const offer = getDraftOffer(key)
    assert.deepEqual(offer.proposedCapabilities, DRAFT_CORE_CAPABILITIES)
    assert.ok(offer.proposedCapabilities.includes('core.quotes.create'))
    assert.ok(offer.proposedCapabilities.includes('core.costs.record'))
    assert.ok(offer.proposedCapabilities.every((code) => getCapability(code).product === 'diriqo_core'))
  }
  assert.deepEqual(['solo', 'team', 'company'].map((key) => DRAFT_OFFERS[key].included), [
    { fullUsers: 1, additionalWorkers: 0 }, { fullUsers: 3, additionalWorkers: 10 },
    { fullUsers: 5, additionalWorkers: 30 },
  ])
})

test('product combinations permit standalone POS and shared add-ons but require core for fleet', () => {
  for (const products of [['pos'], ['diriqo_core'], ['pos', 'inventory', 'invoicing'],
    ['diriqo_core', 'pos', 'inventory'], ['diriqo_core', 'fleet', 'smart_quotes']]) {
    assert.equal(validateDraftProductCombination(products).valid, true)
  }
  for (const products of [[], ['inventory'], ['pos', 'fleet'], ['pos', 'smart_quotes'],
    ['diriqo_core', 'inventory', 'inventory'], ['constructor'], ['POS']]) {
    assert.equal(validateDraftProductCombination(products).valid, false)
  }
})

test('all proposed features belong to their product and Mini includes safe correction and closure', () => {
  for (const offer of Object.values(DRAFT_OFFERS)) {
    for (const code of offer.proposedCapabilities) assert.equal(getCapability(code)?.product, offer.product)
  }
  assert.ok(DRAFT_OFFERS.pos_mini.proposedCapabilities.includes('pos.sale.settle'))
  assert.ok(DRAFT_OFFERS.pos_mini.proposedCapabilities.includes('pos.shift.close'))
  assert.equal(DRAFT_OFFERS.pos_mini.proposedCapabilities.includes('pos.open_account.manage'), false)
  assert.ok(DRAFT_OFFERS.pos_gastro.proposedCapabilities.includes('pos.open_account.manage'))
  assert.equal(DRAFT_OFFERS.pos_gastro.proposedCapabilities.some((key) => key.startsWith('inventory.')), false)
})

test('unknown, prototype and coerced keys never silently resolve to a product or feature', () => {
  for (const value of [null, undefined, '', 'constructor', '__proto__', 'toString', 'POS', ' pos ',
    { toString: () => 'pos' }]) {
    assert.equal(isProductCode(value), false)
    assert.equal(getCapability(value), null)
    assert.equal(getDraftOffer(value), null)
    assert.equal(evaluateCapabilityEntitlement(request({ capability: value })).reason, 'unknown_capability')
  }
  assert.equal(previewDraftPrice('solo', 'weekly'), null)
})

test('missing, failed or malformed entitlement snapshots deny eligibility', () => {
  for (const snapshot of [null, { status: 'unavailable' }, { status: 'ready', grants: null }]) {
    assert.equal(evaluateCapabilityEntitlement(request({ snapshot })).reason, 'entitlements_unavailable')
  }
  for (const override of [{ policyVersion: 'unknown-v99' }, { sourceRef: '' }, { origin: 'toggle' },
    { state: 'draft' }, { state: 'unknown' }, { revoked: true }, { revoked: undefined },
    { capabilities: [] }, { validUntil: NaN }, { validUntil: 999 }, { historyUntil: 1999 },
    { validFrom: '1000' }, { graceUntil: 1000 }]) {
    assert.equal(evaluate(override).entitled, false, JSON.stringify(override))
  }
})

test('company and register boundaries do not share a higher tier grant', () => {
  assert.equal(evaluate().entitled, true) // No core grant exists.
  assert.equal(evaluate({}, { companyId: 'company-B' }).entitled, false)
  assert.equal(evaluate({}, { registerId: 'register-B' }).entitled, false)
  assert.equal(evaluate({}, { registerId: null }).reason, 'invalid_context')
  const mini = grant()
  const gastro = grant({ id: 'gastro-B', registerId: 'register-B', capabilities: ['pos.open_account.manage'] })
  assert.equal(evaluateCapabilityEntitlement(request({
    capability: 'pos.open_account.manage', snapshot: { status: 'ready', grants: [mini, gastro] },
  })).entitled, false)
  assert.equal(evaluateCapabilityEntitlement(request({
    capability: 'pos.open_account.manage', registerId: 'register-B', snapshot: { status: 'ready', grants: [mini, gastro] },
  })).entitled, true)
})

test('paid time is half-open and canceling renewal does not shorten it', () => {
  for (const [now, expected] of [[999, false], [1000, true], [1999, true], [2000, false]]) {
    assert.equal(evaluate({ cancelAtPeriodEnd: true }, { now }).entitled, expected)
  }
  for (const now of [NaN, Infinity, -1, 1500.5]) assert.equal(evaluate({}, { now }).reason, 'invalid_context')
  for (const state of ['readonly', 'canceled']) assert.equal(evaluate({ state }).entitled, false)
})

test('grace is bounded and grants only explicitly configured operations', () => {
  const grace = { state: 'grace', graceUntil: 2500, graceCapabilities: ['pos.sale.create'] }
  assert.equal(evaluate(grace, { now: 2000 }).entitled, true)
  assert.equal(evaluate(grace, { now: 2499 }).entitled, true)
  assert.equal(evaluate(grace, { now: 2500 }).entitled, false)
  assert.equal(evaluate({ ...grace, graceCapabilities: [] }, { now: 2100 }).entitled, false)
  assert.equal(evaluate({ ...grace, graceUntil: null }, { now: 2100 }).entitled, false)
})

test('history is explicit and retained for a bounded time without granting new work', () => {
  for (const capability of ['pos.history.read', 'pos.history.export']) {
    assert.equal(evaluate({ state: 'canceled' }, { capability, now: 3999 }).entitled, true)
    assert.equal(evaluate({ state: 'canceled' }, { capability, now: 4000 }).entitled, false)
    assert.equal(evaluate({ state: 'canceled', capabilities: ['pos.sale.create'] }, { capability }).entitled, false)
    assert.equal(evaluate({ state: 'draft' }, { capability }).entitled, false)
    assert.equal(evaluate({ revoked: true }, { capability }).entitled, false)
  }
  assert.equal(evaluate({ state: 'canceled' }, { now: 3000 }).entitled, false)
})

test('settlement license requires a matching old event and cannot permit a new sale', () => {
  const priorEvent = { eventId: 'event-A', entitlementId: 'grant-A', companyId: 'company-A',
    registerId: 'register-A', capability: 'pos.sale.create', occurredAt: 1999 }
  const context = { capability: 'pos.sale.settle', now: 5000, priorEvent }
  assert.equal(evaluate({ state: 'canceled' }, context).entitled, true)
  for (const change of [{ eventId: '' }, { entitlementId: 'foreign-grant' }, { companyId: 'company-B' },
    { registerId: 'register-B' }, { capability: 'pos.open_account.manage' }, { occurredAt: 2000 },
    { occurredAt: 999 }, { occurredAt: 6000 }]) {
    assert.equal(evaluate({ state: 'canceled' }, { ...context, priorEvent: { ...priorEvent, ...change } }).entitled, false)
  }
  assert.equal(evaluate({ state: 'canceled' }, { ...context, priorEvent: undefined }).entitled, false)
  assert.equal(evaluate({ state: 'canceled' }, { ...context, capability: 'pos.sale.create' }).entitled, false)
  assert.equal(evaluate({ revoked: true }, context).entitled, false)
})

test('multiple grants are independent and query order does not affect the result', () => {
  const rows = [grant({ id: 'expired', validUntil: 1200 }), grant({ id: 'B' }), grant({ id: 'A' })]
  const first = evaluateCapabilityEntitlement(request({ snapshot: { status: 'ready', grants: rows } }))
  const reversed = evaluateCapabilityEntitlement(request({ snapshot: { status: 'ready', grants: [...rows].reverse() } }))
  assert.equal(first.entitlementId, 'A')
  assert.deepEqual(first, reversed)
})

test('settlement preserves an explicitly licensed grace event after grace ends', () => {
  const grace = { state: 'grace', graceUntil: 2500, graceCapabilities: ['pos.sale.create'] }
  const priorEvent = { eventId: 'grace-event', entitlementId: 'grant-A', companyId: 'company-A',
    registerId: 'register-A', capability: 'pos.sale.create', occurredAt: 2100 }
  assert.equal(evaluate(grace, { now: priorEvent.occurredAt }).entitled, true)
  const context = { capability: 'pos.sale.settle', now: 3000, priorEvent }
  assert.equal(evaluate({ ...grace, state: 'canceled' }, context).entitled, true)
  assert.equal(evaluate({ ...grace, state: 'canceled', graceCapabilities: [] }, context).entitled, false)
  assert.equal(evaluate({ ...grace, graceUntil: null }, context).entitled, false)
  for (const occurredAt of [2500, 2501]) {
    assert.equal(evaluate(grace, { ...context, priorEvent: { ...priorEvent, occurredAt } }).entitled, false)
  }
})

test('domain OCR needs its own grant and budget; it does not require assistant membership', () => {
  const capability = 'inventory.ocr.request'
  const inventory = grant({ product: 'inventory', registerId: null, capabilities: [capability] })
  const context = request({ capability, registerId: null, snapshot: { status: 'ready', grants: [inventory] } })
  assert.equal(evaluateCapabilityEntitlement(context).entitled, true)
  assert.equal(getCapability(capability).requiresBudget, true)
  assert.equal(evaluateCapabilityEntitlement({ ...context, companyId: 'company-B' }).entitled, false)
  assert.equal(evaluateCapabilityEntitlement({ ...context, registerId: 'register-A' }).entitled, false)
  assert.equal(evaluateCapabilityEntitlement({ ...context, capability: 'ai_assistant.conversation.run' }).entitled, false)
  assert.equal(DRAFT_CATALOG.includedCreditCadence, 'paid_month_even_on_annual_plan')
  assert.equal(DRAFT_CATALOG.offers.ai_assistant.included.monthlyAiCreditMinor, 10000)
})

test('capability metadata is immutable and settlement points to the same product and scope', () => {
  assert.throws(() => { CAPABILITIES['pos.sale.create'].product = 'diriqo_core' }, TypeError)
  for (const definition of Object.values(CAPABILITIES)) {
    if (definition.purpose !== 'settle_prior_event') continue
    const source = getCapability(definition.settles)
    assert.equal(source?.purpose, 'new_operation')
    assert.equal(source?.product, definition.product)
    assert.equal(source?.scope, definition.scope)
  }
})

test('original specification and all acceptance identifiers are preserved', () => {
  const source = readFileSync(new URL('../docs/diriqo/source-specification-v0.1.txt', import.meta.url))
  assert.equal(createHash('sha256').update(source).digest('hex'), '29fea5e76ba572792e9a442a091685b62408e7dfe714c782b049afd923aa887e')
  const cases = JSON.parse(readFileSync(new URL('../docs/diriqo/acceptance-scenarios.json', import.meta.url), 'utf8'))
  assert.equal(cases.length, 73)
  assert.equal(new Set(cases.map((entry) => entry.id)).size, 73)
  assert.deepEqual(['C', 'M', 'P'].map((prefix) => cases.filter((entry) => entry.id.startsWith(prefix)).length), [30, 18, 25])
})
