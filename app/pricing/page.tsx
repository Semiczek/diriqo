import Link from 'next/link'
import type { CSSProperties } from 'react'

import { addOns, mainPlans } from '@/lib/plans'

function formatMonthlyPrice(value: number | null) {
  if (value === null) return 'Custom pricing'
  return `${value.toLocaleString('cs-CZ')} EUR / month`
}

function formatSetupPrice(value: number | null) {
  if (value === null) return null
  return `+${value.toLocaleString('cs-CZ')} EUR setup`
}

function formatWorkerLimit(value: number | null) {
  return value === null ? 'Custom worker limit' : `${value} active workers`
}

export default function PricingPage() {
  return (
    <main style={pageStyle}>
      <section style={shellStyle}>
        <nav style={navStyle}>
          <Link href="/sign-in" style={brandLinkStyle}>
            Diriqo
          </Link>
          <div style={navActionsStyle}>
            <Link href="/sign-in" style={secondaryLinkStyle}>
              Sign in
            </Link>
            <Link href="/sign-up" style={primaryLinkStyle}>
              Start free
            </Link>
          </div>
        </nav>

        <header style={headerStyle}>
          <p style={eyebrowStyle}>Pricing</p>
          <h1 style={titleStyle}>Plans for service teams</h1>
          <p style={subtitleStyle}>
            Choose a worker limit that fits your team. Website setup is available as a separate add-on.
          </p>
        </header>

        <div style={plansGridStyle}>
          {mainPlans.map((plan) => (
            <article key={plan.key} style={plan.recommended ? recommendedCardStyle : cardStyle}>
              <div style={planHeaderStyle}>
                <h2 style={planTitleStyle}>{plan.name}</h2>
                {plan.recommended ? <span style={badgeStyle}>Recommended</span> : null}
              </div>
              <div style={priceStyle}>{formatMonthlyPrice(plan.priceMonthly)}</div>
              <p style={mutedStyle}>{formatWorkerLimit(plan.workerLimit)}</p>
            </article>
          ))}
        </div>

        {addOns.length > 0 ? (
          <section style={addOnSectionStyle}>
            <h2 style={sectionTitleStyle}>Add-ons</h2>
            <div style={plansGridStyle}>
              {addOns.map((plan) => (
                <article key={plan.key} style={cardStyle}>
                  <h3 style={planTitleStyle}>{plan.name}</h3>
                  <div style={priceStyle}>{formatSetupPrice(plan.setupPrice)}</div>
                  <p style={mutedStyle}>Optional website setup add-on.</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  )
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: '#f8fafc',
  color: '#111827',
  padding: '32px 16px',
  boxSizing: 'border-box',
}

const shellStyle: CSSProperties = {
  maxWidth: 1040,
  margin: '0 auto',
  display: 'grid',
  gap: 24,
}

const navStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 16,
}

const navActionsStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
}

const brandLinkStyle: CSSProperties = {
  color: '#111827',
  fontWeight: 900,
  fontSize: 22,
  textDecoration: 'none',
}

const headerStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  maxWidth: 720,
}

const eyebrowStyle: CSSProperties = {
  margin: 0,
  color: '#2563eb',
  fontSize: 13,
  fontWeight: 900,
  textTransform: 'uppercase',
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 44,
  lineHeight: 1.08,
}

const subtitleStyle: CSSProperties = {
  margin: 0,
  color: '#475569',
  fontSize: 17,
  lineHeight: 1.6,
}

const plansGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 14,
}

const cardStyle: CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  background: '#ffffff',
  padding: 20,
  display: 'grid',
  gap: 10,
}

const recommendedCardStyle: CSSProperties = {
  ...cardStyle,
  border: '1px solid #93c5fd',
  boxShadow: '0 12px 28px rgba(37, 99, 235, 0.12)',
}

const planHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
}

const planTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 22,
}

const priceStyle: CSSProperties = {
  fontSize: 26,
  fontWeight: 900,
}

const mutedStyle: CSSProperties = {
  margin: 0,
  color: '#475569',
  lineHeight: 1.5,
}

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 26,
  borderRadius: 8,
  background: '#eff6ff',
  color: '#1d4ed8',
  border: '1px solid #bfdbfe',
  padding: '4px 8px',
  fontSize: 12,
  fontWeight: 850,
}

const addOnSectionStyle: CSSProperties = {
  display: 'grid',
  gap: 14,
}

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 24,
}

const primaryLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 40,
  padding: '8px 14px',
  borderRadius: 8,
  background: '#111827',
  color: '#ffffff',
  textDecoration: 'none',
  fontWeight: 800,
}

const secondaryLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 40,
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#111827',
  textDecoration: 'none',
  fontWeight: 800,
}
