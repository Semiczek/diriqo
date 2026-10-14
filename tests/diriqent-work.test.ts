import { describe, expect, it } from 'vitest'
import {
  advancedWorkMode, canUseWorkDataset, parseWorkResult, validateWorkRequest, workDatasetLabel, workModeLabel,
  workUsageCharge, WORK_MULTIPLIERS, WORK_RATE_VERSIONS, WORK_SCHEMA,
  type WorkMode, type WorkRequest, type WorkResult,
} from '../lib/diriqent/work'
import type { AiUsage } from '../lib/diriqent/domain'

const companyId = '11111111-1111-4111-8111-111111111111'
const jobId = '22222222-2222-4222-8222-222222222222'
const request = (): WorkRequest => ({
  companyId, mode: 'analytics', spec: { dataset: 'operations', from: '2026-01-01', to: '2026-03-31' },
  prompt: 'Zhodnoť průběh zakázek.', maxUnits: 500,
})
const context = { metrics: { jobCount: 12, completedCount: 4 }, jobs: [{ id: jobId, title: 'Montáž' }] }
const result = (): WorkResult => ({
  answer: 'Čtyři z evidovaných zakázek jsou dokončené.',
  findings: [{ title: 'Stav práce', detail: 'Výsledek vychází z dostupných podkladů.', metricKeys: ['jobCount', 'completedCount'] }],
  steps: [], caveats: ['Přehled neobsahuje záznamy mimo zvolené období.'],
})

describe('Advanced intent navigates to a separate approval flow', () => {
  it.each([
    'Analyzuj dostupné zakázky', 'ANALÝZA ZAKÁZEK', 'analy\u0301za zaka\u0301zek',
    'Porovnej tento měsíc s minulým', 'Chci statistiku dokončených zakázek',
    'Ukaž trendy v docházce', 'Predikce vytížení', 'Připrav report zakázek',
    'Souhrn dokončených zakázek', 'Shrň výsledky', 'Vyhodnoť vývoj zakázek',
    'Analyze available jobs', 'Analyse job completion', 'Give me an analysis',
    'Compare these jobs', 'Job statistics', 'Forecast the workload',
    'Summarize the records', 'A summary of completed jobs', 'Predict next month workload',
  ])('recognizes explicit analytics: %s', prompt => {
    expect(advancedWorkMode(prompt)).toBe('analytics')
  })

  it.each([
    'Navrhni priority zakázek', 'Chci vícekrokový postup', 'vicekrokovy ukol',
    'Rozděl práci do několika částí a navrhni několik kroků', 'Připrav plán práce',
    'Plán dalších kroků', 'Sestav harmonogram zakázek', 'Naplánuj práci týmu',
    'Připrav plán zakázky', 'Vymysli postup řešení',
    'Make a work plan', 'Create an action plan', 'Plan my work',
    'A multi-step task', 'A multistep task', 'Prioritize the available jobs',
    'Analyzuj zakázky a připrav plán práce',
  ])('recognizes explicit planning, including combined analysis and planning: %s', prompt => {
    expect(advancedWorkMode(prompt)).toBe('plan')
  })

  it.each([
    'Jaký stav má zakázka?', 'jaky stav ma zakazka', 'Připrav novou zakázku',
    'Priprav novou zakazku pro Nováka', 'Kde najdu zákazníka?',
    'Kolik mám dnes zakázek?', 'Jaké plánované zakázky mám zítra?',
    'What is the status of this job?', 'Create a new job', 'Open the calendar',
  ])('keeps simple requests and existing job proposals out of the advanced router: %s', prompt => {
    expect(advancedWorkMode(prompt)).toBeNull()
  })

  it.each([null, undefined, 123, [], {}, { prompt: 'Analyze jobs' }, '', '  ', 'Analyze '.repeat(501)])('does not coerce malformed or oversized input: %s', prompt => {
    expect(advancedWorkMode(prompt)).toBeNull()
  })
})

describe('Diriqent work request validation', () => {
  it('accepts an inclusive 90-day interval and normalizes prompt whitespace', () => {
    expect(validateWorkRequest({ ...request(), prompt: '  Zhodnoť zakázky.  ' })).toEqual({ ...request(), prompt: 'Zhodnoť zakázky.' })
  })

  it.each([
    ['2026-10-14', '2026-10-14'],
    ['2024-02-29', '2024-02-29'],
    ['2024-01-01', '2024-03-30'],
    ['2026-12-31', '2027-01-01'],
  ])('accepts real date boundaries %s to %s', (from, to) => {
    expect(validateWorkRequest({ ...request(), spec: { dataset: 'operations', from, to } }).spec).toEqual({ dataset: 'operations', from, to })
  })

  it.each([
    ['2026-01-01', '2026-04-01'],
    ['2024-01-01', '2024-03-31'],
    ['2026-02-29', '2026-03-01'],
    ['2026-02-30', '2026-03-01'],
    ['2026-04-31', '2026-05-01'],
    ['2026-13-01', '2026-13-02'],
    ['2026-10-15', '2026-10-14'],
    ['0000-01-01', '0000-01-02'],
    ['2026-1-01', '2026-01-02'],
    ['2026-01-01T00:00:00Z', '2026-01-02'],
    ['', '2026-01-02'],
  ])('rejects invalid or excessive date interval %s to %s', (from, to) => {
    expect(() => validateWorkRequest({ ...request(), spec: { dataset: 'operations', from, to } })).toThrow()
  })

  it.each([null, undefined, [], 'analytics', 1, {}, { ...request(), execute: 'delete' }])('rejects malformed or extra request fields: %s', value => {
    expect(() => validateWorkRequest(value)).toThrow()
  })

  it.each([
    { companyId: 'foreign' }, { companyId: ` ${companyId}` }, { companyId: 123 },
    { companyId: '11111111-1111-4111-1111-111111111111' },
    { mode: 'chat' }, { mode: 'ANALYTICS' }, { spec: null }, { spec: [] },
    { spec: { dataset: 'all', from: '2026-01-01', to: '2026-01-02' } },
    { spec: { ...request().spec, companyId: 'foreign' } },
    { prompt: ' ' }, { prompt: 5 }, { prompt: 'x'.repeat(4001) },
    { maxUnits: '500' }, { maxUnits: 99 }, { maxUnits: 5001 }, { maxUnits: 100.5 }, { maxUnits: Infinity }, { maxUnits: NaN },
  ])('rejects invalid request values %s', patch => {
    expect(() => validateWorkRequest({ ...request(), ...patch })).toThrow()
  })

  it('accepts both modes and budgets at their exact boundaries without changing the selected dataset', () => {
    for (const mode of ['analytics', 'plan'] as const) {
      for (const maxUnits of [100, 5000]) {
        const value = { ...request(), mode, maxUnits, prompt: 'x'.repeat(4000), spec: { ...request().spec, dataset: 'finance' as const } }
        expect(validateWorkRequest(value)).toEqual(value)
      }
    }
  })
})

describe('Work dataset permissions and labels', () => {
  it.each(['worker', 'manager'])('allows only operations for %s', role => {
    expect(canUseWorkDataset(role, 'operations')).toBe(true)
    expect(canUseWorkDataset(role, 'finance')).toBe(false)
  })

  it.each(['company_admin', 'super_admin'])('allows both datasets for %s', role => {
    expect(canUseWorkDataset(role, 'operations')).toBe(true)
    expect(canUseWorkDataset(role, 'finance')).toBe(true)
  })

  it.each([null, undefined, 'owner', 'admin', 'MANAGER', {}, { role: 'company_admin' }])('fails closed for unknown role %s', role => {
    expect(canUseWorkDataset(role, 'operations')).toBe(false)
    expect(canUseWorkDataset(role, 'finance')).toBe(false)
  })

  it.each([null, undefined, 'all', 'payroll', 'FINANCE', {}])('fails closed for unsupported dataset %s', dataset => {
    expect(canUseWorkDataset('super_admin', dataset)).toBe(false)
  })

  it('labels recorded job value without claiming profit and retains separate rate versions', () => {
    expect(workDatasetLabel('finance')).toBe('Hodnota zakázek')
    expect(workDatasetLabel('operations')).toBe('Provoz a zakázky')
    expect(workModeLabel('analytics')).toBe('Analytika')
    expect(workModeLabel('plan')).toBe('Plán úkolu')
    expect(WORK_RATE_VERSIONS).toEqual({ analytics: 'diriqent-analytics-test-czk-v1', plan: 'diriqent-plan-test-czk-v1' })
    expect(WORK_MULTIPLIERS).toEqual({ analytics: 2, plan: 3 })
  })
})

describe('Structured work results', () => {
  it('accepts only available references and leaves a plan as proposed steps', () => {
    expect(parseWorkResult(JSON.stringify(result()), context, 'analytics')).toEqual(result())
    const plan = { ...result(), steps: [{ title: 'Prověřit termín', detail: 'Vedoucí ověří dokončení práce.', jobId }, { title: 'Doplnit podklady', detail: 'Zkontrolovat neúplné údaje.', jobId: null }] }
    expect(parseWorkResult(JSON.stringify(plan), context, 'plan')).toEqual(plan)
  })

  it.each(['null', '[]', '{}', 'not JSON', '{"answer":"text"}'])('rejects incomplete structured output %s', text => {
    expect(() => parseWorkResult(text, context, 'analytics')).toThrow()
  })

  it.each([
    { jobProposal: { title: 'Injected write' } }, { execute: 'createJob' }, { companyId: 'foreign' },
  ])('rejects undeclared actions and references %s', extra => {
    expect(() => parseWorkResult(JSON.stringify({ ...result(), ...extra }), context, 'plan')).toThrow()
  })

  it.each(['foreignMetric', 'toString', '__proto__', 'https://example.com'])('rejects a metric key outside the supplied metrics: %s', key => {
    const value = { ...result(), findings: [{ ...result().findings[0], metricKeys: [key] }] }
    expect(() => parseWorkResult(JSON.stringify(value), context, 'analytics')).toThrow()
  })

  it('rejects duplicate metric references and malformed metric arrays', () => {
    for (const metricKeys of [['jobCount', 'jobCount'], [123], 'jobCount', null]) {
      expect(() => parseWorkResult(JSON.stringify({ ...result(), findings: [{ ...result().findings[0], metricKeys }] }), context, 'analytics')).toThrow()
    }
  })

  it.each(['other-job', 'https://example.com', 123, { id: jobId }])('rejects a step linked to an unavailable job %s', referenced => {
    expect(() => parseWorkResult(JSON.stringify({ ...result(), steps: [{ title: 'Krok', detail: 'Popis', jobId: referenced }] }), context, 'plan')).toThrow()
  })

  it('rejects undeclared nested links and any steps in analytics mode', () => {
    const step = { title: 'Krok', detail: 'Popis', jobId }
    expect(() => parseWorkResult(JSON.stringify({ ...result(), steps: [step] }), context, 'analytics')).toThrow()
    expect(() => parseWorkResult(JSON.stringify({ ...result(), steps: [{ ...step, href: '/admin' }] }), context, 'plan')).toThrow()
    expect(() => parseWorkResult(JSON.stringify({ ...result(), findings: [{ ...result().findings[0], href: '/admin' }] }), context, 'analytics')).toThrow()
  })

  it.each([null, {}, { metrics: [], jobs: [] }, { metrics: { different: 1 }, jobs: [{ id: jobId }] }])('fails reference checks when context has no matching authorized metrics: %s', invalidContext => {
    expect(() => parseWorkResult(JSON.stringify(result()), invalidContext, 'analytics')).toThrow()
  })

  it('accepts a caveated answer without invented references when no metrics or jobs are available', () => {
    const value = { answer: 'Pro vyhodnocení chybí podklady.', findings: [], steps: [], caveats: ['Ve vybraném období nejsou dostupné záznamy.'] }
    expect(parseWorkResult(JSON.stringify(value), { metrics: {}, jobs: [] }, 'analytics')).toEqual(value)
  })

  it('enforces array limits and text limits including nested plan details', () => {
    const finding = result().findings[0], step = { title: 'Krok', detail: 'Popis', jobId }
    for (const value of [
      { ...result(), answer: 'x'.repeat(12001) }, { ...result(), answer: ' ' },
      { ...result(), findings: Array.from({ length: 13 }, () => finding) },
      { ...result(), steps: Array.from({ length: 21 }, () => step) },
      { ...result(), caveats: Array.from({ length: 11 }, () => 'Upozornění') },
      { ...result(), findings: [{ ...finding, title: 'x'.repeat(161) }] },
      { ...result(), findings: [{ ...finding, detail: 'x'.repeat(1801) }] },
      { ...result(), steps: [{ ...step, title: 'x'.repeat(161) }] },
      { ...result(), steps: [{ ...step, detail: 'x'.repeat(1801) }] },
      { ...result(), caveats: ['x'.repeat(1801)] }, { ...result(), caveats: [null] },
    ]) expect(() => parseWorkResult(JSON.stringify(value), context, 'plan')).toThrow()
  })

  it('accepts exact result boundaries', () => {
    const finding = { title: 't'.repeat(160), detail: 'd'.repeat(1800), metricKeys: ['jobCount'] }
    const step = { title: 't'.repeat(160), detail: 'd'.repeat(1800), jobId }
    const value = { answer: 'a'.repeat(12000), findings: Array.from({ length: 12 }, () => finding), steps: Array.from({ length: 20 }, () => step), caveats: Array.from({ length: 10 }, () => 'c'.repeat(1800)) }
    expect(parseWorkResult(JSON.stringify(value), context, 'plan')).toEqual(value)
  })

  it('declares strict objects for the provider without an executable job proposal field', () => {
    expect(WORK_SCHEMA.additionalProperties).toBe(false)
    expect(WORK_SCHEMA.properties.findings.items.additionalProperties).toBe(false)
    expect(WORK_SCHEMA.properties.steps.items.additionalProperties).toBe(false)
    expect(WORK_SCHEMA.required).toEqual(['answer', 'findings', 'steps', 'caveats'])
    expect(WORK_SCHEMA.properties).not.toHaveProperty('jobProposal')
  })
})

describe('Work credit accounting', () => {
  const usage: AiUsage = { inputTokens: 1000, cachedTokens: 200, outputTokens: 100 }

  it.each([
    ['analytics', 43, 23], ['plan', 64, 44],
  ] as const)('uses exact %s pricing before rounding and caps the approved reservation', (mode, charge, unbilled) => {
    expect(workUsageCharge(usage, 100, mode)).toEqual({ providerMicrousd: 2840, creditUnits: charge, unbilledUnits: 0 })
    expect(workUsageCharge(usage, 20, mode)).toEqual({ providerMicrousd: 2840, creditUnits: 20, unbilledUnits: unbilled })
    expect(workUsageCharge(usage, 0, mode)).toEqual({ providerMicrousd: 2840, creditUnits: 0, unbilledUnits: charge })
  })

  it.each(['analytics', 'plan'] as const)('does not charge empty usage or multiply an already rounded base credit for %s', mode => {
    expect(workUsageCharge({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 }, 100, mode)).toEqual({ providerMicrousd: 0, creditUnits: 0, unbilledUnits: 0 })
    expect(workUsageCharge({ inputTokens: 1, cachedTokens: 1, outputTokens: 0 }, 100, mode)).toEqual({ providerMicrousd: 1, creditUnits: 1, unbilledUnits: 0 })
  })

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid accounting units %s', invalid => {
    for (const key of ['inputTokens', 'cachedTokens', 'outputTokens'] as const) {
      expect(() => workUsageCharge({ ...usage, [key]: invalid }, 100, 'analytics')).toThrow()
    }
    expect(() => workUsageCharge(usage, invalid, 'plan')).toThrow()
  })

  it('rejects impossible cached usage, unknown modes and unrepresentable provider cost', () => {
    expect(() => workUsageCharge({ ...usage, cachedTokens: 1001 }, 100, 'analytics')).toThrow(/cache/)
    expect(() => workUsageCharge(usage, 100, 'chat' as WorkMode)).toThrow()
    expect(() => workUsageCharge({ inputTokens: Number.MAX_SAFE_INTEGER, cachedTokens: 0, outputTokens: 0 }, 100, 'analytics')).toThrow(/rozsah/)
  })
})
