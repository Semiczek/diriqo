import Link from 'next/link'
import type { CSSProperties } from 'react'

import DashboardShell from '@/components/DashboardShell'
import { getPageHelpDefinitions, type HelpPageKey } from '@/lib/help/tutorials'
import { getRequestLocale } from '@/lib/i18n/server'

const topicKeys: HelpPageKey[] = [
  'first_steps',
  'jobs',
  'customers',
  'workers',
  'calendar',
  'absences',
  'advance_requests',
  'costs',
  'finance',
  'offers',
  'settings',
]

export default async function HelpOverviewPage() {
  const locale = await getRequestLocale()
  const pageHelpDefinitions = getPageHelpDefinitions(locale)
  const copy = locale === 'cs'
    ? {
        eyebrow: 'Nápověda',
        title: 'Plná nápověda',
        subtitle: 'Rychlý rozcestník pro hlavní části Diriqa. Kontextovou nápovědu najdeš pořád vpravo dole.',
        restart: 'Znovu spustit úvodní volbu',
        manual: 'Otevřít detailní manuál',
      }
    : {
        eyebrow: 'Help',
        title: 'Full help',
        subtitle: 'A quick guide for the main parts of Diriqo. Contextual help is always available in the bottom-right corner.',
        restart: 'Restart the intro choice',
        manual: 'Open the detailed manual',
      }

  return (
    <DashboardShell activeItem="help">
      <main style={pageStyle}>
        <header style={heroStyle}>
          <div style={eyebrowStyle}>{copy.eyebrow}</div>
          <h1 style={titleStyle}>{copy.title}</h1>
          <p style={subtitleStyle}>{copy.subtitle}</p>
        </header>

        <section style={gridStyle}>
          {topicKeys.map((key) => {
            const topic = pageHelpDefinitions[key]

            return (
              <article key={key} style={cardStyle}>
                <h2 style={cardTitleStyle}>{topic.label}</h2>
                <p style={cardTextStyle}>{topic.shortDescription}</p>
                <ul style={listStyle}>
                  {topic.shortSteps.slice(0, 3).map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </article>
            )
          })}
        </section>

        <div style={footerStyle}>
          <Link href="/onboarding?again=1" style={primaryLinkStyle}>
            {copy.restart}
          </Link>
          <Link href="/napoveda" style={secondaryLinkStyle}>
            {copy.manual}
          </Link>
        </div>
      </main>
    </DashboardShell>
  )
}

const pageStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  paddingBottom: 48,
}

const heroStyle: CSSProperties = {
  borderRadius: 20,
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background:
    'radial-gradient(circle at 8% 8%, rgba(124, 58, 237, 0.14), transparent 28%), radial-gradient(circle at 100% 0%, rgba(6, 182, 212, 0.14), transparent 28%), linear-gradient(135deg, rgba(255,255,255,0.96), rgba(248,250,252,0.95))',
  padding: '18px 20px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.065)',
}

const eyebrowStyle: CSSProperties = {
  display: 'inline-flex',
  borderRadius: 999,
  padding: '4px 9px',
  marginBottom: 8,
  background: 'rgba(37, 99, 235, 0.1)',
  border: '1px solid rgba(37, 99, 235, 0.18)',
  color: '#1d4ed8',
  fontSize: 11,
  fontWeight: 850,
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 32,
  lineHeight: 1.08,
  color: '#020617',
  letterSpacing: 0,
}

const subtitleStyle: CSSProperties = {
  margin: '7px 0 0',
  color: '#475569',
  lineHeight: 1.45,
  fontSize: 14,
  maxWidth: 680,
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(245px, 1fr))',
  gap: 14,
}

const cardStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: 20,
  background: '#ffffff',
  padding: 18,
  boxShadow: '0 14px 34px rgba(15, 23, 42, 0.06)',
}

const cardTitleStyle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: 20,
}

const cardTextStyle: CSSProperties = {
  margin: 0,
  color: '#475569',
  lineHeight: 1.5,
  fontWeight: 650,
}

const listStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: '#334155',
  display: 'grid',
  gap: 6,
  lineHeight: 1.45,
  fontSize: 14,
}

const footerStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
}

const primaryLinkStyle: CSSProperties = {
  minHeight: 42,
  borderRadius: 999,
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
  color: '#ffffff',
  padding: '0 16px',
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
  fontWeight: 900,
}

const secondaryLinkStyle: CSSProperties = {
  ...primaryLinkStyle,
  background: '#ffffff',
  color: '#1d4ed8',
  border: '1px solid rgba(37, 99, 235, 0.24)',
}
