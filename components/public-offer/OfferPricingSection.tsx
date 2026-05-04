'use client'

import type { OfferItem } from '@/components/public-offer/types'
import { formatCurrency, hasText } from '@/components/public-offer/utils'

export default function OfferPricingSection({
  pricingTitle,
  pricingText,
  items,
  priceTotal,
  isOpen,
  onToggle,
  registerSectionRef,
}: {
  pricingTitle: string
  pricingText: string | null
  items: OfferItem[]
  priceTotal: number | null
  isOpen: boolean
  onToggle: (sectionKey: string) => void
  registerSectionRef: (sectionKey: string, element: HTMLElement | null) => void
}) {
  return (
    <section
      id="pricing"
      ref={(element) => {
        registerSectionRef('pricing', element)
      }}
      data-section-key="pricing"
      style={{
        borderRadius: '24px',
        border: '1px solid #bfdbfe',
        backgroundColor: '#ffffff',
        boxShadow: '0 18px 44px rgba(37, 99, 235, 0.08)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => onToggle('pricing')}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          padding: '20px 22px',
          border: 'none',
          backgroundColor: '#eff6ff',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '24px', fontWeight: 800 }}>{pricingTitle}</span>
        <span style={{ color: '#1d4ed8', fontWeight: 700 }}>{isOpen ? 'Sbalit' : 'Rozbalit'}</span>
      </button>

      {isOpen ? (
        <div style={{ padding: '0 22px 22px', display: 'grid', gap: '16px' }}>
          <div
            style={{
              marginTop: '18px',
              padding: '18px 20px',
              borderRadius: '18px',
              backgroundColor: '#111827',
              color: '#ffffff',
              display: 'flex',
              justifyContent: 'space-between',
              gap: '16px',
              flexWrap: 'wrap',
              alignItems: 'end',
            }}
          >
            <div>
              <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: '13px', marginBottom: '6px' }}>Finální cena nabídky</div>
              <div style={{ fontSize: 'clamp(30px, 4vw, 42px)', fontWeight: 800 }}>{formatCurrency(priceTotal)}</div>
            </div>
            <div style={{ color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, maxWidth: '420px' }}>
              {hasText(pricingText) ? pricingText : 'Cena vychází z rozsahu prací uvedeného v této nabídce.'}
            </div>
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            {items.map((item) => (
              <div
                key={item.id}
                style={{
                  borderRadius: '16px',
                  border: '1px solid #dbeafe',
                  backgroundColor: '#f8fafc',
                  padding: '16px',
                  display: 'grid',
                  gap: '10px',
                }}
              >
                <div style={{ fontSize: '18px', fontWeight: 700 }}>{item.name}</div>
                {item.description ? <div style={{ color: '#475569' }}>{item.description}</div> : null}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                  <div>
                    <strong>Množství:</strong> {Number(item.quantity ?? 0)}
                  </div>
                  <div>
                    <strong>Jednotka:</strong> {item.unit || '—'}
                  </div>
                  <div>
                    <strong>Cena/j.:</strong> {formatCurrency(item.unitPrice)}
                  </div>
                  <div>
                    <strong>Cena celkem:</strong> {formatCurrency(item.totalPrice)}
                  </div>
                </div>
                {item.note ? (
                  <div>
                    <strong>Poznámka:</strong> {item.note}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
