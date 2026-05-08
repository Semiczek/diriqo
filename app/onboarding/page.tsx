import { redirect } from 'next/navigation'

import { createFirstCompany } from '@/app/onboarding/actions'
import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type Props = {
  searchParams: Promise<{
    error?: string
  }>
}

export const dynamic = 'force-dynamic'

export default async function OnboardingPage({ searchParams }: Props) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  const activeCompany = await getActiveCompanyContext()
  if (activeCompany) {
    redirect('/')
  }

  const params = await searchParams
  const hasCompanyNameError = params.error === 'company-name'
  const defaultName = user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? ''
  const defaultSupportEmail = user.email ?? ''

  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        <div>
          <div style={eyebrowStyle}>První spuštění</div>
          <h1 style={titleStyle}>Založ firmu v Diriqo</h1>
          <p style={textStyle}>
            Vytvoříme firmu, výchozí nastavení, moduly, support mailbox a tebe přidáme jako prvního administrátora.
          </p>
        </div>

        <form action={createFirstCompany} style={formStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Název firmy</span>
            <input name="company_name" required minLength={2} placeholder="Moje firma s.r.o." style={inputStyle} />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Tvoje jméno</span>
            <input name="full_name" defaultValue={defaultName} placeholder="Jméno administrátora" style={inputStyle} />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Support e-mail</span>
            <input name="support_email" type="email" defaultValue={defaultSupportEmail} style={inputStyle} />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Měna</span>
            <select name="currency" defaultValue="CZK" style={inputStyle}>
              <option value="CZK">CZK</option>
              <option value="EUR">EUR</option>
            </select>
          </label>

          {hasCompanyNameError ? (
            <div style={errorStyle}>Název firmy musí mít alespoň 2 znaky.</div>
          ) : null}

          <button type="submit" style={buttonStyle}>
            Vytvořit firmu
          </button>
        </form>
      </section>
    </main>
  )
}

const pageStyle = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: '24px',
  background: '#f8fafc',
  color: '#0f172a',
} as const

const cardStyle = {
  width: 'min(100%, 760px)',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 0.9fr) minmax(280px, 1fr)',
  gap: '24px',
  borderRadius: '18px',
  border: '1px solid #e2e8f0',
  background: '#ffffff',
  boxShadow: '0 22px 60px rgba(15, 23, 42, 0.1)',
  padding: '28px',
} as const

const eyebrowStyle = {
  color: '#2563eb',
  fontSize: '12px',
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
} as const

const titleStyle = {
  margin: '10px 0',
  fontSize: '36px',
  lineHeight: 1.05,
} as const

const textStyle = {
  margin: 0,
  color: '#64748b',
  fontSize: '15px',
  lineHeight: 1.7,
  fontWeight: 650,
} as const

const formStyle = {
  display: 'grid',
  gap: '14px',
} as const

const fieldStyle = {
  display: 'grid',
  gap: '6px',
} as const

const labelStyle = {
  color: '#334155',
  fontSize: '13px',
  fontWeight: 850,
} as const

const inputStyle = {
  minHeight: '44px',
  borderRadius: '10px',
  border: '1px solid #cbd5e1',
  padding: '9px 11px',
  fontSize: '15px',
  boxSizing: 'border-box',
  width: '100%',
} as const

const buttonStyle = {
  minHeight: '46px',
  borderRadius: '10px',
  border: 'none',
  background: '#111827',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 900,
  cursor: 'pointer',
} as const

const errorStyle = {
  borderRadius: '10px',
  border: '1px solid #fecaca',
  background: '#fef2f2',
  color: '#991b1b',
  padding: '10px 12px',
  fontSize: '14px',
  fontWeight: 750,
} as const
