'use client'

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import CtaButton from '@/components/public-offer/CtaButton'
import OfferAccordion from '@/components/public-offer/OfferAccordion'
import OfferCtaModal from '@/components/public-offer/OfferCtaModal'
import OfferNextStepsSection from '@/components/public-offer/OfferNextStepsSection'
import OfferPricingSection from '@/components/public-offer/OfferPricingSection'
import type {
  CtaActionType,
  CtaModalState,
  PublicOfferPageProps,
} from '@/components/public-offer/types'
import { getQuoteBenefits } from '@/lib/quote-benefits'
import {
  formatCurrency,
  getCtaModalState,
  getOrCreateVisitorId,
  hasText,
  postOfferEvent,
  submitOfferResponse,
} from '@/components/public-offer/utils'

export default function PublicOfferPage({
  token,
  context = 'public',
  title,
  customerName,
  defaultCustomerEmail,
  defaultCustomerPhone,
  validUntil,
  benefitsText,
  contactName,
  contactEmail,
  priceTotal,
  pricingTitle,
  pricingText,
  preparedByName,
  preparedAt,
  updatedAt,
  pdfHref,
  sections,
  items,
}: PublicOfferPageProps) {
  const visitorIdRef = useRef<string>('')
  const openedAtRef = useRef<number>(0)
  const seenSectionsRef = useRef<Set<string>>(new Set())
  const trackedActionKeysRef = useRef<Set<string>>(new Set())
  const modalOpenedAtRef = useRef<number>(0)
  const [ctaModal, setCtaModal] = useState<CtaModalState | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const visibleSections = useMemo(() => sections.filter((section) => hasText(section.content)), [sections])
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initialState: Record<string, boolean> = {}
    sections.forEach((section) => {
      initialState[section.key] = false
    })
    initialState.pricing = false
    return initialState
  })

  const showPricing = items.length > 0 || hasText(pricingText)
  const isPortal = context === 'portal'
  const sectionKeys = useMemo(() => {
    const keys = visibleSections.map((section) => section.key)
    if (showPricing) keys.push('pricing')
    return keys
  }, [showPricing, visibleSections])

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const registerSectionRef = (sectionKey: string, element: HTMLElement | null) => {
    sectionRefs.current[sectionKey] = element
  }

  const introSection = visibleSections.find((section) => section.key === 'intro')
  const requestSection = visibleSections.find((section) => section.key === 'customer_request')
  const solutionSection = visibleSections.find((section) => section.key === 'our_solution')
  const timelineSection = visibleSections.find((section) => section.key === 'timeline')
  const infoSection = visibleSections.find((section) => section.key === 'work_description')
  const paymentTermsSection = visibleSections.find((section) => section.key === 'payment_terms')

  const heroSummary =
    introSection?.content?.trim() ||
    solutionSection?.content?.trim() ||
    'Připravili jsme pro vás přehledné řešení s jasným rozsahem prací, termínem a cenou.'
  const contactLabel = contactName || contactEmail || 'Diriqo'
  const preparedByLabel = preparedByName?.trim() || contactLabel
  const keyBenefits = useMemo(() => getQuoteBenefits(benefitsText), [benefitsText])
  const formattedPreparedAt = useMemo(() => {
    if (!preparedAt) return null
    const date = new Date(preparedAt)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleString('cs-CZ')
  }, [preparedAt])
  const formattedUpdatedAt = useMemo(() => {
    if (!updatedAt) return null
    const date = new Date(updatedAt)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleString('cs-CZ')
  }, [updatedAt])

  useEffect(() => {
    openedAtRef.current = Date.now()
    visitorIdRef.current = isPortal ? token : getOrCreateVisitorId()
    if (isPortal) return

    void postOfferEvent({
      token,
      eventType: 'offer_opened',
      visitorId: visitorIdRef.current,
    })

    const handlePageHide = () => {
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - openedAtRef.current) / 1000))
      void postOfferEvent({
        token,
        eventType: 'offer_engaged',
        eventValue: String(elapsedSeconds),
        visitorId: visitorIdRef.current,
      })
    }

    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      handlePageHide()
    }
  }, [isPortal, token])

  useEffect(() => {
    if (isPortal) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const sectionKey = entry.target.getAttribute('data-section-key')
          if (!sectionKey || seenSectionsRef.current.has(sectionKey)) continue

          seenSectionsRef.current.add(sectionKey)
          void postOfferEvent({
            token,
            eventType: sectionKey === 'pricing' ? 'pricing_viewed' : 'section_viewed',
            sectionKey,
            visitorId: visitorIdRef.current,
          })
        }
      },
      { threshold: 0.45 },
    )

    sectionKeys.forEach((sectionKey) => {
      const element = sectionRefs.current[sectionKey]
      if (element) observer.observe(element)
    })

    return () => observer.disconnect()
  }, [isPortal, sectionKeys, token])

  function toggleSection(sectionKey: string) {
    setOpenSections((current) => {
      const nextValue = !current[sectionKey]
      if (nextValue && !trackedActionKeysRef.current.has(`expand:${sectionKey}`)) {
        trackedActionKeysRef.current.add(`expand:${sectionKey}`)
        if (!isPortal) {
          void postOfferEvent({
            token,
            eventType: sectionKey === 'pricing' ? 'pricing_viewed' : 'section_expanded',
            sectionKey,
            visitorId: visitorIdRef.current,
          })
        }
      }

      return {
        ...current,
        [sectionKey]: nextValue,
      }
    })
  }

  function trackCta(
    eventType: 'cta_interested' | 'cta_revision' | 'cta_contact' | 'cta_not_interested',
  ) {
    if (isPortal) {
      return
    }

    if (trackedActionKeysRef.current.has(eventType)) {
      return
    }

    trackedActionKeysRef.current.add(eventType)
    void postOfferEvent({
      token,
      eventType,
      visitorId: visitorIdRef.current,
    })
  }

  function openCtaModal(actionType: CtaActionType) {
    if (actionType === 'interested') trackCta('cta_interested')
    if (actionType === 'revision_requested') trackCta('cta_revision')
    if (actionType === 'contact_requested') trackCta('cta_contact')
    if (actionType === 'not_interested') trackCta('cta_not_interested')

    setSubmitError(null)
    setSuccessMessage(null)
    modalOpenedAtRef.current = Date.now()
    setCtaModal(getCtaModalState(actionType))
  }

  function handleOpenPricingDetail() {
    setOpenSections((current) => ({
      ...current,
      pricing: true,
    }))

    requestAnimationFrame(() => {
      const pricingSection = sectionRefs.current.pricing
      pricingSection?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  async function handleCtaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ctaModal) return

    const form = event.currentTarget
    const formData = new FormData(form)

    setSubmitLoading(true)
    setSubmitError(null)

    try {
      const payload = {
        token,
        actionType: ctaModal.actionType,
        customerName: String(formData.get('customerName') ?? '').trim(),
        customerEmail: String(formData.get('customerEmail') ?? '').trim(),
        customerPhone: String(formData.get('customerPhone') ?? '').trim(),
        note: String(formData.get('note') ?? '').trim(),
        visitorId: visitorIdRef.current,
        website: String(formData.get('website') ?? ''),
        openedAt: modalOpenedAtRef.current || Date.now(),
      }

      if (isPortal) {
        const response = await fetch('/api/portal/offers/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offerId: token,
            actionType: payload.actionType,
            note: payload.note,
          }),
        })
        const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || 'Reakci se nepodařilo uložit.')
        }
      } else {
        await submitOfferResponse(payload)
      }

      if (ctaModal.actionType === 'interested') {
        setSuccessMessage('Děkujeme, evidujeme váš zájem. Ozveme se vám co nejdříve.')
      } else if (ctaModal.actionType === 'revision_requested') {
        setSuccessMessage('Děkujeme, evidujeme váš požadavek na úpravu nabídky.')
      } else if (ctaModal.actionType === 'not_interested') {
        setSuccessMessage('Děkujeme za zprávu. Evidujeme, že o nabídku nyní nemáte zájem.')
      } else {
        setSuccessMessage('Děkujeme, zprávu jsme přijali a ozveme se vám.')
      }

      setCtaModal(null)
      form.reset()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Reakci se nepodarilo ulozit.')
    } finally {
      setSubmitLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at top left, rgba(191, 219, 254, 0.55), transparent 34%), linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)',
        padding: '32px 16px 56px',
        color: '#111827',
      }}
    >
      <main style={{ maxWidth: '1020px', margin: '0 auto', display: 'grid', gap: '20px' }}>
        <section
          style={{
            borderRadius: '28px',
            border: '1px solid #dbe4f0',
            backgroundColor: '#ffffff',
            padding: '28px',
            boxShadow: '0 20px 60px rgba(15, 23, 42, 0.08)',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '0 auto auto 0',
              width: '220px',
              height: '220px',
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(37, 99, 235, 0.1))',
              borderBottomRightRadius: '999px',
              pointerEvents: 'none',
            }}
          />

          <div style={{ position: 'relative', display: 'grid', gap: '24px' }}>
            <div style={{ display: 'grid', gap: '12px' }}>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#475569',
                }}
              >
                Online cenová nabídka
              </div>

              <h1 style={{ margin: 0, fontSize: 'clamp(32px, 5vw, 56px)', lineHeight: 1.02 }}>{title}</h1>

              <div style={{ color: '#475569', fontSize: '18px', fontWeight: 600 }}>
                {customerName || 'Řešení připravené na míru'}
              </div>

              <div style={{ maxWidth: '720px', color: '#334155', fontSize: '18px', lineHeight: 1.65 }}>{heroSummary}</div>

              {successMessage ? (
                <div
                  style={{
                    maxWidth: '720px',
                    borderRadius: '14px',
                    border: '1px solid #bbf7d0',
                    backgroundColor: '#f0fdf4',
                    color: '#166534',
                    padding: '14px 16px',
                    fontWeight: 600,
                  }}
                >
                  {successMessage}
                </div>
              ) : null}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '18px',
              }}
            >
              <div
                style={{
                  borderRadius: '22px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  padding: '20px',
                  display: 'grid',
                  gap: '12px',
                }}
              >
                <div style={{ fontSize: '16px', fontWeight: 800 }}>Hlavní přínosy nabídky</div>
                <div style={{ display: 'grid', gap: '10px' }}>
                  {keyBenefits.map((benefit) => (
                    <div
                      key={benefit}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        color: '#334155',
                        lineHeight: 1.55,
                      }}
                    >
                      <span style={{ color: '#166534', fontWeight: 900 }}>•</span>
                      <span>{benefit}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '6px', color: '#64748b', fontSize: '14px' }}>
                  Kontakt pro tuto nabídku: <strong style={{ color: '#111827' }}>{contactLabel}</strong>
                </div>
              </div>

              <div
                style={{
                  borderRadius: '22px',
                  backgroundColor: '#111827',
                  color: '#ffffff',
                  padding: '20px',
                  display: 'grid',
                  gap: '14px',
                  alignContent: 'start',
                }}
              >
                <div>
                  <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', marginBottom: '6px' }}>Cena celkem</div>
                  <div style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800 }}>{formatCurrency(priceTotal)}</div>
                </div>

                {timelineSection?.content ? (
                  <div>
                    <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', marginBottom: '6px' }}>Termín / harmonogram</div>
                    <div style={{ lineHeight: 1.55 }}>{timelineSection.content}</div>
                  </div>
                ) : null}

                <div>
                  <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', marginBottom: '6px' }}>Platnost nabídky</div>
                  <div style={{ fontWeight: 700 }}>
                    {validUntil ? new Date(validUntil).toLocaleDateString('cs-CZ') : 'Bez omezení'}
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '12px', marginTop: '4px', justifyItems: 'start', width: '100%' }}>
                  <CtaButton onClick={handleOpenPricingDetail} label="Detail cenové nabídky" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {requestSection ? (
          <OfferAccordion
            title={requestSection.title}
            sectionKey={requestSection.key}
            content={requestSection.content!}
            isOpen={openSections[requestSection.key] ?? false}
            onToggle={toggleSection}
            registerSectionRef={registerSectionRef}
          />
        ) : null}

        {solutionSection ? (
          <OfferAccordion
            title={solutionSection.title}
            sectionKey={solutionSection.key}
            content={solutionSection.content!}
            isOpen={openSections[solutionSection.key] ?? false}
            onToggle={toggleSection}
            registerSectionRef={registerSectionRef}
          />
        ) : null}

        {infoSection ? (
          <OfferAccordion
            title={infoSection.title}
            sectionKey={infoSection.key}
            content={infoSection.content!}
            tone="highlight"
            isOpen={openSections[infoSection.key] ?? false}
            onToggle={toggleSection}
            registerSectionRef={registerSectionRef}
          />
        ) : null}

        {timelineSection ? (
          <OfferAccordion
            title={timelineSection.title}
            sectionKey={timelineSection.key}
            content={timelineSection.content!}
            isOpen={openSections[timelineSection.key] ?? false}
            onToggle={toggleSection}
            registerSectionRef={registerSectionRef}
          />
        ) : null}

        {showPricing ? (
          <OfferPricingSection
            pricingTitle={pricingTitle}
            priceTotal={priceTotal}
            pricingText={pricingText}
            items={items}
            isOpen={openSections.pricing ?? false}
            onToggle={toggleSection}
            registerSectionRef={registerSectionRef}
          />
        ) : null}

        {paymentTermsSection ? (
          <OfferAccordion
            title={paymentTermsSection.title}
            sectionKey={paymentTermsSection.key}
            content={paymentTermsSection.content!}
            isOpen={openSections[paymentTermsSection.key] ?? false}
            onToggle={toggleSection}
            registerSectionRef={registerSectionRef}
          />
        ) : null}

        <OfferNextStepsSection
          onInterested={() => openCtaModal('interested')}
          onRevision={() => openCtaModal('revision_requested')}
          onContact={() => openCtaModal('contact_requested')}
          onNotInterested={() => openCtaModal('not_interested')}
        />

        {(preparedByLabel || formattedPreparedAt || formattedUpdatedAt) ? (
          <section
            style={{
              borderRadius: '22px',
              border: '1px solid #dbe4f0',
              backgroundColor: '#ffffff',
              padding: '20px 24px',
              boxShadow: '0 12px 36px rgba(15, 23, 42, 0.05)',
              display: 'grid',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b' }}>
              Zpracování nabídky
            </div>
            <div style={{ color: '#0f172a', lineHeight: 1.7 }}>
              <strong>Vypracoval/a:</strong> {preparedByLabel}
            </div>
            {formattedPreparedAt ? (
              <div style={{ color: '#334155', lineHeight: 1.7 }}>
                <strong>Vytvořeno:</strong> {formattedPreparedAt}
              </div>
            ) : null}
            {formattedUpdatedAt ? (
              <div style={{ color: '#334155', lineHeight: 1.7 }}>
                <strong>Poslední aktualizace:</strong> {formattedUpdatedAt}
              </div>
            ) : null}
            {pdfHref ? (
            <div style={{ marginTop: '10px' }}>
              <a
                href={pdfHref}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '12px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  padding: '10px 14px',
                  textDecoration: 'none',
                  fontWeight: 800,
                  fontSize: '14px',
                }}
              >
                Stáhnout nabídku v PDF
              </a>
            </div>
            ) : null}
          </section>
        ) : null}
      </main>

      {ctaModal ? (
        <OfferCtaModal
          state={ctaModal}
          contactName={contactName}
          contactEmail={contactEmail}
          defaultCustomerName={customerName}
          defaultCustomerEmail={defaultCustomerEmail}
          defaultCustomerPhone={defaultCustomerPhone}
          submitError={submitError}
          submitLoading={submitLoading}
          onClose={() => {
            setCtaModal(null)
            setSubmitError(null)
          }}
          onSubmit={handleCtaSubmit}
        />
      ) : null}
    </div>
  )
}
