'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useI18n } from '@/components/I18nProvider'
import { DEFAULT_QUOTE_BENEFITS_TEXT } from '@/lib/quote-benefits'
import { QuoteStatus } from '@/lib/quote-status'
import { supabase } from '@/lib/supabase'

type QuoteEditFormProps = {
  customerId: string
  quoteId: string
  initialValues: {
    title: string
    status: QuoteStatus
    quoteDate: string
    validUntil: string
    discountAmount: string
    shareToken: string
    contactName: string
    contactEmail: string
    introText: string
    customerRequestTitle: string
    customerNote: string
    internalNote: string
    customerRequest: string
    ourSolutionTitle: string
    proposedSolution: string
    benefitsText: string
    timelineTitle: string
    workDescription: string
    workSchedule: string
    pricingTitle: string
    pricingText: string
    paymentTermsTitle: string
    paymentTerms: string
    sentAt: string
    acceptedAt: string
    rejectedAt: string
  }
}

function buildShareToken() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export default function QuoteEditForm({ customerId, quoteId, initialValues }: QuoteEditFormProps) {
  const router = useRouter()
  const { dictionary } = useI18n()
  const [title, setTitle] = useState(initialValues.title)
  const [status, setStatus] = useState<QuoteStatus>(initialValues.status)
  const [quoteDate, setQuoteDate] = useState(initialValues.quoteDate)
  const [validUntil, setValidUntil] = useState(initialValues.validUntil)
  const [discountAmount, setDiscountAmount] = useState(initialValues.discountAmount)
  const [shareToken] = useState(initialValues.shareToken || buildShareToken())
  const [contactName, setContactName] = useState(initialValues.contactName)
  const [contactEmail, setContactEmail] = useState(initialValues.contactEmail)
  const [introText, setIntroText] = useState(initialValues.introText)
  const [customerRequestTitle, setCustomerRequestTitle] = useState(initialValues.customerRequestTitle)
  const [customerNote, setCustomerNote] = useState(initialValues.customerNote)
  const [internalNote, setInternalNote] = useState(initialValues.internalNote)
  const [customerRequest, setCustomerRequest] = useState(initialValues.customerRequest)
  const [ourSolutionTitle, setOurSolutionTitle] = useState(initialValues.ourSolutionTitle)
  const [proposedSolution, setProposedSolution] = useState(initialValues.proposedSolution)
  const [benefitsText, setBenefitsText] = useState(initialValues.benefitsText || DEFAULT_QUOTE_BENEFITS_TEXT)
  const [timelineTitle, setTimelineTitle] = useState(initialValues.timelineTitle)
  const [workDescription, setWorkDescription] = useState(initialValues.workDescription)
  const [workSchedule, setWorkSchedule] = useState(initialValues.workSchedule)
  const [pricingTitle, setPricingTitle] = useState(initialValues.pricingTitle)
  const [pricingText, setPricingText] = useState(initialValues.pricingText)
  const [paymentTermsTitle, setPaymentTermsTitle] = useState(initialValues.paymentTermsTitle)
  const [paymentTerms, setPaymentTerms] = useState(initialValues.paymentTerms)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return

    setSaving(true)
    setError(null)

    try {
      if (!title.trim()) {
        throw new Error(dictionary.customers.quoteForm.titleRequired)
      }

      const payload = {
        title: title.trim(),
        share_token: shareToken,
        status,
        quote_date: quoteDate || null,
        valid_until: validUntil || null,
        sent_at: status === 'sent' ? initialValues.sentAt || new Date().toISOString() : null,
        accepted_at: status === 'accepted' ? initialValues.acceptedAt || new Date().toISOString() : null,
        rejected_at: status === 'rejected' ? initialValues.rejectedAt || new Date().toISOString() : null,
      }

      const { error: updateError } = await supabase.from('quotes').update(payload).eq('id', quoteId)

      if (updateError) {
        throw new Error(updateError.message)
      }

      router.push(`/customers/${customerId}/quotes/${quoteId}`)
      router.refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : dictionary.customers.quoteForm.saveFailed)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '20px' }}>
      {error ? (
        <div style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#b91c1c', fontWeight: 600 }}>
          {error}
        </div>
      ) : null}

      <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', backgroundColor: '#ffffff', padding: '20px', display: 'grid', gap: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.quoteTitle}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.date}</span>
            <input type="date" value={quoteDate} onChange={(event) => setQuoteDate(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.validUntil}</span>
            <input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.status}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as QuoteStatus)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }}>
              <option value="draft">{dictionary.customers.quotesList.draft}</option>
              <option value="ready">{dictionary.customers.quotesList.ready}</option>
              <option value="sent">{dictionary.customers.quotesList.sent}</option>
              <option value="viewed">{dictionary.customers.quotesList.viewed}</option>
              <option value="waiting_followup">{dictionary.customers.quotesList.interested}</option>
              <option value="revision_requested">{dictionary.customers.quotesList.revisionRequested}</option>
              <option value="accepted">{dictionary.customers.quotesList.accepted}</option>
              <option value="rejected">{dictionary.customers.quotesList.rejected}</option>
              <option value="expired">{dictionary.customers.quotesList.expired}</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.discount}</span>
            <input value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>

          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.shareToken}</span>
            <input value={shareToken} readOnly style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#f8fafc' }} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.contactPerson}</span>
            <input value={contactName} onChange={(event) => setContactName(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>

          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.contactEmail}</span>
            <input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>
        </div>

        <label style={{ display: 'grid', gap: '8px' }}>
          <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.intro}</span>
          <textarea value={introText} onChange={(event) => setIntroText(event.target.value)} rows={4} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', resize: 'vertical' }} />
        </label>

        <label style={{ display: 'grid', gap: '8px' }}>
          <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.customerNote}</span>
          <textarea value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} rows={3} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', resize: 'vertical' }} />
        </label>

        <label style={{ display: 'grid', gap: '8px' }}>
          <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.internalNote}</span>
          <textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} rows={3} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', resize: 'vertical' }} />
        </label>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', backgroundColor: '#ffffff', padding: '20px', display: 'grid', gap: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '22px' }}>{dictionary.customers.quoteForm.structure}</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.customerRequestHeading}</span>
            <input value={customerRequestTitle} onChange={(event) => setCustomerRequestTitle(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.customerRequest}</span>
            <textarea value={customerRequest} onChange={(event) => setCustomerRequest(event.target.value)} rows={4} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', resize: 'vertical' }} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.solutionHeading}</span>
            <input value={ourSolutionTitle} onChange={(event) => setOurSolutionTitle(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.ourSolution}</span>
            <textarea value={proposedSolution} onChange={(event) => setProposedSolution(event.target.value)} rows={4} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', resize: 'vertical' }} />
          </label>
        </div>

        <label style={{ display: 'grid', gap: '8px' }}>
          <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.benefitsText}</span>
          <textarea value={benefitsText} onChange={(event) => setBenefitsText(event.target.value)} rows={5} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', resize: 'vertical' }} />
          <span style={{ color: '#64748b', fontSize: '13px' }}>{dictionary.customers.quoteForm.benefitsHelp}</span>
        </label>

        <label style={{ display: 'grid', gap: '8px' }}>
          <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.importantInfo}</span>
          <textarea value={workDescription} onChange={(event) => setWorkDescription(event.target.value)} rows={4} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', resize: 'vertical' }} />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.timelineHeading}</span>
            <input value={timelineTitle} onChange={(event) => setTimelineTitle(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.timeline}</span>
            <textarea value={workSchedule} onChange={(event) => setWorkSchedule(event.target.value)} rows={4} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', resize: 'vertical' }} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.pricingHeading}</span>
            <input value={pricingTitle} onChange={(event) => setPricingTitle(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.pricingText}</span>
            <textarea value={pricingText} onChange={(event) => setPricingText(event.target.value)} rows={4} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', resize: 'vertical' }} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.paymentTermsHeading}</span>
            <input value={paymentTermsTitle} onChange={(event) => setPaymentTermsTitle(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </label>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{dictionary.customers.quoteForm.paymentTerms}</span>
            <textarea value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} rows={3} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', resize: 'vertical' }} />
          </label>
        </div>
      </section>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button type="submit" disabled={saving} style={{ padding: '12px 16px', borderRadius: '12px', border: 'none', backgroundColor: '#000000', color: '#ffffff', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? dictionary.customers.quoteForm.saving : dictionary.customers.quoteForm.saveChanges}
        </button>

        <Link href={`/customers/${customerId}/quotes/${quoteId}`} style={{ padding: '12px 16px', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#ffffff', color: '#111827', fontWeight: 700, textDecoration: 'none' }}>
          {dictionary.customers.quoteForm.cancel}
        </Link>
      </div>
    </form>
  )
}
