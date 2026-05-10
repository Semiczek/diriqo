export default function BillingLockedPage() {
  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        <h1 style={titleStyle}>P\u0159\u00edstup je do\u010dasn\u011b pozastaven\u00fd.</h1>
        <p style={textStyle}>Kontaktujte spr\u00e1vce firmy. Data z\u016fst\u00e1vaj\u00ed ulo\u017een\u00e1.</p>
      </section>
    </main>
  )
}

const pageStyle = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background: '#f8fafc',
  color: '#111827',
} as const

const cardStyle = {
  width: 'min(100%, 520px)',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  background: '#ffffff',
  padding: 24,
  textAlign: 'center',
  boxShadow: '0 18px 44px rgba(15, 23, 42, 0.08)',
} as const

const titleStyle = {
  margin: 0,
  fontSize: 28,
  lineHeight: 1.15,
} as const

const textStyle = {
  margin: '10px 0 0',
  color: '#64748b',
  fontSize: 16,
  lineHeight: 1.5,
} as const
