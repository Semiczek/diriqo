import Link from 'next/link'

import { getWorkerLimit } from '@/lib/plans'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { requireSuperAdmin } from '@/lib/superadmin'

type CompanyRow = {
  id: string
  name: string | null
  billing_country: string | null
  locale: string | null
  currency: string | null
  created_at: string | null
}

type SubscriptionRow = {
  company_id: string
  plan_key: string | null
  status: string | null
  trial_ends_at: string | null
  current_period_end: string | null
}

type MemberRow = {
  company_id: string | null
  profile_id: string | null
  role: string | null
  is_active: boolean | null
  profiles?: { email?: string | null; full_name?: string | null } | { email?: string | null; full_name?: string | null }[] | null
}

function asSingle<T>(value: T | T[] | null | undefined) {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium' }).format(new Date(value))
}

export default async function AdminCompaniesPage() {
  await requireSuperAdmin()
  const admin = createSupabaseAdminClient()
  const [companiesResponse, subscriptionsResponse, membersResponse, jobsResponse] = await Promise.all([
    admin
      .from('companies')
      .select('id, name, billing_country, locale, currency, created_at')
      .order('created_at', { ascending: false }),
    admin
      .from('company_subscriptions')
      .select('company_id, plan_key, status, trial_ends_at, current_period_end'),
    admin
      .from('company_members')
      .select('company_id, profile_id, role, is_active, profiles(email, full_name)')
      .eq('is_active', true),
    admin
      .from('jobs')
      .select('company_id, updated_at, created_at')
      .order('updated_at', { ascending: false, nullsFirst: false }),
  ])

  const companies = (companiesResponse.data ?? []) as CompanyRow[]
  const subscriptions = new Map(
    ((subscriptionsResponse.data ?? []) as SubscriptionRow[]).map((subscription) => [
      subscription.company_id,
      subscription,
    ])
  )
  const members = (membersResponse.data ?? []) as MemberRow[]
  const memberCountByCompany = new Map<string, number>()
  const adminEmailByCompany = new Map<string, string>()
  const lastActivityByCompany = new Map<string, string>()

  for (const member of members) {
    if (!member.company_id) continue
    memberCountByCompany.set(member.company_id, (memberCountByCompany.get(member.company_id) ?? 0) + 1)

    if ((member.role ?? '').toLowerCase() === 'company_admin' && !adminEmailByCompany.has(member.company_id)) {
      const profile = asSingle(member.profiles)
      adminEmailByCompany.set(member.company_id, profile?.email ?? profile?.full_name ?? '-')
    }
  }

  for (const job of (jobsResponse.data ?? []) as Array<{ company_id: string | null; updated_at: string | null; created_at: string | null }>) {
    if (!job.company_id || lastActivityByCompany.has(job.company_id)) continue
    lastActivityByCompany.set(job.company_id, job.updated_at ?? job.created_at ?? '')
  }

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <p style={eyebrowStyle}>Superadmin</p>
        <h1 style={titleStyle}>Firmy</h1>
      </header>

      <section style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {[
                'Firma',
                'Země',
                'Jazyk',
                'Měna',
                'Plán',
                'Stav',
                'Konec zkušebního období',
                'Konec období',
                'Limit pracovníků',
                'Členové',
                'Admin',
                'Vytvořeno',
                'Poslední aktivita',
              ].map((heading) => (
                <th key={heading} style={thStyle}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => {
              const subscription = subscriptions.get(company.id)

              return (
                <tr key={company.id}>
                  <td style={tdStyle}>
                    <Link href={`/admin/companies/${company.id}`} style={linkStyle}>
                      {company.name || 'Firma bez názvu'}
                    </Link>
                  </td>
                  <td style={tdStyle}>{company.billing_country ?? '-'}</td>
                  <td style={tdStyle}>{company.locale ?? '-'}</td>
                  <td style={tdStyle}>{company.currency ?? '-'}</td>
                  <td style={tdStyle}>{subscription?.plan_key ?? '-'}</td>
                  <td style={tdStyle}>{subscription?.status ?? '-'}</td>
                  <td style={tdStyle}>{formatDate(subscription?.trial_ends_at)}</td>
                  <td style={tdStyle}>{formatDate(subscription?.current_period_end)}</td>
                  <td style={tdStyle}>{subscription?.plan_key ? getWorkerLimit(subscription.plan_key) ?? 'individuální' : '-'}</td>
                  <td style={tdStyle}>{memberCountByCompany.get(company.id) ?? 0}</td>
                  <td style={tdStyle}>{adminEmailByCompany.get(company.id) ?? '-'}</td>
                  <td style={tdStyle}>{formatDate(company.created_at)}</td>
                  <td style={tdStyle}>{formatDate(lastActivityByCompany.get(company.id))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </main>
  )
}

const pageStyle = {
  minHeight: '100vh',
  display: 'grid',
  gap: 18,
  alignContent: 'start',
  padding: 24,
  background: '#f8fafc',
  color: '#111827',
} as const

const headerStyle = {
  display: 'grid',
  gap: 6,
} as const

const eyebrowStyle = {
  margin: 0,
  color: '#2563eb',
  fontSize: 12,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
} as const

const titleStyle = {
  margin: 0,
  fontSize: 34,
} as const

const tableWrapStyle = {
  overflowX: 'auto',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  background: '#ffffff',
} as const

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
} as const

const thStyle = {
  padding: '10px 12px',
  textAlign: 'left',
  borderBottom: '1px solid #e2e8f0',
  color: '#475569',
  whiteSpace: 'nowrap',
} as const

const tdStyle = {
  padding: '10px 12px',
  borderBottom: '1px solid #f1f5f9',
  whiteSpace: 'nowrap',
} as const

const linkStyle = {
  color: '#2563eb',
  fontWeight: 850,
  textDecoration: 'none',
} as const
