import { NextRequest, NextResponse } from 'next/server'

import { createExportWorkbook, styleExportWorksheet, workbookXlsxResponse } from '@/lib/excel-export'
import { getWorkerType } from '@/lib/payroll-settings'
import { requireHubAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  formatDateForExport,
  formatDateTimeForExport,
  getEffectiveShiftHours,
  getWorkerDisplayName,
  getWorkMonthRange,
  numberOrZero,
  resolveExportMonth,
} from '@/lib/workers-export-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{
    workerId: string
  }>
}

type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
  default_hourly_rate: number | string | null
  worker_type?: string | null
  contractor_default_rate?: number | string | null
}

type WorkShiftRow = {
  id: string
  profile_id: string | null
  company_id: string | null
  job_id: string | null
  job_hours_override: number | string | null
  shift_date: string | null
  started_at: string | null
  ended_at: string | null
  hours_override: number | string | null
  note: string | null
}

type JobRow = {
  id: string
  title: string | null
  address: string | null
  status: string | null
}

type JobAssignmentRow = {
  id: string
  job_id: string | null
  hourly_rate: number | string | null
}

type JobAssignmentSummaryRow = {
  assignment_id: string | null
  job_id: string | null
  effective_hourly_rate: number | string | null
}

function getDefaultHourlyRate(profile: ProfileRow) {
  const workerType = getWorkerType(profile)
  return numberOrZero(
    workerType === 'contractor'
      ? profile.contractor_default_rate ?? profile.default_hourly_rate
      : profile.default_hourly_rate,
  )
}

function getAssignmentRate(
  assignment: JobAssignmentRow | null | undefined,
  summary: JobAssignmentSummaryRow | null | undefined,
  defaultRate: number,
) {
  const summaryRate = numberOrZero(summary?.effective_hourly_rate)
  if (summaryRate > 0) return summaryRate

  const assignmentRate = numberOrZero(assignment?.hourly_rate)
  if (assignmentRate > 0) return assignmentRate

  return defaultRate
}

export async function GET(request: NextRequest, context: RouteContext) {
  const guard = await requireHubAccess()
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const { workerId } = await context.params
  const selectedMonth = resolveExportMonth(request.nextUrl.searchParams.get('month'))
  const { workStartDate, workEndExclusiveDate, workPeriodLabel } = getWorkMonthRange(selectedMonth)
  const supabase = await createSupabaseServerClient()

  const memberResponse = await supabase
    .from('company_members')
    .select('id')
    .eq('company_id', guard.value.companyId)
    .eq('profile_id', workerId)
    .eq('is_active', true)
    .maybeSingle()

  if (memberResponse.error) {
    return NextResponse.json({ error: memberResponse.error.message }, { status: 400 })
  }

  if (!memberResponse.data) {
    return NextResponse.json({ error: 'Pracovník nebyl nalezen.' }, { status: 404 })
  }

  const [profileResponse, shiftsResponse] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, default_hourly_rate, worker_type, contractor_default_rate')
      .eq('id', workerId)
      .maybeSingle(),
    supabase
      .from('work_shifts')
      .select('id, profile_id, company_id, job_id, job_hours_override, shift_date, started_at, ended_at, hours_override, note')
      .eq('company_id', guard.value.companyId)
      .eq('profile_id', workerId)
      .gte('shift_date', workStartDate)
      .lt('shift_date', workEndExclusiveDate)
      .order('shift_date', { ascending: true })
      .order('started_at', { ascending: true }),
  ])

  if (profileResponse.error) {
    return NextResponse.json({ error: profileResponse.error.message }, { status: 400 })
  }

  if (!profileResponse.data) {
    return NextResponse.json({ error: 'Pracovník nebyl nalezen.' }, { status: 404 })
  }

  if (shiftsResponse.error) {
    return NextResponse.json({ error: shiftsResponse.error.message }, { status: 400 })
  }

  const profile = profileResponse.data as ProfileRow
  const shifts = (shiftsResponse.data ?? []) as WorkShiftRow[]
  const jobIds = Array.from(new Set(shifts.map((shift) => shift.job_id).filter((value): value is string => Boolean(value))))

  const [jobsResponse, assignmentsResponse, summariesResponse] = await Promise.all([
    jobIds.length > 0
      ? supabase.from('jobs').select('id, title, address, status').eq('company_id', guard.value.companyId).in('id', jobIds)
      : Promise.resolve({ data: [], error: null }),
    jobIds.length > 0
      ? supabase
          .from('job_assignments')
          .select('id, job_id, hourly_rate')
          .eq('profile_id', workerId)
          .in('job_id', jobIds)
          .is('archived_at', null)
      : Promise.resolve({ data: [], error: null }),
    jobIds.length > 0
      ? supabase
          .from('worker_job_assignment_summary')
          .select('assignment_id, job_id, effective_hourly_rate')
          .eq('profile_id', workerId)
          .in('job_id', jobIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (jobsResponse.error) {
    return NextResponse.json({ error: jobsResponse.error.message }, { status: 400 })
  }

  if (assignmentsResponse.error) {
    return NextResponse.json({ error: assignmentsResponse.error.message }, { status: 400 })
  }

  if (summariesResponse.error) {
    return NextResponse.json({ error: summariesResponse.error.message }, { status: 400 })
  }

  const jobsById = new Map(((jobsResponse.data ?? []) as JobRow[]).map((job) => [job.id, job]))
  const assignmentsByJobId = new Map(
    ((assignmentsResponse.data ?? []) as JobAssignmentRow[])
      .filter((assignment) => assignment.job_id)
      .map((assignment) => [assignment.job_id as string, assignment]),
  )
  const summariesByAssignmentId = new Map(
    ((summariesResponse.data ?? []) as JobAssignmentSummaryRow[])
      .filter((summary) => summary.assignment_id)
      .map((summary) => [summary.assignment_id as string, summary]),
  )
  const defaultHourlyRate = getDefaultHourlyRate(profile)
  const workerName = getWorkerDisplayName(profile)

  const workbook = createExportWorkbook(`Směny ${workerName}`)
  const worksheet = workbook.addWorksheet('Směny')

  worksheet.columns = [
    { header: 'Období', key: 'period', width: 24 },
    { header: 'Datum směny', key: 'shiftDate', width: 14 },
    { header: 'Začátek', key: 'startedAt', width: 20 },
    { header: 'Konec', key: 'endedAt', width: 20 },
    { header: 'Pracovník', key: 'workerName', width: 28 },
    { header: 'E-mail', key: 'email', width: 30 },
    { header: 'Zakázka', key: 'jobTitle', width: 32 },
    { header: 'Adresa zakázky', key: 'jobAddress', width: 34 },
    { header: 'Hodiny směny', key: 'shiftHours', width: 14 },
    { header: 'Hodiny na zakázku', key: 'jobHours', width: 16 },
    { header: 'Sazba Kč/h', key: 'hourlyRate', width: 14 },
    { header: 'Odměna Kč', key: 'reward', width: 14 },
    { header: 'Poznámka', key: 'note', width: 36 },
  ]

  for (const shift of shifts) {
    const job = shift.job_id ? jobsById.get(shift.job_id) ?? null : null
    const assignment = shift.job_id ? assignmentsByJobId.get(shift.job_id) ?? null : null
    const summary = assignment?.id ? summariesByAssignmentId.get(assignment.id) ?? null : null
    const shiftHours = getEffectiveShiftHours(shift)
    const jobHours = shift.job_id ? numberOrZero(shift.job_hours_override) || shiftHours : 0
    const hourlyRate = getAssignmentRate(assignment, summary, defaultHourlyRate)

    worksheet.addRow({
      period: workPeriodLabel,
      shiftDate: formatDateForExport(shift.shift_date),
      startedAt: formatDateTimeForExport(shift.started_at),
      endedAt: formatDateTimeForExport(shift.ended_at),
      workerName,
      email: profile.email ?? '',
      jobTitle: job?.title ?? '',
      jobAddress: job?.address ?? '',
      shiftHours,
      jobHours,
      hourlyRate,
      reward: shiftHours * hourlyRate,
      note: shift.note ?? '',
    })
  }

  worksheet.getColumn('shiftHours').numFmt = '0.00'
  worksheet.getColumn('jobHours').numFmt = '0.00'
  worksheet.getColumn('hourlyRate').numFmt = '# ##0 Kč'
  worksheet.getColumn('reward').numFmt = '# ##0 Kč'
  styleExportWorksheet(worksheet)

  return workbookXlsxResponse(workbook, `smeny-${workerName}-${selectedMonth}`)
}
