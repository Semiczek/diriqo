import type { CSSProperties } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import DashboardShell from '@/components/DashboardShell'
import { getRequestDictionary } from '@/lib/i18n/server'
import { getContractorBillingTypeLabel, getWorkerTypeLabel } from '@/lib/payroll-settings'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type NewWorkerPageProps = {
  searchParams?: Promise<{
    error?: string
    details?: string
  }>
}

function getThrownMessage(error: unknown, fallback: string) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof error.digest === 'string' &&
    error.digest.startsWith('NEXT_REDIRECT')
  ) {
    return null
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

function getErrorMessage(
  errorCode: string | undefined,
  t: Awaited<ReturnType<typeof getRequestDictionary>>['workersNewPage']
) {
  if (!errorCode) return null

  if (errorCode === 'missing-name') return t.missingName
  if (errorCode === 'missing-email') return t.missingEmail
  if (errorCode === 'missing-password') return t.missingPassword
  if (errorCode === 'short-password') return t.shortPassword
  if (errorCode === 'invalid-number') return t.invalidNumber
  if (errorCode === 'not-logged-in') return t.notLoggedIn
  if (errorCode === 'my-profile-not-found') return t.myProfileNotFound
  if (errorCode === 'my-company-not-found') return t.myCompanyNotFound
  if (errorCode === 'auth-create-failed') return t.authCreateFailed
  if (errorCode === 'profile-create-failed') return t.profileCreateFailed
  if (errorCode === 'membership-create-failed') {
    return t.membershipCreateFailed
  }
  if (errorCode === 'unexpected-error') {
    return t.unexpectedError
  }

  return t.genericError
}

function formatDebugDetails(details: string | undefined) {
  if (!details) return null
  return decodeURIComponent(details).replace(/-/g, ' ')
}

function encodeDetails(value: string | undefined | null) {
  if (!value) return 'unknown'
  return encodeURIComponent(value.replace(/\s+/g, '-'))
}

const pageStyle: CSSProperties = {
  display: 'grid',
  gap: '18px',
  width: '100%',
  maxWidth: '980px',
  margin: '0 auto',
  padding: '2px 0 48px',
  color: '#111827',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: '16px',
  flexWrap: 'wrap',
  padding: '22px',
  borderRadius: '22px',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255,255,255,0.88)',
  boxShadow: '0 18px 44px rgba(15, 23, 42, 0.08)',
}

const eyebrowStyle: CSSProperties = {
  margin: '0 0 7px',
  color: '#2563eb',
  fontSize: '12px',
  fontWeight: 900,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const titleStyle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: '34px',
  lineHeight: 1.1,
  fontWeight: 900,
}

const subtitleStyle: CSSProperties = {
  margin: '8px 0 0',
  color: '#64748b',
  fontSize: '15px',
  lineHeight: 1.5,
  fontWeight: 650,
}

const backLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '40px',
  padding: '9px 14px',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.36)',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 850,
}

const formCardStyle: CSSProperties = {
  display: 'grid',
  gap: '16px',
  padding: '22px',
  borderRadius: '22px',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255,255,255,0.92)',
  boxShadow: '0 14px 34px rgba(15, 23, 42, 0.06)',
}

export default async function NewWorkerPage({
  searchParams,
}: NewWorkerPageProps) {
  const dictionary = await getRequestDictionary()
  const t = dictionary.workersNewPage
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const errorMessage = getErrorMessage(resolvedSearchParams?.error, t)
  const debugDetails = formatDebugDetails(resolvedSearchParams?.details)

  async function createWorker(formData: FormData) {
    'use server'

    try {
      const fullName = String(formData.get('full_name') ?? '').trim()
      const emailRaw = String(formData.get('email') ?? '').trim().toLowerCase()
      const password = String(formData.get('password') ?? '').trim()
      const defaultHourlyRateRaw = String(formData.get('default_hourly_rate') ?? '').trim()
      const advancePaidRaw = String(formData.get('advance_paid') ?? '').trim()
      const workerTypeRaw = String(formData.get('worker_type') ?? 'employee').trim()
      const contractorBillingTypeRaw = String(formData.get('contractor_billing_type') ?? 'hourly').trim()
      const contractorDefaultRateRaw = String(formData.get('contractor_default_rate') ?? '').trim()
      const workerType = workerTypeRaw === 'contractor' ? 'contractor' : 'employee'
      const contractorBillingType =
        contractorBillingTypeRaw === 'fixed' || contractorBillingTypeRaw === 'invoice'
          ? contractorBillingTypeRaw
          : 'hourly'

      if (!fullName) {
        redirect('/workers/new?error=missing-name')
      }

      if (!emailRaw) {
        redirect('/workers/new?error=missing-email')
      }

      if (!password) {
        redirect('/workers/new?error=missing-password')
      }

      if (password.length < 8) {
        redirect('/workers/new?error=short-password')
      }

      const defaultHourlyRate =
        defaultHourlyRateRaw === ''
          ? null
          : Number(defaultHourlyRateRaw.replace(',', '.'))

      const advancePaid =
        advancePaidRaw === ''
          ? 0
          : Number(advancePaidRaw.replace(',', '.'))
      const contractorDefaultRate =
        contractorDefaultRateRaw === ''
          ? null
          : Number(contractorDefaultRateRaw.replace(',', '.'))

      if (
        (defaultHourlyRateRaw !== '' && Number.isNaN(defaultHourlyRate)) ||
        Number.isNaN(advancePaid) ||
        (contractorDefaultRateRaw !== '' && Number.isNaN(contractorDefaultRate))
      ) {
        redirect('/workers/new?error=invalid-number')
      }

      const supabase = await createSupabaseServerClient()
      const supabaseAdmin = createSupabaseAdminClient()

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        redirect('/workers/new?error=not-logged-in')
      }

      let myProfileResponse = await supabase
        .from('profiles')
        .select('id, auth_user_id, user_id')
        .eq('auth_user_id', user.id)
        .maybeSingle()

      if (myProfileResponse.error || !myProfileResponse.data?.id) {
        myProfileResponse = await supabase
          .from('profiles')
          .select('id, auth_user_id, user_id')
          .eq('user_id', user.id)
          .maybeSingle()
      }

      if (myProfileResponse.error || !myProfileResponse.data?.id) {
        const details = myProfileResponse.error?.message || 'my-profile-not-found'
        redirect(`/workers/new?error=my-profile-not-found&details=${encodeDetails(details)}`)
      }

      const myProfileId = myProfileResponse.data.id

      const myCompanyResponse = await supabase
        .from('company_members')
        .select('company_id')
        .eq('profile_id', myProfileId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      if (myCompanyResponse.error || !myCompanyResponse.data?.company_id) {
        const details = myCompanyResponse.error?.message || 'my-company-not-found'
        redirect(`/workers/new?error=my-company-not-found&details=${encodeDetails(details)}`)
      }

      const companyId = myCompanyResponse.data.company_id

      const authCreateResponse = await supabaseAdmin.auth.admin.createUser({
        email: emailRaw,
        password,
        email_confirm: true,
      })

      if (authCreateResponse.error || !authCreateResponse.data.user?.id) {
        const details = authCreateResponse.error?.message || 'auth-create-failed'
        redirect(`/workers/new?error=auth-create-failed&details=${encodeDetails(details)}`)
      }

      const authUserId = authCreateResponse.data.user.id

      const profileCreateResponse = await supabaseAdmin
        .from('profiles')
        .insert({
          auth_user_id: authUserId,
          user_id: authUserId,
          full_name: fullName,
          email: emailRaw,
          default_hourly_rate: defaultHourlyRate,
          advance_paid: advancePaid,
          worker_type: workerType,
          contractor_billing_type: workerType === 'contractor' ? contractorBillingType : null,
          contractor_default_rate: workerType === 'contractor' ? contractorDefaultRate : null,
        })
        .select('id')
        .single()

      if (profileCreateResponse.error || !profileCreateResponse.data?.id) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId)

        const details = profileCreateResponse.error?.message || 'profile-create-failed'
        redirect(`/workers/new?error=profile-create-failed&details=${encodeDetails(details)}`)
      }

      const newProfileId = profileCreateResponse.data.id

      const membershipCreateResponse = await supabaseAdmin
        .from('company_members')
        .insert({
          profile_id: newProfileId,
          company_id: companyId,
          role: 'worker',
          is_active: true,
        })

      if (membershipCreateResponse.error) {
        await supabaseAdmin.from('profiles').delete().eq('id', newProfileId)
        await supabaseAdmin.auth.admin.deleteUser(authUserId)

        const details = membershipCreateResponse.error.message || 'membership-create-failed'
        redirect(`/workers/new?error=membership-create-failed&details=${encodeDetails(details)}`)
      }

      revalidatePath('/workers')
      revalidatePath(`/workers/${newProfileId}`)

      redirect(`/workers/${newProfileId}`)
    } catch (error: unknown) {
      const message = getThrownMessage(error, 'unknown-server-error')
      if (message === null) {
        throw error
      }

      redirect(`/workers/new?error=unexpected-error&details=${encodeDetails(message)}`)
    }
  }

  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: '13px',
    fontWeight: 850,
    color: '#334155',
    marginBottom: '8px',
  }

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid rgba(148, 163, 184, 0.44)',
    borderRadius: '12px',
    padding: '12px 14px',
    minHeight: '46px',
    fontSize: '15px',
    fontWeight: 650,
    color: '#0f172a',
    background: '#ffffff',
    outline: 'none',
  }

  return (
    <DashboardShell activeItem="workers">
      <main style={pageStyle}>
        <header style={headerStyle}>
          <div>
            <p style={eyebrowStyle}>{dictionary.navigation.workers}</p>
            <h1 style={titleStyle}>{t.title}</h1>
            <p style={subtitleStyle}>{t.subtitle}</p>
          </div>
          <Link href="/workers" style={backLinkStyle}>
            ← {t.backToWorkers.replace(/^‹\s*/, '')}
          </Link>
        </header>

        <section style={formCardStyle}>
          {errorMessage ? (
            <div
              style={{
                border: '1px solid #fdba74',
                background: '#fff7ed',
                color: '#9a3412',
                borderRadius: '12px',
                padding: '14px 16px',
                fontSize: '14px',
              }}
            >
              <div>{errorMessage}</div>
              {debugDetails ? (
                <div style={{ marginTop: '8px', fontSize: '13px' }}>
                  {t.detail}: {debugDetails}
                </div>
              ) : null}
            </div>
          ) : null}

          <form action={createWorker} className="worker-create-form">
            <div
              style={{
                display: 'grid',
                gap: '18px',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              }}
            >
              <div>
                <label htmlFor="full_name" style={labelStyle}>
                  {t.fullName}
                </label>
                <input id="full_name" name="full_name" type="text" style={inputStyle} required />
              </div>

              <div>
                <label htmlFor="email" style={labelStyle}>
                  {t.loginEmail}
                </label>
                <input id="email" name="email" type="email" style={inputStyle} required />
              </div>

              <div>
                <label htmlFor="password" style={labelStyle}>
                  {t.temporaryPassword}
                </label>
                <input id="password" name="password" type="password" style={inputStyle} required />
              </div>

              <div>
                <label htmlFor="worker_type" style={labelStyle}>
                  Typ pracovníka
                </label>
                <select id="worker_type" name="worker_type" defaultValue="employee" style={inputStyle}>
                  <option value="employee">{getWorkerTypeLabel('employee')}</option>
                  <option value="contractor">{getWorkerTypeLabel('contractor')}</option>
                </select>
                <p style={{ margin: '8px 0 0 0', color: '#6b7280', fontSize: '13px' }}>
                  Externí pracovník se nepočítá do klasických výplat a záloh.
                </p>
              </div>

              <div>
                <label htmlFor="default_hourly_rate" style={labelStyle}>
                  {t.defaultHourlyRate}
                </label>
                <input
                  id="default_hourly_rate"
                  name="default_hourly_rate"
                  type="number"
                  step="0.01"
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="contractor_billing_type" style={labelStyle}>
                  Typ vyúčtování externisty
                </label>
                <select id="contractor_billing_type" name="contractor_billing_type" defaultValue="hourly" style={inputStyle}>
                  <option value="hourly">{getContractorBillingTypeLabel('hourly')}</option>
                  <option value="fixed">{getContractorBillingTypeLabel('fixed')}</option>
                  <option value="invoice">{getContractorBillingTypeLabel('invoice')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="contractor_default_rate" style={labelStyle}>
                  Výchozí sazba / cena externisty
                </label>
                <input
                  id="contractor_default_rate"
                  name="contractor_default_rate"
                  type="number"
                  step="0.01"
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="advance_paid" style={labelStyle}>
                  {t.advancePaid}
                </label>
                <input
                  id="advance_paid"
                  name="advance_paid"
                  type="number"
                  step="0.01"
                  defaultValue="0"
                  style={inputStyle}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '12px',
                flexWrap: 'wrap',
                marginTop: '24px',
              }}
            >
              <button
                type="submit"
                style={{
                  border: 'none',
                  borderRadius: '14px',
                  background: 'linear-gradient(135deg, #111827 0%, #1f2937 100%)',
                  color: '#ffffff',
                  minHeight: '50px',
                  padding: '13px 18px',
                  fontSize: '15px',
                  fontWeight: 900,
                  cursor: 'pointer',
                  boxShadow: '0 16px 32px rgba(15, 23, 42, 0.18)',
                }}
              >
                {t.create}
              </button>

              <Link
                href="/workers"
                style={{
                  display: 'inline-block',
                  borderRadius: '12px',
                  border: '1px solid rgba(148, 163, 184, 0.38)',
                  background: '#ffffff',
                  color: '#111827',
                  minHeight: '50px',
                  padding: '12px 16px',
                  fontSize: '15px',
                  fontWeight: 850,
                  textDecoration: 'none',
                  boxSizing: 'border-box',
                }}
              >
                {t.cancel}
              </Link>
            </div>
          </form>
        </section>
      </main>
    </DashboardShell>
  )
}
