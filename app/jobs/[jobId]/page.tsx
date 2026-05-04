import JobDetailPageClient from './JobDetailPageClient'
import { listEntityThreadMessages } from '@/lib/email/listEntityThreadMessages'
import type { MessageFeedItem } from '@/lib/email/types'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

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
  start_at: string | null
  end_at: string | null
  billing_status?: string | null
  invoiced_at?: string | null
  due_date?: string | null
  paid_at?: string | null
}

type JobStateRow = {
  id: string
  time_state: 'future' | 'active' | 'finished' | 'unknown' | null
  work_state: 'not_started' | 'in_progress' | 'partially_done' | 'done' | 'unknown' | null
  billing_state_resolved:
    | 'waiting_for_invoice'
    | 'due'
    | 'overdue'
    | 'paid'
    | 'unknown'
    | null
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
  } | null
}

type AssignmentBaseRow = Omit<AssignmentRow, 'profiles'>

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

type WorkShiftBaseRow = Omit<WorkShiftRow, 'profiles'>

type ProfileRelationRow = {
  id: string
  full_name: string | null
  email: string | null
  default_hourly_rate: number | null
  worker_type?: string | null
  contractor_billing_type?: string | null
  contractor_default_rate?: number | null
}

type SupabaseErrorLike = {
  message?: string
  code?: string
}

type WorkLogRow = {
  id: string
  job_id: string
  profile_id: string | null
  hours: number | null
  work_date: string | null
}

function isMissingArchivedAtColumn(error: SupabaseErrorLike | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return error?.code === '42703' || message.includes('archived_at')
}

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

type GroupMemberJobRow = {
  id: string
  parent_job_id: string | null
  title: string | null
  description: string | null
  status: string | null
  address: string | null
  start_at: string | null
  end_at: string | null
  created_at: string | null
  price: number | null
  customer_id: string | null
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

type JobDetailPageProps = {
  params: Promise<{
    jobId: string
  }>
}

const emptyInitialDetail = {
  initialJobCustomerContacts: [],
  initialAssignments: [],
  initialWorkShifts: [],
  initialGroupParentJob: null,
  initialGroupMemberJobs: [],
  initialGroupMemberJobStates: [],
  initialGroupWorkShifts: [],
  initialGroupEconomicsSummaries: [],
  initialWorkLogs: [],
  initialCostItems: [],
}

const economicsSelect =
  'job_id, revenue_total, labor_hours_total, labor_cost_total, other_cost_total, total_cost_total, profit_total, margin_percent'

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobId } = await params

  if (!jobId) {
    return (
      <JobDetailPageClient
        jobId=""
        initialJob={null}
        initialJobState={null}
        initialCustomer={null}
        initialMainCustomerContact={null}
        {...emptyInitialDetail}
        initialJobEconomicsSummary={null}
        initialCommunicationFeed={[]}
        initialError="Chybi ID zakazky."
      />
    )
  }

  const supabase = await createSupabaseServerClient()

  const jobResponse = await supabase
    .from('jobs')
    .select(
      `
        id,
        company_id,
        parent_job_id,
          title,
          description,
          status,
          price,
          is_internal,
          is_paid,
        customer_id,
        contact_id,
        address,
        scheduled_date,
        start_at,
        end_at,
        billing_status,
        invoiced_at,
        due_date,
        paid_at,
        customer:customers (
          id,
          name,
          email,
          phone
        ),
        main_contact:customer_contacts (
          id,
          customer_id,
          full_name,
          role,
          phone,
          email,
          note
        )
      `
    )
    .eq('id', jobId)
    .single()

  if (jobResponse.error) {
    if (jobResponse.error.code === 'PGRST116') {
      return (
        <JobDetailPageClient
          jobId={jobId}
          initialJob={null}
          initialJobState={null}
          initialCustomer={null}
          initialMainCustomerContact={null}
          {...emptyInitialDetail}
          initialJobEconomicsSummary={null}
          initialCommunicationFeed={[]}
          initialNotFound
        />
      )
    }

    return (
      <JobDetailPageClient
        jobId={jobId}
        initialJob={null}
        initialJobState={null}
        initialCustomer={null}
        initialMainCustomerContact={null}
        {...emptyInitialDetail}
        initialJobEconomicsSummary={null}
        initialCommunicationFeed={[]}
        initialError={`Nepodarilo se nacist zakazku: ${jobResponse.error.message}`}
      />
    )
  }

  const jobRow = jobResponse.data as unknown as Job & {
    customer?: Customer | Customer[] | null
    main_contact?: CustomerContact | CustomerContact[] | null
  }
  const { customer: joinedCustomer = null, main_contact: joinedMainContact = null, ...job } = jobRow
  const customer = Array.isArray(joinedCustomer) ? joinedCustomer[0] ?? null : joinedCustomer
  const mainContact = Array.isArray(joinedMainContact)
    ? joinedMainContact[0] ?? null
    : joinedMainContact
  let communicationFeed: MessageFeedItem[] = []
  let communicationError: string | null = null

  if (job.company_id) {
    try {
      const communication = await listEntityThreadMessages(
        supabase,
        job.company_id,
        'job',
        jobId
      )
      communicationFeed = communication.feedItems
    } catch (error) {
      communicationError =
        error instanceof Error ? error.message : 'Nepodarilo se nacist komunikaci zakazky.'
    }
  }

  const groupRootId = job.parent_job_id ?? job.id
  const [
    assignmentsResponse,
    initialWorkLogsResponse,
    costItemsResponse,
    jobCustomerContactsResponse,
    groupJobsResponse,
  ] = await Promise.all([
    supabase
      .from('job_assignments')
      .select(
        `
          id,
          job_id,
          profile_id,
          labor_hours,
          hourly_rate,
          worker_type_snapshot,
          assignment_billing_type,
          external_amount,
          note,
          work_started_at,
          work_completed_at
        `
      )
      .eq('job_id', jobId),
    supabase
      .from('work_logs')
      .select('id, job_id, profile_id, hours, work_date')
      .eq('job_id', jobId)
      .is('archived_at', null),
    supabase
      .from('job_cost_items')
      .select(
        `
          id,
          job_id,
          cost_type,
          title,
          quantity,
          unit,
          unit_price,
          total_price,
          note,
          created_at
        `
      )
      .eq('job_id', jobId)
      .order('created_at', { ascending: false }),
    supabase
      .from('job_customer_contacts')
      .select(
        `
          id,
          job_id,
          customer_contact_id,
          role_label,
          created_at,
          contact:customer_contacts (
            id,
            customer_id,
            full_name,
            role,
            phone,
            email,
            note
          )
        `
      )
      .eq('job_id', jobId)
      .order('created_at', { ascending: true }),
    supabase
      .from('jobs')
      .select(
        `
          id,
          parent_job_id,
          title,
          description,
          status,
          address,
          start_at,
          end_at,
          created_at,
          price,
          customer_id
        `
      )
      .or(`id.eq.${groupRootId},parent_job_id.eq.${groupRootId}`)
      .order('start_at', { ascending: true }),
  ])

  const workLogsResponse =
    initialWorkLogsResponse.error && isMissingArchivedAtColumn(initialWorkLogsResponse.error)
      ? await supabase
          .from('work_logs')
          .select('id, job_id, profile_id, hours, work_date')
          .eq('job_id', jobId)
      : initialWorkLogsResponse

  const groupMemberJobs = !groupJobsResponse.error
    ? ((groupJobsResponse.data ?? []) as GroupMemberJobRow[])
    : []
  const groupParentJob =
    job.parent_job_id && groupMemberJobs.some((item) => item.id === groupRootId)
      ? groupMemberJobs.find((item) => item.id === groupRootId) ?? null
      : null
  const groupJobIds = groupMemberJobs.length > 0 ? groupMemberJobs.map((item) => item.id) : [job.id]

  const [groupStatesResponse, groupShiftsResponse, groupEconomicsResponse] =
    groupJobIds.length > 0
      ? await Promise.all([
          supabase
            .from('jobs_with_state')
            .select(
              `
                id,
                time_state,
                work_state,
                billing_state_resolved,
                assigned_total,
                started_total,
                completed_total,
                active_workers
              `
            )
            .in('id', groupJobIds),
          supabase
            .from('work_shifts')
            .select(
              `
                id,
                job_id,
                profile_id,
                shift_date,
                started_at,
                ended_at,
                hours_override,
                job_hours_override,
                note
              `
            )
            .in('job_id', groupJobIds)
            .order('shift_date', { ascending: true })
            .order('started_at', { ascending: true }),
          supabase
            .from('job_economics_summary')
            .select(economicsSelect)
            .in('job_id', groupJobIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ]

  const baseAssignments = (assignmentsResponse.data as AssignmentBaseRow[] | null) ?? []
  const baseGroupWorkShifts = (groupShiftsResponse.data as WorkShiftBaseRow[] | null) ?? []
  const relatedProfileIds = Array.from(
    new Set(
      [...baseAssignments, ...baseGroupWorkShifts]
        .map((item) => item.profile_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  )
  const profilesResponse =
    relatedProfileIds.length > 0 && !assignmentsResponse.error && !groupShiftsResponse.error
      ? await supabase
          .from('profiles')
          .select('id, full_name, email, default_hourly_rate, worker_type, contractor_billing_type, contractor_default_rate')
          .in('id', relatedProfileIds)
      : { data: [], error: null }
  const profilesById = new Map(
    ((profilesResponse.data ?? []) as ProfileRelationRow[]).map((profile) => [profile.id, profile])
  )
  const assignmentsWithProfiles: AssignmentRow[] = baseAssignments.map((assignment) => ({
    ...assignment,
    profiles: assignment.profile_id ? profilesById.get(assignment.profile_id) ?? null : null,
  }))
  const groupWorkShifts: WorkShiftRow[] = baseGroupWorkShifts.map((shift) => ({
    ...shift,
    profiles: shift.profile_id ? profilesById.get(shift.profile_id) ?? null : null,
  }))
  const groupMemberJobStates = (groupStatesResponse.data as JobStateRow[] | null) ?? []
  const groupEconomicsSummaries =
    (groupEconomicsResponse.data as JobEconomicsSummaryRow[] | null) ?? []
  const jobState = groupMemberJobStates.find((item) => item.id === jobId) ?? null
  const jobEconomicsSummary =
    groupEconomicsSummaries.find((item) => item.job_id === jobId) ?? null
  const secondaryError =
    assignmentsResponse.error?.message ??
    workLogsResponse.error?.message ??
    costItemsResponse.error?.message ??
    jobCustomerContactsResponse.error?.message ??
    groupJobsResponse.error?.message ??
    groupStatesResponse.error?.message ??
    groupShiftsResponse.error?.message ??
    groupEconomicsResponse.error?.message ??
    profilesResponse.error?.message ??
    null

  return (
    <JobDetailPageClient
      jobId={jobId}
      initialJob={job}
      initialJobState={jobState}
      initialCustomer={customer}
      initialMainCustomerContact={mainContact}
      initialJobCustomerContacts={
        (jobCustomerContactsResponse.data as JobCustomerContact[] | null) ?? []
      }
      initialAssignments={assignmentsWithProfiles}
      initialWorkShifts={groupWorkShifts.filter((shift) => shift.job_id === jobId)}
      initialGroupParentJob={groupParentJob}
      initialGroupMemberJobs={groupMemberJobs}
      initialGroupMemberJobStates={groupMemberJobStates}
      initialGroupWorkShifts={groupWorkShifts}
      initialGroupEconomicsSummaries={groupEconomicsSummaries}
      initialWorkLogs={(workLogsResponse.data as WorkLogRow[] | null) ?? []}
      initialCostItems={(costItemsResponse.data as CostItemRow[] | null) ?? []}
      initialJobEconomicsSummary={jobEconomicsSummary}
      initialCommunicationFeed={communicationFeed}
      initialError={
        communicationError ??
        (secondaryError ? `Nepodařilo se načíst detail zakázky: ${secondaryError}` : null)
      }
    />
  )
}
