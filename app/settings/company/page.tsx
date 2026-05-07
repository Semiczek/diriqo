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

  const [companyResponse, companySettings, payrollSettings, billingSettings, modules, membersResponse] =
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
    ])

  const company = ((companyResponse.data ?? null) as CompanyRow | null) ?? {
    id: activeCompany.companyId,
    name: activeCompany.companyName,
  }

  const members = ((membersResponse.data ?? []) as MemberRow[]).map((member) => {
    const profile = asSingle(member.profiles)

    return {
      id: member.id,
      profileId: member.profile_id,
      fullName: profile?.full_name ?? 'Pracovník bez jména',
      email: profile?.email ?? null,
      role: member.role ?? 'worker',
      isActive: member.is_active !== false,
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
