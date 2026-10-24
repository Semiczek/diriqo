'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'

import DashboardShell from '../../components/DashboardShell'
import { primaryButtonStyle, secondaryButtonStyle } from '@/components/SaasPageLayout'
import styles from '@/components/OperationalUI.module.css'
import { resolveCompanyTimeZone } from '@/lib/company-timezone'
import { useI18n } from '../../components/I18nProvider'
import type { JobsMessages } from '@/lib/i18n/dictionaries/types'
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
import { aggregateJobEconomics, buildJobGroups, type JobParentLinkRow } from '../../lib/job-grouping'
import { supabase } from '../../lib/supabase'
import { calculateQuotedJobEconomics, type JobEconomicsSummary } from '@/lib/economics'
import LaborCostStatus from '@/components/LaborCostStatus'
import { readJobEconomicsAction } from '@/app/jobs/economics-actions'
import { OFFICE_CONTEXT_EVENT, OFFICE_CONTEXT_STORAGE_KEY } from '@/lib/office/client-context'
import { createJobGroupFromDropAction } from '@/app/jobs/actions'

const JOB_DRAG_TYPE = 'application/x-diriqo-job-id'

type FilterType = 'all' | 'today' | TimeState | WorkState | BillingStateResolved
type SortType = 'date_asc' | 'date_desc' | 'customer_asc' | 'title_asc'
type ViewType = 'individual' | 'summary'

type JobRow = {
  id: string
  company_id: string
  currency: string
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

type JobEconomicsSummaryRow = JobEconomicsSummary

type JobWithComputed = JobRow & {
  workers: string[]
  workerProfileIds: string[]
  startedWorkerProfileIds: string[]
  completedWorkerProfileIds: string[]
  activeWorkerProfileIds: string[]
  laborCost: number | null
  otherCost: number | null
  profit: number | null
  economics: JobEconomicsSummary | null
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

function formatMonthInputLabel(value: string, locale: string) {
  const [year, month] = value.split('-').map(Number)

  if (!year || !month) return value

  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1))
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
  const tones = {
    green: { backgroundColor: '#edf7f2', color: '#287454' },
    orange: { backgroundColor: '#fff5e9', color: '#99611f' },
    blue: { backgroundColor: '#f0edff', color: '#6748c2' },
    red: { backgroundColor: '#fff0f1', color: '#b04452' },
    amber: { backgroundColor: '#fff7e9', color: '#99611f' },
    gray: { backgroundColor: '#f3f3f6', color: '#717684' },
  }
  return tones[tone]
}

function getLocalizedWorkStatusPanel(
  timeState: TimeState,
  workState: WorkState,
  messages: JobsMessages
) {
  if (workState === 'done') {
    return { label: messages.done, icon: '✓', tone: 'green' as const }
  }

  if (workState === 'in_progress' || workState === 'partially_done' || timeState === 'active') {
    return { label: messages.inProgress, icon: '↻', tone: 'orange' as const }
  }

  if (timeState === 'future') {
    return { label: messages.future, icon: '●', tone: 'blue' as const }
  }

  return { label: messages.notStarted, icon: '●', tone: 'gray' as const }
}

function getLocalizedBillingStatusPanel(state: BillingStateResolved, messages: JobsMessages) {
  if (state === 'waiting_for_invoice') {
    return { label: messages.waitingForInvoice, icon: '□', tone: 'amber' as const }
  }

  if (state === 'due') {
    return { label: messages.due, icon: '◇', tone: 'blue' as const }
  }

  if (state === 'overdue') {
    return { label: messages.overdue, icon: '!', tone: 'red' as const }
  }

  if (state === 'paid') {
    return { label: messages.paid, icon: '✓', tone: 'green' as const }
  }

  return { label: messages.unknownBilling, icon: '●', tone: 'gray' as const }
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
  minWidth: 0,
}

const statusPanelItem: CSSProperties = {
  display: 'grid',
  justifyItems: 'end',
  gap: '6px',
}

const statusPanelLabel: CSSProperties = {
  color: '#64748b',
  fontSize: '11px',
  fontWeight: 500,
}

const statusPanelBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '9px',
  minHeight: '28px',
  padding: '6px 9px',
  borderRadius: '7px',
  fontSize: '14px',
  lineHeight: 1,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const statusPanelIcon: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '16px',
  height: '16px',
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
  const [dropMessage, setDropMessage] = useState<string | null>(null)
  const [draggingJobId, setDraggingJobId] = useState<string | null>(null)
  const [dropTargetJobId, setDropTargetJobId] = useState<string | null>(null)
  const [groupingJob, setGroupingJob] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
  const [companyTimeZone, setCompanyTimeZone] = useState('Europe/Prague')
  const [canReadEconomics, setCanReadEconomics] = useState(false)
  const dateLocale = locale === 'de' ? 'de-DE' : locale === 'en' ? 'en-GB' : 'cs-CZ'

  function formatCurrency(value: number | null, currency: string) {
    if (value === null) return '—'
    return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : locale === 'en' ? 'en-GB' : 'cs-CZ', {
      style: 'currency',
      currency,
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

    // An explicit empty month means all periods; an absent month defaults to now.
    params.set('month', monthValue)

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
    const clear = () => {
      setJobs([]); setCustomers([]); setAssignments([]); setEconomicsSummaries([])
      setJobShiftActivity([]); setJobParentLinks([]); setCanReadEconomics(false)
    }
    const invalidate = () => {
      mounted = false
      clear()
      setDataVersion(current => current + 1)
    }
    const storage = (event: StorageEvent) => { if (event.key === OFFICE_CONTEXT_STORAGE_KEY) invalidate() }
    async function activeScope() {
      const response = await fetch('/api/active-company', { cache: 'no-store' })
      const value = await response.json()
      if (!response.ok || typeof value?.companyId !== 'string' || typeof value?.profileId !== 'string') throw new Error('Scope unavailable')
      return value as { companyId: string; profileId: string; role: string; timeZone?: string | null }
    }
    async function loadData() {
      setLoading(true); setError(null); clear()
      try {
        const scope = await activeScope()
        if (!mounted) return
        const financial = ['company_admin', 'super_admin'].includes(scope.role)
        const jobsSelectBase = 'id,company_id,currency,title,description,address,status,start_at,end_at,created_at,price,customer_id,time_state,work_state,billing_state_resolved,assigned_total,started_total,completed_total,active_workers'
        let jobsResponse: { data: unknown[] | null; error: { message: string } | null } = await supabase.from('jobs_with_state').select(jobsSelectBase + ',is_internal')
          .eq('company_id', scope.companyId).order('created_at', { ascending: false })
        if (jobsResponse.error && /is_internal/i.test(jobsResponse.error.message)) {
          jobsResponse = await supabase.from('jobs_with_state').select(jobsSelectBase)
            .eq('company_id', scope.companyId).order('created_at', { ascending: false })
        }
        if (jobsResponse.error) throw new Error('Jobs unavailable')
        const jobsData = ((jobsResponse.data ?? []) as unknown as JobRow[]).map(job => ({ ...job, is_internal: job.is_internal ?? false }))
        if (jobsData.some(job => job.company_id !== scope.companyId)) throw new Error('Job scope changed')
        const jobIds = jobsData.map(job => job.id)
        const [customersResponse, assignmentsResponse, shiftsResponse, parentLinksResponse] = await Promise.all([
          supabase.from('customers').select('id,name').eq('company_id', scope.companyId),
          supabase.from('job_assignments').select('job_id,profile_id,work_started_at,work_completed_at')
            .eq('company_id', scope.companyId).is('archived_at', null),
          supabase.from('work_shifts').select('job_id,shift_date,started_at,ended_at').eq('company_id', scope.companyId).not('job_id', 'is', null),
          supabase.from('jobs').select('id,parent_job_id').eq('company_id', scope.companyId),
        ])
        if (customersResponse.error || assignmentsResponse.error || shiftsResponse.error || parentLinksResponse.error) throw new Error('Jobs details unavailable')
        const assignmentData = ((assignmentsResponse.data ?? []) as RawJobAssignmentRow[]).filter(row => row.job_id && jobIds.includes(row.job_id))
        const profileIds = [...new Set(assignmentData.map(row => row.profile_id).filter((id): id is string => Boolean(id)))]
        const profilesResponse = profileIds.length ? await supabase.from('profiles').select('id,full_name').in('id', profileIds) : { data: [], error: null }
        if (profilesResponse.error) throw new Error('Worker names unavailable')
        const summaries: JobEconomicsSummary[] = []
        if (financial) {
          for (let offset = 0; offset < jobIds.length; offset += 500) {
            const result = await readJobEconomicsAction({ companyId: scope.companyId, profileId: scope.profileId, jobIds: jobIds.slice(offset, offset + 500) })
            if (!result.ok || result.companyId !== scope.companyId || result.profileId !== scope.profileId) throw new Error('Economics scope changed')
            summaries.push(...result.summaries)
          }
        }
        const current = await activeScope()
        if (!mounted) return
        if (current.companyId !== scope.companyId || current.profileId !== scope.profileId || current.role !== scope.role) throw new Error('Active company changed')
        const profilesById = new Map(((profilesResponse.data ?? []) as JobAssignmentProfile[]).map(profile => [profile.id, profile]))
        setCompanyTimeZone(resolveCompanyTimeZone(scope.timeZone))
        setCanReadEconomics(financial)
        setJobs(jobsData); setCustomers(customersResponse.data ?? [])
        setAssignments(normalizeAssignments(assignmentData, profilesById)); setEconomicsSummaries(summaries)
        setJobShiftActivity((shiftsResponse.data ?? []) as JobShiftActivityRow[])
        setJobParentLinks((parentLinksResponse.data ?? []) as JobParentLinkRow[])
        setLoading(false)
      } catch {
        if (!mounted) return
        clear(); setError(dictionary.jobs.loadError); setLoading(false)
      }
    }
    window.addEventListener(OFFICE_CONTEXT_EVENT, invalidate)
    window.addEventListener('storage', storage)
    window.addEventListener('focus', invalidate)
    void loadData()
    return () => {
      mounted = false
      window.removeEventListener(OFFICE_CONTEXT_EVENT, invalidate)
      window.removeEventListener('storage', storage)
      window.removeEventListener('focus', invalidate)
    }
  }, [dataVersion, dictionary.jobs.loadError])

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

      const laborCost = economics?.labor_cost_total ?? null
      const otherCost = economics?.other_cost_total ?? null
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
        completeness: economics?.labor_completeness ?? 'incomplete',
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
        economics: economics ?? null,
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
        const directChildJobs = memberJobs.filter((job) => job.parent_job_id === rootId)
        const statsJobs = directChildJobs.length > 0 ? directChildJobs : memberJobs
        const uniqueWorkers = Array.from(
          new Set(statsJobs.flatMap((job) => job.workers.filter((worker) => worker.trim().length > 0)))
        )
        const aggregatedAssignedCount = new Set(
          statsJobs.flatMap((job) => job.workerProfileIds)
        ).size
        const aggregatedActiveCount = new Set(
          statsJobs.flatMap((job) => job.activeWorkerProfileIds)
        ).size
        const aggregatedCompletedCount = new Set(
          statsJobs.flatMap((job) => job.completedWorkerProfileIds)
        ).size
        const aggregatedStartedCount = new Set(
          statsJobs.flatMap((job) => job.startedWorkerProfileIds)
        ).size
        const aggregatedNotStartedCount = Math.max(aggregatedAssignedCount - aggregatedStartedCount, 0)
        const groupShiftCount = statsJobs.reduce(
          (sum, job) => sum + (shiftCountByJobId.get(job.id) ?? 0),
          0
        )

        const memberTimeStates = statsJobs.map((job) => job.timeStateResolved)
        const memberWorkStates = statsJobs.map((job) => job.workStateResolved)
        const memberBillingStates = statsJobs.map((job) => job.billingStateResolvedFinal)

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
          statsJobs.length === 1 ||
          (visibleBillingStates.length === statsJobs.length &&
            new Set(visibleBillingStates).size === 1 &&
            groupWorkState === 'done')

        const groupBillingState =
          canShowBillingState && visibleBillingStates.length > 0
            ? visibleBillingStates[0]
            : rootJob.billingStateResolvedFinal

        const groupNextShiftAt = statsJobs
          .map((job) => parseDateSafe(job.nextShiftAt))
          .filter((date): date is Date => Boolean(date))
          .sort((left, right) => left.getTime() - right.getTime())[0] ?? null

        const groupLastShiftAt = statsJobs
          .map((job) => parseDateSafe(job.lastShiftAt))
          .filter((date): date is Date => Boolean(date))
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? null

        const groupStartAt = statsJobs
          .map((job) => parseDateSafe(job.start_at))
          .filter((date): date is Date => Boolean(date))
          .sort((left, right) => left.getTime() - right.getTime())[0] ?? parseDateSafe(rootJob.start_at)

        const groupEndAt = statsJobs
          .map((job) => parseDateSafe(job.end_at ?? job.start_at))
          .filter((date): date is Date => Boolean(date))
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? parseDateSafe(rootJob.end_at)

        const groupEconomics = aggregateJobEconomics(
          memberJobs.flatMap(member => member.economics ? [member.economics] : []),
          memberJobs.map(member => member.id), rootJob.currency
        )
        const groupQuoted = calculateQuotedJobEconomics({
          quotedRevenue: groupEconomics?.quoted_revenue_total, laborCost: groupEconomics?.labor_cost_total,
          otherCost: groupEconomics?.other_cost_total, completeness: groupEconomics?.labor_completeness ?? 'incomplete',
        })
        result.push({
          ...rootJob,
          economics: groupEconomics,
          laborCost: groupEconomics?.labor_cost_total ?? null,
          otherCost: groupEconomics?.other_cost_total ?? null,
          profit: groupQuoted.profit,
          price: groupEconomics?.quoted_revenue_total ?? (memberJobs.length === 1 ? rootJob.price : null),
          assignedCount: aggregatedAssignedCount,
          activeCount: aggregatedActiveCount,
          completedCount: aggregatedCompletedCount,
          startedCount: aggregatedStartedCount,
          notStartedCount: aggregatedNotStartedCount,
          workers: uniqueWorkers,
          customerName: statsJobs.find((job) => job.customerName)?.customerName ?? rootJob.customerName ?? null,
          customer_id: statsJobs.find((job) => job.customer_id)?.customer_id ?? rootJob.customer_id ?? null,
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
      minHeight: '44px', padding: '9px 14px', borderRadius: '9px',
      border: '1px solid transparent', background: active ? '#f0ebff' : 'transparent',
      color: active ? '#6342d0' : '#717684', fontWeight: active ? 650 : 500, cursor: 'pointer',
    } as const
  }

  function applyFilter(nextFilter: FilterType) {
    setFilter(nextFilter)
    updateSearchParams({ filter: nextFilter })
  }

  async function createGroupFromDroppedJobs(draggedJobId: string, targetJobId: string) {
    if (!draggedJobId || !targetJobId || draggedJobId === targetJobId || groupingJob) return

    setGroupingJob(true)
    setDropMessage(null)

    const result = await createJobGroupFromDropAction({ draggedJobId, targetJobId })

    if (!result.ok) {
      setDropMessage(result.error)
      setGroupingJob(false)
      return
    }

    setDropMessage('Byla vytvořena nová matka a obě zakázky jsou pod ní jako dcery.')
    setGroupingJob(false)
    setDataVersion((version) => version + 1)
    router.refresh()
  }

  function startDraggingJob(event: DragEvent<HTMLElement>, jobId: string) {
    event.dataTransfer.setData(JOB_DRAG_TYPE, jobId)
    event.dataTransfer.setData('text/plain', jobId)
    event.dataTransfer.effectAllowed = 'move'
    setDraggingJobId(jobId)
    setDropMessage(null)
  }

  function stopDraggingJob() {
    setDraggingJobId(null)
    setDropTargetJobId(null)
  }

  function getDraggedJobId(event: DragEvent<HTMLElement>) {
    return event.dataTransfer.getData(JOB_DRAG_TYPE) || draggingJobId
  }

  const quickFilters: { label: string; value: FilterType }[] = [
    { label: dictionary.jobs.all, value: 'all' },
    { label: dictionary.jobs.today, value: 'today' },
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
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>{dictionary.jobs.title}</h1>
            <p className={styles.subtitle}>{dictionary.jobs.subtitle}</p>
          </div>
          <Link href="/jobs/new" data-tour="new-job-button" style={primaryButtonStyle}>
            + {dictionary.jobs.newJob.replace(/^\+\s*/, '')}
          </Link>
        </header>

        <div data-tour="jobs-overview-summary" className={styles.stats}>
          {[
            [dictionary.jobs.total, groupedJobBlocks.length],
            [dictionary.jobs.today, jobsTodayCount],
            [dictionary.jobs.done, jobsDoneCount],
            [dictionary.jobs.readyForInvoice, jobsWaitingInvoiceCount],
          ].map(([label, value]) => (
            <div key={label} className={styles.stat}><span>{label}</span><strong>{loading ? '—' : value}</strong></div>
          ))}
        </div>

        <div data-tour="jobs-filters" className={styles.filterPanel}>
          <div className={styles.filterRow}>
            <label className={styles.field}>
              <span>{locale === 'cs' ? 'Hledat zakázku' : locale === 'de' ? 'Aufträge suchen' : 'Find a job'}</span>
              <input type="search" value={searchTerm} placeholder={dictionary.jobs.searchPlaceholder} className={styles.input}
                onChange={(event) => { setSearchTerm(event.target.value); updateSearchParams({ q: event.target.value }) }} />
            </label>
            <div className={styles.field}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <label htmlFor="jobs-month">{dictionary.jobs.month}</label>
                <button type="button"
                  style={{ ...secondaryButtonStyle, padding: '0 8px', borderColor: 'transparent', backgroundColor: 'transparent', color: '#6d4aff', fontSize: 12 }}
                  onClick={() => {
                    const nextMonth = selectedMonth ? '' : getCurrentMonthValue(companyTimeZone)
                    setSelectedMonth(nextMonth)
                    updateSearchParams({ month: nextMonth })
                  }}>
                  {selectedMonth
                    ? locale === 'cs' ? 'Všechna období' : locale === 'de' ? 'Alle Zeiträume' : 'All periods'
                    : locale === 'cs' ? 'Aktuální měsíc' : locale === 'de' ? 'Aktueller Monat' : 'Current month'}
                </button>
              </div>
              <input id="jobs-month" type="month" value={selectedMonth} className={styles.input}
                onChange={(event) => { setSelectedMonth(event.target.value); updateSearchParams({ month: event.target.value }) }}
                onBlur={(event) => {
                  const nextMonth = event.currentTarget.value
                  if (nextMonth !== selectedMonth && (nextMonth === '' || /^\d{4}-(0[1-9]|1[0-2])$/.test(nextMonth))) {
                    setSelectedMonth(nextMonth)
                    updateSearchParams({ month: nextMonth })
                  }
                }} />
            </div>
            <button type="button" style={secondaryButtonStyle} aria-expanded={advancedFiltersOpen} aria-controls="job-extra-filters"
              onClick={() => setAdvancedFiltersOpen((current) => !current)}>
              {dictionary.jobs.filters}{selectedCustomerId || sort !== 'date_asc' ? ' •' : ''}
            </button>
          </div>
          <div className={styles.tabs}>
            {quickFilters.map((quickFilter) => (
              <button key={quickFilter.value} type="button" onClick={() => applyFilter(quickFilter.value)}
                aria-pressed={filter === quickFilter.value} style={getFilterButtonStyle(filter === quickFilter.value)}>
                {quickFilter.label}
              </button>
            ))}
          </div>
          {advancedFiltersOpen ? (
            <div id="job-extra-filters" className={styles.filterDetails}>
              <label className={styles.field}>
                <span>{dictionary.jobs.customerLabel}</span>
                <select value={selectedCustomerId} className={styles.input}
                  onChange={(event) => { setSelectedCustomerId(event.target.value); updateSearchParams({ customer: event.target.value }) }}>
                  <option value="">{dictionary.jobs.allCustomers}</option>
                  {customerOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name ?? dictionary.jobs.customerMissing}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>{locale === 'cs' ? 'Řazení' : locale === 'de' ? 'Sortierung' : 'Sort by'}</span>
                <select value={sort} className={styles.input}
                  onChange={(event) => { const nextValue = parseSortParam(event.target.value); setSort(nextValue); updateSearchParams({ sort: nextValue }) }}>
                  <option value="date_asc">{dictionary.jobs.sortDateAsc}</option>
                  <option value="date_desc">{dictionary.jobs.sortDateDesc}</option>
                  <option value="customer_asc">{dictionary.jobs.sortCustomerAsc}</option>
                  <option value="title_asc">{dictionary.jobs.sortTitleAsc}</option>
                </select>
              </label>
              {advancedFilterGroups.map((group) => (
                <div key={group.title} className={styles.field}>
                  <span>{group.title}</span>
                  <div className={styles.tabs}>
                    {group.options.map((option) => (
                      <button key={option.value} type="button" onClick={() => applyFilter(option.value)}
                        aria-pressed={filter === option.value} style={getFilterButtonStyle(filter === option.value)}>{option.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {error ? <div role="alert" className={styles.empty}>{dictionary.jobs.loadError}</div> : null}
        {dropMessage ? <div role="status" className={styles.empty}>{dropMessage}</div> : null}

        {loading ? (
          <div role="status" className={styles.empty}>{dictionary.jobs.loading}</div>
        ) : error ? null : filteredJobs.length === 0 ? (
          <div className={styles.empty}>
            <h2>{jobs.length === 0
              ? dictionary.jobs.emptyTitle
              : locale === 'cs'
                ? 'Tomuto výběru neodpovídá žádná zakázka'
                : locale === 'de'
                  ? 'Keine Aufträge entsprechen dieser Auswahl'
                  : 'No jobs match this selection'}</h2>
            <p>{locale === 'cs' ? 'Zkuste jiný měsíc nebo upravte filtry. Novou zakázku založíte jedním tlačítkem.' : locale === 'de' ? 'Wählen Sie einen anderen Monat oder ändern Sie die Filter.' : 'Try another month or adjust the filters.'}</p>
            <Link href="/jobs/new" style={primaryButtonStyle}>{dictionary.jobs.createJob}</Link>
          </div>
        ) : (
          <div data-tour="jobs-list" className={styles.list}>
            {filteredJobs.map((job) => {
              const childJobs = job.memberJobs.filter((memberJob) => memberJob.id !== job.id)
              const parentQuery = searchParams.toString()
              const workStatus = getLocalizedWorkStatusPanel(job.timeStateResolved, job.workStateResolved, dictionary.jobs)
              const billingState = job.canShowBillingState ? getVisibleBillingState(job.workStateResolved, job.billingStateResolvedFinal) : null
              const billingStatus = billingState ? getLocalizedBillingStatusPanel(billingState, dictionary.jobs) : null
              return (
                <div key={job.id} draggable className={styles.jobGroup}
                  onDragStart={(event) => startDraggingJob(event, job.id)} onDragEnd={stopDraggingJob}
                  onDragOver={(event) => {
                    if (!draggingJobId || draggingJobId === job.id) return
                    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTargetJobId(job.id)
                  }}
                  onDragLeave={() => setDropTargetJobId((current) => current === job.id ? null : current)}
                  onDrop={(event) => {
                    event.preventDefault(); event.stopPropagation()
                    const childJobId = getDraggedJobId(event)
                    setDropTargetJobId(null); setDraggingJobId(null)
                    if (childJobId) void createGroupFromDroppedJobs(childJobId, job.id)
                  }}
                  style={{ outline: dropTargetJobId === job.id ? '2px solid #6d4aff' : undefined, outlineOffset: 3 }}>
                  <Link href={`/jobs/${job.id}${parentQuery ? `?${parentQuery}` : ''}`} className={styles.jobCard}>
                    <div className={styles.jobHeader}>
                      <div className={styles.resourceBody}>
                        <h2 className={styles.jobTitle}>{job.title ?? dictionary.jobs.untitledJob}</h2>
                        <div className={styles.meta}>
                          <span>{job.customerName ?? dictionary.jobs.customerMissing}</span>
                          {job.is_internal ? <span>{dictionary.jobs.internalJob}</span> : null}
                        </div>
                      </div>
                      <div style={statusPanelStack}>
                        <StatusPanel title={dictionary.jobs.work} icon={workStatus.icon} label={workStatus.label} tone={workStatus.tone} />
                        {billingStatus ? <StatusPanel title={dictionary.jobs.billing} icon={billingStatus.icon} label={billingStatus.label} tone={billingStatus.tone} /> : null}
                      </div>
                    </div>
                    <div className={styles.meta}>
                      <span>{dictionary.jobs.startLabel}: {formatDateTimePrague(job.start_at, dateLocale, companyTimeZone)}</span>
                      <span>{dictionary.jobs.endLabel}: {formatDateTimePrague(job.end_at, dateLocale, companyTimeZone)}</span>
                    </div>
                    <div className={styles.jobFooter}>
                      <span>{job.workers.length > 0 ? job.workers.join(', ') : dictionary.jobs.noWorkersAssigned}</span>
                      {childJobs.length ? <span>{dictionary.jobs.childJobs}: {childJobs.length}</span> : null}
                      <strong>{dictionary.jobs.price}: {job.price === null ? '—' : formatCurrency(toNumber(job.price), job.currency)}</strong>
                    </div>
                  </Link>
                  {canReadEconomics ? <LaborCostStatus summary={job.economics} locale={locale} /> : null}
                  {childJobs.map((childJob) => {
                    const childStatus = getLocalizedWorkStatusPanel(childJob.timeStateResolved, childJob.workStateResolved, dictionary.jobs)
                    return (
                      <div key={childJob.id} draggable className={styles.childJob}
                        onDragStart={(event) => { event.stopPropagation(); startDraggingJob(event, childJob.id) }} onDragEnd={stopDraggingJob}>
                        <Link href={`/jobs/${childJob.id}${parentQuery ? `?${parentQuery}` : ''}`} className={styles.jobCard}>
                          <div className={styles.jobHeader}>
                            <div className={styles.resourceBody}>
                              <h3 className={styles.resourceTitle}>{childJob.title ?? dictionary.jobs.untitledJob}</h3>
                              <div className={styles.meta}>{formatDateTimePrague(childJob.start_at, dateLocale, companyTimeZone)} · {dictionary.jobs.relatedJob}</div>
                            </div>
                            <StatusPanel title={dictionary.jobs.work} icon={childStatus.icon} label={childStatus.label} tone={childStatus.tone} />
                          </div>
                        </Link>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </DashboardShell>
  )
}
