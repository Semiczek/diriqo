import type { DiriqentScope } from './access'
import type { AiUsage } from './domain'

export type WorkMode = 'analytics' | 'plan'
export type WorkDataset = 'operations' | 'finance'
export type WorkSpec = { dataset: WorkDataset; from: string; to: string }
export type WorkRequest = { companyId: string; mode: WorkMode; spec: WorkSpec; prompt: string; maxUnits: number }
export type WorkQuote = {
  id: string
  companyId: string
  profileId: string
  scope: DiriqentScope
  mode: WorkMode
  spec: WorkSpec
  prompt: string
  maxUnits: number
  rateVersion: string
  multiplier: number
  expiresAt: string
}
export type WorkResult = {
  answer: string
  findings: { title: string; detail: string; metricKeys: string[] }[]
  steps: { title: string; detail: string; jobId: string | null }[]
  caveats: string[]
}

export const WORK_RATE_VERSIONS = {
  analytics: 'diriqent-analytics-test-czk-v1',
  plan: 'diriqent-plan-test-czk-v1',
} as const
export const WORK_MULTIPLIERS = { analytics: 2, plan: 3 } as const

/**
 * Recognizes explicit advanced intent for navigation to a separate approval screen.
 * This is not a complete language classifier, a billing decision or an access check.
 * Resolve prepared support guides first; never start paid work from this result alone.
 */
export function advancedWorkMode(prompt: unknown): WorkMode | null {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) return null
  const text = prompt.normalize('NFKD').replace(/\p{M}/gu, '').replace(/\p{Cf}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

  const plan = /\b(priorit\w*|vicekrok\w*|multistep|roadmap\w*|harmonogram\w*)\b/.test(text)
    || /\b(?:vice|nekolik) krok\w*\b|\bmulti[ -]+step\b/.test(text)
    || /\b(?:work|working|action|task|project) plan\w*\b/.test(text)
    || /\bplan (?:my |our |the )?(?:work|tasks?|steps?|project)\b/.test(text)
    || /\b(?:plan|planu|planem|planovani) (?:(?:dalsi|dalsich|konkretnich|konkretni|pracovnich|sloziteho) ){0,3}(?:prace|ukol\w*|krok\w*|kapacit\w*|tymu|projekt\w*|tydn\w*|zakazk\w*|vyrob\w*)\b/.test(text)
    || /\b(?:navrhni|priprav|sestav|rozvrhni|naplanuj|vymysli)\b.*\b(?:postup|rozvrh\w*|krok\w*|plan|praci|ukol\w*)\b/.test(text)
  if (plan) return 'plan'

  const analytics = /\b(analyz\w*|analyti\w*|analysis|analyses|analy[sz]e\w*|compar\w*|porovn\w*|statistik\w*|statistic\w*|trend\w*|predik\w*|predict\w*|forecast\w*|report\w*|souhrn\w*|shrn\w*|summary|summari[sz]\w*|vyhodno\w*|zhodnot\w*|agreg\w*|aggregat\w*|rozbor\w*)\b/.test(text)
  return analytics ? 'analytics' : null
}

/** Provider format is strict; the runtime parser also validates sizes and references. */
export const WORK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'findings', 'steps', 'caveats'],
  properties: {
    answer: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'metricKeys'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          metricKeys: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'jobId'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          jobId: { type: ['string', 'null'] },
        },
      },
    },
    caveats: { type: 'array', items: { type: 'string' } },
  },
} as const

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactObject(value: unknown, keys: readonly string[], error: string): Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error(error)
  return value
}

function isMode(value: unknown): value is WorkMode {
  return value === 'analytics' || value === 'plan'
}

function isDataset(value: unknown): value is WorkDataset {
  return value === 'operations' || value === 'finance'
}

function checkedText(value: unknown, max: number, error: string): string {
  if (typeof value !== 'string' || value.length > max || !value.trim()) throw new Error(error)
  return value.trim()
}

function dateValue(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) {
    throw new Error('Vyberte platné datum ve formátu RRRR-MM-DD.')
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error('Vyberte platné datum ve formátu RRRR-MM-DD.')
  }
  return timestamp
}

export function validateWorkRequest(input: unknown): WorkRequest {
  const value = exactObject(input, ['companyId', 'mode', 'spec', 'prompt', 'maxUnits'], 'Neplatné zadání práce s daty.')
  if (typeof value.companyId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.companyId)) {
    throw new Error('Neplatná firma.')
  }
  if (!isMode(value.mode)) throw new Error('Vyberte analytiku nebo plán úkolu.')
  const spec = exactObject(value.spec, ['dataset', 'from', 'to'], 'Neplatný rozsah podkladů.')
  if (!isDataset(spec.dataset)) throw new Error('Vyberte dostupnou oblast podkladů.')
  const from = dateValue(spec.from), to = dateValue(spec.to)
  if (to < from || (to - from) / 86_400_000 + 1 > 90) throw new Error('Období musí mít 1 až 90 dní včetně počátečního a koncového dne.')
  const prompt = checkedText(value.prompt, 4000, 'Vyplňte zadání do 4 000 znaků.')
  if (typeof value.maxUnits !== 'number' || !Number.isSafeInteger(value.maxUnits) || value.maxUnits < 100 || value.maxUnits > 5000) {
    throw new Error('Vyberte limit spotřeby od 1 do 50 Kč.')
  }
  return {
    companyId: value.companyId.toLowerCase(), mode: value.mode,
    spec: { dataset: spec.dataset, from: spec.from as string, to: spec.to as string }, prompt, maxUnits: value.maxUnits,
  }
}

/** Use the current server membership; a dataset choice or a budget never grants access. */
export function canUseWorkDataset(role: unknown, dataset: unknown): boolean {
  if (!isDataset(dataset)) return false
  if (role === 'super_admin' || role === 'company_admin') return true
  return dataset === 'operations' && (role === 'manager' || role === 'worker')
}

export function workModeLabel(mode: WorkMode): string {
  if (mode === 'analytics') return 'Analytika'
  if (mode === 'plan') return 'Plán úkolu'
  throw new Error('Neplatný režim práce s daty.')
}

export function workDatasetLabel(dataset: WorkDataset): string {
  if (dataset === 'operations') return 'Provoz a zakázky'
  if (dataset === 'finance') return 'Hodnota zakázek'
  throw new Error('Neplatná oblast podkladů.')
}

export function parseWorkResult(text: string, context: unknown, mode: WorkMode): WorkResult {
  const error = 'Asistent nevrátil použitelný výsledek práce s daty.'
  if (!isMode(mode) || typeof text !== 'string') throw new Error(error)
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error(error) }
  const value = exactObject(parsed, ['answer', 'findings', 'steps', 'caveats'], error)
  const answer = checkedText(value.answer, 12000, error)
  if (!Array.isArray(value.findings) || value.findings.length > 12
    || !Array.isArray(value.steps) || value.steps.length > 20
    || !Array.isArray(value.caveats) || value.caveats.length > 10
    || (mode === 'analytics' && value.steps.length !== 0)) throw new Error(error)

  const metrics = record(context) && record(context.metrics) ? Object.keys(context.metrics) : []
  const allowedMetrics = new Set(metrics)
  const jobs = record(context) && Array.isArray(context.jobs) ? context.jobs : []
  const allowedJobs = new Set(jobs.filter((job): job is Record<string, unknown> => record(job))
    .map(job => job.id).filter((id): id is string => typeof id === 'string'))

  const findings = value.findings.map(item => {
    const finding = exactObject(item, ['title', 'detail', 'metricKeys'], error)
    if (!Array.isArray(finding.metricKeys) || finding.metricKeys.length > allowedMetrics.size
      || finding.metricKeys.some(key => typeof key !== 'string' || !allowedMetrics.has(key))
      || new Set(finding.metricKeys).size !== finding.metricKeys.length) throw new Error('Výsledek odkazuje na nedostupný nebo opakovaný ukazatel.')
    return {
      title: checkedText(finding.title, 160, error), detail: checkedText(finding.detail, 1800, error),
      metricKeys: [...finding.metricKeys] as string[],
    }
  })
  const steps = value.steps.map(item => {
    const step = exactObject(item, ['title', 'detail', 'jobId'], error)
    if (step.jobId !== null && (typeof step.jobId !== 'string' || !allowedJobs.has(step.jobId))) {
      throw new Error('Plán odkazuje na nedostupnou zakázku.')
    }
    return { title: checkedText(step.title, 160, error), detail: checkedText(step.detail, 1800, error), jobId: step.jobId as string | null }
  })
  return { answer, findings, steps, caveats: value.caveats.map(caveat => checkedText(caveat, 1800, error)) }
}

/** Same provider cost as basic chat; apply the mode multiplier before rounding CZK cents. */
export function workUsageCharge(usage: AiUsage, reserved: number, mode: WorkMode) {
  if (!isMode(mode) || !record(usage)) throw new Error('Neplatná spotřeba.')
  for (const count of [usage.inputTokens, usage.cachedTokens, usage.outputTokens, reserved]) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Neplatná spotřeba.')
  }
  if (usage.cachedTokens > usage.inputTokens) throw new Error('Neplatná spotřeba cache.')
  const million = BigInt(1_000_000)
  const ceilDivide = (value: bigint, divisor: bigint) => (value + divisor - BigInt(1)) / divisor
  const provider = ceilDivide((BigInt(usage.inputTokens) - BigInt(usage.cachedTokens)) * BigInt(2_000_000)
    + BigInt(usage.cachedTokens) * BigInt(200_000) + BigInt(usage.outputTokens) * BigInt(12_000_000), million)
  const charge = ceilDivide(provider * BigInt(mode === 'analytics' ? 15_000 : 22_500), million)
  if (provider > BigInt(Number.MAX_SAFE_INTEGER) || charge > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Spotřeba překročila podporovaný rozsah.')
  const providerMicrousd = Number(provider), calculatedCredit = Number(charge)
  return { providerMicrousd, creditUnits: Math.min(reserved, calculatedCredit), unbilledUnits: Math.max(0, calculatedCredit - reserved) }
}
