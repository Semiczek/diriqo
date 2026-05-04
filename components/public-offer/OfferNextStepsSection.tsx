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
        borderRadius: '22px',
        border: '1px solid #dbe4f0',
        backgroundColor: '#ffffff',
        padding: '24px',
        boxShadow: '0 12px 36px rgba(15, 23, 42, 0.05)',
        display: 'grid',
        gap: '14px',
      }}
    >
      <div style={{ display: 'grid', gap: '6px' }}>
        <strong style={{ fontSize: '22px', color: '#111827', lineHeight: 1.2 }}>
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
            border: '1px solid #0B1B2B',
            backgroundColor: '#0B1B2B',
            color: '#ffffff',
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
            minHeight: '50px',
            width: '100%',
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
