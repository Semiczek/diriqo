'use client'

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Image from 'next/image'
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
import { offerResponseKey, restoreOfferResponse, saveOfferResponse, type PendingOfferResponse } from '@/components/public-offer/response-state'
import { parsePublicOfferResponseContact, MAX_NOTE_LENGTH } from '@/lib/public-offer-security'
import { getQuoteBenefits } from '@/lib/quote-benefits'
import {
  formatCurrency,
  getCtaModalState,
  getOrCreateVisitorId,
  hasText,
  postOfferEvent,
} from '@/components/public-offer/utils'

function normalizePublicLogoUrl(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return url.toString()
    }
  } catch {
    return null
  }

  return null
}

export default function PublicOfferPage(props: PublicOfferPageProps) {
  return <PublicOfferContent key={`${props.context || 'public'}:${props.responseActorId || 'anonymous'}:${props.token}:${props.versionId || 'legacy'}`} {...props} />
}

function PublicOfferContent({
  token,
  context = 'public',
  responseActorId = null, versionId = null, versionNumber = null, canRespond = false,
  currency = null, pricingMode = null, subtotal = null, discount = null,
  title,
  customerName,
  defaultCustomerEmail,
  defaultCustomerPhone,
  validUntil,
  benefitsText,
  contactName,
  contactEmail,
  companyName,
  companyLogoUrl,
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
  const responseBusy = useRef(false)
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener('storage', notify)
    window.addEventListener('diriqo-offer-response-change', notify)
    return () => { window.removeEventListener('storage', notify); window.removeEventListener('diriqo-offer-response-change', notify) }
  }, [])
  const storedResponse = useSyncExternalStore(subscribe, useCallback(() => {
    if (!versionId) return null
    try { return sessionStorage.getItem(offerResponseKey(context, token, versionId, responseActorId)) }
    catch { return 'storage-unavailable' }
  }, [context, token, versionId, responseActorId]), () => null)
  const restored = useMemo(() => {
    if (!versionId) return { pending: null, error: null }
    try { return { pending: restoreOfferResponse(storedResponse, context, token, versionId, responseActorId), error: null } }
    catch (error) { return { pending: null, error: error instanceof Error ? error.message : 'Uložený požadavek nelze ověřit.' } }
  }, [storedResponse, context, token, versionId, responseActorId])
  const pendingResponse = restored.pending
  const responseStorageError = restored.error
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
  const customerNoteSection = visibleSections.find(section => section.key === 'customer_note')
  const paymentTermsSection = visibleSections.find((section) => section.key === 'payment_terms')

  const heroSummary =
    introSection?.content?.trim() ||
    solutionSection?.content?.trim() ||
    'Připravili jsme pro vás přehledné řešení s jasným rozsahem prací, termínem a cenou.'
  const contactLabel = contactName || contactEmail || 'Diriqo'
  const preparedByLabel = preparedByName?.trim() || contactLabel
  const brandLogoUrl = useMemo(() => normalizePublicLogoUrl(companyLogoUrl), [companyLogoUrl])
  const brandLabel = companyName?.trim() || 'Diriqo'
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
    if (!versionId || !canRespond || pendingResponse || responseStorageError || responseBusy.current) return
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

  async function sendResponse(payload: PendingOfferResponse) {
    if (responseBusy.current || payload.token !== token || payload.versionId !== versionId || payload.context !== context || payload.actorId !== responseActorId) return
    responseBusy.current = true
    setSubmitLoading(true)
    setSubmitError(null)
    try {
      const response = await fetch(payload.context === 'portal' ? '/api/portal/offers/respond' : '/api/offers/respond', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.context === 'portal'
          ? { actorId: payload.actorId, offerId: payload.token, versionId: payload.versionId, operationId: payload.operationId, actionType: payload.actionType, note: payload.note }
          : payload),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok || data.versionId !== payload.versionId || data.operationId !== payload.operationId) {
        throw new Error(data?.error || 'Výsledek reakce se nepodařilo potvrdit. Opakujte uložený požadavek.')
      }
      sessionStorage.removeItem(offerResponseKey(payload.context, payload.token, payload.versionId, payload.actorId))
      window.dispatchEvent(new Event('diriqo-offer-response-change'))
      setSuccessMessage(payload.actionType === 'interested' ? 'Děkujeme, evidujeme váš zájem. Ozveme se vám co nejdříve.'
        : payload.actionType === 'revision_requested' ? 'Děkujeme, evidujeme váš požadavek na úpravu této verze nabídky.'
        : payload.actionType === 'not_interested' ? 'Děkujeme za zprávu. Evidujeme, že o tuto nabídku nyní nemáte zájem.'
        : 'Děkujeme, zprávu jsme přijali a ozveme se vám.')
    } catch (error) { setSubmitError(error instanceof Error ? error.message : 'Výsledek reakce není potvrzený.') }
    finally { responseBusy.current = false; setSubmitLoading(false) }
  }

  async function handleCtaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if ((isPortal && !responseActorId) || !ctaModal || !versionId || pendingResponse || responseBusy.current || responseStorageError) return
    const formData = new FormData(event.currentTarget)
    const payload: PendingOfferResponse = {
      token, context, actorId: responseActorId, versionId, operationId: crypto.randomUUID(), actionType: ctaModal.actionType,
      customerName: String(formData.get('customerName') ?? '').trim(),
      customerEmail: String(formData.get('customerEmail') ?? '').trim(),
      customerPhone: String(formData.get('customerPhone') ?? '').trim(),
      note: String(formData.get('note') ?? '').trim(), visitorId: visitorIdRef.current,
      website: String(formData.get('website') ?? ''), openedAt: modalOpenedAtRef.current || Date.now(),
    }
    try {
      if (isPortal) {
        if (payload.note.length > MAX_NOTE_LENGTH) throw new Error('Poznámka může mít nejvýše 2 000 znaků.')
      } else Object.assign(payload, parsePublicOfferResponseContact(payload))
    } catch (error) { setSubmitError(error instanceof Error ? error.message : 'Zkontrolujte údaje.'); return }
    try { saveOfferResponse(sessionStorage, payload) }
    catch { setSubmitError('Požadavek nelze bezpečně uložit. Povolte úložiště tohoto panelu a zkuste to znovu.'); return }
    window.dispatchEvent(new Event('diriqo-offer-response-change'))
    setCtaModal(null)
    await sendResponse(payload)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at 12% 0%, rgba(217, 70, 239, 0.18), transparent 34%), radial-gradient(circle at 86% 8%, rgba(6, 182, 212, 0.22), transparent 32%), linear-gradient(180deg, #f8fbff 0%, #eef4ff 48%, #f8fafc 100%)',
        padding: '28px 16px 56px',
        color: '#111827',
      }}
    >
      <main style={{ maxWidth: '1080px', margin: '0 auto', display: 'grid', gap: '22px' }}>
        <section
          style={{
            borderRadius: '32px',
            border: '1px solid rgba(124, 58, 237, 0.2)',
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.92) 58%, rgba(236,254,255,0.96) 100%)',
            padding: '0',
            boxShadow: '0 24px 70px rgba(15, 23, 42, 0.12)',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '-120px auto auto -90px',
              width: '380px',
              height: '380px',
              background: 'radial-gradient(circle, rgba(217, 70, 239, 0.28), rgba(37, 99, 235, 0.16) 48%, transparent 70%)',
              borderRadius: '999px',
              filter: 'blur(2px)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 'auto -120px -140px auto',
              width: '420px',
              height: '420px',
              background: 'radial-gradient(circle, rgba(34, 211, 238, 0.28), rgba(59, 130, 246, 0.12) 46%, transparent 72%)',
              borderRadius: '999px',
              pointerEvents: 'none',
            }}
          />

          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '18px',
              padding: '22px 28px',
              background:
                'linear-gradient(90deg, rgba(4, 9, 28, 0.96), rgba(15, 23, 42, 0.9) 52%, rgba(8, 47, 73, 0.86))',
              borderBottom: '1px solid rgba(255,255,255,0.12)',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                minWidth: 0,
                flex: '1 1 460px',
                flexWrap: 'wrap',
              }}
            >
              {brandLogoUrl ? (
                <div
                  style={{
                    minHeight: '76px',
                    maxWidth: '280px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '18px',
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(255,255,255,0.96)',
                    padding: '10px 14px',
                    boxShadow: '0 18px 36px rgba(15, 23, 42, 0.22)',
                    flex: '0 1 auto',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={brandLogoUrl}
                    alt={brandLabel}
                    style={{
                      display: 'block',
                      maxWidth: '252px',
                      maxHeight: '56px',
                      width: 'auto',
                      height: 'auto',
                      objectFit: 'contain',
                    }}
                  />
                </div>
              ) : (
                <div
                  style={{
                    minHeight: '76px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '6px 0',
                    flex: '0 0 auto',
                    filter: 'drop-shadow(0 16px 30px rgba(34, 211, 238, 0.22))',
                  }}
                >
                  <Image
                    src="/diriqo-logo-icon.png"
                    alt=""
                    width={46}
                    height={46}
                    priority
                    sizes="46px"
                    style={{ objectFit: 'contain' }}
                  />
                  <span
                    style={{
                      color: '#ffffff',
                      fontSize: '24px',
                      fontWeight: 900,
                      letterSpacing: 0,
                      lineHeight: 1,
                    }}
                  >
                    {'diriqo'}
                  </span>
                </div>
              )}
              <div
                style={{
                  display: 'grid',
                  gap: '5px',
                  minWidth: 0,
                  color: '#ffffff',
                }}
              >
                <span
                  style={{
                    color: 'rgba(224, 242, 254, 0.78)',
                    fontSize: '12px',
                    fontWeight: 850,
                    letterSpacing: '0.08em',
                    lineHeight: 1.2,
                    textTransform: 'uppercase',
                  }}
                >
                  Nabídka je od firmy
                </span>
                <strong
                  style={{
                    color: '#ffffff',
                    fontSize: 'clamp(18px, 2.2vw, 24px)',
                    fontWeight: 950,
                    lineHeight: 1.15,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {brandLabel}
                </strong>
              </div>
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
                color: '#e0f2fe',
                fontSize: '13px',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '999px',
                  background: 'linear-gradient(135deg, #d946ef, #06b6d4)',
                  boxShadow: '0 0 18px rgba(34, 211, 238, 0.9)',
                }}
              />
              Online nabídka
            </div>
          </div>

          <div style={{ position: 'relative', display: 'grid', gap: '26px', padding: '32px 34px 34px' }}>
            <div style={{ display: 'grid', gap: '12px' }}>
              <div
                style={{
                  width: 'fit-content',
                  borderRadius: '999px',
                  border: '1px solid rgba(124, 58, 237, 0.24)',
                  background: 'linear-gradient(135deg, rgba(250, 245, 255, 0.95), rgba(236, 254, 255, 0.95))',
                  padding: '8px 13px',
                  fontSize: '12px',
                  fontWeight: 900,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: '#5b21b6',
                }}
              >
                Online cenová nabídka
              </div>

              <h1
                style={{
                  margin: 0,
                  maxWidth: '880px',
                  fontSize: 'clamp(38px, 6vw, 68px)',
                  lineHeight: 0.98,
                  color: '#08111f',
                  fontWeight: 900,
                }}
              >
                {title}
              </h1>

              <div style={{ color: '#334155', fontSize: '19px', fontWeight: 800 }}>
                {customerName || 'Řešení připravené na míru'}
              </div>

              <div style={{ maxWidth: '760px', color: '#475569', fontSize: '18px', lineHeight: 1.65 }}>{heroSummary}</div>

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
                  borderRadius: '24px',
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.94))',
                  border: '1px solid rgba(203, 213, 225, 0.9)',
                  padding: '22px',
                  display: 'grid',
                  gap: '12px',
                  boxShadow: '0 16px 44px rgba(15, 23, 42, 0.06)',
                }}
              >
                <div style={{ fontSize: '17px', fontWeight: 900, color: '#0f172a' }}>Hlavní přínosy nabídky</div>
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
                      <span style={{ color: '#06b6d4', fontWeight: 900 }}>•</span>
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
                  borderRadius: '26px',
                  background:
                    'radial-gradient(circle at 22% 0%, rgba(217,70,239,0.28), transparent 34%), radial-gradient(circle at 100% 0%, rgba(6,182,212,0.28), transparent 38%), linear-gradient(135deg, #070b1a 0%, #101827 62%, #06243a 100%)',
                  color: '#ffffff',
                  padding: '24px',
                  display: 'grid',
                  gap: '14px',
                  alignContent: 'start',
                  border: '1px solid rgba(255,255,255,0.12)',
                  boxShadow: '0 22px 58px rgba(15, 23, 42, 0.22), inset 0 1px 0 rgba(255,255,255,0.12)',
                }}
              >
                <div>
                  <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', marginBottom: '6px' }}>Cena celkem</div>
                  <div style={{ fontSize: 'clamp(34px, 5vw, 52px)', fontWeight: 900 }}>{formatCurrency(priceTotal, currency)}</div>
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
                  <CtaButton onClick={handleOpenPricingDetail} label="Detail cenové nabídky" primary />
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
            currency={currency} pricingMode={pricingMode} subtotal={subtotal} discount={discount}
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

        {customerNoteSection ? <OfferAccordion title={customerNoteSection.title} sectionKey={customerNoteSection.key}
          content={customerNoteSection.content!} isOpen={openSections[customerNoteSection.key] ?? false}
          onToggle={toggleSection} registerSectionRef={registerSectionRef} /> : null}
        <p style={{ color: '#475569' }}>{versionNumber ? `Vydaná verze ${versionNumber}` : 'Starší nabídka - původní verze není doložena'} · {pricingMode === 'net' ? 'Ceny bez DPH' : 'Cenový režim není doložen'} · Měna: {currency || 'nedoložena'}</p>
        {responseStorageError ? <p role="alert">{responseStorageError}</p> : null}
        {pendingResponse ? <section style={{ background: '#f5f3ff', padding: 20, borderRadius: 12 }} aria-live="polite">
          <p>Uložená reakce čeká na potvrzení. Opakování použije stejný požadavek.</p>
          {submitError ? <p role="alert">{submitError}</p> : null}
          <button disabled={submitLoading} onClick={() => void sendResponse(pendingResponse)}>{submitLoading ? 'Ověřuji…' : 'Ověřit uloženou reakci'}</button>
        </section> : null}
        {canRespond && versionId && !pendingResponse && !responseStorageError ? <OfferNextStepsSection
          onInterested={() => openCtaModal('interested')}
          onRevision={() => openCtaModal('revision_requested')}
          onContact={() => openCtaModal('contact_requested')}
          onNotInterested={() => openCtaModal('not_interested')}
        /> : <p role="status">Reakce k této verzi už nejsou dostupné. V případě dotazu kontaktujte dodavatele.</p>}

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
