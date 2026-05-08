import DashboardShell from '@/components/DashboardShell'
import {
  getCompanyBillingSettings,
  getCompanyModules,
  getCompanyPayrollSettings,
  getCompanySettings,
} from '@/lib/company-settings'
import { requireHubAccess } from '@/lib/require-hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import CompanySettingsClient from './CompanySettingsClient'

type CompanyRow = {
  id: string
  name: string | null
  ico?: string | null
  dic?: string | null
  email?: string | null
  phone?: string | null
  web?: string | null
  address?: string | null
  currency?: string | null
  locale?: string | null
  timezone?: string | null
}

type ProfileRelation =
  | {
      id: string
      full_name: string | null
      email: string | null
    }
  | {
      id: string
      full_name: string | null
      email: string | null
    }[]
  | null

type MemberRow = {
  id: string | null
  role: string | null
  is_active: boolean | null
  profile_id: string | null
  profiles?: ProfileRelation
}

type WorkerPaymentRow = {
  profile_id: string | null
  worker_type: string | null
  pay_type_override: string | null
  payday_day_override: number | null
  payday_weekday_override: number | null
  hourly_rate: number | null
  fixed_rate_per_job: number | null
  advances_enabled_override: boolean | null
  advance_limit_amount_override: number | null
  contractor_company_name: string | null
  contractor_registration_no: string | null
  contractor_vat_no: string | null
  contractor_invoice_required: boolean | null
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export default async function CompanySettingsPage() {
  const activeCompany = await requireHubAccess()
  const role = (activeCompany.role ?? '').toLowerCase()
  const isAdmin = role === 'super_admin' || role === 'company_admin'

  if (!isAdmin) {
    return (
      <DashboardShell activeItem="companySettings">
        <section style={cardStyle}>
          <h1 style={{ margin: 0, fontSize: '28px' }}>Nastavení společnosti</h1>
          <p style={{ margin: '10px 0 0', color: '#64748b', fontWeight: 700 }}>
            Nemáte oprávnění spravovat nastavení společnosti.
          </p>
        </section>
      </DashboardShell>
    )
  }

  const supabase = await createSupabaseServerClient()

  const [
    companyResponse,
    companySettings,
    payrollSettings,
    billingSettings,
    modules,
    membersResponse,
    workerPaymentResponse,
  ] =
    await Promise.all([
      supabase
        .from('companies')
        .select('id, name, ico, dic, email, phone, web, address, currency, locale, timezone')
        .eq('id', activeCompany.companyId)
        .maybeSingle(),
      getCompanySettings(activeCompany.companyId),
      getCompanyPayrollSettings(activeCompany.companyId),
      getCompanyBillingSettings(activeCompany.companyId),
      getCompanyModules(activeCompany.companyId),
      supabase
        .from('company_members')
        .select('id, role, is_active, profile_id, profiles(id, full_name, email)')
        .eq('company_id', activeCompany.companyId)
        .order('created_at', { ascending: true }),
      supabase
        .from('worker_payment_settings')
        .select(
          'profile_id, worker_type, pay_type_override, payday_day_override, payday_weekday_override, hourly_rate, fixed_rate_per_job, advances_enabled_override, advance_limit_amount_override, contractor_company_name, contractor_registration_no, contractor_vat_no, contractor_invoice_required'
        )
        .eq('company_id', activeCompany.companyId),
    ])

  const company = ((companyResponse.data ?? null) as CompanyRow | null) ?? {
    id: activeCompany.companyId,
    name: activeCompany.companyName,
  }

  const workerPayments = new Map(
    ((workerPaymentResponse.data ?? []) as WorkerPaymentRow[])
      .filter((row) => row.profile_id)
      .map((row) => [row.profile_id as string, row])
  )

  const members = ((membersResponse.data ?? []) as MemberRow[]).map((member) => {
    const profile = asSingle(member.profiles)
    const paymentSettings = member.profile_id ? workerPayments.get(member.profile_id) ?? null : null

    return {
      id: member.id,
      profileId: member.profile_id,
      fullName: profile?.full_name ?? 'Pracovník bez jména',
      email: profile?.email ?? null,
      role: member.role ?? 'worker',
      isActive: member.is_active !== false,
      paymentSettings,
    }
  })

  return (
    <DashboardShell activeItem="companySettings">
      <CompanySettingsClient
        company={company}
        companySettings={companySettings}
        payrollSettings={payrollSettings}
        billingSettings={billingSettings}
        modules={modules}
        members={members}
      />
    </DashboardShell>
  )
}

const cardStyle = {
  borderRadius: '24px',
  border: '1px solid rgba(203, 213, 225, 0.76)',
  background: '#ffffff',
  boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
  padding: '24px',
} as const
