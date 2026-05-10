import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getWorkerLimit } from '@/lib/plans'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { logSuperadminAction, requireSuperAdmin } from '@/lib/superadmin'

import { attemptSupportEntryAction } from './actions'

type DetailPageProps = {
  params: Promise<{
    companyId: string
  }>
  searchParams?: Promise<{
    support?: string
  }>
}

type CompanyRow = {
  id: string
  name: string | null
  billing_country: string | null
  locale: string | null
  currency: string | null
  email: string | null
  support_email: string | null
  created_at: string | null
}

type SubscriptionRow = {
  plan_key: string | null
  status: string | null
  trial_started_at: string | null
  trial_ends_at: string | null
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_price_id: string | null
}

type MemberRow = {
  id: string
  role: string | null
  is_active: boolean | null
  created_at: string | null
  profiles?: { email?: string | null; full_name?: string | null } | { email?: string | null; full_name?: string | null }[] | null
}

function asSingle<T>(value: T | T[] | null | undefined) {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default async function AdminCompanyDetailPage({ params, searchParams }: DetailPageProps) {
  const superadmin = await requireSuperAdmin()
  const { companyId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const admin = createSupabaseAdminClient()

  await logSuperadminAction({
    superadminProfileId: superadmin.profileId,
    companyId,
    action: 'company_detail_opened',
  })

  const [
    companyResponse,
    subscriptionResponse,
    membersResponse,
    jobsCountResponse,
    customersCountResponse,
    supportGrantResponse,
  ] = await Promise.all([
    admin
      .from('companies')
      .select('id, name, billing_country, locale, currency, email, support_email, created_at')
      .eq('id', companyId)
      .maybeSingle(),
    admin
      .from('company_subscriptions')
      .select(
        'plan_key, status, trial_started_at, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, stripe_price_id'
      )
      .eq('company_id', companyId)
      .maybeSingle(),
    admin
      .from('company_members')
      .select('id, role, is_active, created_at, profiles(email, full_name)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true }),
    admin.from('jobs').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    admin.from('customers').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    admin
      .from('support_access_grants')
      .select('id, expires_at, revoked_at')
      .eq('company_id', companyId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const company = companyResponse.data as CompanyRow | null
  if (!company?.id) {
    notFound()
  }

  const subscription = subscriptionResponse.data as SubscriptionRow | null
  const members = (membersResponse.data ?? []) as MemberRow[]
  const supportGrant = supportGrantResponse.data as { id: string; expires_at: string | null } | null

  if (supportGrant?.id) {
    await logSuperadminAction({
      superadminProfileId: superadmin.profileId,
      companyId,
      action: 'support_access_operational_metadata_viewed',
      metadata: {
        support_access_grant_id: supportGrant.id,
      },
    })
  }

  return (
    <main style={pageStyle}>
      <Link href="/admin/companies" style={backLinkStyle}>Back to companies</Link>
      <header style={headerStyle}>
        <p style={eyebrowStyle}>Superadmin detail</p>
        <h1 style={titleStyle}>{company.name || 'Company without name'}</h1>
      </header>

      {resolvedSearchParams.support === 'allowed' ? (
        <section style={successStyle}>Support access je aktivni. Pokus o vstup byl zalogovan jako uspesny.</section>
      ) : null}
      {resolvedSearchParams.support === 'denied' ? (
        <section style={warningStyle}>Support access neni aktivni. Pokus o vstup byl zalogovan a provozni data zustavaji zamcena.</section>
      ) : null}

      <section style={gridStyle}>
        <article style={cardStyle}>
          <h2 style={cardTitleStyle}>Zakladni info</h2>
          <dl style={detailsStyle}>
            <div><dt>Email</dt><dd>{company.email ?? '-'}</dd></div>
            <div><dt>Support email</dt><dd>{company.support_email ?? '-'}</dd></div>
            <div><dt>Country</dt><dd>{company.billing_country ?? '-'}</dd></div>
            <div><dt>Language</dt><dd>{company.locale ?? '-'}</dd></div>
            <div><dt>Currency</dt><dd>{company.currency ?? '-'}</dd></div>
            <div><dt>Created</dt><dd>{formatDate(company.created_at)}</dd></div>
          </dl>
        </article>

        <article style={cardStyle}>
          <h2 style={cardTitleStyle}>Subscription</h2>
          <dl style={detailsStyle}>
            <div><dt>Plan</dt><dd>{subscription?.plan_key ?? '-'}</dd></div>
            <div><dt>Status</dt><dd>{subscription?.status ?? '-'}</dd></div>
            <div><dt>Trial started</dt><dd>{formatDate(subscription?.trial_started_at)}</dd></div>
            <div><dt>Trial ends</dt><dd>{formatDate(subscription?.trial_ends_at)}</dd></div>
            <div><dt>Current period start</dt><dd>{formatDate(subscription?.current_period_start)}</dd></div>
            <div><dt>Current period end</dt><dd>{formatDate(subscription?.current_period_end)}</dd></div>
            <div><dt>Worker limit</dt><dd>{subscription?.plan_key ? getWorkerLimit(subscription.plan_key) ?? 'custom' : '-'}</dd></div>
            <div><dt>Cancel at period end</dt><dd>{subscription?.cancel_at_period_end ? 'yes' : 'no'}</dd></div>
          </dl>
        </article>

        <article style={cardStyle}>
          <h2 style={cardTitleStyle}>Stripe</h2>
          <dl style={detailsStyle}>
            <div><dt>Customer id</dt><dd>{subscription?.stripe_customer_id ?? '-'}</dd></div>
            <div><dt>Subscription id</dt><dd>{subscription?.stripe_subscription_id ?? '-'}</dd></div>
            <div><dt>Price id</dt><dd>{subscription?.stripe_price_id ?? '-'}</dd></div>
          </dl>
        </article>

        <article style={cardStyle}>
          <h2 style={cardTitleStyle}>Support access</h2>
          {supportGrant ? (
            <p style={successStyle}>Aktivni do {formatDate(supportGrant.expires_at)}</p>
          ) : (
            <p style={warningStyle}>Provozni data nejsou bez aktivniho grantu dostupna.</p>
          )}
          <form action={attemptSupportEntryAction}>
            <input type="hidden" name="company_id" value={company.id} />
            <button type="submit" style={buttonStyle}>
              Pokusit se vstoupit do firmy
            </button>
          </form>
        </article>
      </section>

      <section style={gridStyle}>
        <article style={cardStyle}>
          <h2 style={cardTitleStyle}>Provozni souhrn</h2>
          {supportGrant ? (
            <dl style={detailsStyle}>
              <div><dt>Pocet zakazek</dt><dd>{jobsCountResponse.count ?? 0}</dd></div>
              <div><dt>Pocet zakazniku</dt><dd>{customersCountResponse.count ?? 0}</dd></div>
            </dl>
          ) : (
            <p style={mutedStyle}>Souhrn provoznich dat vyzaduje aktivni support access grant.</p>
          )}
        </article>

        <article style={cardStyle}>
          <h2 style={cardTitleStyle}>Clenove firmy</h2>
          <div style={memberListStyle}>
            {members.map((member) => {
              const profile = asSingle(member.profiles)
              return (
                <div key={member.id} style={memberRowStyle}>
                  <strong>{profile?.full_name || profile?.email || 'Unknown member'}</strong>
                  <span>{profile?.email ?? '-'}</span>
                  <span>{member.role ?? '-'} / {member.is_active ? 'active' : 'inactive'}</span>
                </div>
              )
            })}
          </div>
        </article>
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

const backLinkStyle = {
  color: '#2563eb',
  fontWeight: 850,
  textDecoration: 'none',
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

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 14,
} as const

const cardStyle = {
  display: 'grid',
  gap: 12,
  alignContent: 'start',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  background: '#ffffff',
  padding: 18,
} as const

const cardTitleStyle = {
  margin: 0,
  fontSize: 22,
} as const

const detailsStyle = {
  display: 'grid',
  gap: 10,
  margin: 0,
} as const

const mutedStyle = {
  margin: 0,
  color: '#64748b',
  lineHeight: 1.5,
} as const

const successStyle = {
  margin: 0,
  border: '1px solid #bbf7d0',
  background: '#f0fdf4',
  color: '#166534',
  borderRadius: 8,
  padding: 12,
  fontWeight: 800,
} as const

const warningStyle = {
  margin: 0,
  border: '1px solid #fdba74',
  background: '#fff7ed',
  color: '#9a3412',
  borderRadius: 8,
  padding: 12,
  fontWeight: 800,
} as const

const buttonStyle = {
  minHeight: 40,
  border: 0,
  borderRadius: 8,
  padding: '8px 12px',
  background: '#111827',
  color: '#ffffff',
  fontWeight: 850,
  cursor: 'pointer',
} as const

const memberListStyle = {
  display: 'grid',
  gap: 8,
} as const

const memberRowStyle = {
  display: 'grid',
  gap: 4,
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 10,
  fontSize: 14,
} as const
