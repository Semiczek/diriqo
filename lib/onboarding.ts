import 'server-only'

import type { SupabaseServerClient } from '@/lib/dal/auth'

export type CompanyOnboardingStepKey =
  | 'company_profile'
  | 'first_customer'
  | 'first_worker'
  | 'first_job'

export type CompanyOnboardingState = {
  companyId: string
  companyProfileCompleted: boolean
  firstCustomerCreated: boolean
  firstWorkerCreated: boolean
  firstJobCreated: boolean
  dismissedAt: string | null
  completedAt: string | null
  lastOpenedAt: string | null
}

export type CompanyOnboardingStep = {
  key: CompanyOnboardingStepKey
  done: boolean
  href: string
}

export type CompanyOnboardingChecklist = {
  state: CompanyOnboardingState
  completed: number
  total: number
  isComplete: boolean
  isDismissed: boolean
  profileName: string | null
  profileEmail: string | null
  defaultHourlyRate: number | null
  steps: CompanyOnboardingStep[]
}

type CompanyOnboardingRow = {
  company_id: string
  company_profile_completed: boolean | null
  first_customer_created: boolean | null
  first_worker_created: boolean | null
  first_job_created: boolean | null
  dismissed_at: string | null
  completed_at: string | null
  last_opened_at: string | null
}

function asSingleRelation<T>(value: T[] | T | null | undefined): T | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

function countFromNullableResponse(response: { count: number | null }) {
  return response.count ?? 0
}

function toPositiveNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function isProfileReadyAsWorker(profile: {
  default_hourly_rate?: unknown
  hourly_rate?: unknown
} | null) {
  return Boolean(
    toPositiveNumber(profile?.default_hourly_rate) ??
    toPositiveNumber(profile?.hourly_rate)
  )
}

async function syncCompanyOnboardingState(
  supabase: SupabaseServerClient,
  companyId: string,
  existing: CompanyOnboardingRow | null,
  computed: {
    companyProfileCompleted: boolean
    firstCustomerCreated: boolean
    firstWorkerCreated: boolean
    firstJobCreated: boolean
  }
) {
  const isComplete =
    computed.companyProfileCompleted &&
    computed.firstCustomerCreated &&
    computed.firstWorkerCreated &&
    computed.firstJobCreated
  const completedAt = isComplete ? existing?.completed_at ?? new Date().toISOString() : null
  const now = new Date().toISOString()

  const nextRow = {
    company_id: companyId,
    company_profile_completed: computed.companyProfileCompleted,
    first_customer_created: computed.firstCustomerCreated,
    first_worker_created: computed.firstWorkerCreated,
    first_job_created: computed.firstJobCreated,
    completed_at: completedAt,
    updated_at: now,
  }

  const { data } = await supabase
    .from('company_onboarding')
    .upsert(nextRow, { onConflict: 'company_id' })
    .select(
      'company_id, company_profile_completed, first_customer_created, first_worker_created, first_job_created, dismissed_at, completed_at, last_opened_at'
    )
    .maybeSingle()

  return ((data as CompanyOnboardingRow | null) ?? {
    company_id: companyId,
    company_profile_completed: computed.companyProfileCompleted,
    first_customer_created: computed.firstCustomerCreated,
    first_worker_created: computed.firstWorkerCreated,
    first_job_created: computed.firstJobCreated,
    dismissed_at: existing?.dismissed_at ?? null,
    completed_at: completedAt,
    last_opened_at: existing?.last_opened_at ?? null,
  }) satisfies CompanyOnboardingRow
}

export async function getCompanyOnboardingChecklist(
  supabase: SupabaseServerClient,
  companyId: string,
  profileId: string
): Promise<CompanyOnboardingChecklist> {
  const [
    onboardingResponse,
    companyResponse,
    customersResponse,
    jobsResponse,
    membersResponse,
    profileResponse,
  ] = await Promise.all([
    supabase
      .from('company_onboarding')
      .select(
        'company_id, company_profile_completed, first_customer_created, first_worker_created, first_job_created, dismissed_at, completed_at, last_opened_at'
      )
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase
      .from('companies')
      .select('name, country_code, default_language, default_currency, billing_country, locale, currency')
      .eq('id', companyId)
      .maybeSingle(),
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId),
    supabase
      .from('company_members')
      .select(
        `
          role,
          is_active,
          profiles (
            id,
            default_hourly_rate,
            hourly_rate
          )
        `
      )
      .eq('company_id', companyId)
      .eq('is_active', true),
    supabase
      .from('profiles')
      .select('id, full_name, email, default_hourly_rate, hourly_rate')
      .eq('id', profileId)
      .maybeSingle(),
  ])

  const company = (companyResponse.data ?? null) as {
    name?: string | null
    country_code?: string | null
    default_language?: string | null
    default_currency?: string | null
    billing_country?: string | null
    locale?: string | null
    currency?: string | null
  } | null
  const existing = (onboardingResponse.data as CompanyOnboardingRow | null) ?? null
  const currentProfile = (profileResponse.data ?? null) as {
    full_name?: string | null
    email?: string | null
    default_hourly_rate?: unknown
    hourly_rate?: unknown
  } | null
  const members = ((membersResponse.data ?? []) as Array<{
    role?: string | null
    profiles?:
      | {
          default_hourly_rate?: unknown
          hourly_rate?: unknown
        }
      | Array<{
          default_hourly_rate?: unknown
          hourly_rate?: unknown
        }>
      | null
  }>).map((member) => ({
    role: (member.role ?? '').trim().toLowerCase(),
    profile: asSingleRelation(member.profiles),
  }))
  const hasWorkerWithRate = members.some((member) => isProfileReadyAsWorker(member.profile))
  const computed = {
    companyProfileCompleted: Boolean(
      company?.name?.trim() &&
      (company?.country_code?.trim() || company?.billing_country?.trim()) &&
      (company?.default_language?.trim() || company?.locale?.trim()) &&
      (company?.default_currency?.trim() || company?.currency?.trim())
    ),
    firstCustomerCreated: countFromNullableResponse(customersResponse) > 0,
    firstWorkerCreated: hasWorkerWithRate,
    firstJobCreated: countFromNullableResponse(jobsResponse) > 0,
  }
  const stateRow = await syncCompanyOnboardingState(supabase, companyId, existing, computed)
  const steps: CompanyOnboardingStep[] = [
    {
      key: 'company_profile',
      done: Boolean(stateRow.company_profile_completed),
      href: '/settings/company',
    },
    {
      key: 'first_customer',
      done: Boolean(stateRow.first_customer_created),
      href: '/customers/new',
    },
    {
      key: 'first_worker',
      done: Boolean(stateRow.first_worker_created),
      href: '/workers/new',
    },
    {
      key: 'first_job',
      done: Boolean(stateRow.first_job_created),
      href: '/jobs/new',
    },
  ]
  const completed = steps.filter((step) => step.done).length

  return {
    state: {
      companyId,
      companyProfileCompleted: Boolean(stateRow.company_profile_completed),
      firstCustomerCreated: Boolean(stateRow.first_customer_created),
      firstWorkerCreated: Boolean(stateRow.first_worker_created),
      firstJobCreated: Boolean(stateRow.first_job_created),
      dismissedAt: stateRow.dismissed_at,
      completedAt: stateRow.completed_at,
      lastOpenedAt: stateRow.last_opened_at,
    },
    completed,
    total: steps.length,
    isComplete: completed >= steps.length,
    isDismissed: Boolean(stateRow.dismissed_at),
    profileName: currentProfile?.full_name?.trim() || null,
    profileEmail: currentProfile?.email?.trim() || null,
    defaultHourlyRate:
      toPositiveNumber(currentProfile?.default_hourly_rate) ??
      toPositiveNumber(currentProfile?.hourly_rate),
    steps,
  }
}

export type FirstRunChecklistItem = {
  key: 'company' | 'currency' | 'workers' | 'customers' | 'quote' | 'job'
  label: string
  href: string
  done: boolean
}

export type FirstRunChecklist = {
  completed: number
  total: number
  items: FirstRunChecklistItem[]
}

function countFromResponse(response: { count: number | null }) {
  return response.count ?? 0
}

export async function getFirstRunChecklist(
  supabase: SupabaseServerClient,
  companyId: string,
): Promise<FirstRunChecklist> {
  const [companyResponse, workersResponse, customersResponse, quotesResponse, jobsResponse] =
    await Promise.all([
      supabase
        .from('companies')
        .select('name, currency')
        .eq('id', companyId)
        .maybeSingle(),
      supabase
        .from('company_members')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('is_active', true),
      supabase
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
      supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
    ])

  const company = (companyResponse.data ?? null) as {
    name?: string | null
    currency?: string | null
  } | null

  const items: FirstRunChecklistItem[] = [
    {
      key: 'company',
      label: 'Doplň název firmy',
      href: '/settings/company',
      done: Boolean(company?.name?.trim()),
    },
    {
      key: 'currency',
      label: 'Zkontroluj měnu a fakturaci',
      href: '/settings/company',
      done: Boolean(company?.currency?.trim()),
    },
    {
      key: 'workers',
      label: 'Přidej pracovníky',
      href: '/workers',
      done: countFromResponse(workersResponse) > 1,
    },
    {
      key: 'customers',
      label: 'Přidej zákazníka',
      href: '/customers/new',
      done: countFromResponse(customersResponse) > 0,
    },
    {
      key: 'quote',
      label: 'Vytvoř první nabídku',
      href: '/cenove-nabidky',
      done: countFromResponse(quotesResponse) > 0,
    },
    {
      key: 'job',
      label: 'Založ první zakázku',
      href: '/jobs/new',
      done: countFromResponse(jobsResponse) > 0,
    },
  ]

  return {
    completed: items.filter((item) => item.done).length,
    total: items.length,
    items,
  }
}
