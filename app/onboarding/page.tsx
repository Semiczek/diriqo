import { redirect } from 'next/navigation'
import type { CSSProperties } from 'react'

import { chooseOnboardingMode } from '@/app/onboarding/actions'
import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUserOnboardingState } from '@/lib/user-onboarding'

type OnboardingPageProps = {
  searchParams: Promise<{
    again?: string
  }>
}

const options = [
  {
    mode: 'skipped',
    title: 'Začít hned pracovat',
    duration: 'Bez průvodce',
    description: 'Přejdeš rovnou do dashboardu. Nápovědu najdeš kdykoliv vpravo dole.',
    points: ['Dashboard je dostupný hned', 'Nápověda zůstane po ruce', 'Tutorial můžeš spustit později'],
    button: 'Pokračovat do aplikace',
    recommended: false,
  },
  {
    mode: 'quick',
    title: 'Rychlé seznámení',
    duration: '2-4 minuty',
    description: 'Krátce ti ukážeme princip zákazník, zakázka, pracovník, kalendář a ekonomika.',
    points: ['Kde najít pomoc', 'Jak vzniká první zakázka', 'Jak se orientovat v hlavních stránkách'],
    button: 'Spustit rychlé seznámení',
    recommended: true,
  },
  {
    mode: 'detailed',
    title: 'Podrobný tutorial',
    duration: 'Krok za krokem',
    description: 'Delší průvodce pro nastavení firmy, pracovníky, zákazníky, zakázky, náklady a finance.',
    points: ['Vždy jde zavřít', 'Kroky lze přeskočit', 'Pokračovat můžeš později'],
    button: 'Spustit podrobný tutorial',
    recommended: false,
  },
] as const

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const params = await searchParams
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/sign-in')
  }

  const activeCompany = await getActiveCompanyContext({
    allowedRoles: ['super_admin', 'company_admin', 'manager', 'worker'],
  })

  if (!activeCompany) {
    redirect('/onboarding/company')
  }

  const state = await getUserOnboardingState(user.id, activeCompany.companyId)
  const canShowAgain = params.again === '1' || params.again === 'true'

  if (state?.onboarding_completed && !canShowAgain) {
    redirect('/')
  }

  return (
    <main style={pageStyle}>
      <section style={shellStyle}>
        <div style={headerStyle}>
          <div style={badgeStyle}>Diriqo</div>
          <h1 style={titleStyle}>Jak chceš začít?</h1>
          <p style={subtitleStyle}>
            Vyber si způsob, který ti nejvíc sedí. Diriqo můžeš začít používat hned,
            nebo si ho nechat ukázat krok za krokem.
          </p>
        </div>

        <div style={gridStyle}>
          {options.map((option) => (
            <form key={option.mode} action={chooseOnboardingMode} style={cardStyle}>
              <input type="hidden" name="mode" value={option.mode} />
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={durationStyle}>{option.duration}</span>
                  {option.recommended ? <span style={recommendedStyle}>Doporučeno</span> : null}
                </div>
                <h2 style={cardTitleStyle}>{option.title}</h2>
                <p style={cardDescriptionStyle}>{option.description}</p>
              </div>

              <ul style={listStyle}>
                {option.points.map((point) => (
                  <li key={point} style={listItemStyle}>
                    <span style={checkStyle}>✓</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>

              <button type="submit" style={option.recommended ? primaryButtonStyle : secondaryButtonStyle}>
                {option.button}
              </button>
            </form>
          ))}
        </div>

        <p style={footnoteStyle}>
          Tutorial není povinný. Vždy ho můžeš zavřít, přeskočit krok nebo znovu spustit přes nápovědu.
        </p>
      </section>
    </main>
  )
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  background:
    'radial-gradient(circle at 18% 12%, rgba(124, 58, 237, 0.16), transparent 34%), radial-gradient(circle at 86% 22%, rgba(6, 182, 212, 0.18), transparent 28%), linear-gradient(180deg, #f8fafc 0%, #eef4fb 100%)',
  color: '#0f172a',
}

const shellStyle: CSSProperties = {
  width: 'min(1100px, 100%)',
  display: 'grid',
  gap: 22,
}

const headerStyle: CSSProperties = {
  textAlign: 'center',
  display: 'grid',
  justifyItems: 'center',
  gap: 10,
}

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  borderRadius: 999,
  padding: '8px 13px',
  background: '#ffffff',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  color: '#2563eb',
  fontSize: 12,
  fontWeight: 900,
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'clamp(34px, 5vw, 56px)',
  lineHeight: 1,
  letterSpacing: 0,
}

const subtitleStyle: CSSProperties = {
  margin: 0,
  maxWidth: 720,
  color: '#475569',
  fontSize: 17,
  lineHeight: 1.6,
  fontWeight: 650,
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
}

const cardStyle: CSSProperties = {
  minHeight: 390,
  display: 'grid',
  gridTemplateRows: 'auto 1fr auto',
  gap: 18,
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: 22,
  background: 'rgba(255, 255, 255, 0.94)',
  padding: 20,
  boxShadow: '0 22px 54px rgba(15, 23, 42, 0.09)',
}

const durationStyle: CSSProperties = {
  color: '#64748b',
  fontSize: 12,
  fontWeight: 900,
  textTransform: 'uppercase',
}

const recommendedStyle: CSSProperties = {
  borderRadius: 999,
  background: '#ecfeff',
  border: '1px solid #a5f3fc',
  color: '#0e7490',
  padding: '5px 9px',
  fontSize: 12,
  fontWeight: 900,
}

const cardTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 24,
  lineHeight: 1.15,
}

const cardDescriptionStyle: CSSProperties = {
  margin: 0,
  color: '#475569',
  lineHeight: 1.55,
  fontWeight: 650,
}

const listStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'grid',
  gap: 10,
}

const listItemStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  color: '#334155',
  fontSize: 14,
  fontWeight: 720,
  lineHeight: 1.45,
}

const checkStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 999,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  background: '#dcfce7',
  color: '#166534',
  fontSize: 12,
  fontWeight: 950,
}

const primaryButtonStyle: CSSProperties = {
  minHeight: 46,
  border: 0,
  borderRadius: 999,
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
  color: '#ffffff',
  padding: '0 18px',
  fontWeight: 900,
  cursor: 'pointer',
}

const secondaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  background: '#ffffff',
  border: '1px solid rgba(37, 99, 235, 0.24)',
  color: '#1d4ed8',
}

const footnoteStyle: CSSProperties = {
  margin: 0,
  color: '#64748b',
  textAlign: 'center',
  fontSize: 13,
  fontWeight: 700,
}
