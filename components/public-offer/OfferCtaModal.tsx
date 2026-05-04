'use client'

import { type CSSProperties, type FormEvent } from 'react'
import type { CtaModalState } from '@/components/public-offer/types'

const inputStyle: CSSProperties = {
  width: '100%',
  borderRadius: '12px',
  border: '1px solid #cbd5e1',
  backgroundColor: '#ffffff',
  color: '#111827',
  fontSize: '16px',
  padding: '12px 14px',
  outline: 'none',
}

export default function OfferCtaModal({
  state,
  contactName,
  contactEmail,
  defaultCustomerName,
  defaultCustomerEmail,
  defaultCustomerPhone,
  submitError,
  submitLoading,
  onClose,
  onSubmit,
}: {
  state: CtaModalState
  contactName: string | null
  contactEmail: string | null
  defaultCustomerName?: string | null
  defaultCustomerEmail?: string | null
  defaultCustomerPhone?: string | null
  submitError: string | null
  submitLoading: boolean
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          borderRadius: '24px',
          border: '1px solid #dbe4f0',
          backgroundColor: '#ffffff',
          boxShadow: '0 24px 80px rgba(15, 23, 42, 0.22)',
          padding: '24px',
          display: 'grid',
          gap: '18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ display: 'grid', gap: '6px' }}>
            <h2 style={{ margin: 0, fontSize: '28px', lineHeight: 1.1 }}>{state.title}</h2>
            <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>{state.description}</p>
            {contactName || contactEmail ? (
              <div style={{ color: '#64748b', fontSize: '14px' }}>
                Kontakt k nabídce: <strong style={{ color: '#111827' }}>{contactName || contactEmail}</strong>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              backgroundColor: '#f3f4f6',
              color: '#111827',
              borderRadius: '999px',
              minWidth: '38px',
              minHeight: '38px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'grid', gap: '14px' }}>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              width: '1px',
              height: '1px',
              overflow: 'hidden',
              clip: 'rect(0 0 0 0)',
              clipPath: 'inset(50%)',
              whiteSpace: 'nowrap',
            }}
          >
            <label htmlFor="offer-website">Website</label>
            <input id="offer-website" name="website" tabIndex={-1} autoComplete="off" />
          </div>

          <div style={{ display: 'grid', gap: '6px' }}>
            <label htmlFor="offer-customer-name" style={{ fontWeight: 700 }}>
              Jméno
            </label>
            <input id="offer-customer-name" name="customerName" required defaultValue={defaultCustomerName ?? ''} style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gap: '6px' }}>
            <label htmlFor="offer-customer-email" style={{ fontWeight: 700 }}>
              E-mail
            </label>
            <input id="offer-customer-email" name="customerEmail" type="email" required defaultValue={defaultCustomerEmail ?? contactEmail ?? ''} style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gap: '6px' }}>
            <label htmlFor="offer-customer-phone" style={{ fontWeight: 700 }}>
              Telefon
            </label>
            <input id="offer-customer-phone" name="customerPhone" required defaultValue={defaultCustomerPhone ?? ''} style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gap: '6px' }}>
            <label htmlFor="offer-note" style={{ fontWeight: 700 }}>
              {state.noteLabel}
            </label>
            <textarea id="offer-note" name="note" rows={4} placeholder={state.notePlaceholder} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          {submitError ? (
            <div
              style={{
                borderRadius: '14px',
                border: '1px solid #fecaca',
                backgroundColor: '#fef2f2',
                color: '#991b1b',
                padding: '12px 14px',
              }}
            >
              {submitError}
            </div>
          ) : null}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '12px 16px',
                borderRadius: '12px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#111827',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Zrušit
            </button>
            <button
              type="submit"
              disabled={submitLoading}
              style={{
                padding: '12px 18px',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: '#111827',
                color: '#ffffff',
                fontWeight: 700,
                cursor: submitLoading ? 'default' : 'pointer',
                opacity: submitLoading ? 0.7 : 1,
              }}
            >
              {submitLoading ? 'Odesílám…' : state.submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
