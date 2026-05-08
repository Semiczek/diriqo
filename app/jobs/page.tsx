'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import DashboardShell from '../../components/DashboardShell'
import { resolveCompanyTimeZone } from '@/lib/company-timezone'
import { useI18n } from '../../components/I18nProvider'
import {
  getCurrentMonthValuePrague as getCurrentMonthValue,
  parseDateSafe,
} from '@/lib/date/prague-time'
import { formatDateTimePrague } from '@/lib/formatters'
import {
  getEffectiveJobWorkState,
  getVisibleBillingState,
  isMultiDayJobRange,
  resolveJobBillingState,
  resolveJobTimeState,
  resolveJobWorkState,
  resolveLegacyJobStatus,
} from '../../lib/job-status'
import type {
  BillingStateResolved,
  TimeState,
  WorkState,
} from '../../lib/job-status'
import {
  buildJobShiftActivityMap,
  type JobShiftActivityRow,
} from '../../lib/job-shift-activity'
import { buildJobGroups, type JobParentLinkRow } from '../../lib/job-grouping'
import { supabase } from '../../lib/supabase'
import { getContractorBillingType, getWorkerType } from '@/lib/payroll-settings'
import { calculateQuotedJobEconomics } from '@/lib/economics'

type FilterType = 'all' | 'today' | TimeState | WorkState | BillingStateResolved
type SortType = 'date_asc' | 'date_desc' | 'customer_asc' | 'title_asc'
type ViewType = 'individual' | 'summary'

type JobRow = {
  id: string
  title: string | null
  description: string | null
  address: string | null
  status: string | null
  start_at: string | null
  end_at: string | null
  created_at: string | null
  parent_job_id: string | null
  price: number | null
  is_internal: boolean | null
  customer_id: string | null
  time_state: TimeState | null
  work_state: WorkState | null
  billing_state_resolved: BillingStateResolved | null
  assigned_total: number | null
  started_total: number | null
  completed_total: number | null
  active_workers: number | null
}

type Customer = {
  id: string
  name: string | null
}

type JobAssignmentProfile = {
  id: string
  full_name: string | null
  default_hourly_rate: number | null
  worker_type?: string | null
  contractor_billing_type?: string | null
  contractor_default_rate?: number | null
}

type JobAssignmentRow = {
  job_id: string
  profile_id: string | null
  labor_hours: number | null
  hourly_rate: number | null
  worker_type_snapshot?: string | null
  assignment_billing_type?: string | null
  external_amount?: number | null
  work_started_at: string | null
  work_completed_at: string | null
  profiles: JobAssignmentProfile | null
}

type RawJobAssignmentRow = {
  job_id?: string | null
  profile_id?: string | null
  labor_hours?: number | null
  hourly_rate?: number | null
  worker_type_snapshot?: string | null
  assignment_billing_type?: string | null
  external_amount?: number | null
  work_started_at?: string | null
  work_completed_at?: string | null
}

type JobEconomicsSummaryRow = {
  job_id: string
  revenue_total: number | null
  labor_hours_total: number | null
  labor_cost_total: number | null
  other_cost_total: number | null
  total_cost_total: number | null
  profit_total: number | null
  margin_percent: number | null
}

type JobWithComputed = JobRow & {
  workers: string[]
  workerProfileIds: string[]
  startedWorkerProfileIds: string[]
  completedWorkerProfileIds: string[]
  activeWorkerProfileIds: string[]
  laborCost: number
  otherCost: number
  profit: number
  customerName: string | null
  assignedCount: number
  activeCount: number
  completedCount: number
  notStartedCount: number
  startedCount: number
  timeStateResolved: TimeState
  workStateResolved: WorkState
  billingStateResolvedFinal: BillingStateResolved
  nextShiftAt: string | null
  lastShiftAt: string | null
  sortAt: string | null
}

type GroupedJobBlock = JobWithComputed & {
  memberJobs: JobWithComputed[]
  memberJobIds: string[]
  memberJobsCount: number
  shiftCount: number
  groupStartAt: string | null
  groupEndAt: string | null
  uniqueWorkers: string[]
  canShowBillingState: boolean
}

function getMonthKeyFromJob(
  job: Pick<JobRow, 'start_at' | 'end_at' | 'created_at'> & { sortAt?: string | null },
  timeZone: string
) {
  const baseDate =
    parseDateSafe(job.sortAt) ??
    parseDateSafe(job.start_at) ??
    parseDateSafe(job.end_at) ??
    parseDateSafe(job.created_at)

  if (!baseDate) return null

  const year = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
  }).format(baseDate)

  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    month: '2-digit',
  }).format(baseDate)

  return `${year}-${month}`
}

function toNumber(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function normalizeAssignments(
  data: RawJobAssignmentRow[],
  profilesById: Map<string, JobAssignmentProfile>
): JobAssignmentRow[] {
  return data.map((item) => {
    const profile = item?.profile_id ? profilesById.get(item.profile_id) ?? null : null

    return {
      job_id: item?.job_id ?? '',
      profile_id: item?.profile_id ?? null,
      labor_hours:
        item?.labor_hours !== null && item?.labor_hours !== undefined
          ? toNumber(item.labor_hours)
          : null,
      hourly_rate:
        item?.hourly_rate !== null && item?.hourly_rate !== undefined
          ? toNumber(item.hourly_rate)
          : null,
      worker_type_snapshot: item?.worker_type_snapshot ?? null,
      assignment_billing_type: item?.assignment_billing_type ?? null,
      external_amount:
        item?.external_amount !== null && item?.external_amount !== undefined
          ? toNumber(item.external_amount)
          : null,
      work_started_at: item?.work_started_at ?? null,
      work_completed_at: item?.work_completed_at ?? null,
      profiles: profile
        ? {
            id: profile.id,
            full_name: profile.full_name ?? null,
            default_hourly_rate:
              profile.default_hourly_rate !== null &&
              profile.default_hourly_rate !== undefined
                ? toNumber(profile.default_hourly_rate)
                : null,
            worker_type: profile.worker_type ?? null,
            contractor_billing_type: profile.contractor_billing_type ?? null,
            contractor_default_rate:
              profile.contractor_default_rate !== null &&
              profile.contractor_default_rate !== undefined
                ? toNumber(profile.contractor_default_rate)
                : null,
          }
        : null,
    }
  })
}

function getTimeStateStyles(state: TimeState) {
  if (state === 'future') {
    return { backgroundColor: 'rgba(37, 99, 235, 0.08)', color: '#1d4ed8', border: '1px solid rgba(37, 99, 235, 0.14)' }
  }

  if (state === 'active') {
    return { backgroundColor: 'rgba(37, 99, 235, 0.08)', color: '#1d4ed8', border: '1px solid rgba(37, 99, 235, 0.14)' }
  }

  if (state === 'finished') {
    return { backgroundColor: 'rgba(22, 163, 74, 0.09)', color: '#166534', border: '1px solid rgba(22, 163, 74, 0.16)' }
  }

  return { backgroundColor: 'rgba(100, 116, 139, 0.08)', color: '#475569', border: '1px solid rgba(100, 116, 139, 0.14)' }
}

function getWorkStateStyles(state: WorkState) {
  if (state === 'not_started') {
    return { backgroundColor: 'rgba(100, 116, 139, 0.08)', color: '#475569', border: '1px solid rgba(100, 116, 139, 0.14)' }
  }

  if (state === 'in_progress') {
    return { backgroundColor: 'rgba(37, 99, 235, 0.08)', color: '#1d4ed8', border: '1px solid rgba(37, 99, 235, 0.14)' }
  }

  if (state === 'partially_done') {
    return { backgroundColor: 'rgba(124, 58, 237, 0.08)', color: '#6d28d9', border: '1px solid rgba(124, 58, 237, 0.14)' }
  }

  if (state === 'done') {
    return { backgroundColor: 'rgba(22, 163, 74, 0.09)', color: '#166534', border: '1px solid rgba(22, 163, 74, 0.16)' }
  }

  return { backgroundColor: 'rgba(100, 116, 139, 0.08)', color: '#475569', border: '1px solid rgba(100, 116, 139, 0.14)' }
}

function getBillingStateStyles(state: BillingStateResolved) {
  if (state === 'waiting_for_invoice') {
    return { backgroundColor: 'rgba(249, 115, 22, 0.1)', color: '#c2410c', border: '1px solid rgba(249, 115, 22, 0.18)' }
  }

  if (state === 'due') {
    return { backgroundColor: 'rgba(37, 99, 235, 0.08)', color: '#1d4ed8', border: '1px solid rgba(37, 99, 235, 0.14)' }
  }

  if (state === 'overdue') {
    return { backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#991b1b', border: '1px solid rgba(220, 38, 38, 0.18)' }
  }

  if (state === 'paid') {
    return { backgroundColor: 'rgba(22, 163, 74, 0.09)', color: '#166534', border: '1px solid rgba(22, 163, 74, 0.16)' }
  }

  return { backgroundColor: 'rgba(100, 116, 139, 0.08)', color: '#475569', border: '1px solid rgba(100, 116, 139, 0.14)' }
}

function getTimeStateIcon(state: TimeState) {
  if (state === 'future') return ''
  if (state === 'active') return '⏳'
  if (state === 'finished') return '✓'
  return ''
}

function getWorkStateIcon(state: WorkState) {
  if (state === 'not_started') return ''
  if (state === 'in_progress') return '⏳'
  if (state === 'partially_done') return '⏳'
  if (state === 'done') return '✓'
  return ''
}

function getBillingStateIcon(state: BillingStateResolved) {
  if (state === 'waiting_for_invoice') return '💰'
  if (state === 'due') return '↗'
  if (state === 'overdue') return '!'
  if (state === 'paid') return '✓'
  return ''
}

function shouldShowTimeStateBadge(timeState: TimeState, workState: WorkState) {
  if (timeState === 'finished' && workState === 'done') return false
  return true
}

function StatusBadge({
  icon,
  label,
  tone,
}: {
  icon: string
  label: string
  tone: CSSProperties
}) {
  return (
    <span style={{ ...statusBadge, ...tone }}>
      {icon ? <span style={statusBadgeIcon}>{icon}</span> : null}
      <span>{label}</span>
    </span>
  )
}

const statusBadgeGroup: CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  alignItems: 'flex-start',
}

const statusBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  minHeight: '38px',
  padding: '9px 13px',
  borderRadius: '18px',
  fontSize: '13px',
  lineHeight: 1,
  fontWeight: 900,
  whiteSpace: 'nowrap',
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
  backdropFilter: 'blur(10px)',
}

const statusBadgeIcon: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '16px',
  minWidth: '16px',
  fontSize: '13px',
  fontWeight: 900,
}

const jobMetricGrid: CSSProperties = {
  display: 'grid',
  gap: '12px',
  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  paddingTop: '16px',
  marginTop: '4px',
  marginBottom: '14px',
  borderTop: '1px solid rgba(226, 232, 240, 0.82)',
}

const jobMetricTile: CSSProperties = {
  padding: '12px 14px',
  borderRadius: '14px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  border: '1px solid rgba(226, 232, 240, 0.82)',
}

const jobMetricLabel: CSSProperties = {
  fontSize: '12px',
  color: '#64748b',
  marginBottom: '5px',
  fontWeight: 800,
}

const jobMetricValue: CSSProperties = {
  fontSize: '19px',
  lineHeight: 1.12,
  fontWeight: 900,
  letterSpacing: 0,
  color: '#0f172a',
}

type PremiumStatusTone = 'blue' | 'orange' | 'green' | 'amber' | 'red' | 'gray'

function getPremiumStatusTone(tone: PremiumStatusTone): CSSProperties {
  if (tone === 'green') {
    return {
      background: 'linear-gradient(135deg, rgba(220,252,231,0.98), rgba(187,247,208,0.92))',
      border: '1px solid rgba(34,197,94,0.50)',
      color: '#047857',
      boxShadow: '0 10px 24px rgba(34,197,94,0.20), 0 0 0 3px rgba(34,197,94,0.08)',
    }
  }

  if (tone === 'orange') {
    return {
      background: 'linear-gradient(135deg, rgba(255,237,213,0.98), rgba(254,215,170,0.92))',
      border: '1px solid rgba(249,115,22,0.52)',
      color: '#c2410c',
      boxShadow: '0 10px 24px rgba(249,115,22,0.20), 0 0 0 3px rgba(249,115,22,0.08)',
    }
  }

  if (tone === 'blue') {
    return {
      background: 'linear-gradient(135deg, rgba(219,234,254,0.98), rgba(207,250,254,0.90))',
      border: '1px solid rgba(37,99,235,0.46)',
      color: '#1d4ed8',
      boxShadow: '0 10px 24px rgba(37,99,235,0.18), 0 0 0 3px rgba(37,99,235,0.07)',
    }
  }

  if (tone === 'red') {
    return {
      background: 'linear-gradient(135deg, rgba(254,226,226,0.98), rgba(254,202,202,0.90))',
      border: '1px solid rgba(239,68,68,0.52)',
      color: '#b91c1c',
      boxShadow: '0 10px 24px rgba(239,68,68,0.20), 0 0 0 3px rgba(239,68,68,0.08)',
    }
  }

  if (tone === 'amber') {
    return {
      background: 'linear-gradient(135deg, rgba(254,243,199,0.98), rgba(253,230,138,0.90))',
      border: '1px solid rgba(245,158,11,0.52)',
      color: '#b45309',
      boxShadow: '0 10px 24px rgba(245,158,11,0.20), 0 0 0 3px rgba(245,158,11,0.08)',
    }
  }

  return {
    background: 'linear-gradient(135deg, rgba(248,250,252,0.98), rgba(226,232,240,0.90))',
    border: '1px solid rgba(100,116,139,0.34)',
    color: '#475569',
    boxShadow: '0 10px 24px rgba(100,116,139,0.14), 0 0 0 3px rgba(100,116,139,0.06)',
  }
}

function getWorkStatusPanel(timeState: TimeState, workState: WorkState) {
  if (workState === 'done') {
    return { label: 'Dokončeno', icon: '✓', tone: 'green' as const }
  }

  if (workState === 'in_progress' || workState === 'partially_done' || timeState === 'active') {
    return { label: 'Probíhá', icon: '↻', tone: 'orange' as const }
  }

  if (timeState === 'future') {
    return { label: 'Budoucí', icon: '●', tone: 'blue' as const }
  }

  return { label: 'Nezahájeno', icon: '●', tone: 'gray' as const }
}

function getBillingStatusPanel(state: BillingStateResolved) {
  if (state === 'waiting_for_invoice') {
    return { label: 'Čeká na fakturaci', icon: '▣', tone: 'amber' as const }
  }

  if (state === 'due') {
    return { label: 'Ve splatnosti', icon: '◷', tone: 'blue' as const }
  }

  if (state === 'overdue') {
    return { label: 'Po splatnosti', icon: '!', tone: 'red' as const }
  }

  if (state === 'paid') {
    return { label: 'Uhrazeno', icon: '✓', tone: 'green' as const }
  }

  return { label: 'Bez fakturace', icon: '●', tone: 'gray' as const }
}

function StatusPanel({
  title,
  icon,
  label,
  tone,
}: {
  title: string
  icon: string
  label: string
  tone: PremiumStatusTone
}) {
  return (
    <div style={statusPanelItem}>
      <div style={statusPanelLabel}>{title}</div>
      <div style={{ ...statusPanelBadge, ...getPremiumStatusTone(tone) }}>
        <span style={statusPanelIcon}>{icon}</span>
        <span>{label}</span>
      </div>
    </div>
  )
}

const statusPanelStack: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  alignItems: 'flex-start',
  gap: '12px',
  minWidth: '300px',
}

const statusPanelItem: CSSProperties = {
  display: 'grid',
  justifyItems: 'end',
  gap: '6px',
}

const statusPanelLabel: CSSProperties = {
  color: '#64748b',
  fontSize: '11px',
  fontWeight: 900,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

const statusPanelBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '9px',
  minHeight: '42px',
  padding: '12px 16px',
  borderRadius: '18px',
  fontSize: '14px',
  lineHeight: 1,
  fontWeight: 850,
  whiteSpace: 'nowrap',
  backdropFilter: 'blur(14px)',
}

const statusPanelIcon: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '22px',
  height: '22px',
  borderRadius: '999px',
  backgroundColor: 'rgba(255,255,255,0.74)',
  color: 'inherit',
  fontSize: '13px',
  fontWeight: 950,
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.55)',
}

function matchesFilter(job: JobWithComputed, filter: FilterType) {
  if (filter === 'all') return true

  if (
    filter === 'waiting_for_invoice' ||
    filter === 'due' ||
    filter === 'overdue' ||
    filter === 'paid'
  ) {
    return (
      getVisibleBillingState(job.workStateResolved, job.billingStateResolvedFinal) === filter
    )
  }

  return (
    job.timeStateResolved === filter ||
    job.workStateResolved === filter ||
    job.billingStateResolvedFinal === filter
  )
}

const VALID_FILTERS: FilterType[] = [
  'all',
  'today',
  'future',
  'active',
  'finished',
  'not_started',
  'in_progress',
  'partially_done',
  'done',
  'waiting_for_invoice',
  'due',
  'overdue',
  'paid',
]

const VALID_SORTS: SortType[] = ['date_asc', 'date_desc', 'customer_asc', 'title_asc']
const VALID_VIEWS: ViewType[] = ['individual', 'summary']

function parseFilterParam(value: string | null): FilterType {
  if (!value) return 'all'
  return VALID_FILTERS.includes(value as FilterType) ? (value as FilterType) : 'all'
}

function parseSortParam(value: string | null): SortType {
  if (!value) return 'date_asc'
  return VALID_SORTS.includes(value as SortType) ? (value as SortType) : 'date_asc'
}

function parseViewParam(value: string | null): ViewType {
  if (!value) return 'individual'
  return VALID_VIEWS.includes(value as ViewType) ? (value as ViewType) : 'individual'
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export default function JobsPage() {
  const { dictionary, locale } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [assignments, setAssignments] = useState<JobAssignmentRow[]>([])
  const [economicsSummaries, setEconomicsSummaries] = useState<JobEconomicsSummaryRow[]>([])
  const [jobShiftActivity, setJobShiftActivity] = useState<JobShiftActivityRow[]>([])
  const [jobParentLinks, setJobParentLinks] = useState<JobParentLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>(() => parseFilterParam(searchParams.get('filter')))
  const [selectedMonth, setSelectedMonth] = useState(() => searchParams.get('month') ?? getCurrentMonthValue())
  const [selectedCustomerId, setSelectedCustomerId] = useState(() => searchParams.get('customer') ?? '')
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') ?? '')
  const [sort, setSort] = useState<SortType>(() => parseSortParam(searchParams.get('sort')))
  const [view, setView] = useState<ViewType>(() => parseViewParam(searchParams.get('view')))
  const [error, setError] = useState<string | null>(null)
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
  const [companyTimeZone, setCompanyTimeZone] = useState('Europe/Prague')
  const dateLocale = locale === 'de' ? 'de-DE' : locale === 'en' ? 'en-GB' : 'cs-CZ'

  function formatCurrency(value: number) {
    return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : locale === 'en' ? 'en-GB' : 'cs-CZ', {
      style: 'currency',
      currency: 'CZK',
    }).format(value)
  }

  function getTimeStateLabel(state: TimeState) {
    if (state === 'future') return dictionary.jobs.future
    if (state === 'active') return dictionary.jobs.active
    if (state === 'finished') return dictionary.jobs.finished
    return dictionary.jobs.unknownTime
  }

  function getWorkStateLabel(state: WorkState) {
    if (state === 'not_started') return dictionary.jobs.notStarted
    if (state === 'in_progress') return dictionary.jobs.inProgress
    if (state === 'partially_done') return dictionary.jobs.partiallyDone
    if (state === 'done') return dictionary.jobs.done
    return dictionary.jobs.unknownWork
  }

  function getBillingStateLabel(state: BillingStateResolved) {
    if (state === 'waiting_for_invoice') return dictionary.jobs.waitingForInvoice
    if (state === 'due') return dictionary.jobs.due
    if (state === 'overdue') return dictionary.jobs.overdue
    if (state === 'paid') return dictionary.jobs.paid
    return dictionary.jobs.unknownBilling
  }

  function getDisplayTimeStateLabel(
    timeState: TimeState,
    workState?: WorkState,
    activeCount?: number
  ) {
    if (timeState === 'finished') return dictionary.jobs.finished

    if (
      timeState === 'future' &&
      (workState === 'in_progress' || workState === 'partially_done' || toNumber(activeCount) > 0)
    ) {
      return dictionary.jobs.active
    }

    return getTimeStateLabel(timeState)
  }

  function updateSearchParams(next: {
    filter?: FilterType
    month?: string
    customer?: string
    q?: string
    sort?: SortType
    view?: ViewType
  }) {
    const params = new URLSearchParams(searchParams.toString())

    const filterValue = next.filter ?? filter
    const monthValue = next.month ?? selectedMonth
    const customerValue = next.customer ?? selectedCustomerId
    const queryValue = next.q ?? searchTerm
    const sortValue = next.sort ?? sort
    const viewValue = next.view ?? view

    if (filterValue && filterValue !== 'all') {
      params.set('filter', filterValue)
    } else {
      params.delete('filter')
    }

    if (monthValue) {
      params.set('month', monthValue)
    } else {
      params.delete('month')
    }

    if (customerValue) {
      params.set('customer', customerValue)
    } else {
      params.delete('customer')
    }

    if (queryValue.trim()) {
      params.set('q', queryValue.trim())
    } else {
      params.delete('q')
    }

    if (sortValue !== 'date_asc') {
      params.set('sort', sortValue)
    } else {
      params.delete('sort')
    }

    if (viewValue !== 'individual') {
      params.set('view', viewValue)
    } else {
      params.delete('view')
    }

    const nextQuery = params.toString()
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }

  useEffect(() => {
    let mounted = true

    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

        if (!mounted) return

        if (sessionError) {
          console.error('Jobs session error', sessionError)
          setError('Data se nepodařilo načíst.')
          setJobs([])
          setCustomers([])
          setAssignments([])
          setEconomicsSummaries([])
          setJobShiftActivity([])
          setJobParentLinks([])
          setLoading(false)
          return
        }

        if (!sessionData.session) {
          setError(dictionary.jobs.unauthenticated)
          setJobs([])
          setCustomers([])
          setAssignments([])
          setEconomicsSummaries([])
          setJobShiftActivity([])
          setJobParentLinks([])
          setLoading(false)
          return
        }

        const activeCompanyResponse = await fetch('/api/active-company', { cache: 'no-store' })
        const activeCompanyPayload = (await activeCompanyResponse.json().catch(() => null)) as {
          timeZone?: string | null
        } | null

        if (mounted && activeCompanyResponse.ok) {
          setCompanyTimeZone(resolveCompanyTimeZone(activeCompanyPayload?.timeZone))
        }

        const jobsSelectBase = `
          id,
          title,
          description,
          address,
          status,
          start_at,
          end_at,
          created_at,
          price,
          customer_id,
          time_state,
          work_state,
          billing_state_resolved,
          assigned_total,
          started_total,
          completed_total,
          active_workers
        `

        const jobsResponse = await supabase
          .from('jobs_with_state')
          .select(
            `
              ${jobsSelectBase},
              is_internal
            `
          )
          .order('created_at', { ascending: false })
        let jobsData = (jobsResponse.data ?? []) as JobRow[]
        let jobsFallbackHandled = false

        if (
          jobsResponse.error &&
          /is_internal/i.test(jobsResponse.error.message)
        ) {
          const fallbackResponse = await supabase
            .from('jobs_with_state')
            .select(jobsSelectBase)
            .order('created_at', { ascending: false })
          const fallbackData: JobRow[] = ((fallbackResponse.data ?? []) as JobRow[]).map((job): JobRow => ({
            ...job,
            address: job.address ?? null,
            price: job.price ?? null,
            is_internal: false,
          }))

          if (!fallbackResponse.error) {
            jobsData = fallbackData
            jobsFallbackHandled = true
          }
        }

        const [
          customersResponse,
          assignmentsResponse,
          profilesResponse,
          economicsResponse,
          shiftsResponse,
          parentLinksResponse,
        ] = await Promise.all([
          supabase.from('customers').select('id, name'),
          supabase.from('job_assignments').select(`
            job_id,
            profile_id,
            labor_hours,
            hourly_rate,
            worker_type_snapshot,
            assignment_billing_type,
            external_amount,
            work_started_at,
            work_completed_at
          `).is('archived_at', null),
          supabase
            .from('profiles')
            .select('id, full_name, default_hourly_rate, worker_type, contractor_billing_type, contractor_default_rate'),
          supabase
            .from('job_economics_summary')
            .select('job_id, revenue_total, labor_hours_total, labor_cost_total, other_cost_total, total_cost_total, profit_total, margin_percent'),
          supabase
            .from('work_shifts')
            .select('job_id, shift_date, started_at, ended_at')
            .not('job_id', 'is', null),
          supabase
            .from('jobs')
            .select('id, parent_job_id'),
        ])

        if (!mounted) return

        if (jobsResponse.error && !jobsFallbackHandled) {
          console.error('Jobs jobs_with_state error', jobsResponse.error)
          setError('Data se nepodařilo načíst.')
          setJobs([])
          setCustomers([])
          setAssignments([])
          setEconomicsSummaries([])
          setJobShiftActivity([])
          setJobParentLinks([])
          setLoading(false)
          return
        }

        if (customersResponse.error) {
          console.error('Jobs customers error', customersResponse.error)
          setError('Data se nepodařilo načíst.')
          setJobs(jobsData)
          setCustomers([])
          setAssignments([])
          setEconomicsSummaries([])
          setJobShiftActivity([])
          setJobParentLinks([])
          setLoading(false)
          return
        }

        if (assignmentsResponse.error) {
          console.error('Jobs job_assignments error', assignmentsResponse.error)
          setError('Data se nepodařilo načíst.')
          setJobs(jobsData)
          setCustomers(customersResponse.data ?? [])
          setAssignments([])
          setEconomicsSummaries([])
          setJobShiftActivity([])
          setJobParentLinks([])
          setLoading(false)
          return
        }

        if (profilesResponse.error) {
          console.error('Jobs profiles error', profilesResponse.error)
          setError('Data se nepodařilo načíst.')
          setJobs(jobsData)
          setCustomers(customersResponse.data ?? [])
          setAssignments([])
          setEconomicsSummaries([])
          setJobShiftActivity([])
          setJobParentLinks([])
          setLoading(false)
          return
        }

        const profilesById = new Map(
          ((profilesResponse.data ?? []) as JobAssignmentProfile[]).map((profile) => [
            profile.id,
            profile,
          ])
        )

        const normalizedAssignments = normalizeAssignments(
          (assignmentsResponse.data ?? []) as RawJobAssignmentRow[],
          profilesById
        )

        if (economicsResponse.error) {
          console.error('Jobs job_economics_summary error', economicsResponse.error)
          setError('Data se nepodařilo načíst.')
          setJobs(jobsData)
          setCustomers(customersResponse.data ?? [])
          setAssignments(normalizedAssignments)
          setEconomicsSummaries([])
          setJobShiftActivity([])
          setJobParentLinks([])
          setLoading(false)
          return
        }

        setError(null)
        setJobs(jobsData)
        setCustomers(customersResponse.data ?? [])
        setAssignments(normalizedAssignments)
        setEconomicsSummaries((economicsResponse.data ?? []) as JobEconomicsSummaryRow[])
        setJobShiftActivity(
          shiftsResponse.error ? [] : ((shiftsResponse.data ?? []) as JobShiftActivityRow[])
        )
        setJobParentLinks(
          parentLinksResponse.error ? [] : ((parentLinksResponse.data ?? []) as JobParentLinkRow[])
        )
        setLoading(false)
      } catch (err) {
        console.error('JOBS DEBUG unexpected error', err)

        if (!mounted) return

        setError('Data se nepodařilo načíst.')
        setJobs([])
        setCustomers([])
        setAssignments([])
        setEconomicsSummaries([])
        setJobShiftActivity([])
        setJobParentLinks([])
        setLoading(false)
      }
    }

    void loadData()

    return () => {
      mounted = false
    }
  }, [dictionary.jobs.unauthenticated])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setFilter(parseFilterParam(searchParams.get('filter')))
      setSelectedMonth(searchParams.get('month') ?? getCurrentMonthValue(companyTimeZone))
      setSelectedCustomerId(searchParams.get('customer') ?? '')
      setSearchTerm(searchParams.get('q') ?? '')
      setSort(parseSortParam(searchParams.get('sort')))
      setView(parseViewParam(searchParams.get('view')))
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [companyTimeZone, searchParams])

  const jobsWithWorkers = useMemo<JobWithComputed[]>(() => {
    const assignmentsByJob = new Map<string, JobAssignmentRow[]>()
    const customersMap = new Map(customers.map((customer) => [customer.id, customer]))
    const economicsByJob = new Map(economicsSummaries.map((summary) => [summary.job_id, summary]))
    const shiftActivityByJob = buildJobShiftActivityMap(jobShiftActivity)
    const parentByJobId = new Map(jobParentLinks.map((item) => [item.id, item.parent_job_id ?? null]))

    assignments.forEach((assignment) => {
      const arr = assignmentsByJob.get(assignment.job_id) ?? []
      arr.push(assignment)
      assignmentsByJob.set(assignment.job_id, arr)
    })

    return jobs.map((job) => {
      const jobAssignments = assignmentsByJob.get(job.id) ?? []
      const customer = job.customer_id ? customersMap.get(job.customer_id) : null
      const economics = economicsByJob.get(job.id)

      const workers = jobAssignments.map(
        (assignment) => assignment.profiles?.full_name ?? dictionary.jobs.untitledWorker
      )
      const workerProfileIds = Array.from(
        new Set(
          jobAssignments
            .map((assignment) => assignment.profile_id?.trim() ?? '')
            .filter((profileId) => profileId.length > 0)
        )
      )
      const startedWorkerProfileIds = Array.from(
        new Set(
          jobAssignments
            .filter((assignment) => Boolean(assignment.work_started_at))
            .map((assignment) => assignment.profile_id?.trim() ?? '')
            .filter((profileId) => profileId.length > 0)
        )
      )
      const completedWorkerProfileIds = Array.from(
        new Set(
          jobAssignments
            .filter((assignment) => Boolean(assignment.work_completed_at))
            .map((assignment) => assignment.profile_id?.trim() ?? '')
            .filter((profileId) => profileId.length > 0)
        )
      )
      const activeWorkerProfileIds = Array.from(
        new Set(
          jobAssignments
            .filter(
              (assignment) => Boolean(assignment.work_started_at) && !assignment.work_completed_at
            )
            .map((assignment) => assignment.profile_id?.trim() ?? '')
            .filter((profileId) => profileId.length > 0)
        )
      )

      const laborCost = jobAssignments.reduce((sum, assignment) => {
        const workerType = getWorkerType({
          worker_type: assignment.worker_type_snapshot ?? assignment.profiles?.worker_type,
        })
        if (workerType === 'contractor') return sum
        const hours = toNumber(assignment.labor_hours)
        const hourlyRate = toNumber(assignment.hourly_rate ?? assignment.profiles?.default_hourly_rate)
        return sum + hours * hourlyRate
      }, 0)
      const externalLaborCost = jobAssignments.reduce((sum, assignment) => {
        const workerType = getWorkerType({
          worker_type: assignment.worker_type_snapshot ?? assignment.profiles?.worker_type,
        })
        if (workerType !== 'contractor') return sum
        const billingType = getContractorBillingType(
          assignment.assignment_billing_type ?? assignment.profiles?.contractor_billing_type
        )
        if (billingType !== 'hourly' && assignment.external_amount != null) {
          return sum + toNumber(assignment.external_amount)
        }
        const hours = toNumber(assignment.labor_hours)
        const hourlyRate = toNumber(
          assignment.hourly_rate ??
            assignment.profiles?.contractor_default_rate ??
            assignment.profiles?.default_hourly_rate
        )
        return sum + hours * hourlyRate
      }, 0)
      const otherCost = toNumber(economics?.other_cost_total) + externalLaborCost
      const shiftActivity = shiftActivityByJob.get(job.id)
      const activeCount =
        job.active_workers !== null && job.active_workers !== undefined ? toNumber(job.active_workers) : 0
      const completedCount =
        job.completed_total !== null && job.completed_total !== undefined
          ? toNumber(job.completed_total)
          : 0
      const assignedCount =
        job.assigned_total !== null && job.assigned_total !== undefined
          ? toNumber(job.assigned_total)
          : jobAssignments.length
      const startedCount =
        job.started_total !== null && job.started_total !== undefined ? toNumber(job.started_total) : 0
      const notStartedCount = Math.max(assignedCount - startedCount, 0)
      const quotedEconomics = calculateQuotedJobEconomics({
        quotedRevenue: job.price,
        laborCost,
        otherCost,
      })
      const timeStateResolved = resolveJobTimeState(job.time_state)
      const workStateResolved = getEffectiveJobWorkState({
        timeState: timeStateResolved,
        workState: resolveJobWorkState(job.work_state),
        legacyStatus: resolveLegacyJobStatus(job.status),
        isMultiDay: isMultiDayJobRange(job.start_at, job.end_at),
        assignedCount,
        startedCount,
        completedCount,
        activeCount,
      })

      return {
        ...job,
        parent_job_id: parentByJobId.get(job.id) ?? null,
        workers,
        workerProfileIds,
        startedWorkerProfileIds,
        completedWorkerProfileIds,
        activeWorkerProfileIds,
        laborCost,
        otherCost,
        profit: quotedEconomics.profit,
        customerName: customer?.name ?? null,
        assignedCount,
        activeCount,
        completedCount,
        notStartedCount,
        startedCount,
        timeStateResolved,
        workStateResolved,
        billingStateResolvedFinal: resolveJobBillingState(job.billing_state_resolved),
        nextShiftAt: shiftActivity?.nextShiftAt ?? null,
        lastShiftAt: shiftActivity?.lastShiftAt ?? null,
        sortAt: shiftActivity?.sortAt ?? job.start_at ?? job.created_at ?? null,
      }
    })
  }, [
    assignments,
    customers,
    dictionary.jobs.untitledWorker,
    economicsSummaries,
    jobParentLinks,
    jobShiftActivity,
    jobs,
  ])

  const customerOptions = useMemo(() => {
    return [...customers].sort((left, right) =>
      (left.name ?? dictionary.jobs.customerMissing).localeCompare(
        right.name ?? dictionary.jobs.customerMissing,
        locale === 'de' ? 'de' : locale === 'en' ? 'en' : 'cs'
      )
    )
  }, [customers, dictionary.jobs.customerMissing, locale])

  const groupedJobBlocks = useMemo((): GroupedJobBlock[] => {
    const shiftCountByJobId = new Map<string, number>()

    for (const shift of jobShiftActivity) {
      if (!shift.job_id) continue
      shiftCountByJobId.set(shift.job_id, (shiftCountByJobId.get(shift.job_id) ?? 0) + 1)
    }

    const { groups, jobsById } = buildJobGroups(jobsWithWorkers)

    return Array.from(groups.entries()).reduce<GroupedJobBlock[]>((result, [rootId, memberJobs]) => {
        const rootJob = jobsById.get(rootId) ?? memberJobs[0]
        if (!rootJob) return result
        const uniqueWorkers = Array.from(
          new Set(memberJobs.flatMap((job) => job.workers.filter((worker) => worker.trim().length > 0)))
        )
        const aggregatedAssignedCount = new Set(
          memberJobs.flatMap((job) => job.workerProfileIds)
        ).size
        const aggregatedActiveCount = new Set(
          memberJobs.flatMap((job) => job.activeWorkerProfileIds)
        ).size
        const aggregatedCompletedCount = new Set(
          memberJobs.flatMap((job) => job.completedWorkerProfileIds)
        ).size
        const aggregatedStartedCount = new Set(
          memberJobs.flatMap((job) => job.startedWorkerProfileIds)
        ).size
        const aggregatedNotStartedCount = Math.max(aggregatedAssignedCount - aggregatedStartedCount, 0)
        const groupShiftCount = memberJobs.reduce(
          (sum, job) => sum + (shiftCountByJobId.get(job.id) ?? 0),
          0
        )

        const memberTimeStates = memberJobs.map((job) => job.timeStateResolved)
        const memberWorkStates = memberJobs.map((job) => job.workStateResolved)
        const memberBillingStates = memberJobs.map((job) => job.billingStateResolvedFinal)

        const groupTimeState: TimeState = memberTimeStates.includes('active')
          ? 'active'
          : memberTimeStates.includes('future')
          ? 'future'
          : memberTimeStates.every((state) => state === 'finished')
          ? 'finished'
          : rootJob.timeStateResolved

        const groupWorkState: WorkState = memberWorkStates.includes('in_progress')
          ? 'in_progress'
          : memberWorkStates.every((state) => state === 'done')
          ? 'done'
          : memberWorkStates.some((state) => state === 'partially_done' || state === 'done')
          ? 'partially_done'
          : memberWorkStates.every((state) => state === 'not_started')
          ? 'not_started'
          : rootJob.workStateResolved

        const visibleBillingStates = memberBillingStates.filter(
          (state): state is BillingStateResolved => state !== 'unknown'
        )

        const canShowBillingState =
          memberJobs.length === 1 ||
          (visibleBillingStates.length === memberJobs.length &&
            new Set(visibleBillingStates).size === 1 &&
            groupWorkState === 'done')

        const groupBillingState =
          canShowBillingState && visibleBillingStates.length > 0
            ? visibleBillingStates[0]
            : rootJob.billingStateResolvedFinal

        const groupNextShiftAt = memberJobs
          .map((job) => parseDateSafe(job.nextShiftAt))
          .filter((date): date is Date => Boolean(date))
          .sort((left, right) => left.getTime() - right.getTime())[0] ?? null

        const groupLastShiftAt = memberJobs
          .map((job) => parseDateSafe(job.lastShiftAt))
          .filter((date): date is Date => Boolean(date))
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? null

        const groupStartAt = memberJobs
          .map((job) => parseDateSafe(job.start_at))
          .filter((date): date is Date => Boolean(date))
          .sort((left, right) => left.getTime() - right.getTime())[0] ?? parseDateSafe(rootJob.start_at)

        const groupEndAt = memberJobs
          .map((job) => parseDateSafe(job.end_at ?? job.start_at))
          .filter((date): date is Date => Boolean(date))
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? parseDateSafe(rootJob.end_at)
        const directChildJobs = memberJobs.filter((job) => job.parent_job_id === rootId)

        result.push({
          ...rootJob,
          laborCost: memberJobs.reduce((sum, job) => sum + job.laborCost, 0),
          otherCost: memberJobs.reduce((sum, job) => sum + job.otherCost, 0),
          profit: memberJobs.reduce((sum, job) => sum + job.profit, 0),
          price: memberJobs.reduce((sum, job) => sum + toNumber(job.price), 0),
          assignedCount: aggregatedAssignedCount,
          activeCount: aggregatedActiveCount,
          completedCount: aggregatedCompletedCount,
          startedCount: aggregatedStartedCount,
          notStartedCount: aggregatedNotStartedCount,
          workers: uniqueWorkers,
          customerName: rootJob.customerName ?? memberJobs.find((job) => job.customerName)?.customerName ?? null,
          customer_id: rootJob.customer_id ?? memberJobs.find((job) => job.customer_id)?.customer_id ?? null,
          timeStateResolved: groupTimeState,
          workStateResolved: groupWorkState,
          billingStateResolvedFinal: groupBillingState,
          nextShiftAt: groupNextShiftAt?.toISOString() ?? null,
          lastShiftAt: groupLastShiftAt?.toISOString() ?? null,
          sortAt:
            groupNextShiftAt?.toISOString() ??
            groupLastShiftAt?.toISOString() ??
            rootJob.start_at ??
            rootJob.created_at ??
            null,
          start_at: groupStartAt?.toISOString() ?? rootJob.start_at,
          end_at: groupEndAt?.toISOString() ?? rootJob.end_at,
          memberJobs: [...memberJobs].sort((left, right) => {
            const leftDate =
              parseDateSafe(left.start_at)?.getTime() ?? parseDateSafe(left.created_at)?.getTime() ?? 0
            const rightDate =
              parseDateSafe(right.start_at)?.getTime() ?? parseDateSafe(right.created_at)?.getTime() ?? 0
            return leftDate - rightDate
          }),
          memberJobIds: memberJobs.map((job) => job.id),
          memberJobsCount: directChildJobs.length > 0 ? directChildJobs.length : memberJobs.length,
          shiftCount: groupShiftCount,
          groupStartAt: groupStartAt?.toISOString() ?? null,
          groupEndAt: groupEndAt?.toISOString() ?? null,
          uniqueWorkers,
          canShowBillingState,
        })

        return result
      }, [])
  }, [jobShiftActivity, jobsWithWorkers])

  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: companyTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const isJobToday = useCallback((job: GroupedJobBlock) => {
    const start = parseDateSafe(job.groupStartAt ?? job.start_at)
    if (!start) return false
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: companyTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(start) === todayKey
  }, [companyTimeZone, todayKey])

  const filteredJobs = useMemo(() => {
    const normalizedQuery = normalizeSearchText(searchTerm)

    return groupedJobBlocks
      .filter((job) => (filter === 'today' ? isJobToday(job) : matchesFilter(job, filter)))
      .filter((job) => {
        if (!selectedMonth) return true
        return getMonthKeyFromJob(job, companyTimeZone) === selectedMonth
      })
      .filter((job) => {
        if (!selectedCustomerId) return true
        return job.customer_id === selectedCustomerId
      })
      .filter((job) => {
        if (!normalizedQuery) return true

        const haystack = normalizeSearchText(
          [
            job.title,
            job.customerName,
            job.address,
            job.description,
            ...job.memberJobs.map((memberJob) => memberJob.title),
          ]
            .filter(Boolean)
            .join(' ')
        )

        return haystack.includes(normalizedQuery)
      })
      .sort((left, right) => {
        if (sort === 'customer_asc') {
          const customerCompare = (left.customerName ?? dictionary.jobs.customerMissing).localeCompare(
            right.customerName ?? dictionary.jobs.customerMissing,
            locale === 'de' ? 'de' : locale === 'en' ? 'en' : 'cs'
          )
          if (customerCompare !== 0) return customerCompare
        }

        if (sort === 'title_asc') {
          const titleCompare = (left.title ?? dictionary.jobs.untitledJob).localeCompare(
            right.title ?? dictionary.jobs.untitledJob,
            locale === 'de' ? 'de' : locale === 'en' ? 'en' : 'cs'
          )
          if (titleCompare !== 0) return titleCompare
        }

        const leftFallback =
          parseDateSafe(left.groupStartAt)?.getTime() ??
          parseDateSafe(left.start_at)?.getTime() ??
          parseDateSafe(left.created_at)?.getTime() ??
          0
        const rightFallback =
          parseDateSafe(right.groupStartAt)?.getTime() ??
          parseDateSafe(right.start_at)?.getTime() ??
          parseDateSafe(right.created_at)?.getTime() ??
          0

        return sort === 'date_desc' ? rightFallback - leftFallback : leftFallback - rightFallback
      })
  }, [companyTimeZone, dictionary.jobs.customerMissing, dictionary.jobs.untitledJob, filter, groupedJobBlocks, isJobToday, locale, searchTerm, selectedCustomerId, selectedMonth, sort])

  const jobsTodayCount = groupedJobBlocks.filter((job) => isJobToday(job)).length
  const jobsDoneCount = groupedJobBlocks.filter((job) => job.workStateResolved === 'done').length
  const jobsWaitingInvoiceCount = groupedJobBlocks.filter(
    (job) =>
      getVisibleBillingState(job.workStateResolved, job.billingStateResolvedFinal) ===
      'waiting_for_invoice'
  ).length

  function getFilterButtonStyle(active: boolean) {
    return {
      padding: '9px 13px',
      borderRadius: '999px',
      border: active ? '1px solid #2563eb' : '1px solid #cbd5e1',
      background: active
        ? 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)'
        : '#ffffff',
      color: active ? '#ffffff' : '#334155',
      fontWeight: 800,
      cursor: 'pointer',
      boxShadow: active ? '0 10px 22px rgba(37, 99, 235, 0.18)' : 'none',
    } as const
  }

  function applyFilter(nextFilter: FilterType) {
    setFilter(nextFilter)
    updateSearchParams({ filter: nextFilter })
  }

  const quickFilters: { label: string; value: FilterType }[] = [
    { label: dictionary.jobs.all, value: 'all' },
    { label: 'Dnes', value: 'today' },
    { label: dictionary.jobs.inProgress, value: 'in_progress' },
    { label: dictionary.jobs.done, value: 'done' },
  ]

  const advancedFilterGroups: { title: string; options: { label: string; value: FilterType }[] }[] = [
    {
      title: dictionary.jobs.timeState,
      options: [
        { label: dictionary.jobs.future, value: 'future' },
        { label: dictionary.jobs.active, value: 'active' },
        { label: dictionary.jobs.finished, value: 'finished' },
      ],
    },
    {
      title: dictionary.jobs.workState,
      options: [
        { label: dictionary.jobs.notStarted, value: 'not_started' },
        { label: dictionary.jobs.inProgress, value: 'in_progress' },
        { label: dictionary.jobs.partiallyDone, value: 'partially_done' },
        { label: dictionary.jobs.done, value: 'done' },
      ],
    },
    {
      title: dictionary.jobs.billing,
      options: [
        { label: dictionary.jobs.waitingForInvoice, value: 'waiting_for_invoice' },
        { label: dictionary.jobs.due, value: 'due' },
        { label: dictionary.jobs.overdue, value: 'overdue' },
        { label: dictionary.jobs.paid, value: 'paid' },
      ],
    },
  ]

  return (
    <DashboardShell activeItem="jobs">
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'stretch',
          gap: '18px',
          marginBottom: '22px',
          flexWrap: 'wrap',
          padding: '28px',
          borderRadius: '28px',
          background:
            'linear-gradient(135deg, rgba(250,245,255,0.96) 0%, rgba(239,246,255,0.94) 52%, rgba(236,254,255,0.9) 100%)',
          border: '1px solid rgba(203, 213, 225, 0.78)',
          boxShadow: '0 22px 58px rgba(15, 23, 42, 0.10)',
        }}
      >
        <div>
          <div style={{ display: 'inline-flex', marginBottom: '12px', padding: '7px 11px', borderRadius: '999px', backgroundColor: 'rgba(255,255,255,0.72)', border: '1px solid rgba(124,58,237,0.2)', color: '#5b21b6', fontSize: '12px', fontWeight: 900 }}>
            Provoz
          </div>
          <h1 style={{ fontSize: '42px', margin: 0, color: '#0f172a', lineHeight: 1.05 }}>
            Zakázky
          </h1>
          <p style={{ margin: '10px 0 0', color: '#64748b', lineHeight: 1.6, fontSize: '15px' }}>
            Plánuj práci, přiřazuj lidi a sleduj stav zakázek.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '12px',
            minWidth: 'min(100%, 430px)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(82px, 1fr))', gap: '8px' }}>
            {[
              ['Celkem', groupedJobBlocks.length],
              ['Dnes', jobsTodayCount],
              ['Hotovo', jobsDoneCount],
              ['K fakturaci', jobsWaitingInvoiceCount],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: '12px', borderRadius: '18px', backgroundColor: 'rgba(255,255,255,0.72)', border: '1px solid rgba(226,232,240,0.9)' }}>
                <div style={{ color: '#64748b', fontSize: '12px', fontWeight: 800 }}>{label}</div>
                <div style={{ color: '#0f172a', fontSize: '24px', fontWeight: 900 }}>{value}</div>
              </div>
            ))}
          </div>
          <Link
            href="/jobs/new"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '13px 18px',
              borderRadius: '999px',
              background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
              color: 'white',
              textDecoration: 'none',
              fontWeight: 900,
              boxShadow: '0 16px 34px rgba(37, 99, 235, 0.24)',
              justifySelf: 'end',
            }}
          >
            Nová zakázka
          </Link>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: '14px',
          marginBottom: '22px',
          padding: '18px',
          borderRadius: '22px',
          backgroundColor: '#ffffff',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          boxShadow: '0 14px 34px rgba(15, 23, 42, 0.06)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: '10px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => {
              const nextValue = event.target.value
              setSearchTerm(nextValue)
              updateSearchParams({ q: nextValue })
            }}
            placeholder={dictionary.jobs.searchPlaceholder}
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              border: '1px solid #d1d5db',
              backgroundColor: '#ffffff',
              color: '#111827',
              fontSize: '14px',
            }}
          />

          <select
            value={selectedCustomerId}
            onChange={(event) => {
              const nextValue = event.target.value
              setSelectedCustomerId(nextValue)
              updateSearchParams({ customer: nextValue })
            }}
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              border: '1px solid #d1d5db',
              backgroundColor: '#ffffff',
              color: '#111827',
              fontSize: '14px',
            }}
          >
            <option value="">{dictionary.jobs.allCustomers}</option>
            {customerOptions.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name ?? dictionary.jobs.customerMissing}
              </option>
            ))}
          </select>

          <input
            type="month"
            value={selectedMonth}
            onChange={(event) => {
              const nextValue = event.target.value
              setSelectedMonth(nextValue)
              updateSearchParams({ month: nextValue })
            }}
            aria-label={dictionary.jobs.month}
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              border: '1px solid #d1d5db',
              backgroundColor: '#ffffff',
              color: '#111827',
              fontSize: '14px',
              fontWeight: 700,
              minHeight: '44px',
            }}
          />

          <select
            value={sort}
            onChange={(event) => {
              const nextValue = parseSortParam(event.target.value)
              setSort(nextValue)
              updateSearchParams({ sort: nextValue })
            }}
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              border: '1px solid #d1d5db',
              backgroundColor: '#ffffff',
              color: '#111827',
              fontSize: '14px',
            }}
          >
            <option value="date_asc">Řazení: datum od nejstarší</option>
            <option value="date_desc">Řazení: datum od nejnovější</option>
            <option value="customer_asc">Řazení: zákazník A-Z</option>
            <option value="title_asc">Řazení: název A-Z</option>
          </select>

          <button
            type="button"
            onClick={() => setAdvancedFiltersOpen((current) => !current)}
            aria-expanded={advancedFiltersOpen}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '44px',
              padding: '12px 16px',
              borderRadius: '12px',
              border: advancedFiltersOpen ? '1px solid #2563eb' : '1px solid #cbd5e1',
              background: advancedFiltersOpen
                ? 'linear-gradient(135deg, #eef2ff 0%, #ecfeff 100%)'
                : '#ffffff',
              color: '#0f172a',
              fontSize: '14px',
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            Filtry ⚙
          </button>

        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {quickFilters.map((quickFilter) => (
            <button
              key={quickFilter.value}
              type="button"
              onClick={() => applyFilter(quickFilter.value)}
              style={getFilterButtonStyle(filter === quickFilter.value)}
            >
              {quickFilter.label}
            </button>
          ))}
        </div>

        {advancedFiltersOpen ? (
          <div
            style={{
              display: 'grid',
              gap: '14px',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              padding: '14px',
              borderRadius: '18px',
              border: '1px solid #dbeafe',
              background: 'linear-gradient(135deg, #f8fafc 0%, #eef6ff 100%)',
            }}
          >
            {advancedFilterGroups.map((group) => (
              <div key={group.title} style={{ display: 'grid', gap: '8px' }}>
                <div style={{ color: '#64748b', fontSize: '12px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {group.title}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {group.options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => applyFilter(option.value)}
                      style={getFilterButtonStyle(filter === option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {error && (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px 14px',
            borderRadius: '10px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
          }}
        >
          <strong>Data se nepodařilo načíst.</strong>
          {process.env.NODE_ENV === 'development' ? (
            <div style={{ marginTop: '6px', fontSize: '12px', opacity: 0.75 }}>{error}</div>
          ) : null}
        </div>
      )}

      {loading ? (
        <p>{dictionary.jobs.loading}</p>
      ) : filteredJobs.length === 0 ? (
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            padding: '20px',
            backgroundColor: '#ffffff',
          }}
        >
          <div style={{ display: 'grid', gap: '12px', justifyItems: 'start' }}>
            <div style={{ fontSize: '18px', fontWeight: 900, color: '#0f172a' }}>
              Zatím tu nic není. Vytvoř první zakázku.
            </div>
            <Link
              href="/jobs/new"
              style={{
                display: 'inline-flex',
                padding: '11px 15px',
                borderRadius: '999px',
                background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #14b8a6 100%)',
                color: '#ffffff',
                textDecoration: 'none',
                fontWeight: 900,
              }}
            >
              Vytvořit zakázku
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          {filteredJobs.map((job) => {
            const childJobs = job.memberJobs.filter((memberJob) => memberJob.id !== job.id)
            const hasChildJobs = childJobs.length > 0
            const parentQuery = searchParams.toString()
            return (
            <div key={job.id} style={{ display: 'grid', gap: hasChildJobs ? '10px' : '0' }}>
            <Link
              href={`/jobs/${job.id}${parentQuery ? `?${parentQuery}` : ''}`}
              className="jobs-premium-link"
              style={{ display: 'block', textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
            >
              <div
                className="jobs-premium-card"
                style={{
                  border: '1px solid rgba(226, 232, 240, 0.92)',
                  borderTop: '2px solid rgba(124,58,237,0.25)',
                  borderRadius: '22px',
                  padding: '22px 24px',
                  backgroundColor: '#ffffff',
                  boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
                  transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '16px',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    marginBottom: '12px',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                      <h2 style={{ margin: '0 0 8px 0', fontSize: '26px', lineHeight: 1.18, fontWeight: 900, color: '#0f172a' }}>
                        {job.title ?? dictionary.jobs.untitledJob}
                      </h2>
                      {job.is_internal ? (
                        <div style={{ marginBottom: '8px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: '999px', backgroundColor: '#fff7ed', color: '#9a3412', border: '1px solid #fdba74', fontSize: '12px', fontWeight: 700 }}>
                            Interní zakázka
                          </span>
                        </div>
                      ) : null}

                      <div style={{ color: '#6b7280', fontSize: '14px', display: 'grid', gap: '4px' }}>
                      <div>
                        <strong>{dictionary.jobs.customerLabel}:</strong>{' '}
                        {job.customerName ?? dictionary.jobs.customerMissing}
                      </div>
                      <div>
                        <strong>{dictionary.jobs.startLabel}:</strong>{' '}
                        {formatDateTimePrague(job.start_at, dateLocale, companyTimeZone)}
                      </div>
                      <div>
                        <strong>{dictionary.jobs.endLabel}:</strong>{' '}
                        {formatDateTimePrague(job.end_at, dateLocale, companyTimeZone)}
                      </div>
                      <div>
                        <strong>Nejbližší směna:</strong>{' '}
                        {job.nextShiftAt
                          ? formatDateTimePrague(
                              job.nextShiftAt,
                              dateLocale,
                              companyTimeZone
                            )
                          : '—'}
                      </div>
                      <div>
                        <strong>Poslední aktivita:</strong>{' '}
                        {job.lastShiftAt
                          ? formatDateTimePrague(
                              job.lastShiftAt,
                              dateLocale,
                              companyTimeZone
                            )
                          : '—'}
                      </div>
                    </div>
                  </div>

                  <div style={statusPanelStack}>
                    {(() => {
                      const workStatus = getWorkStatusPanel(job.timeStateResolved, job.workStateResolved)
                      const billingState = job.canShowBillingState
                        ? getVisibleBillingState(job.workStateResolved, job.billingStateResolvedFinal)
                        : null
                      const billingStatus = billingState ? getBillingStatusPanel(billingState) : null

                      return (
                        <>
                          <StatusPanel
                            title="Práce"
                            icon={workStatus.icon}
                            label={workStatus.label}
                            tone={workStatus.tone}
                          />
                          {billingStatus ? (
                            <StatusPanel
                              title="Fakturace"
                              icon={billingStatus.icon}
                              label={billingStatus.label}
                              tone={billingStatus.tone}
                            />
                          ) : null}
                        </>
                      )
                    })()}
                    <div style={{ width: '100%', color: hasChildJobs ? '#1d4ed8' : '#64748b', fontSize: '13px', fontWeight: 900, textAlign: 'right' }}>
                      {hasChildJobs ? 'Souhrnná zakázka' : 'Samostatná zakázka'}
                    </div>
                  </div>
                </div>

                <div style={jobMetricGrid}>
                  <div style={jobMetricTile}><div style={jobMetricLabel}>{dictionary.jobs.price}</div><div style={{ ...jobMetricValue, fontSize: '20px' }}>{formatCurrency(toNumber(job.price))}</div></div>
                  <div style={jobMetricTile}><div style={jobMetricLabel}>Práce</div><div style={{ ...jobMetricValue, color: '#334155' }}>{formatCurrency(job.laborCost)}</div></div>
                  <div style={jobMetricTile}><div style={jobMetricLabel}>{dictionary.jobs.otherCosts}</div><div style={{ ...jobMetricValue, color: '#334155' }}>{formatCurrency(job.otherCost)}</div></div>
                  <div style={jobMetricTile}><div style={jobMetricLabel}>{dictionary.jobs.profit}</div><div style={{ ...jobMetricValue, fontSize: '21px', color: job.profit >= 0 ? '#047857' : '#b91c1c' }}>{formatCurrency(job.profit)}</div></div>
                </div>

                <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: '12px' }}>
                  <div><div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Dílčí zakázky</div><div style={{ fontWeight: 700 }}>{job.memberJobsCount}</div></div>
                  <div><div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Směny ve skupině</div><div style={{ fontWeight: 700 }}>{job.shiftCount}</div></div>
                  <div><div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{dictionary.jobs.assignedWorkers}</div><div style={{ fontWeight: 700 }}>{job.assignedCount}</div></div>
                  <div><div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{dictionary.jobs.activelyWorking}</div><div style={{ fontWeight: 700 }}>{job.activeCount}</div></div>
                  <div><div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{dictionary.jobs.completed}</div><div style={{ fontWeight: 700 }}>{job.completedCount}</div></div>
                  <div><div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{dictionary.jobs.notStartedWorkers}</div><div style={{ fontWeight: 700 }}>{job.notStartedCount}</div></div>
                </div>

                <div style={{ color: '#6b7280', fontSize: '14px', marginBottom: '10px' }}>
                  <strong>Rozsah skupiny:</strong>{' '}
                  {formatDateTimePrague(job.groupStartAt, dateLocale, companyTimeZone)}
                  {' '}–{' '}
                  {formatDateTimePrague(job.groupEndAt, dateLocale, companyTimeZone)}
                </div>

                <div style={{ color: '#6b7280', fontSize: '14px' }}>
                  <strong>{dictionary.jobs.workers}:</strong>{' '}
                  {job.workers.length > 0 ? job.workers.join(', ') : dictionary.jobs.noWorkersAssigned}
                </div>

                {job.memberJobsCount > 1 ? (
                  <div style={{ color: '#6b7280', fontSize: '14px', marginTop: '10px' }}>
                    <strong>Seskupeno:</strong>{' '}
                    {job.memberJobs
                      .map((memberJob) => memberJob.title ?? dictionary.jobs.untitledJob)
                      .join(', ')}
                  </div>
                ) : null}
              </div>
            </Link>

            {childJobs.map((childJob) => {
              const childQuery = searchParams.toString()
              return (
                <Link
                  key={childJob.id}
                  href={`/jobs/${childJob.id}${childQuery ? `?${childQuery}` : ''}`}
                  className="jobs-premium-link"
                  style={{
                    display: 'block',
                    marginLeft: '28px',
                    paddingLeft: '16px',
                    borderLeft: '4px solid #bfdbfe',
                    textDecoration: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    className="jobs-premium-card"
                    style={{
                      border: '1px solid rgba(226, 232, 240, 0.92)',
                      borderTop: '2px solid rgba(124,58,237,0.25)',
                      borderRadius: '18px',
                      padding: '18px 20px',
                      backgroundColor: '#ffffff',
                      boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
                      transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '16px',
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                        marginBottom: '12px',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                          <h3 style={{ margin: '0 0 8px 0', fontSize: '23px', lineHeight: 1.2, fontWeight: 900, color: '#0f172a' }}>
                            {childJob.title ?? dictionary.jobs.untitledJob}
                          </h3>
                          {childJob.is_internal ? (
                            <div style={{ marginBottom: '8px' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: '999px', backgroundColor: '#fff7ed', color: '#9a3412', border: '1px solid #fdba74', fontSize: '12px', fontWeight: 700 }}>
                                Interní zakázka
                              </span>
                            </div>
                          ) : null}
                          <div style={{ color: '#6b7280', fontSize: '14px', display: 'grid', gap: '4px' }}>
                          <div>
                            <strong>{dictionary.jobs.customerLabel}:</strong>{' '}
                            {childJob.customerName ?? dictionary.jobs.customerMissing}
                          </div>
                          <div>
                            <strong>{dictionary.jobs.startLabel}:</strong>{' '}
                            {formatDateTimePrague(childJob.start_at, dateLocale, companyTimeZone)}
                          </div>
                          <div>
                            <strong>{dictionary.jobs.endLabel}:</strong>{' '}
                            {formatDateTimePrague(childJob.end_at, dateLocale, companyTimeZone)}
                          </div>
                        </div>
                      </div>

                      <div style={statusPanelStack}>
                        {(() => {
                          const workStatus = getWorkStatusPanel(childJob.timeStateResolved, childJob.workStateResolved)
                          const billingState = getVisibleBillingState(childJob.workStateResolved, childJob.billingStateResolvedFinal)
                          const billingStatus = billingState ? getBillingStatusPanel(billingState) : null

                          return (
                            <>
                              <StatusPanel
                                title="Práce"
                                icon={workStatus.icon}
                                label={workStatus.label}
                                tone={workStatus.tone}
                              />
                              {billingStatus ? (
                                <StatusPanel
                                  title="Fakturace"
                                  icon={billingStatus.icon}
                                  label={billingStatus.label}
                                  tone={billingStatus.tone}
                                />
                              ) : null}
                            </>
                          )
                        })()}
                        <div style={{ width: '100%', color: '#64748b', fontSize: '13px', fontWeight: 900, textAlign: 'right' }}>
                          Přidružená zakázka
                        </div>
                      </div>
                    </div>

                    <div style={{ ...jobMetricGrid, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                      <div style={jobMetricTile}><div style={jobMetricLabel}>{dictionary.jobs.price}</div><div style={jobMetricValue}>{formatCurrency(toNumber(childJob.price))}</div></div>
                      <div style={jobMetricTile}><div style={jobMetricLabel}>Práce</div><div style={{ ...jobMetricValue, color: '#334155' }}>{formatCurrency(childJob.laborCost)}</div></div>
                      <div style={jobMetricTile}><div style={jobMetricLabel}>{dictionary.jobs.otherCosts}</div><div style={{ ...jobMetricValue, color: '#334155' }}>{formatCurrency(childJob.otherCost)}</div></div>
                      <div style={jobMetricTile}><div style={jobMetricLabel}>{dictionary.jobs.profit}</div><div style={{ ...jobMetricValue, color: childJob.profit >= 0 ? '#047857' : '#b91c1c' }}>{formatCurrency(childJob.profit)}</div></div>
                      <div><div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{dictionary.jobs.assignedWorkers}</div><div style={{ fontWeight: 700 }}>{childJob.assignedCount}</div></div>
                      <div><div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{dictionary.jobs.completed}</div><div style={{ fontWeight: 700 }}>{childJob.completedCount}</div></div>
                    </div>
                  </div>
                </Link>
              )
            })}
            </div>
            )
          })}
        </div>
      )}
    </DashboardShell>
  )
}
