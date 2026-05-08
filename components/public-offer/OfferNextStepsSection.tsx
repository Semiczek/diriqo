'use client'


export default function OfferNextStepsSection({
  onInterested,
  onRevision,
  onNotInterested,
  onContact,
}: {
  onInterested: () => void
  onRevision: () => void
  onNotInterested: () => void
  onContact: () => void
}) {
  return (
    <section
      style={{
        borderRadius: '26px',
        border: '1px solid rgba(124, 58, 237, 0.2)',
        background:
          'radial-gradient(circle at 0% 0%, rgba(217,70,239,0.12), transparent 34%), radial-gradient(circle at 100% 0%, rgba(6,182,212,0.14), transparent 34%), #ffffff',
        padding: '26px',
        boxShadow: '0 18px 52px rgba(15, 23, 42, 0.08)',
        display: 'grid',
        gap: '14px',
      }}
    >
      <div style={{ display: 'grid', gap: '6px' }}>
          <strong style={{ fontSize: '24px', color: '#08111f', lineHeight: 1.2 }}>
          Jak chcete pokračovat?
        </strong>
        <span style={{ color: '#475569', lineHeight: 1.6 }}>
          Vyberte další krok k realizaci nabídky
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '12px',
          alignItems: 'start',
        }}
      >
        <button
          type="button"
          onClick={onInterested}
          style={{
            padding: '15px 18px',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
            color: '#ffffff',
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
            minHeight: '50px',
            width: '100%',
            boxShadow: '0 16px 34px rgba(37, 99, 235, 0.24)',
          }}
        >
          Chci realizaci
        </button>

        <button
          type="button"
          onClick={onRevision}
          style={{
            padding: '15px 18px',
            borderRadius: '12px',
            border: '1px solid #d1d5db',
            backgroundColor: '#f8fafc',
            color: '#111827',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: '50px',
            width: '100%',
          }}
        >
          Chci upravit nabídku
        </button>

        <div
          style={{
            display: 'grid',
            gap: '8px',
            justifyItems: 'stretch',
          }}
        >
          <button
            type="button"
            onClick={onContact}
            style={{
              padding: '15px 18px',
              borderRadius: '12px',
              border: '1px solid #cbd5e1',
              backgroundColor: 'transparent',
              color: '#0f172a',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
              minHeight: '50px',
              width: '100%',
            }}
          >
            Mám dotaz
          </button>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onNotInterested}
              style={{
                padding: 0,
                border: 'none',
                backgroundColor: 'transparent',
                color: '#9CA3AF',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'right',
                width: 'fit-content',
                textDecoration: 'underline',
                textDecorationColor: 'transparent',
              }}
            >
              Nemám zájem
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
