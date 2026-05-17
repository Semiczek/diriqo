'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import JobEconomicsSection from '../../../components/JobEconomicsSection'
import JobCommunicationSection from '@/components/JobCommunicationSection'
import DashboardShell from '../../../components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import JobDangerZone from '@/components/JobDangerZone'
import JobPhotosSection from '@/components/JobPhotosSection'
import { getIntlLocale } from '@/lib/i18n/config'
import {
  cardTitleStyle,
  emptyStateStyle,
  errorStateStyle,
  eyebrowStyle,
  heroCardStyle,
  heroTitleStyle,
  metaItemStyle,
  metaLabelStyle,
  metaValueStyle,
  pageShellStyle,
  primaryButtonStyle,
  sectionCardStyle,
  secondaryButtonStyle,
} from '@/components/SaasPageLayout'
import {
  getEffectiveJobWorkState,
  getVisibleBillingState,
  isMultiDayJobRange,
  resolveJobBillingState,
  resolveJobTimeState,
  resolveJobWorkState,
  resolveLegacyJobStatus,
} from '@/lib/job-status'
import type {
  BillingStateResolved,
  TimeState,
  WorkState,
} from '@/lib/job-status'
import { getShiftDateKey } from '@/lib/job-shift-activity'
import type { MessageFeedItem } from '@/lib/email/types'
import {
  getAssignmentFallbackLaborCalculation,
  getShiftLaborCalculation,
  type LaborCalculationSource,
} from '@/lib/labor-calculation'
import {
  getContractorBillingType,
  getWorkerType,
} from '@/lib/payroll-settings'
import { calculateQuotedJobEconomics } from '@/lib/economics'

type AssignmentWorkState = 'not_started' | 'working' | 'completed'

type Job = {
  id: string
  company_id: string | null
  parent_job_id?: string | null
  title: string | null
  description: string | null
  status: string | null
  price: number | null
  is_internal?: boolean | null
  is_paid: boolean | null
  customer_id: string | null
  contact_id?: string | null
  address?: string | null
  scheduled_date?: string | null
  scheduled_start?: string | null
  scheduled_end?: string | null
  start_at: string | null
  end_at: string | null
  billing_status?: string | null
  invoiced_at?: string | null
  due_date?: string | null
  paid_at?: string | null
}

type JobStateRow = {
  id: string
  time_state: TimeState | null
  work_state: WorkState | null
  billing_state_resolved: BillingStateResolved | null
  assigned_total?: number | null
  started_total?: number | null
  completed_total?: number | null
  active_workers?: number | null
}

type Customer = {
  id: string
  name: string | null
  email?: string | null
  phone?: string | null
}

type CustomerContact = {
  id: string
  customer_id?: string | null
  full_name?: string | null
  role?: string | null
  phone?: string | null
  email?: string | null
  note?: string | null
}

type JobCustomerContact = {
  id: string
  job_id: string
  customer_contact_id: string | null
  role_label?: string | null
  created_at?: string | null
  contact?: CustomerContact | null
}

type AssignmentRow = {
  id: string
  job_id: string
  profile_id: string | null
  labor_hours: number | null
  hourly_rate: number | null
  worker_type_snapshot?: string | null
  assignment_billing_type?: string | null
  external_amount?: number | null
  note?: string | null
  work_started_at: string | null
  work_completed_at: string | null
  profiles: {
    id?: string | null
    full_name?: string | null
    email?: string | null
    default_hourly_rate?: number | null
    worker_type?: string | null
    contractor_billing_type?: string | null
    contractor_default_rate?: number | null
    name?: string | null
    first_name?: string | null
    last_name?: string | null
  } | null
}

type WorkerOption = {
  id: string
  full_name: string | null
  email?: string | null
  default_hourly_rate?: number | null
  hourly_rate?: number | null
  worker_type?: string | null
  contractor_billing_type?: string | null
  contractor_default_rate?: number | null
}

type WorkLogRow = {
  id: string
  job_id: string
  profile_id: string | null
  hours: number | null
  work_date: string | null
}

type GroupMemberJobRow = {
  id: string
  parent_job_id: string | null
  title: string | null
  description: string | null
  status: string | null
  address: string | null
  scheduled_start?: string | null
  scheduled_end?: string | null
  start_at: string | null
  end_at: string | null
  created_at: string | null
  price: number | null
  customer_id: string | null
}

type WorkShiftRow = {
  id: string
  job_id: string | null
  profile_id: string | null
  shift_date: string | null
  started_at: string | null
  ended_at: string | null
  hours_override: number | null
  job_hours_override: number | null
  note: string | null
  profiles:
    | {
        full_name?: string | null
        email?: string | null
        default_hourly_rate?: number | null
      }
    | null
}

type PhotoRow = {
  id: string
  job_id: string
  photo_url?: string | null
  file_path?: string | null
  uploaded_at?: string | null
}

type CostType =
  | 'material'
  | 'transport'
  | 'accommodation'
  | 'other'
  | 'consumption'

type CostItemRow = {
  id: string
  job_id: string
  cost_type?: string | null
  title?: string | null
  quantity?: number | null
  unit?: string | null
  unit_price?: number | null
  total_price?: number | null
  note?: string | null
  created_at?: string | null
}

type JobEconomicsSummaryRow = {
  job_id: string
  quoted_revenue_total?: number | null
  revenue_total: number
  labor_hours_total: number
  internal_labor_cost_total?: number | null
  external_labor_cost_total?: number | null
  labor_cost_total: number
  other_cost_total: number
  total_cost_total: number
  profit_total: number
  margin_percent: number | null
}

type JobDetailPageClientProps = {
  jobId: string
  canManageJobPhotos?: boolean
  canManageCommunication?: boolean
  initialJob: Job | null
  initialJobState: JobStateRow | null
  initialCustomer: Customer | null
  initialMainCustomerContact: CustomerContact | null
  initialJobCustomerContacts: JobCustomerContact[]
  initialAssignments: AssignmentRow[]
  initialWorkShifts: WorkShiftRow[]
  initialGroupParentJob: GroupMemberJobRow | null
  initialGroupMemberJobs: GroupMemberJobRow[]
  initialGroupMemberJobStates: JobStateRow[]
  initialGroupWorkShifts: WorkShiftRow[]
  initialGroupEconomicsSummaries: JobEconomicsSummaryRow[]
  initialWorkLogs: WorkLogRow[]
  initialCostItems: CostItemRow[]
  initialJobEconomicsSummary: JobEconomicsSummaryRow | null
  initialCommunicationFeed: MessageFeedItem[]
  initialError?: string | null
  initialNotFound?: boolean
}

type DerivedHoursRow = {
  id: string
  profileName: string
  hours: number
  note: string
  hourlyRate: number | null
  laborCost: number
  workStartedAt: string | null
  workCompletedAt: string | null
  workState: AssignmentWorkState
  hoursSource: LaborCalculationSource
}

type NormalizedAssignment = {
  id: string
  job_id: string
  profile_id: string
  labor_hours: number | null
  hourly_rate: number | null
  worker_type: 'employee' | 'contractor'
  assignment_billing_type: string | null
  external_amount: number | null
  note: string | null
  computed_labor_hours: number
  computed_hourly_rate: number
  computed_labor_cost: number
  computed_internal_labor_cost: number
  computed_external_labor_cost: number
  work_started_at: string | null
  work_completed_at: string | null
  profiles: {
    full_name: string | null
    default_hourly_rate: number | null
  } | null
}

type NormalizedCostItem = {
  id: string
  job_id: string
  cost_type: CostType
  title: string
  quantity: number | null
  unit: string | null
  unit_price: number | null
  total_price: number | null
  note: string | null
}

type ScheduledJobLike = {
  scheduled_date?: string | null
  scheduled_start?: string | null
  scheduled_end?: string | null
  start_at?: string | null
  end_at?: string | null
}

function getJobStartAt(job: ScheduledJobLike | null | undefined) {
  return job?.start_at ?? job?.scheduled_start ?? job?.scheduled_date ?? null
}

function getJobEndAt(job: ScheduledJobLike | null | undefined) {
  return job?.end_at ?? job?.scheduled_end ?? null
}

function getProfileNameForDisplay(profile: AssignmentRow['profiles'], fallback: string) {
  if (!profile) return fallback

  if (profile.full_name) return profile.full_name
  if (profile.name) return profile.name

  const firstName = profile.first_name ?? ''
  const lastName = profile.last_name ?? ''
  const combined = `${firstName} ${lastName}`.trim()

  if (combined) return combined
  if (profile.email) return profile.email

  return profile.id ?? fallback
}

function formatCurrencyForLocale(value: number | null | undefined, locale: string) {
  const safeValue = Number(value ?? 0)

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 2,
  }).format(safeValue)
}

function formatDateTimeForLocale(value: string | null, locale: string) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getPhotoUrl(photo: PhotoRow) {
  return photo.photo_url ?? photo.file_path ?? null
}

function formatDateForLocale(value: string | null, locale: string) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatHoursForLocale(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100
}

function toNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatTemplate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template
  )
}

function getHoursFromStartedCompleted(
  startedAt: string | null,
  completedAt: string | null
) {
  if (!startedAt || !completedAt) return 0

  const start = new Date(startedAt)
  const end = new Date(completedAt)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0

  const diffMs = end.getTime() - start.getTime()
  if (diffMs <= 0) return 0

  return roundHours(diffMs / (1000 * 60 * 60))
}

function getShiftHours(shift: Pick<WorkShiftRow, 'hours_override' | 'job_hours_override' | 'started_at' | 'ended_at'>) {
  if (shift.job_hours_override != null) {
    return roundHours(toNumber(shift.job_hours_override))
  }

  if (shift.hours_override != null) {
    return roundHours(toNumber(shift.hours_override))
  }

  return getHoursFromStartedCompleted(shift.started_at, shift.ended_at)
}

function getShiftWorkerNameForDisplay(shift: WorkShiftRow, fallback: string) {
  if (shift.profiles?.full_name?.trim()) return shift.profiles.full_name.trim()
  if (shift.profiles?.email?.trim()) return shift.profiles.email.trim()
  return fallback
}

function getShiftHourlyRate(shift: WorkShiftRow, assignments: AssignmentRow[]) {
  const assignmentRate = assignments.find(
    (assignment) =>
      assignment.job_id === shift.job_id &&
      assignment.profile_id === shift.profile_id &&
      assignment.hourly_rate != null &&
      toNumber(assignment.hourly_rate) > 0
  )?.hourly_rate

  if (assignmentRate != null && toNumber(assignmentRate) > 0) {
    return toNumber(assignmentRate)
  }

  return toNumber(shift.profiles?.default_hourly_rate)
}

function getShiftLaborCost(shift: WorkShiftRow, assignments: AssignmentRow[]) {
  return roundHours(getShiftHours(shift) * getShiftHourlyRate(shift, assignments))
}

function normalizeCostType(value: string | null | undefined): CostType {
  switch (value) {
    case 'material':
    case 'transport':
    case 'accommodation':
    case 'other':
    case 'consumption':
      return value
    default:
      return 'other'
  }
}

function getTimeStateStyles(state: TimeState): React.CSSProperties {
  if (state === 'future') {
    return {
      backgroundColor: '#dbeafe',
      color: '#1d4ed8',
      border: '1px solid #bfdbfe',
    }
  }

  if (state === 'active') {
    return {
      backgroundColor: '#fef3c7',
      color: '#b45309',
      border: '1px solid #fde68a',
    }
  }

  if (state === 'finished') {
    return {
      backgroundColor: '#fee2e2',
      color: '#991b1b',
      border: '1px solid #fecaca',
    }
  }

  return {
    backgroundColor: '#e5e7eb',
    color: '#374151',
    border: '1px solid #d1d5db',
  }
}

function getWorkStateStyles(state: WorkState): React.CSSProperties {
  if (state === 'not_started') {
    return {
      backgroundColor: '#f3f4f6',
      color: '#374151',
      border: '1px solid #d1d5db',
    }
  }

  if (state === 'in_progress') {
    return {
      backgroundColor: '#fef3c7',
      color: '#92400e',
      border: '1px solid #fde68a',
    }
  }

  if (state === 'partially_done') {
    return {
      backgroundColor: '#ede9fe',
      color: '#6d28d9',
      border: '1px solid #ddd6fe',
    }
  }

  if (state === 'done') {
    return {
      backgroundColor: '#dcfce7',
      color: '#166534',
      border: '1px solid #bbf7d0',
    }
  }

  return {
    backgroundColor: '#e5e7eb',
    color: '#374151',
    border: '1px solid #d1d5db',
  }
}

function getBillingStateStyles(
  state: BillingStateResolved
): React.CSSProperties {
  if (state === 'waiting_for_invoice') {
    return {
      backgroundColor: '#fef9c3',
      color: '#854d0e',
      border: '1px solid #fde68a',
    }
  }

  if (state === 'due') {
    return {
      backgroundColor: '#dbeafe',
      color: '#1d4ed8',
      border: '1px solid #bfdbfe',
    }
  }

  if (state === 'overdue') {
    return {
      backgroundColor: '#fee2e2',
      color: '#991b1b',
      border: '1px solid #fecaca',
    }
  }

  if (state === 'paid') {
    return {
      backgroundColor: '#dcfce7',
      color: '#166534',
      border: '1px solid #bbf7d0',
    }
  }

  return {
    backgroundColor: '#e5e7eb',
    color: '#374151',
    border: '1px solid #d1d5db',
  }
}

type StatusTone = 'blue' | 'green' | 'orange' | 'amber' | 'red' | 'gray'

const premiumStatusTones: Record<
  StatusTone,
  { background: string; border: string; color: string; shadow: string; iconBg: string }
> = {
  blue: {
    background: 'linear-gradient(135deg, rgba(37,99,235,0.16), rgba(6,182,212,0.09))',
    border: '1px solid rgba(37,99,235,0.38)',
    color: '#1d4ed8',
    shadow: '0 12px 28px rgba(37,99,235,0.12)',
    iconBg: 'rgba(37,99,235,0.16)',
  },
  green: {
    background: 'linear-gradient(135deg, rgba(34,197,94,0.18), rgba(22,163,74,0.10))',
    border: '1px solid rgba(34,197,94,0.42)',
    color: '#047857',
    shadow: '0 12px 28px rgba(34,197,94,0.13)',
    iconBg: 'rgba(34,197,94,0.18)',
  },
  orange: {
    background: 'linear-gradient(135deg, rgba(249,115,22,0.19), rgba(245,158,11,0.10))',
    border: '1px solid rgba(249,115,22,0.42)',
    color: '#c2410c',
    shadow: '0 12px 28px rgba(249,115,22,0.13)',
    iconBg: 'rgba(249,115,22,0.18)',
  },
  amber: {
    background: 'linear-gradient(135deg, rgba(245,158,11,0.22), rgba(251,191,36,0.12))',
    border: '1px solid rgba(245,158,11,0.42)',
    color: '#b45309',
    shadow: '0 12px 28px rgba(245,158,11,0.13)',
    iconBg: 'rgba(245,158,11,0.18)',
  },
  red: {
    background: 'linear-gradient(135deg, rgba(239,68,68,0.18), rgba(220,38,38,0.10))',
    border: '1px solid rgba(239,68,68,0.42)',
    color: '#b91c1c',
    shadow: '0 12px 28px rgba(239,68,68,0.13)',
    iconBg: 'rgba(239,68,68,0.18)',
  },
  gray: {
    background: 'linear-gradient(135deg, rgba(100,116,139,0.13), rgba(148,163,184,0.08))',
    border: '1px solid rgba(100,116,139,0.28)',
    color: '#475569',
    shadow: '0 12px 28px rgba(15,23,42,0.07)',
    iconBg: 'rgba(100,116,139,0.14)',
  },
}

function formatJobTermForLocale(
  startAt: string | null,
  endAt: string | null,
  locale: string,
  notScheduledLabel: string
) {
  if (!startAt && !endAt) return notScheduledLabel

  const start = startAt ? new Date(startAt) : null
  const end = endAt ? new Date(endAt) : null

  if (start && !Number.isNaN(start.getTime()) && end && !Number.isNaN(end.getTime())) {
    const sameDay = start.toDateString() === end.toDateString()
    const date = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).format(start)
    const startTime = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(start)
    const endTime = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(end)

    if (sameDay) return `${date}, ${startTime}-${endTime}`
  }

  return `${formatDateTimeForLocale(startAt, locale)} - ${formatDateTimeForLocale(endAt, locale)}`
}

function StatusPanel({
  label,
  value,
  tone,
  icon,
}: {
  label: string
  value: string
  tone: StatusTone
  icon: string
}) {
  const colors = premiumStatusTones[tone]

  return (
    <div
      style={{
        minHeight: '86px',
        borderRadius: '20px',
        padding: '14px 16px',
        background: colors.background,
        border: colors.border,
        boxShadow: colors.shadow,
        display: 'grid',
        alignContent: 'center',
        gap: '8px',
      }}
    >
      <div
        style={{
          color: '#64748b',
          fontSize: '12px',
          fontWeight: 900,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span
          style={{
            width: '30px',
            height: '30px',
            borderRadius: '999px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: colors.iconBg,
            color: colors.color,
            fontWeight: 900,
          }}
        >
          {icon}
        </span>
        <span style={{ color: colors.color, fontSize: '18px', fontWeight: 900 }}>
          {value}
        </span>
      </div>
    </div>
  )
}

function FinanceSummaryCard({
  label,
  value,
  tone = 'blue',
}: {
  label: string
  value: string
  tone?: StatusTone
}) {
  const colors = premiumStatusTones[tone]

  return (
    <div
      style={{
        borderRadius: '22px',
        padding: '18px',
        background: 'rgba(255,255,255,0.88)',
        border: '1px solid rgba(148,163,184,0.22)',
        boxShadow: '0 18px 42px rgba(15,23,42,0.08)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 'auto 14px 0 14px',
          height: '4px',
          borderRadius: '999px',
          background: colors.color,
          opacity: 0.85,
        }}
      />
      <div style={{ color: '#64748b', fontSize: '14px', fontWeight: 800, marginBottom: '8px' }}>
        {label}
      </div>
      <div style={{ color: colors.color, fontSize: '28px', fontWeight: 900 }}>
        {value}
      </div>
    </div>
  )
}

function DetailInfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '14px',
        padding: '11px 0',
        borderBottom: '1px solid rgba(226,232,240,0.75)',
      }}
    >
      <span style={{ color: '#64748b', fontWeight: 800 }}>{label}</span>
      <span style={{ color: '#0f172a', fontWeight: 850, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function getAssignmentWorkState(
  assignment: Pick<AssignmentRow, 'work_started_at' | 'work_completed_at'>,
  options?: {
    effectiveHours?: number
    jobWorkState?: WorkState
  }
): AssignmentWorkState {
  if (!assignment.work_started_at) {
    if (
      (options?.effectiveHours ?? 0) > 0 &&
      options?.jobWorkState === 'done'
    ) {
      return 'completed'
    }

    return 'not_started'
  }

  if (assignment.work_started_at && !assignment.work_completed_at) return 'working'
  return 'completed'
}

function getAssignmentWorkStateStyles(
  state: AssignmentWorkState
): React.CSSProperties {
  if (state === 'not_started') {
    return {
      backgroundColor: '#dbeafe',
      color: '#1d4ed8',
      border: '1px solid #bfdbfe',
    }
  }

  if (state === 'working') {
    return {
      backgroundColor: '#fef3c7',
      color: '#b45309',
      border: '1px solid #fde68a',
    }
  }

  return {
    backgroundColor: '#dcfce7',
    color: '#166534',
    border: '1px solid #bbf7d0',
  }
}

function getEffectiveHourlyRate(assignment: AssignmentRow) {
  const rawRate =
    assignment.hourly_rate !== null && assignment.hourly_rate !== undefined
      ? toNumber(assignment.hourly_rate)
      : null

  const defaultRate =
    assignment.profiles?.default_hourly_rate !== null &&
    assignment.profiles?.default_hourly_rate !== undefined
      ? toNumber(assignment.profiles.default_hourly_rate)
      : null

  if (rawRate !== null && rawRate > 0) {
    return rawRate
  }

  return defaultRate ?? 0
}

function getEffectiveHours(assignment: AssignmentRow) {
  return getAssignmentFallbackLaborCalculation(
    assignment,
    toNumber(assignment.profiles?.default_hourly_rate)
  ).hours
}

function getEffectiveHoursSource(assignment: AssignmentRow): LaborCalculationSource {
  return getAssignmentFallbackLaborCalculation(
    assignment,
    toNumber(assignment.profiles?.default_hourly_rate)
  ).source
}

function normalizeAssignmentRows(
  data: unknown[],
  profilesById = new Map<string, NonNullable<AssignmentRow['profiles']>>()
): AssignmentRow[] {
  return data.map((item) => {
    const row = item as {
      id?: string | null
      job_id?: string | null
      profile_id?: string | null
      labor_hours?: number | null
      hourly_rate?: number | null
      worker_type_snapshot?: string | null
      assignment_billing_type?: string | null
      external_amount?: number | null
      note?: string | null
      work_started_at?: string | null
      work_completed_at?: string | null
    }

    const profile = row.profile_id ? profilesById.get(row.profile_id) ?? null : null

    return {
      id: row.id ?? '',
      job_id: row.job_id ?? '',
      profile_id: row.profile_id ?? null,
      labor_hours:
        row.labor_hours !== null && row.labor_hours !== undefined
          ? toNumber(row.labor_hours)
          : null,
      hourly_rate:
        row.hourly_rate !== null && row.hourly_rate !== undefined
          ? toNumber(row.hourly_rate)
          : null,
      worker_type_snapshot: row.worker_type_snapshot ?? null,
      assignment_billing_type: row.assignment_billing_type ?? null,
      external_amount:
        row.external_amount !== null && row.external_amount !== undefined
          ? toNumber(row.external_amount)
          : null,
      note: row.note ?? null,
      work_started_at: row.work_started_at ?? null,
      work_completed_at: row.work_completed_at ?? null,
      profiles: profile
        ? {
            id: profile.id ?? null,
            full_name: profile.full_name ?? null,
            email: profile.email ?? null,
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
            name: profile.name ?? null,
            first_name: profile.first_name ?? null,
            last_name: profile.last_name ?? null,
          }
        : null,
    }
  })
}

export default function JobDetailPageClient({
  jobId,
  canManageJobPhotos = false,
  canManageCommunication = false,
  initialJob,
  initialJobState,
  initialCustomer,
  initialMainCustomerContact,
  initialJobCustomerContacts,
  initialAssignments,
  initialWorkShifts,
  initialGroupParentJob,
  initialGroupMemberJobs,
  initialGroupMemberJobStates,
  initialGroupWorkShifts,
  initialGroupEconomicsSummaries,
  initialWorkLogs,
  initialCostItems,
  initialJobEconomicsSummary,
  initialCommunicationFeed,
  initialError = null,
  initialNotFound = false,
}: JobDetailPageClientProps) {
  const router = useRouter()
  const { dictionary, locale } = useI18n()
  const dateLocale = getIntlLocale(locale)
  const detailMessages = dictionary.jobs.detail
  const formatCurrency = (value: number | null | undefined) => formatCurrencyForLocale(value, dateLocale)
  const formatDateTime = (value: string | null) => formatDateTimeForLocale(value, dateLocale)
  const formatDate = (value: string | null) => formatDateForLocale(value, dateLocale)
  const formatHours = (value: number) => formatHoursForLocale(value, dateLocale)
  const formatJobTerm = (startAt: string | null, endAt: string | null) =>
    formatJobTermForLocale(startAt, endAt, dateLocale, detailMessages.notScheduled)
  const getProfileName = useCallback(
    (profile: AssignmentRow['profiles']) =>
      getProfileNameForDisplay(profile, detailMessages.unknownWorker),
    [detailMessages.unknownWorker]
  )
  const getShiftWorkerName = useCallback(
    (shift: WorkShiftRow) =>
      getShiftWorkerNameForDisplay(shift, detailMessages.unknownWorker),
    [detailMessages.unknownWorker]
  )
  const getWorkerTypeLabel = (workerType: string | null | undefined) =>
    getWorkerType({ worker_type: workerType }) === 'contractor'
      ? detailMessages.contractorWorker
      : detailMessages.employeeWorker
  const getContractorBillingTypeLabel = (value: string | null | undefined) => {
    const normalized = getContractorBillingType(value)
    if (normalized === 'fixed') return detailMessages.contractorFixed
    if (normalized === 'invoice') return detailMessages.contractorInvoice
    return detailMessages.contractorHourly
  }
  const getHumanWorkStatus = useCallback((timeState: TimeState, workState: WorkState) => {
    if (workState === 'done') {
      return { label: dictionary.jobs.done, tone: 'green' as const, icon: '✓', state: 'done' as const }
    }

    if (workState === 'in_progress' || workState === 'partially_done' || timeState === 'active') {
      return { label: dictionary.jobs.inProgress, tone: 'orange' as const, icon: '↻', state: 'in_progress' as const }
    }

    if (timeState === 'future') {
      return { label: dictionary.jobs.future, tone: 'blue' as const, icon: '•', state: 'future' as const }
    }

    return { label: dictionary.jobs.notStarted, tone: 'gray' as const, icon: '•', state: 'not_started' as const }
  }, [dictionary.jobs.done, dictionary.jobs.future, dictionary.jobs.inProgress, dictionary.jobs.notStarted])
  const getHumanBillingStatus = useCallback((state: BillingStateResolved | null) => {
    if (state === 'waiting_for_invoice') {
      return { label: dictionary.jobs.waitingForInvoice, tone: 'amber' as const, icon: 'F' }
    }
    if (state === 'due') return { label: dictionary.jobs.due, tone: 'blue' as const, icon: 'S' }
    if (state === 'overdue') return { label: dictionary.jobs.overdue, tone: 'red' as const, icon: '!' }
    if (state === 'paid') return { label: dictionary.jobs.paid, tone: 'green' as const, icon: '✓' }
    return { label: detailMessages.noInvoice, tone: 'gray' as const, icon: '•' }
  }, [
    detailMessages.noInvoice,
    dictionary.jobs.due,
    dictionary.jobs.overdue,
    dictionary.jobs.paid,
    dictionary.jobs.waitingForInvoice,
  ])
  const getMainJobStatusLabel = (workStatus: ReturnType<typeof getHumanWorkStatus>) => {
    if (workStatus.state === 'done') return detailMessages.mainStatusDone
    if (workStatus.state === 'in_progress') return detailMessages.mainStatusInProgress
    if (workStatus.state === 'future') return detailMessages.mainStatusUpcoming
    return detailMessages.mainStatusNotStarted
  }

  const [job, setJob] = useState<Job | null>(initialJob)
  const [jobState, setJobState] = useState<JobStateRow | null>(initialJobState)
  const [customer] = useState<Customer | null>(initialCustomer)
  const [mainCustomerContact] =
    useState<CustomerContact | null>(initialMainCustomerContact)
  const [jobCustomerContactsWithDetails] =
    useState<JobCustomerContact[]>(initialJobCustomerContacts)
  const [assignments, setAssignments] = useState<AssignmentRow[]>(initialAssignments)
  const [workShifts, setWorkShifts] = useState<WorkShiftRow[]>(initialWorkShifts)
  const [groupParentJob] =
    useState<GroupMemberJobRow | null>(initialGroupParentJob)
  const [groupMemberJobs] = useState<GroupMemberJobRow[]>(initialGroupMemberJobs)
  const [groupMemberJobStates] =
    useState<JobStateRow[]>(initialGroupMemberJobStates)
  const [groupWorkShifts, setGroupWorkShifts] = useState<WorkShiftRow[]>(initialGroupWorkShifts)
  const [groupEconomicsSummaries] =
    useState<JobEconomicsSummaryRow[]>(initialGroupEconomicsSummaries)
  const [workLogs] = useState<WorkLogRow[]>(initialWorkLogs)
  const [costItems, setCostItems] = useState<CostItemRow[]>(initialCostItems)
  const [jobEconomicsSummary, setJobEconomicsSummary] =
    useState<JobEconomicsSummaryRow | null>(initialJobEconomicsSummary)
  const detailsLoading = false
  const [error, setError] = useState<string | null>(initialError)
  const [notFound, setNotFound] = useState(initialNotFound)
  const [workerOptions, setWorkerOptions] = useState<WorkerOption[]>([])
  const [loadingWorkerOptions, setLoadingWorkerOptions] = useState(false)
  const [workerMessage, setWorkerMessage] = useState<string | null>(null)
  const [workersExpanded, setWorkersExpanded] = useState(false)
  const [costItemsExpanded, setCostItemsExpanded] = useState(false)
  const [addingWorker, setAddingWorker] = useState(false)
  const [savingAssignmentId, setSavingAssignmentId] = useState<string | null>(null)
  const [removingAssignmentId, setRemovingAssignmentId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [markingJobDone, setMarkingJobDone] = useState(false)
  const [newAssignment, setNewAssignment] = useState({
    profile_id: '',
    labor_hours: '',
    hourly_rate: '',
    external_amount: '',
    note: '',
  })
  const [assignmentDrafts, setAssignmentDrafts] = useState<
    Record<string, { labor_hours: string; hourly_rate: string; external_amount: string; note: string }>
  >({})

  function handlePriceSaved(nextPrice: number) {
    setJob((current) => (current ? { ...current, price: nextPrice } : current))
  }

  function handleCostItemAdded(item: NormalizedCostItem) {
    setCostItems((current) => [item, ...current.filter((existing) => existing.id !== item.id)])
  }

  function handleCostItemDeleted(id: string) {
    setCostItems((current) => current.filter((item) => item.id !== id))
  }

  useEffect(() => {
    setAssignments(initialAssignments)
  }, [initialAssignments])

  useEffect(() => {
    setJobEconomicsSummary(initialJobEconomicsSummary)
  }, [initialJobEconomicsSummary])

  useEffect(() => {
    setAssignmentDrafts(
      Object.fromEntries(
        initialAssignments.map((assignment) => [
          assignment.id,
          {
            labor_hours: assignment.labor_hours != null ? String(assignment.labor_hours) : '',
            hourly_rate: assignment.hourly_rate != null ? String(assignment.hourly_rate) : '',
            external_amount: assignment.external_amount != null ? String(assignment.external_amount) : '',
            note: assignment.note ?? '',
          },
        ])
      )
    )
  }, [initialAssignments])

  useEffect(() => {
    let cancelled = false

    async function loadWorkerOptions() {
      setLoadingWorkerOptions(true)

      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, default_hourly_rate, hourly_rate, worker_type, contractor_billing_type, contractor_default_rate')
        .order('full_name', { ascending: true })

      if (!cancelled) {
        setWorkerOptions((data ?? []) as WorkerOption[])
        setLoadingWorkerOptions(false)
      }
    }

    void loadWorkerOptions()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setWorkShifts(initialWorkShifts)
  }, [initialWorkShifts])

  useEffect(() => {
    setGroupWorkShifts(initialGroupWorkShifts)
  }, [initialGroupWorkShifts])

  const getLocalizedTimeStateLabel = (state: TimeState) => {
    if (state === 'future') return dictionary.jobs.future
    if (state === 'active') return dictionary.jobs.active
    if (state === 'finished') return dictionary.jobs.finished
    return dictionary.jobs.unknownTime
  }

  const getLocalizedDisplayTimeStateLabel = (state: TimeState) => {
    if (state === 'finished') return dictionary.jobs.finished
    return getLocalizedTimeStateLabel(state)
  }

  const getLocalizedWorkStateLabel = (state: WorkState) => {
    if (state === 'not_started') return dictionary.jobs.notStarted
    if (state === 'in_progress') return dictionary.jobs.inProgress
    if (state === 'partially_done') return dictionary.jobs.partiallyDone
    if (state === 'done') return dictionary.jobs.done
    return dictionary.jobs.unknownWork
  }

  const getLocalizedBillingStateLabel = (state: BillingStateResolved) => {
    if (state === 'waiting_for_invoice') return dictionary.jobs.waitingForInvoice
    if (state === 'due') return dictionary.jobs.due
    if (state === 'overdue') return dictionary.jobs.overdue
    if (state === 'paid') return dictionary.jobs.paid
    return dictionary.jobs.unknownBilling
  }

  const getLocalizedAssignmentWorkStateLabel = (state: AssignmentWorkState) => {
    if (state === 'not_started') return dictionary.jobs.future
    if (state === 'working') return dictionary.jobs.inProgress
    return dictionary.jobs.done
  }

  const resolvedTimeState = useMemo<TimeState>(() => {
    return resolveJobTimeState(jobState?.time_state)
  }, [jobState])

  const currentLegacyStatus = useMemo(() => {
    return resolveLegacyJobStatus(job?.status)
  }, [job?.status])
  const jobStartAt = getJobStartAt(job)
  const jobEndAt = getJobEndAt(job)

  const resolvedWorkState = useMemo<WorkState>(() => {
    return getEffectiveJobWorkState({
      timeState: resolvedTimeState,
      workState: resolveJobWorkState(jobState?.work_state),
      legacyStatus: currentLegacyStatus,
      isMultiDay: isMultiDayJobRange(jobStartAt, jobEndAt),
      assignedCount: toNumber(jobState?.assigned_total),
      startedCount: toNumber(jobState?.started_total),
      completedCount: toNumber(jobState?.completed_total),
      activeCount: toNumber(jobState?.active_workers),
    })
  }, [currentLegacyStatus, jobEndAt, jobStartAt, jobState, resolvedTimeState])

  const resolvedBillingState = useMemo<BillingStateResolved>(() => {
    return resolveJobBillingState(jobState?.billing_state_resolved)
  }, [jobState])
  const normalizedAssignments = useMemo<NormalizedAssignment[]>(() => {
    return assignments.map((assignment) => {
      const workerType = getWorkerType({
        worker_type: assignment.worker_type_snapshot ?? assignment.profiles?.worker_type,
      })
      const billingType = assignment.assignment_billing_type ?? assignment.profiles?.contractor_billing_type ?? null
      const computedLaborHours = getEffectiveHours(assignment)
      const computedHourlyRate = getEffectiveHourlyRate(assignment)
      const hourlyCost = roundHours(computedLaborHours * computedHourlyRate)
      const computedExternalLaborCost =
        workerType === 'contractor'
          ? roundHours(
              assignment.external_amount != null && toNumber(assignment.external_amount) > 0
                ? toNumber(assignment.external_amount)
                : hourlyCost
            )
          : 0
      const computedInternalLaborCost = workerType === 'employee' ? hourlyCost : 0
      const computedLaborCost = computedInternalLaborCost + computedExternalLaborCost

      return {
        id: assignment.id,
        job_id: assignment.job_id,
        profile_id: assignment.profile_id ?? '',
        labor_hours: assignment.labor_hours,
        hourly_rate: assignment.hourly_rate,
        worker_type: workerType,
        assignment_billing_type: billingType,
        external_amount: assignment.external_amount ?? null,
        note: assignment.note ?? null,
        computed_labor_hours: computedLaborHours,
        computed_hourly_rate: computedHourlyRate,
        computed_labor_cost: computedLaborCost,
        computed_internal_labor_cost: computedInternalLaborCost,
        computed_external_labor_cost: computedExternalLaborCost,
        work_started_at: assignment.work_started_at,
        work_completed_at: assignment.work_completed_at,
        profiles: assignment.profiles
          ? {
              full_name: assignment.profiles.full_name ?? null,
              default_hourly_rate: assignment.profiles.default_hourly_rate ?? null,
            }
          : null,
      }
    })
  }, [assignments])

  const derivedHoursRows = useMemo<DerivedHoursRow[]>(() => {
    const shiftAssignmentKeys = new Set(
      workShifts
        .filter((shift) => shift.job_id && shift.profile_id)
        .map((shift) => `${shift.job_id}:${shift.profile_id}`)
    )

    const shiftRows = workShifts.map((shift) => {
      const hourlyRate = getShiftHourlyRate(shift, assignments)
      const calculation = getShiftLaborCalculation(shift, hourlyRate)

      return {
        id: shift.id,
        profileName: getShiftWorkerName(shift),
        hours: calculation.hours,
        note: shift.note ?? '',
        hourlyRate: calculation.hourlyRate,
        laborCost: calculation.reward,
        workStartedAt: shift.started_at,
        workCompletedAt: shift.ended_at,
        workState: shift.ended_at ? 'completed' as const : 'working' as const,
        hoursSource: calculation.source,
      }
    })

    const fallbackRows = assignments
      .filter(
        (assignment) =>
          !assignment.job_id ||
          !assignment.profile_id ||
          !shiftAssignmentKeys.has(`${assignment.job_id}:${assignment.profile_id}`)
      )
      .map((assignment) => {
      const normalizedAssignment = normalizedAssignments.find((item) => item.id === assignment.id)
      const workState = getAssignmentWorkState(assignment, {
        effectiveHours: normalizedAssignment?.computed_labor_hours ?? 0,
        jobWorkState: resolvedWorkState,
      })

      return {
        id: assignment.id,
        profileName: getProfileName(assignment.profiles),
        hours: normalizedAssignment?.computed_labor_hours ?? 0,
        note: assignment.note ?? '',
        hourlyRate: normalizedAssignment?.computed_hourly_rate ?? 0,
        laborCost: normalizedAssignment?.computed_labor_cost ?? 0,
        workStartedAt:
          getEffectiveHoursSource(assignment) === 'assignment_fallback'
            ? assignment.work_started_at
            : null,
        workCompletedAt:
          getEffectiveHoursSource(assignment) === 'assignment_fallback'
            ? assignment.work_completed_at
            : null,
        workState,
        hoursSource: getEffectiveHoursSource(assignment),
      }
    })

    return [...shiftRows, ...fallbackRows]
  }, [assignments, getProfileName, getShiftWorkerName, normalizedAssignments, resolvedWorkState, workShifts])

  const selectedWorkerOption = useMemo(() => {
    return workerOptions.find((worker) => worker.id === newAssignment.profile_id) ?? null
  }, [newAssignment.profile_id, workerOptions])

  const selectedWorkerType = getWorkerType(selectedWorkerOption)
  const selectedContractorBillingType = getContractorBillingType(
    selectedWorkerOption?.contractor_billing_type
  )

  const groupedWorkShifts = useMemo(() => {
    const groups = new Map<
      string,
      {
        dateKey: string
        shifts: WorkShiftRow[]
        totalHours: number
      }
    >()

    for (const shift of workShifts) {
      const dateKey = getShiftDateKey(shift)
      if (!dateKey) continue

      const current = groups.get(dateKey) ?? {
        dateKey,
        shifts: [],
        totalHours: 0,
      }

      current.shifts.push(shift)
      current.totalHours += getShiftHours(shift)
      groups.set(dateKey, current)
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        totalHours: roundHours(group.totalHours),
        shifts: [...group.shifts].sort((left, right) => {
          const leftTime =
            new Date(left.started_at ?? left.shift_date ?? 0).getTime() || Number.MAX_SAFE_INTEGER
          const rightTime =
            new Date(right.started_at ?? right.shift_date ?? 0).getTime() || Number.MAX_SAFE_INTEGER

          return leftTime - rightTime
        }),
      }))
      .sort((left, right) => {
        const leftTime = new Date(left.dateKey).getTime()
        const rightTime = new Date(right.dateKey).getTime()
        return leftTime - rightTime
      })
  }, [workShifts])

  const groupMemberJobStateMap = useMemo(() => {
    return new Map(groupMemberJobStates.map((item) => [item.id, item]))
  }, [groupMemberJobStates])

  const groupedJobsForDisplay = useMemo(() => {
    return groupMemberJobs
      .map((groupJob) => {
        const jobState = groupMemberJobStateMap.get(groupJob.id) ?? null
        const shifts = groupWorkShifts.filter((shift) => shift.job_id === groupJob.id)

        const resolvedMemberTimeState = resolveJobTimeState(jobState?.time_state)
        const resolvedMemberWorkState = getEffectiveJobWorkState({
          timeState: resolvedMemberTimeState,
          workState: resolveJobWorkState(jobState?.work_state),
          legacyStatus: resolveLegacyJobStatus(groupJob.status),
          isMultiDay: isMultiDayJobRange(getJobStartAt(groupJob), getJobEndAt(groupJob)),
          assignedCount: toNumber(jobState?.assigned_total),
          startedCount: toNumber(jobState?.started_total),
          completedCount: toNumber(jobState?.completed_total),
          activeCount: toNumber(jobState?.active_workers),
        })

        const shiftsByDate = new Map<string, WorkShiftRow[]>()

        for (const shift of shifts) {
          const dateKey = getShiftDateKey(shift)
          if (!dateKey) continue
          const current = shiftsByDate.get(dateKey) ?? []
          current.push(shift)
          shiftsByDate.set(dateKey, current)
        }

        return {
          ...groupJob,
          shiftsByDate: Array.from(shiftsByDate.entries())
            .map(([dateKey, dateShifts]) => ({
              dateKey,
              shifts: dateShifts,
            }))
            .sort((left, right) => new Date(left.dateKey).getTime() - new Date(right.dateKey).getTime()),
          shiftsCount: shifts.length,
          totalShiftHours: roundHours(shifts.reduce((sum, shift) => sum + getShiftHours(shift), 0)),
          resolvedMemberTimeState,
          resolvedMemberWorkState,
        }
      })
      .sort((left, right) => {
        const leftDate =
          new Date(getJobStartAt(left) ?? left.created_at ?? 0).getTime() || Number.MAX_SAFE_INTEGER
        const rightDate =
          new Date(getJobStartAt(right) ?? right.created_at ?? 0).getTime() || Number.MAX_SAFE_INTEGER
        return leftDate - rightDate
      })
  }, [groupMemberJobStateMap, groupMemberJobs, groupWorkShifts])

  const groupedDailyJobsForDisplay = useMemo(() => {
    const hasExplicitDailyChildren = groupMemberJobs.some((memberJob) => memberJob.parent_job_id === job?.id)

    if (!hasExplicitDailyChildren) {
      return groupedJobsForDisplay
    }

    return groupedJobsForDisplay.filter((memberJob) => memberJob.id !== job?.id)
  }, [groupMemberJobs, groupedJobsForDisplay, job?.id])

  const groupedEconomicsSummary = useMemo(() => {
    const quotedRevenue = groupEconomicsSummaries.reduce(
      (sum, item) => sum + toNumber(item.quoted_revenue_total),
      0
    )
    const laborCost = groupEconomicsSummaries.reduce(
      (sum, item) => sum + toNumber(item.labor_cost_total),
      0
    )
    const otherCosts = groupEconomicsSummaries.reduce(
      (sum, item) => sum + toNumber(item.other_cost_total),
      0
    )
    const quotedEconomics = calculateQuotedJobEconomics({
      quotedRevenue,
      laborCost,
      otherCost: otherCosts,
    })

    return {
      totalHours: roundHours(
        groupEconomicsSummaries.reduce((sum, item) => sum + toNumber(item.labor_hours_total), 0)
      ),
      laborCost,
      otherCosts,
      totalCosts: quotedEconomics.totalCost,
      revenue: groupEconomicsSummaries.reduce(
        (sum, item) => sum + toNumber(item.revenue_total),
        0
      ),
      profit: quotedEconomics.profit,
    }
  }, [groupEconomicsSummaries])

  const totalHours = useMemo(() => {
    return roundHours(toNumber(jobEconomicsSummary?.labor_hours_total))
  }, [jobEconomicsSummary])

  const laborCost = useMemo(() => {
    return toNumber(jobEconomicsSummary?.internal_labor_cost_total ?? jobEconomicsSummary?.labor_cost_total)
  }, [jobEconomicsSummary])

  const otherCosts = useMemo(() => {
    return toNumber(jobEconomicsSummary?.other_cost_total)
  }, [jobEconomicsSummary])

  const normalizedCostItems = useMemo<NormalizedCostItem[]>(() => {
    return costItems.map((item) => ({
      id: item.id,
      job_id: item.job_id,
      cost_type: normalizeCostType(item.cost_type),
      title: item.title ?? '',
      quantity: item.quantity ?? null,
      unit: item.unit ?? null,
      unit_price: item.unit_price ?? null,
      total_price:
        item.total_price != null
          ? toNumber(item.total_price)
          : toNumber(item.quantity) * toNumber(item.unit_price),
      note: item.note ?? null,
    }))
  }, [costItems])

  const groupedCostItems = useMemo(() => {
    const buckets: Record<CostType, CostItemRow[]> = {
      material: [],
      transport: [],
      accommodation: [],
      other: [],
      consumption: [],
    }

    for (const item of costItems) {
      buckets[normalizeCostType(item.cost_type)].push(item)
    }

    return buckets
  }, [costItems])

  const assignmentTotalHours = useMemo(() => {
    return roundHours(
      normalizedAssignments.reduce((sum, assignment) => sum + assignment.computed_labor_hours, 0)
    )
  }, [normalizedAssignments])

  const assignmentLaborCost = useMemo(() => {
    return normalizedAssignments.reduce(
      (sum, assignment) => sum + assignment.computed_internal_labor_cost,
      0
    )
  }, [normalizedAssignments])

  const externalLaborCost = useMemo(() => {
    return toNumber(jobEconomicsSummary?.external_labor_cost_total)
  }, [jobEconomicsSummary])

  const assignedWorkerNames = useMemo(() => {
    return normalizedAssignments
      .map((assignment) => getProfileName(assignment.profiles))
      .filter((name) => name.trim().length > 0)
  }, [getProfileName, normalizedAssignments])

  const activeWorkerNames = useMemo(() => {
    return normalizedAssignments
      .filter((assignment) => Boolean(assignment.work_started_at) && !assignment.work_completed_at)
      .map((assignment) => getProfileName(assignment.profiles))
      .filter((name) => name.trim().length > 0)
  }, [getProfileName, normalizedAssignments])

  const totalCostItemsCount = useMemo(() => {
    return normalizedCostItems.length
  }, [normalizedCostItems])

  const accountingRevenue = useMemo(() => {
    return toNumber(jobEconomicsSummary?.revenue_total)
  }, [jobEconomicsSummary])

  const assignmentProfit = useMemo(() => {
    return calculateQuotedJobEconomics({
      quotedRevenue: job?.price,
      laborCost,
      otherCost: externalLaborCost + otherCosts,
    }).profit
  }, [externalLaborCost, job?.price, laborCost, otherCosts])

  const visibleBillingState = useMemo(() => {
    return getVisibleBillingState(resolvedWorkState, resolvedBillingState)
  }, [resolvedBillingState, resolvedWorkState])

  const workStatusPanel = useMemo(() => {
    return getHumanWorkStatus(resolvedTimeState, resolvedWorkState)
  }, [getHumanWorkStatus, resolvedTimeState, resolvedWorkState])

  const billingStatusPanel = useMemo(() => {
    return getHumanBillingStatus(visibleBillingState)
  }, [getHumanBillingStatus, visibleBillingState])

  const mainJobStatusLabel = getMainJobStatusLabel(workStatusPanel)
  const jobTermLabel = formatJobTerm(jobStartAt, jobEndAt)
  const invoiceCreateHref = `/invoices/new?jobId=${job?.id ?? jobId}${
    job?.customer_id ? `&customerId=${job.customer_id}` : ''
  }`

  const nearestShift = useMemo(() => {
    const now = Date.now()
    const sorted = [...workShifts]
      .filter((shift) => shift.started_at || shift.shift_date)
      .sort((left, right) => {
        const leftTime = new Date(left.started_at ?? left.shift_date ?? 0).getTime()
        const rightTime = new Date(right.started_at ?? right.shift_date ?? 0).getTime()
        return leftTime - rightTime
      })

    return (
      sorted.find((shift) => {
        const value = new Date(shift.started_at ?? shift.shift_date ?? 0).getTime()
        return Number.isFinite(value) && value >= now
      }) ?? sorted[0] ?? null
    )
  }, [workShifts])

  function parseMoneyInput(value: string) {
    const normalized = value.replace(',', '.').trim()
    if (!normalized) return 0
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }

  function updateAssignmentDraft(
    assignmentId: string,
    patch: Partial<{ labor_hours: string; hourly_rate: string; external_amount: string; note: string }>
  ) {
    setAssignmentDrafts((current) => ({
      ...current,
      [assignmentId]: {
        labor_hours: current[assignmentId]?.labor_hours ?? '',
        hourly_rate: current[assignmentId]?.hourly_rate ?? '',
        external_amount: current[assignmentId]?.external_amount ?? '',
        note: current[assignmentId]?.note ?? '',
        ...patch,
      },
    }))
  }

  function syncJobStateForAssignments(nextAssignments: AssignmentRow[]) {
    const assignedTotal = nextAssignments.filter((assignment) => assignment.profile_id).length
    const startedTotal = nextAssignments.filter((assignment) => assignment.work_started_at).length
    const completedTotal = nextAssignments.filter((assignment) => assignment.work_completed_at).length
    const activeWorkers = nextAssignments.filter(
      (assignment) => assignment.work_started_at && !assignment.work_completed_at
    ).length

    setJobState((current) =>
      current
        ? {
            ...current,
            assigned_total: assignedTotal,
            started_total: startedTotal,
            completed_total: completedTotal,
            active_workers: activeWorkers,
          }
        : current
    )
  }

  async function addJobAssignment() {
    if (!job?.id) return

    const profileId = newAssignment.profile_id.trim()
    if (!profileId) {
      setWorkerMessage(detailMessages.workerRequired)
      return
    }

    if (assignments.some((assignment) => assignment.profile_id === profileId)) {
      setWorkerMessage(detailMessages.workerAlreadyAssigned)
      return
    }

    const laborHours = parseMoneyInput(newAssignment.labor_hours)
    const hourlyRate = parseMoneyInput(newAssignment.hourly_rate)
    const externalAmount = parseMoneyInput(newAssignment.external_amount)
    const workerType = getWorkerType(selectedWorkerOption)
    const billingType =
      workerType === 'contractor'
        ? getContractorBillingType(selectedWorkerOption?.contractor_billing_type)
        : null

    if (workerType === 'employee' && (!Number.isFinite(laborHours) || laborHours < 0)) {
      setWorkerMessage(detailMessages.validHoursRequired)
      return
    }

    if (
      (workerType === 'employee' || billingType === 'hourly') &&
      (!Number.isFinite(hourlyRate) || hourlyRate < 0)
    ) {
      setWorkerMessage(detailMessages.validRateRequired)
      return
    }

    if (
      workerType === 'contractor' &&
      billingType !== 'hourly' &&
      (!Number.isFinite(externalAmount) || externalAmount < 0)
    ) {
      setWorkerMessage(detailMessages.validExternalAmountRequired)
      return
    }

    setAddingWorker(true)
    setWorkerMessage(detailMessages.addingWorker)

    try {
      const response = await fetch(`/api/jobs/${job.id}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: profileId,
          labor_hours: Math.round(laborHours * 100) / 100,
          hourly_rate: Math.round(hourlyRate * 100) / 100,
          worker_type_snapshot: workerType,
          assignment_billing_type: billingType,
          external_amount:
            workerType === 'contractor' && billingType !== 'hourly'
              ? Math.round(externalAmount * 100) / 100
              : null,
          note: newAssignment.note.trim() || null,
        }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || detailMessages.addWorkerFailed)
      }

      const body = (await response.json().catch(() => null)) as {
        assignment?: Partial<AssignmentRow> | null
      } | null
      const selectedProfile = workerOptions.find((worker) => worker.id === profileId) ?? null
      const savedAssignment = body?.assignment ?? null
      const temporaryId = savedAssignment?.id ?? `temp-${profileId}-${Date.now()}`
      const nextAssignment: AssignmentRow = {
        id: temporaryId,
        job_id: savedAssignment?.job_id ?? job.id,
        profile_id: savedAssignment?.profile_id ?? profileId,
        labor_hours:
          savedAssignment?.labor_hours != null
            ? Number(savedAssignment.labor_hours)
            : Math.round(laborHours * 100) / 100,
        hourly_rate:
          savedAssignment?.hourly_rate != null
            ? Number(savedAssignment.hourly_rate)
            : Math.round(hourlyRate * 100) / 100,
        worker_type_snapshot: savedAssignment?.worker_type_snapshot ?? workerType,
        assignment_billing_type: savedAssignment?.assignment_billing_type ?? billingType,
        external_amount:
          savedAssignment?.external_amount != null
            ? Number(savedAssignment.external_amount)
            : workerType === 'contractor' && billingType !== 'hourly'
              ? Math.round(externalAmount * 100) / 100
              : null,
        note: savedAssignment?.note ?? (newAssignment.note.trim() || null),
        work_started_at: savedAssignment?.work_started_at ?? null,
        work_completed_at: savedAssignment?.work_completed_at ?? null,
        profiles: selectedProfile
          ? {
              id: selectedProfile.id,
              full_name: selectedProfile.full_name,
              email: selectedProfile.email ?? null,
              default_hourly_rate: selectedProfile.default_hourly_rate ?? selectedProfile.hourly_rate ?? null,
              worker_type: selectedProfile.worker_type ?? null,
              contractor_billing_type: selectedProfile.contractor_billing_type ?? null,
              contractor_default_rate: selectedProfile.contractor_default_rate ?? null,
            }
          : null,
      }

      const nextAssignments = [...assignments, nextAssignment]
      setAssignments(nextAssignments)
      syncJobStateForAssignments(nextAssignments)
      setAssignmentDrafts((current) => ({
        ...current,
        [temporaryId]: {
          labor_hours: String(nextAssignment.labor_hours ?? ''),
          hourly_rate: String(nextAssignment.hourly_rate ?? ''),
          external_amount: String(nextAssignment.external_amount ?? ''),
          note: nextAssignment.note ?? '',
        },
      }))
      setNewAssignment({ profile_id: '', labor_hours: '', hourly_rate: '', external_amount: '', note: '' })
      setWorkerMessage(detailMessages.workerAdded)
      router.refresh()
    } catch (saveError) {
      setWorkerMessage(saveError instanceof Error ? saveError.message : detailMessages.addWorkerFailed)
    } finally {
      setAddingWorker(false)
    }
  }

  async function saveJobAssignment(assignment: NormalizedAssignment) {
    if (!job?.id) return

    const draft = assignmentDrafts[assignment.id] ?? {
      labor_hours: String(assignment.labor_hours ?? ''),
      hourly_rate: String(assignment.hourly_rate ?? ''),
      external_amount: String(assignment.external_amount ?? ''),
      note: assignment.note ?? '',
    }

    const laborHours = parseMoneyInput(draft.labor_hours)
    const hourlyRate = parseMoneyInput(draft.hourly_rate)
    const externalAmount = parseMoneyInput(draft.external_amount)
    const billingType = assignment.worker_type === 'contractor'
      ? getContractorBillingType(assignment.assignment_billing_type)
      : null

    if (assignment.worker_type === 'employee' && (!Number.isFinite(laborHours) || laborHours < 0)) {
      setWorkerMessage(detailMessages.validHoursRequired)
      return
    }

    if (
      (assignment.worker_type === 'employee' || billingType === 'hourly') &&
      (!Number.isFinite(hourlyRate) || hourlyRate < 0)
    ) {
      setWorkerMessage(detailMessages.validRateRequired)
      return
    }

    if (
      assignment.worker_type === 'contractor' &&
      billingType !== 'hourly' &&
      (!Number.isFinite(externalAmount) || externalAmount < 0)
    ) {
      setWorkerMessage(detailMessages.validExternalAmountRequired)
      return
    }

    setSavingAssignmentId(assignment.id)
    setWorkerMessage(detailMessages.savingWorker)

    try {
      const response = await fetch(`/api/jobs/${job.id}/assignments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: [
            {
              id: assignment.id,
              profile_id: assignment.profile_id,
              labor_hours: Math.round(laborHours * 100) / 100,
              hourly_rate: Math.round(hourlyRate * 100) / 100,
              worker_type_snapshot: assignment.worker_type,
              assignment_billing_type: billingType,
              external_amount:
                assignment.worker_type === 'contractor' && billingType !== 'hourly'
                  ? Math.round(externalAmount * 100) / 100
                  : null,
              note: draft.note.trim() || null,
            },
          ],
        }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || detailMessages.saveWorkerFailed)
      }

      const nextAssignments = assignments.map((item) =>
          item.id === assignment.id
            ? {
                ...item,
                labor_hours: Math.round(laborHours * 100) / 100,
                hourly_rate: Math.round(hourlyRate * 100) / 100,
                worker_type_snapshot: assignment.worker_type,
                assignment_billing_type: billingType,
                external_amount:
                  assignment.worker_type === 'contractor' && billingType !== 'hourly'
                    ? Math.round(externalAmount * 100) / 100
                    : null,
                note: draft.note.trim() || null,
              }
            : item
      )
      setAssignments(nextAssignments)
      syncJobStateForAssignments(nextAssignments)
      setWorkerMessage(detailMessages.workerSaved)
      router.refresh()
    } catch (saveError) {
      setWorkerMessage(saveError instanceof Error ? saveError.message : detailMessages.saveWorkerFailed)
    } finally {
      setSavingAssignmentId(null)
    }
  }

  async function removeJobAssignment(assignment: NormalizedAssignment) {
    if (!job?.id) return

    const confirmed = window.confirm(detailMessages.removeWorkerConfirm)
    if (!confirmed) return

    setRemovingAssignmentId(assignment.id)
    setWorkerMessage(detailMessages.removingWorker)

    try {
      const response = await fetch(`/api/jobs/${job.id}/assignments`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId: assignment.id }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || detailMessages.removeWorkerFailed)
      }

      const nextAssignments = assignments.filter((item) => item.id !== assignment.id)
      setAssignments(nextAssignments)
      syncJobStateForAssignments(nextAssignments)
      setAssignmentDrafts((current) => {
        const next = { ...current }
        delete next[assignment.id]
        return next
      })
      setWorkerMessage(detailMessages.workerRemoved)
      router.refresh()
    } catch (saveError) {
      setWorkerMessage(saveError instanceof Error ? saveError.message : detailMessages.removeWorkerFailed)
    } finally {
      setRemovingAssignmentId(null)
    }
  }

  async function markJobAsDone() {
    if (!job || resolvedWorkState === 'done') return

    setMarkingJobDone(true)
    setStatusMessage(detailMessages.markingDone)
    setError(null)

    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: job.title,
          description: job.description,
          status: 'done',
          address: job.address ?? null,
          price: job.price,
          is_internal: job.is_internal === true,
          start_at: jobStartAt,
          end_at: jobEndAt,
          is_paid: job.is_paid === true,
          customer_id: job.customer_id,
          contact_id: job.contact_id ?? null,
          parent_job_id: job.parent_job_id ?? null,
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? detailMessages.markDoneError)
      }

      setJob((current) => (current ? { ...current, status: 'done' } : current))
      setJobState((current) =>
        current
          ? {
              ...current,
              work_state: 'done',
              billing_state_resolved:
                current.billing_state_resolved && current.billing_state_resolved !== 'unknown'
                  ? current.billing_state_resolved
                  : 'waiting_for_invoice',
            }
          : current
      )
      setStatusMessage(detailMessages.markDoneSuccess)
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : detailMessages.markDoneError
      setStatusMessage(message)
      setError(message)
    } finally {
      setMarkingJobDone(false)
    }
  }

  if (!job && !notFound) {
    return (
      <DashboardShell activeItem="jobs">
        <p>{dictionary.jobs.loading}</p>
      </DashboardShell>
    )
  }

  if (notFound || !job) {
    return (
      <DashboardShell activeItem="jobs">
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            backgroundColor: '#fff',
            padding: '24px',
          }}
        >
          <h1 style={{ marginTop: 0 }}>{dictionary.jobs.detail.jobNotFound}</h1>
          <Link href="/jobs">{dictionary.jobs.detail.backToJobs}</Link>
        </div>
      </DashboardShell>
    )
  }

  const photos: PhotoRow[] = []

  return (
    <DashboardShell activeItem="jobs">
      <main style={pageShellStyle}>
      <section
        data-tour="job-detail-header"
        style={{
          ...heroCardStyle,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: '24px',
          alignItems: 'center',
          marginBottom: '18px',
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.92), rgba(239,246,255,0.86) 48%, rgba(207,250,254,0.72))',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Link
            href="/jobs"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '14px',
              color: '#475569',
              textDecoration: 'none',
              fontWeight: 900,
            }}
          >
            ← {detailMessages.backToJobs}
          </Link>

          <div style={eyebrowStyle}>{detailMessages.detailEyebrow}</div>
          <h1 style={{ ...heroTitleStyle, marginBottom: '12px' }}>
            {job.title ?? dictionary.jobs.untitledJob}
          </h1>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '10px',
              color: '#475569',
              fontSize: '16px',
              fontWeight: 750,
              marginBottom: '14px',
            }}
          >
            <span>{customer?.name ?? dictionary.jobs.customerMissing}</span>
            <span style={{ color: '#94a3b8' }}>•</span>
            <span>{jobTermLabel}</span>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusPanel
              label={detailMessages.mainStatus}
              value={mainJobStatusLabel}
              tone={workStatusPanel.tone}
              icon={workStatusPanel.icon}
            />
            {job.is_internal ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  alignSelf: 'stretch',
                  padding: '0 14px',
                  borderRadius: '18px',
                  backgroundColor: '#fff7ed',
                  color: '#9a3412',
                  border: '1px solid #fdba74',
                  fontSize: '13px',
                  fontWeight: 900,
                }}
              >
                {detailMessages.internalJobBadge}
              </span>
            ) : null}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          {resolvedWorkState !== 'done' ? (
            <button
              type="button"
              data-tour="job-detail-status"
              onClick={markJobAsDone}
              disabled={markingJobDone}
              style={{
                ...secondaryButtonStyle,
                opacity: markingJobDone ? 0.7 : 1,
              }}
            >
              {markingJobDone ? detailMessages.markingDone : detailMessages.markDone}
            </button>
          ) : null}
          <Link
            href={`/jobs/${job.id}/edit`}
            data-tour="job-detail-edit"
            style={{
              ...primaryButtonStyle,
              textDecoration: 'none',
            }}
          >
            {detailMessages.editJob}
          </Link>
          {!job.parent_job_id ? (
            <Link
              href={`/jobs/new?parent=${job.id}`}
              style={{
                ...secondaryButtonStyle,
                textDecoration: 'none',
              }}
            >
              Přidat dceru
            </Link>
          ) : null}
        </div>
      </section>

      {error && (
        <div
          style={errorStateStyle}
        >
          <strong>{dictionary.jobs.detail.errorPrefix}:</strong> {error}
        </div>
      )}

      {statusMessage && !error ? (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px 14px',
            borderRadius: '14px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            fontWeight: 800,
          }}
        >
          {statusMessage}
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gap: '14px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          marginBottom: '18px',
        }}
      >
        <FinanceSummaryCard label={detailMessages.accountingRevenue} value={formatCurrency(accountingRevenue)} tone="blue" />
        <FinanceSummaryCard label={detailMessages.jobPrice} value={formatCurrency(job.price)} tone="gray" />
        <FinanceSummaryCard label={detailMessages.internalLabor} value={formatCurrency(laborCost)} tone="orange" />
        <FinanceSummaryCard label={detailMessages.externalLabor} value={formatCurrency(externalLaborCost)} tone="gray" />
        <FinanceSummaryCard label={detailMessages.directCosts} value={formatCurrency(otherCosts)} tone="gray" />
        <FinanceSummaryCard
          label={dictionary.jobs.profit}
          value={formatCurrency(assignmentProfit)}
          tone={assignmentProfit >= 0 ? 'green' : 'red'}
        />
      </div>

      <div
        className="job-detail-grid"
        style={{
          display: 'grid',
          gap: '14px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          marginBottom: '18px',
        }}
      >
        <section data-tour="job-detail-status" style={sectionCardStyle}>
          <h2 style={{ ...cardTitleStyle, marginTop: 0, marginBottom: '14px', fontSize: '20px' }}>
            {detailMessages.jobStatus}
          </h2>
          <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <StatusPanel
              label="Práce"
              value={workStatusPanel.label}
              tone={workStatusPanel.tone}
              icon={workStatusPanel.icon}
            />
          </div>
        </section>

        <section data-tour="job-detail-billing" style={sectionCardStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
              alignItems: 'center',
              marginBottom: '10px',
            }}
          >
            <h2 style={{ ...cardTitleStyle, margin: 0, fontSize: '20px' }}>{detailMessages.billingInfo}</h2>
            <Link href={invoiceCreateHref} style={{ ...secondaryButtonStyle, textDecoration: 'none' }}>
              {detailMessages.createInvoice}
            </Link>
          </div>
          {!job.invoiced_at ? (
            <p style={{ margin: '0 0 8px', color: '#64748b', fontWeight: 700 }}>
              {detailMessages.noInvoiceYet}
            </p>
          ) : null}
          <DetailInfoRow label={detailMessages.status} value={billingStatusPanel.label} />
          <DetailInfoRow label={detailMessages.invoicedAt} value={formatDateTime(job.invoiced_at ?? null)} />
          <DetailInfoRow label={detailMessages.dueDate} value={formatDate(job.due_date ?? null)} />
          <DetailInfoRow label={detailMessages.paidAt} value={formatDateTime(job.paid_at ?? null)} />
        </section>
      </div>

      {groupParentJob ? (
        <div
          style={{
            border: '1px solid rgba(37, 99, 235, 0.22)',
            borderRadius: '18px',
            backgroundColor: '#eff6ff',
            padding: '16px 18px',
          }}
        >
          <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: '6px' }}>
            {dictionary.jobs.grouped}
          </div>
          <div style={{ color: '#1f2937', fontSize: '14px' }}>
            {dictionary.jobs.summaryJob}:{' '}
            <Link href={`/jobs/${groupParentJob.id}`} style={{ color: '#1d4ed8', fontWeight: 700, textDecoration: 'none' }}>
              {groupParentJob.title ?? dictionary.jobs.untitledJob}
            </Link>
          </div>
        </div>
      ) : null}

      {detailsLoading ? (
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            backgroundColor: '#fff',
            padding: '20px',
            marginTop: '20px',
            color: '#6b7280',
          }}
        >
          {detailMessages.loadingSections}
        </div>
      ) : null}

      {!detailsLoading && groupedJobsForDisplay.length > 1 ? (
        <div
          style={sectionCardStyle}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBottom: '14px',
            }}
          >
            <h2 style={{ ...cardTitleStyle, margin: 0, fontSize: '20px' }}>{detailMessages.groupCostSummary}</h2>
          </div>

          <div
            style={{
              display: 'grid',
              gap: '12px',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{detailMessages.groupHours}</div>
              <div style={{ fontWeight: 700, fontSize: '24px', color: '#111827' }}>
                {formatHours(groupedEconomicsSummary.totalHours)} h
              </div>
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{detailMessages.groupLabor}</div>
              <div style={{ fontWeight: 700, fontSize: '24px', color: '#111827' }}>
                {formatCurrency(groupedEconomicsSummary.laborCost)}
              </div>
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{detailMessages.groupOtherCosts}</div>
              <div style={{ fontWeight: 700, fontSize: '24px', color: '#111827' }}>
                {formatCurrency(groupedEconomicsSummary.otherCosts)}
              </div>
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{detailMessages.groupTotalCosts}</div>
              <div style={{ fontWeight: 700, fontSize: '24px', color: '#111827' }}>
                {formatCurrency(groupedEconomicsSummary.totalCosts)}
              </div>
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{detailMessages.groupRevenue}</div>
              <div style={{ fontWeight: 700, fontSize: '24px', color: '#111827' }}>
                {formatCurrency(groupedEconomicsSummary.revenue)}
              </div>
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{detailMessages.groupProfit}</div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '24px',
                  color: groupedEconomicsSummary.profit >= 0 ? '#166534' : '#991b1b',
                }}
              >
                {formatCurrency(groupedEconomicsSummary.profit)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!detailsLoading && !groupParentJob && groupMemberJobs.length > 1 && groupedDailyJobsForDisplay.length > 0 ? (
        <div
          style={sectionCardStyle}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBottom: '14px',
            }}
          >
            <h2 style={{ ...cardTitleStyle, margin: 0, fontSize: '20px' }}>{detailMessages.dailyJobs}</h2>
            <div style={{ color: '#6b7280', fontSize: '14px' }}>
              {detailMessages.dailyJobsDescription}
            </div>
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            {groupedDailyJobsForDisplay.map((memberJob) => (
              <div
                key={memberJob.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '14px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '12px',
                    flexWrap: 'wrap',
                    marginBottom: '10px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827' }}>
                      <Link
                        href={`/jobs/${memberJob.id}`}
                        style={{ color: '#111827', textDecoration: 'none' }}
                      >
                        {memberJob.title ?? dictionary.jobs.untitledJob}
                      </Link>
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '14px', marginTop: '4px' }}>
                      {formatDateTime(getJobStartAt(memberJob))} - {formatDateTime(getJobEndAt(memberJob))}
                    </div>
                  </div>

                  <div
                    style={{
                      ...getWorkStateStyles(memberJob.resolvedMemberWorkState),
                      padding: '6px 10px',
                      borderRadius: '999px',
                      fontSize: '12px',
                      fontWeight: 700,
                    }}
                  >
                    {getLocalizedWorkStateLabel(memberJob.resolvedMemberWorkState)}
                  </div>
                </div>

                <div style={{ color: '#6b7280', fontSize: '14px', marginBottom: '10px' }}>
                  {formatTemplate(detailMessages.shiftCount, { count: memberJob.shiftsCount })} | {formatHours(memberJob.totalShiftHours)} h
                </div>

                {memberJob.shiftsByDate.length === 0 ? (
                  <div style={{ color: '#6b7280', fontSize: '14px' }}>
                    {detailMessages.noConcreteShifts}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {memberJob.shiftsByDate.map((dayGroup) => (
                      <div key={`${memberJob.id}-${dayGroup.dateKey}`} style={{ fontSize: '14px' }}>
                        <div style={{ fontWeight: 700, color: '#111827' }}>{formatDate(dayGroup.dateKey)}</div>
                        <div style={{ color: '#4b5563', marginTop: '4px' }}>
                          {dayGroup.shifts
                            .map((shift) => `${getShiftWorkerName(shift)} (${formatHours(getShiftHours(shift))} h)`)
                            .join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="job-detail-grid">
      <div
        className="job-detail-schedule-card"
        style={sectionCardStyle}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: '14px',
          }}
        >
          <h2 style={{ ...cardTitleStyle, margin: 0, fontSize: '20px' }}>{dictionary.jobs.recurrence}</h2>
          <div style={{ color: '#6b7280', fontSize: '14px' }}>
            {detailMessages.jobScheduleDescription}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '10px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            marginBottom: '16px',
          }}
        >
          <div style={metaItemStyle}>
            <span style={metaLabelStyle}>{dictionary.jobs.startLabel}</span>
            <span style={metaValueStyle}>{formatDateTime(jobStartAt)}</span>
          </div>
          <div style={metaItemStyle}>
            <span style={metaLabelStyle}>{dictionary.jobs.endLabel}</span>
            <span style={metaValueStyle}>{formatDateTime(jobEndAt)}</span>
          </div>
          <div style={metaItemStyle}>
            <span style={metaLabelStyle}>{dictionary.jobs.nextShift}</span>
            <span style={metaValueStyle}>
              {nearestShift ? formatDateTime(nearestShift.started_at ?? nearestShift.shift_date ?? null) : '—'}
            </span>
          </div>
          <div style={metaItemStyle}>
            <span style={metaLabelStyle}>{dictionary.jobs.groupRange}</span>
            <span style={metaValueStyle}>
              {groupedDailyJobsForDisplay.length > 0
                ? formatTemplate(detailMessages.daysCount, { count: groupedDailyJobsForDisplay.length })
                : dictionary.jobs.standaloneJob}
            </span>
          </div>
        </div>

        {detailsLoading ? (
          <p style={{ margin: 0, color: '#6b7280' }}>{detailMessages.loadingShifts}</p>
        ) : groupedWorkShifts.length === 0 ? (
          <p style={{ margin: 0, color: '#6b7280' }}>
            {detailMessages.noShiftsForJob}
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '12px' }}>
            {groupedWorkShifts.map((group) => (
              <div
                key={group.dateKey}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '14px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '12px',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    marginBottom: '10px',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#111827' }}>{formatDate(group.dateKey)}</div>
                  <div style={{ color: '#6b7280', fontSize: '14px' }}>
                    {formatTemplate(detailMessages.shiftCount, { count: group.shifts.length })} | {formatHours(group.totalHours)} h
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '8px' }}>
                  {group.shifts.map((shift) => (
                    <div
                      key={shift.id}
                      style={{
                        borderTop: '1px solid #f3f4f6',
                        paddingTop: '8px',
                        display: 'grid',
                        gap: '4px',
                        fontSize: '14px',
                      }}
                    >
                      <div style={{ fontWeight: 600, color: '#111827' }}>{getShiftWorkerName(shift)}</div>
                      <div style={{ color: '#4b5563' }}>
                        <strong>{dictionary.jobs.timeState}:</strong> {formatDateTime(shift.started_at)} - {formatDateTime(shift.ended_at)}
                      </div>
                      <div style={{ color: '#4b5563' }}>
                        <strong>{detailMessages.jobHours}:</strong> {formatHours(getShiftHours(shift))} h
                      </div>
                      <div style={{ color: '#4b5563' }}>
                        <strong>{detailMessages.note}:</strong> {shift.note?.trim() ? shift.note : '-'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {false && (
      <div
        style={sectionCardStyle}
      >
        <h2 style={{ marginTop: 0, marginBottom: '14px', fontSize: '20px' }}>
          {dictionary.customers.contacts}
        </h2>

        <div style={{ display: 'grid', gap: '10px' }}>
          <div>
            <strong>{dictionary.jobs.customer}:</strong> {customer?.name ?? '—'}
          </div>
          <div>
            <strong>{dictionary.customers.emailLabel}:</strong> {customer?.email ?? '—'}
          </div>
          <div>
            <strong>{dictionary.customers.phoneLabel}:</strong> {customer?.phone ?? '—'}
          </div>
          <div>
            <strong>{detailMessages.mainContact}:</strong>{' '}
            {mainCustomerContact?.full_name ?? '—'}
          </div>
          <div>
            <strong>{detailMessages.mainContactEmail}:</strong>{' '}
            {mainCustomerContact?.email ?? '—'}
          </div>
          <div>
            <strong>{detailMessages.mainContactPhone}:</strong>{' '}
            {mainCustomerContact?.phone ?? '—'}
          </div>

          {jobCustomerContactsWithDetails.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              <strong>{dictionary.customers.contacts}:</strong>
              <div style={{ display: 'grid', gap: '10px', marginTop: '10px' }}>
                {jobCustomerContactsWithDetails.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: '12px',
                      padding: '12px',
                    }}
                  >
                    <div>
                      <strong>{dictionary.workers.detail.name}:</strong>{' '}
                      {item.contact?.full_name ?? '—'}
                    </div>
                    <div>
                      <strong>{dictionary.customers.role}:</strong> {item.role_label ?? item.contact?.role ?? '—'}
                    </div>
                    <div>
                      <strong>{dictionary.customers.emailLabel}:</strong> {item.contact?.email ?? '—'}
                    </div>
                    <div>
                      <strong>{dictionary.customers.phoneLabel}:</strong> {item.contact?.phone ?? '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      <div
        className="job-detail-workers-card"
        data-tour="job-detail-workers"
        style={sectionCardStyle}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: '14px',
          }}
        >
          <h2 style={{ ...cardTitleStyle, margin: 0, fontSize: '20px' }}>{detailMessages.workersAndWork}</h2>

          <button
            type="button"
            onClick={() => setWorkersExpanded((current) => !current)}
            style={{ ...secondaryButtonStyle, cursor: 'pointer' }}
          >
            {workersExpanded ? detailMessages.hideWorkerManagement : detailMessages.manageWorkers}
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '10px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            marginBottom: '16px',
          }}
        >
          <div style={metaItemStyle}>
            <span style={metaLabelStyle}>{detailMessages.assigned}</span>
            <span style={metaValueStyle}>{toNumber(jobState?.assigned_total)}</span>
          </div>
          <div style={metaItemStyle}>
            <span style={metaLabelStyle}>{detailMessages.started}</span>
            <span style={metaValueStyle}>{toNumber(jobState?.started_total)}</span>
          </div>
          <div style={metaItemStyle}>
            <span style={metaLabelStyle}>{detailMessages.completed}</span>
            <span style={metaValueStyle}>{toNumber(jobState?.completed_total)}</span>
          </div>
          <div style={metaItemStyle}>
            <span style={metaLabelStyle}>{detailMessages.activeWorkers}</span>
            <span style={metaValueStyle}>{toNumber(jobState?.active_workers)}</span>
          </div>
        </div>

        <div style={{ color: '#374151', fontSize: '14px', marginBottom: workersExpanded ? '16px' : 0 }}>
          <div style={{ fontWeight: 800, marginBottom: '6px' }}>
            {assignedWorkerNames.length === 0
              ? detailMessages.noWorkersAssignedShort
              : assignedWorkerNames.join(', ')}
          </div>
          <div style={{ color: '#64748b' }}>
            {formatTemplate(detailMessages.activeWorkersLine, {
              names: activeWorkerNames.length > 0 ? activeWorkerNames.join(', ') : detailMessages.nobody,
            })}
          </div>
        </div>

        {workersExpanded ? (
        <>
        {workerMessage ? (
          <div
            style={{
              marginBottom: '14px',
              padding: '12px 14px',
              borderRadius: '12px',
              border: '1px solid #dbeafe',
              background: '#eff6ff',
              color: '#1e40af',
              fontSize: '14px',
              fontWeight: 700,
            }}
          >
            {workerMessage}
          </div>
        ) : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <select
            value={newAssignment.profile_id}
            onChange={(event) => {
              const profileId = event.target.value
              const profile = workerOptions.find((item) => item.id === profileId)
              const workerType = getWorkerType(profile ?? null)
              const billingType = getContractorBillingType(profile?.contractor_billing_type)
              setNewAssignment((current) => ({
                ...current,
                profile_id: profileId,
                hourly_rate:
                  workerType === 'contractor' && profile?.contractor_default_rate != null
                    ? String(profile.contractor_default_rate)
                    : profile?.default_hourly_rate != null
                    ? String(profile.default_hourly_rate)
                    : profile?.hourly_rate != null
                    ? String(profile.hourly_rate)
                    : current.hourly_rate,
                external_amount:
                  workerType === 'contractor' && billingType !== 'hourly' && profile?.contractor_default_rate != null
                    ? String(profile.contractor_default_rate)
                    : current.external_amount,
              }))
            }}
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              border: '1px solid #d1d5db',
              background: '#ffffff',
              color: '#111827',
              minHeight: '44px',
            }}
          >
            <option value="">
              {loadingWorkerOptions ? detailMessages.loadingWorkers : detailMessages.chooseWorker}
            </option>
            {workerOptions.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {(worker.full_name || worker.email || detailMessages.unnamedWorker) +
                  ` - ${getWorkerTypeLabel(worker.worker_type)}`}
              </option>
            ))}
          </select>

          {selectedWorkerOption ? (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '12px',
                border: '1px solid #dbeafe',
                background: '#eff6ff',
                color: '#1e3a8a',
                fontWeight: 800,
                minHeight: '44px',
                boxSizing: 'border-box',
              }}
            >
              {getWorkerTypeLabel(selectedWorkerOption.worker_type)}
              {selectedWorkerType === 'contractor'
                ? ` · ${getContractorBillingTypeLabel(selectedWorkerOption.contractor_billing_type)}`
                : ''}
            </div>
          ) : null}

          {selectedWorkerType !== 'contractor' || selectedContractorBillingType === 'hourly' ? (
            <input
              value={newAssignment.labor_hours}
              onChange={(event) => setNewAssignment((current) => ({ ...current, labor_hours: event.target.value }))}
              placeholder={detailMessages.hours}
              inputMode="decimal"
              style={{
                padding: '12px 14px',
                borderRadius: '12px',
                border: '1px solid #d1d5db',
                minHeight: '44px',
              }}
            />
          ) : null}

          {selectedWorkerType !== 'contractor' || selectedContractorBillingType === 'hourly' ? (
            <input
              value={newAssignment.hourly_rate}
              onChange={(event) => setNewAssignment((current) => ({ ...current, hourly_rate: event.target.value }))}
              placeholder={detailMessages.hourlyRatePlaceholder}
              inputMode="decimal"
              style={{
                padding: '12px 14px',
                borderRadius: '12px',
                border: '1px solid #d1d5db',
                minHeight: '44px',
              }}
            />
          ) : (
            <input
              value={newAssignment.external_amount}
              onChange={(event) => setNewAssignment((current) => ({ ...current, external_amount: event.target.value }))}
              placeholder={selectedContractorBillingType === 'invoice' ? detailMessages.expectedAmountPlaceholder : detailMessages.fixedAmountPlaceholder}
              inputMode="decimal"
              style={{
                padding: '12px 14px',
                borderRadius: '12px',
                border: '1px solid #d1d5db',
                minHeight: '44px',
              }}
            />
          )}

          <input
            value={newAssignment.note}
            onChange={(event) => setNewAssignment((current) => ({ ...current, note: event.target.value }))}
            placeholder={detailMessages.note}
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              border: '1px solid #d1d5db',
              minHeight: '44px',
            }}
          />
        </div>

        <button
          type="button"
          onClick={addJobAssignment}
          disabled={addingWorker}
          style={{
            ...primaryButtonStyle,
            opacity: addingWorker ? 0.7 : 1,
            marginBottom: '18px',
          }}
        >
          {addingWorker ? detailMessages.addingWorker : detailMessages.addWorker}
        </button>

        <div
          style={{
            marginBottom: '16px',
            color: '#374151',
            fontSize: '14px',
            fontWeight: 700,
          }}
        >
          {formatTemplate(detailMessages.assignmentSummary, {
            hours: formatHours(assignmentTotalHours),
            cost: formatCurrency(assignmentLaborCost),
          })}
        </div>

        {detailsLoading ? (
          <p style={{ margin: 0 }}>{dictionary.jobs.loading}</p>
        ) : normalizedAssignments.length === 0 ? (
          <div
            style={{
              ...emptyStateStyle,
              alignItems: 'flex-start',
              textAlign: 'left',
              margin: 0,
            }}
          >
            <div style={{ fontSize: '28px' }}>+</div>
            <strong>{detailMessages.noWorkerAssignedTitle}</strong>
            <span>{detailMessages.noWorkerAssignedText}</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '12px' }}>
            {normalizedAssignments.map((assignment) => {
              const draft = assignmentDrafts[assignment.id] ?? {
                labor_hours: assignment.labor_hours != null ? String(assignment.labor_hours) : '',
                hourly_rate: assignment.hourly_rate != null ? String(assignment.hourly_rate) : '',
                external_amount: assignment.external_amount != null ? String(assignment.external_amount) : '',
                note: assignment.note ?? '',
              }
              const previewHours = parseMoneyInput(draft.labor_hours)
              const previewRate = parseMoneyInput(draft.hourly_rate)
              const previewExternal = parseMoneyInput(draft.external_amount)
              const billingType = assignment.worker_type === 'contractor'
                ? getContractorBillingType(assignment.assignment_billing_type)
                : null
              const previewCost =
                assignment.worker_type === 'contractor' && billingType !== 'hourly'
                  ? Number.isFinite(previewExternal)
                    ? previewExternal
                    : assignment.computed_external_labor_cost
                : Number.isFinite(previewHours) && Number.isFinite(previewRate)
                  ? previewHours * previewRate
                  : assignment.computed_labor_cost

              return (
              <div
                key={assignment.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '14px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '12px',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    marginBottom: '10px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827' }}>
                      {assignment.profiles?.full_name || detailMessages.unknownWorker}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '14px' }}>
                      {assignment.worker_type === 'contractor'
                        ? `${detailMessages.contractorWorker} · ${getContractorBillingTypeLabel(assignment.assignment_billing_type)} · ${formatCurrency(assignment.computed_external_labor_cost)}`
                        : `${formatHours(assignment.computed_labor_hours)} h × ${formatCurrency(assignment.computed_hourly_rate)} = ${formatCurrency(assignment.computed_internal_labor_cost)}`}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeJobAssignment(assignment)}
                    disabled={removingAssignmentId === assignment.id}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '10px',
                      border: '1px solid #fecaca',
                      background: '#fff1f2',
                      color: '#be123c',
                      fontWeight: 800,
                      cursor: removingAssignmentId === assignment.id ? 'default' : 'pointer',
                      opacity: removingAssignmentId === assignment.id ? 0.7 : 1,
                    }}
                  >
                    {removingAssignmentId === assignment.id ? detailMessages.removingWorker : detailMessages.removeWorker}
                  </button>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: '10px',
                  }}
                >
                  {assignment.worker_type !== 'contractor' || billingType === 'hourly' ? (
                    <>
                      <input
                        value={draft.labor_hours}
                        onChange={(event) => updateAssignmentDraft(assignment.id, { labor_hours: event.target.value })}
                        placeholder={detailMessages.hours}
                        inputMode="decimal"
                        style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #d1d5db' }}
                      />
                      <input
                        value={draft.hourly_rate}
                        onChange={(event) => updateAssignmentDraft(assignment.id, { hourly_rate: event.target.value })}
                        placeholder={detailMessages.hourlyRatePlaceholder}
                        inputMode="decimal"
                        style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #d1d5db' }}
                      />
                    </>
                  ) : (
                    <input
                      value={draft.external_amount}
                      onChange={(event) => updateAssignmentDraft(assignment.id, { external_amount: event.target.value })}
                      placeholder={billingType === 'invoice' ? detailMessages.expectedAmountPlaceholder : detailMessages.fixedAmountPlaceholder}
                      inputMode="decimal"
                      style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #d1d5db' }}
                    />
                  )}
                  <input
                    value={draft.note}
                    onChange={(event) => updateAssignmentDraft(assignment.id, { note: event.target.value })}
                    placeholder={detailMessages.note}
                    style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #d1d5db' }}
                  />
                  <button
                    type="button"
                    onClick={() => saveJobAssignment(assignment)}
                    disabled={savingAssignmentId === assignment.id}
                    style={{
                      ...secondaryButtonStyle,
                      justifyContent: 'center',
                      opacity: savingAssignmentId === assignment.id ? 0.7 : 1,
                    }}
                  >
                    {savingAssignmentId === assignment.id ? detailMessages.savingShort : dictionary.common.save}
                  </button>
                </div>

                <div style={{ marginTop: '10px', color: '#374151', fontSize: '14px', fontWeight: 700 }}>
                  {formatTemplate(detailMessages.costAfterEdit, { cost: formatCurrency(previewCost) })}
                </div>
              </div>
            )})}
          </div>
        )}

        {!detailsLoading && workLogs.length > 0 && (
          <div style={{ marginTop: '18px' }}>
            <h3 style={{ marginTop: 0 }}>{dictionary.jobs.detail.workLogs}</h3>
            <div style={{ display: 'grid', gap: '8px' }}>
              {workLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    fontSize: '14px',
                  }}
                >
                  <strong>{dictionary.jobs.detail.date}:</strong> {formatDate(log.work_date)} |{' '}
                  <strong>{dictionary.jobs.detail.hours}:</strong> {formatHours(toNumber(log.hours))}
                </div>
              ))}
            </div>
          </div>
        )}
        </>
        ) : null}
      </div>

      </div>

      <div className="job-detail-grid">
        <div style={{ gridColumn: '1 / -1' }}>
          <div data-tour="job-detail-economics">
          <JobEconomicsSection
            jobId={jobId}
            companyId={job.company_id ?? null}
            price={job.price != null ? Number(job.price) : null}
            assignments={normalizedAssignments}
            costItems={normalizedCostItems}
            accountingRevenue={accountingRevenue}
            laborCost={laborCost}
            externalLaborCost={externalLaborCost}
            otherCosts={otherCosts}
            profit={assignmentProfit}
            onPriceSaved={handlePriceSaved}
            onCostItemAdded={handleCostItemAdded}
            onCostItemDeleted={handleCostItemDeleted}
          />
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <JobPhotosSection jobId={job.id} compact canManage={canManageJobPhotos} />
        </div>
      </div>

      {canManageCommunication ? (
        <div data-tour="job-detail-communication">
        <JobCommunicationSection
          jobId={job.id}
          customerId={job.customer_id ?? null}
          contactId={job.contact_id ?? null}
          defaultToEmail={mainCustomerContact?.email ?? customer?.email ?? null}
          defaultToName={mainCustomerContact?.full_name ?? customer?.name ?? null}
          defaultSubject={
            job.title?.trim()
              ? formatTemplate(detailMessages.communicationJobSubject, { title: job.title })
              : detailMessages.communicationFallbackSubject
          }
          feedItems={initialCommunicationFeed}
        />
        </div>
      ) : null}

      {false && (
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: '16px',
          backgroundColor: '#fff',
          padding: '20px',
          marginTop: '20px',
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: '14px', fontSize: '20px' }}>
          {detailMessages.photos.title}
        </h2>

        {photos.length === 0 ? (
          <p style={{ margin: 0 }}>{detailMessages.photosEmptyInline}</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gap: '12px',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            {photos.map((photo) => {
              const url = getPhotoUrl(photo)

              return (
                <div
                  key={photo.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    backgroundColor: '#f9fafb',
                  }}
                >
                  {url ? (
                    <Image
                      src={url}
                      alt={detailMessages.photoAlt}
                      width={360}
                      height={180}
                      unoptimized
                      style={{
                        width: '100%',
                        height: '180px',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        height: '180px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#6b7280',
                      }}
                    >
                      {detailMessages.photos.noPreview}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

      <JobDangerZone
        jobId={job.id}
        hasCustomer={Boolean(job.customer_id)}
      />
      </main>
    </DashboardShell>
  )
}
