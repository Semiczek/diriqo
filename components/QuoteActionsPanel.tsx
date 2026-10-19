'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useMemo, useState } from 'react'
import QuoteConversionDialog from './QuoteConversionDialog'
import {
  deleteQuoteAction,
  markQuoteSentAction,
  rejectQuoteAction,
  syncQuotePricingFromCalculationAction,
} from '@/app/business-actions'

function buttonStyle(backgroundColor: string, color: string, border: string, disabled: boolean) {
  return {
    border,
    backgroundColor,
    color,
    borderRadius: '10px',
    padding: '8px 10px',
    fontSize: '13px',
    fontWeight: 750,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    whiteSpace: 'nowrap' as const,
  }
}

type QuoteActionsPanelProps = {
  customerId: string | null
  quoteId: string
  companyId: string
  actorProfileId: string
  shareUrl?: string | null
  contactName?: string | null
  contactEmail?: string | null
  quoteTitle?: string | null
  sourceCalculationId?: string | null
  workDescription?: string | null
  proposedSolution?: string | null
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />')
}

export default function QuoteActionsPanel({
  customerId,
  quoteId,
  companyId,
  actorProfileId,
  shareUrl,
  contactName,
  contactEmail,
  quoteTitle,
  sourceCalculationId,
  workDescription,
  proposedSolution,
}: QuoteActionsPanelProps) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [copying, setCopying] = useState(false)
  const [syncingPricing, setSyncingPricing] = useState(false)
  const [sendingUpdate, setSendingUpdate] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [showCreateJobModal, setShowCreateJobModal] = useState(false)
  const [showSendOfferModal, setShowSendOfferModal] = useState(false)
  const [offerRecipientEmail, setOfferRecipientEmail] = useState(contactEmail?.trim() || '')
  const [offerRecipientName, setOfferRecipientName] = useState(contactName?.trim() || '')
  const [offerSubject, setOfferSubject] = useState(
    `Aktualizovaná cenová nabídka: ${quoteTitle?.trim() || 'Diriqo'}`,
  )
  const [offerMessage, setOfferMessage] = useState(() =>
    [
      `Dobrý den${contactName?.trim() ? ` ${contactName.trim()}` : ''},`,
      '',
      'zasíláme Vám aktualizovanou verzi cenové nabídky.',
      '',
      shareUrl ? `Odkaz na nabídku:\n${shareUrl}` : 'Odkaz na nabídku teď není dostupný.',
      '',
      'Pokud budete chtít cokoli upravit, dejte nám prosím vědět.',
      '',
      'S pozdravem',
      'Diriqo',
    ].join('\n'),
  )
  const createJobDisabledReason = useMemo(() => {
    if (!companyId) return 'Nabídka nemá dostupné company_id.'
    return undefined
  }, [companyId])

  const sendOfferDisabledReason = useMemo(() => {
    if (!shareUrl) return 'Pro odeslání nabídky chybí sdílený odkaz.'
    return undefined
  }, [shareUrl])

  async function handleCopyLink() {
    if (!shareUrl || copying) return

    try {
      setCopying(true)
      await navigator.clipboard.writeText(shareUrl)
      alert('Odkaz na online nabídku je zkopírovaný.')
    } catch {
      alert('Nepodařilo se zkopírovat odkaz. Zkuste ho prosím zkopírovat ručně.')
    } finally {
      setCopying(false)
    }
  }

  async function handleDelete() {
    if (deleting) return

    const confirmed = window.confirm('Opravdu chcete smazat tuto cenovou nabídku?')
    if (!confirmed) return

    setDeleting(true)

    try {
      const result = await deleteQuoteAction({ quoteId, customerId })
      if (!result.ok) throw new Error(result.error)

      router.replace(customerId ? `/customers/${customerId}/quotes` : '/cenove-nabidky')
      router.refresh()
      window.location.assign(customerId ? `/customers/${customerId}/quotes` : '/cenove-nabidky')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Nepodařilo se smazat cenovou nabídku.')
      setDeleting(false)
    }
  }

  async function handleSyncPricing() {
    if (!sourceCalculationId || syncingPricing) return

    setSyncingPricing(true)

    try {
      const result = await syncQuotePricingFromCalculationAction({
        quoteId,
        customerId,
        sourceCalculationId,
      })

      if (!result.ok) throw new Error(result.error)

      alert('Cenova kalkulace v nabidce byla aktualizovana podle posledni verze kalkulace.')
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Nepodařilo se aktualizovat cenovou kalkulaci.')
    } finally {
      setSyncingPricing(false)
    }
  }

  async function handleSendUpdatedOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sendingUpdate) return

    if (!shareUrl) {
      alert('Pro odeslání nabídky chybí sdílený odkaz.')
      return
    }

    const trimmedEmail = offerRecipientEmail.trim().toLowerCase()
    const trimmedSubject = offerSubject.trim()
    const trimmedMessage = offerMessage.trim()

    if (!trimmedEmail || !trimmedSubject || !trimmedMessage) {
      alert('Vyplňte prosím e-mail příjemce, předmět i zprávu.')
      return
    }

    setSendingUpdate(true)

    try {
      const response = await fetch('/api/mail/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          relatedEntityType: 'offer',
          relatedEntityId: quoteId,
          customerId: customerId ?? null,
          messageType: 'quote_update',
          toEmail: trimmedEmail,
          toName: offerRecipientName.trim() || null,
          subject: trimmedSubject,
          text: trimmedMessage,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(
            trimmedMessage,
          )}</div>`,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Nepodařilo se odeslat aktualizovanou nabídku.')
      }

      const updateResult = await markQuoteSentAction({ quoteId, customerId })
      if (!updateResult.ok) throw new Error(updateResult.error)

      window.dispatchEvent(
        new CustomEvent('diriqo:email-feed-refresh', {
          detail: {
            entityType: 'offer',
            entityId: quoteId,
            subject: trimmedSubject,
            email: trimmedEmail,
            preview: trimmedMessage,
          },
        }),
      )

      setShowSendOfferModal(false)
      alert('Aktualizovaná nabídka byla odeslaná z Hubu.')
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Nepodařilo se odeslat aktualizovanou nabídku.')
    } finally {
      setSendingUpdate(false)
    }
  }

  async function handleRejectQuote() {
    if (rejecting) return

    const confirmed = window.confirm('Opravdu chcete tuto cenovou nabídku označit jako "Nemá zájem"?')
    if (!confirmed) return

    setRejecting(true)

    try {
      const result = await rejectQuoteAction({ quoteId, customerId })
      if (!result.ok) throw new Error(result.error)

      alert('Nabídka byla označená jako "Nemá zájem".')
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Nepodařilo se změnit stav nabídky.')
    } finally {
      setRejecting(false)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
      {customerId ? (
        <Link
          href={`/customers/${customerId}/quotes/${quoteId}/edit`}
          style={{
            display: 'inline-block',
            backgroundColor: '#000000',
            color: '#ffffff',
            textDecoration: 'none',
            fontWeight: '700',
            fontSize: '13px',
            padding: '8px 10px',
            borderRadius: '10px',
            whiteSpace: 'nowrap',
          }}
        >
          Upravit nabídku
        </Link>
      ) : null}

      {shareUrl ? (
        <a
          href={shareUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-block',
            backgroundColor: '#eff6ff',
            color: '#1d4ed8',
            textDecoration: 'none',
            fontWeight: '700',
            fontSize: '13px',
            padding: '8px 10px',
            borderRadius: '10px',
            border: '1px solid #bfdbfe',
            whiteSpace: 'nowrap',
          }}
        >
          Otevřít online nabídku
        </a>
      ) : null}

      {shareUrl ? (
        <button type="button" onClick={handleCopyLink} disabled={copying} style={buttonStyle('#ffffff', '#111827', '1px solid #d1d5db', copying)}>
          {copying ? 'Kopíruji...' : 'Kopírovat odkaz'}
        </button>
      ) : null}

      <a
        href={`/api/quotes/${quoteId}/pdf`}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'inline-block',
          backgroundColor: '#ffffff',
          color: '#111827',
          textDecoration: 'none',
          fontWeight: '700',
          fontSize: '13px',
          padding: '8px 10px',
          borderRadius: '10px',
          border: '1px solid #d1d5db',
          whiteSpace: 'nowrap',
        }}
      >
        Stáhnout PDF
      </a>

      <button
        type="button"
        onClick={handleSyncPricing}
        disabled={!sourceCalculationId || syncingPricing}
        title={
          sourceCalculationId
            ? undefined
            : 'Tato nabídka nemá navázanou zdrojovou kalkulaci.'
        }
        style={buttonStyle('#eff6ff', '#1d4ed8', '1px solid #bfdbfe', !sourceCalculationId || syncingPricing)}
      >
        {syncingPricing ? 'Aktualizuji kalkulaci...' : 'Aktualizovat cenovou kalkulaci'}
      </button>

      <button
        type="button"
        onClick={() => setShowCreateJobModal(true)}
        disabled={Boolean(createJobDisabledReason)}
        title={createJobDisabledReason}
        style={buttonStyle('#eef2ff', '#4338ca', '1px solid #c7d2fe', Boolean(createJobDisabledReason))}
      >
        Vytvořit zakázku z nabídky
      </button>

      <button
        type="button"
        onClick={() => setShowSendOfferModal(true)}
        disabled={Boolean(sendOfferDisabledReason) || sendingUpdate}
        title={
          sendOfferDisabledReason
            ? sendOfferDisabledReason
            : undefined
        }
        style={buttonStyle('#ecfdf5', '#166534', '1px solid #bbf7d0', Boolean(sendOfferDisabledReason) || sendingUpdate)}
      >
        {sendingUpdate ? 'Odesílám...' : 'Odeslat aktualizovanou nabídku'}
      </button>

      <button
        type="button"
        onClick={handleRejectQuote}
        disabled={rejecting}
        style={buttonStyle('#fef2f2', '#991b1b', '1px solid #fecaca', rejecting)}
      >
        {rejecting ? 'Ukládám...' : 'Nemá zájem'}
      </button>

      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        style={buttonStyle('#fef2f2', '#991b1b', '1px solid #fecaca', deleting)}
      >
        {deleting ? 'Mažu...' : 'Smazat nabídku'}
      </button>
      </div>

      {showSendOfferModal ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 1000,
          }}
        >
          <form
            onSubmit={handleSendUpdatedOffer}
            style={{
              width: '100%',
              maxWidth: '720px',
              borderRadius: '18px',
              backgroundColor: '#ffffff',
              padding: '24px',
              boxShadow: '0 24px 64px rgba(15, 23, 42, 0.18)',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '24px' }}>Odeslat aktualizovanou nabídku</h3>
              <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>
                Email se odešle serverově z Hubu a odpověď se pak bude párovat přímo k této nabídce.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gap: '12px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>E-mail příjemce</span>
                <input
                  type="email"
                  value={offerRecipientEmail}
                  onChange={(event) => setOfferRecipientEmail(event.target.value)}
                  placeholder="zakaznik@firma.cz"
                  required
                  style={{
                    border: '1px solid #d1d5db',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    fontSize: '14px',
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Jméno příjemce</span>
                <input
                  type="text"
                  value={offerRecipientName}
                  onChange={(event) => setOfferRecipientName(event.target.value)}
                  placeholder="Jméno kontaktu"
                  style={{
                    border: '1px solid #d1d5db',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    fontSize: '14px',
                  }}
                />
              </label>
            </div>

            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Předmět</span>
              <input
                type="text"
                value={offerSubject}
                onChange={(event) => setOfferSubject(event.target.value)}
                required
                style={{
                  border: '1px solid #d1d5db',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  fontSize: '14px',
                }}
              />
            </label>

            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Zpráva</span>
              <textarea
                value={offerMessage}
                onChange={(event) => setOfferMessage(event.target.value)}
                rows={9}
                required
                style={{
                  border: '1px solid #d1d5db',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  fontSize: '14px',
                  resize: 'vertical',
                }}
              />
            </label>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ color: '#64748b', fontSize: '14px' }}>
                Odkaz na nabídku: {shareUrl ? shareUrl : 'není dostupný'}
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setShowSendOfferModal(false)}
                  disabled={sendingUpdate}
                  style={buttonStyle('#ffffff', '#111827', '1px solid #d1d5db', sendingUpdate)}
                >
                  Zavřít
                </button>
                <button
                  type="submit"
                  disabled={sendingUpdate}
                  style={buttonStyle('#111827', '#ffffff', '1px solid #111827', sendingUpdate)}
                >
                  {sendingUpdate ? 'Odesílám...' : 'Odeslat nabídku'}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {showCreateJobModal ? <QuoteConversionDialog
        companyId={companyId} actorProfileId={actorProfileId} quoteId={quoteId} customerId={customerId}
        quoteTitle={quoteTitle} description={workDescription?.trim() || proposedSolution?.trim() || ''}
        contactName={contactName} contactEmail={contactEmail} shareUrl={shareUrl}
        onClose={() => setShowCreateJobModal(false)} /> : null}
    </>
  )
}