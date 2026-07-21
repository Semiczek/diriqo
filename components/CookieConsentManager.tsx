'use client'

import { Analytics } from '@vercel/analytics/next'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { useI18n } from '@/components/I18nProvider'

type CookieConsent = {
  version: string
  analytics: boolean
  decidedAt: string
}

const CONSENT_COOKIE_NAME = 'diriqo_cookie_consent'
const CONSENT_VERSION = '2026.07.21'
const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180

const copy = {
  cs: {
    title: 'Nastavení cookies',
    body:
      'Používáme nezbytné cookies pro přihlášení, bezpečnost a fungování aplikace. Analytiku návštěv spustíme jen s vaším souhlasem.',
    essentialTitle: 'Nezbytné cookies',
    essentialBody: 'Vždy aktivní. Zajišťují přihlášení, bezpečnost, jazyk a základní provoz Diriqo.',
    analyticsTitle: 'Analytika návštěv',
    analyticsBody:
      'Pomáhá nám měřit návštěvnost a používané stránky přes Vercel Web Analytics. Neposíláme e-mail, jméno ani obsah firemních dat.',
    alwaysOn: 'Vždy aktivní',
    acceptAll: 'Přijmout vše',
    rejectOptional: 'Odmítnout volitelné',
    customize: 'Nastavit',
    save: 'Uložit nastavení',
    close: 'Zavřít',
    privacy: 'Soukromí',
    cookies: 'Cookies',
    manage: 'Cookies',
    dnt:
      'Prohlížeč posílá Do Not Track. Analytika zůstane vypnutá, dokud je tato volba aktivní.',
  },
  en: {
    title: 'Cookie Settings',
    body:
      'We use essential cookies for sign-in, security, and app functionality. Visitor analytics runs only with your consent.',
    essentialTitle: 'Essential Cookies',
    essentialBody: 'Always active. They support sign-in, security, language, and core Diriqo operation.',
    analyticsTitle: 'Visitor Analytics',
    analyticsBody:
      'Helps us measure traffic and viewed pages through Vercel Web Analytics. We do not send email, name, or company data content.',
    alwaysOn: 'Always active',
    acceptAll: 'Accept all',
    rejectOptional: 'Reject optional',
    customize: 'Customize',
    save: 'Save settings',
    close: 'Close',
    privacy: 'Privacy',
    cookies: 'Cookies',
    manage: 'Cookies',
    dnt:
      'Your browser sends Do Not Track. Analytics will stay disabled while that preference is active.',
  },
  de: {
    title: 'Cookie-Einstellungen',
    body:
      'Wir verwenden notwendige Cookies für Anmeldung, Sicherheit und App-Funktionen. Besucheranalysen starten nur mit Ihrer Zustimmung.',
    essentialTitle: 'Notwendige Cookies',
    essentialBody: 'Immer aktiv. Sie ermöglichen Anmeldung, Sicherheit, Sprache und den grundlegenden Betrieb von Diriqo.',
    analyticsTitle: 'Besucheranalyse',
    analyticsBody:
      'Hilft uns, Besuche und aufgerufene Seiten mit Vercel Web Analytics zu messen. Wir senden keine E-Mail, keinen Namen und keine Firmendateninhalte.',
    alwaysOn: 'Immer aktiv',
    acceptAll: 'Alle akzeptieren',
    rejectOptional: 'Optionale ablehnen',
    customize: 'Anpassen',
    save: 'Einstellungen speichern',
    close: 'Schließen',
    privacy: 'Datenschutz',
    cookies: 'Cookies',
    manage: 'Cookies',
    dnt:
      'Ihr Browser sendet Do Not Track. Analytics bleibt deaktiviert, solange diese Einstellung aktiv ist.',
  },
} as const

function getConsentCookie() {
  if (typeof document === 'undefined') return null

  const cookie = document.cookie
    .split('; ')
    .find((item) => item.startsWith(`${CONSENT_COOKIE_NAME}=`))

  return cookie ? cookie.slice(CONSENT_COOKIE_NAME.length + 1) : null
}

function readStoredConsent(): CookieConsent | null {
  const value = getConsentCookie()
  if (!value) return null

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<CookieConsent>
    if (
      parsed.version !== CONSENT_VERSION ||
      typeof parsed.analytics !== 'boolean' ||
      typeof parsed.decidedAt !== 'string'
    ) {
      return null
    }

    return {
      version: parsed.version,
      analytics: parsed.analytics,
      decidedAt: parsed.decidedAt,
    }
  } catch {
    return null
  }
}

function writeStoredConsent(analytics: boolean): CookieConsent {
  const consent: CookieConsent = {
    version: CONSENT_VERSION,
    analytics,
    decidedAt: new Date().toISOString(),
  }
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''

  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(
    JSON.stringify(consent)
  )}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`

  return consent
}

function hasStoredAnalyticsConsent() {
  return readStoredConsent()?.analytics === true && !hasDoNotTrackEnabled()
}

function hasDoNotTrackEnabled() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false

  const browserDnt = navigator.doNotTrack
  const legacyDnt = (window as Window & { doNotTrack?: string }).doNotTrack

  return browserDnt === '1' || legacyDnt === '1'
}

function redactAnalyticsPath(pathname: string) {
  return pathname
    .replace(/^\/offer\/[^/]+/, '/offer/[token]')
    .replace(/^\/invite\/[^/]+/, '/invite/[token]')
    .replace(/^\/jobs\/[^/]+/, '/jobs/[jobId]')
    .replace(/^\/workers\/[^/]+/, '/workers/[workerId]')
    .replace(/^\/invoices\/[^/]+/, '/invoices/[invoiceId]')
    .replace(/^\/kalkulace\/[^/]+/, '/kalkulace/[calculationId]')
    .replace(/^\/cenove-nabidky\/[^/]+/, '/cenove-nabidky/[quoteId]')
    .replace(/^\/calendar\/events\/[^/]+/, '/calendar/events/[eventId]')
    .replace(/^\/portal\/offers\/[^/]+/, '/portal/offers/[offerId]')
    .replace(/^\/portal\/invoices\/[^/]+/, '/portal/invoices/[invoiceId]')
    .replace(/^\/portal\/jobs\/[^/]+/, '/portal/jobs/[jobId]')
    .replace(/^\/portal\/inquiries\/[^/]+/, '/portal/inquiries/[inquiryId]')
    .replace(/^\/customers\/[^/]+\/contacts\/[^/]+/, '/customers/[customerId]/contacts/[contactId]')
    .replace(/^\/customers\/[^/]+\/calculations\/[^/]+/, '/customers/[customerId]/calculations/[calculationId]')
    .replace(/^\/customers\/[^/]+\/quotes\/[^/]+/, '/customers/[customerId]/quotes/[quoteId]')
    .replace(/^\/customers\/[^/]+/, '/customers/[customerId]')
}

function redactAnalyticsUrl(value: string) {
  try {
    const url = new URL(value, window.location.origin)
    url.pathname = redactAnalyticsPath(url.pathname)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value.split(/[?#]/)[0] ?? value
  }
}

function beforeSendAnalyticsEvent<T extends { url: string }>(event: T) {
  if (!hasStoredAnalyticsConsent()) return null

  return {
    ...event,
    url: redactAnalyticsUrl(event.url),
  }
}

export default function CookieConsentManager() {
  const { locale } = useI18n()
  const text = copy[locale]
  const [loaded, setLoaded] = useState(false)
  const [consent, setConsent] = useState<CookieConsent | null>(null)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [doNotTrack, setDoNotTrack] = useState(false)

  useEffect(() => {
    const storedConsent = readStoredConsent()
    const dnt = hasDoNotTrackEnabled()

    setConsent(storedConsent)
    setAnalyticsEnabled(storedConsent?.analytics === true && !dnt)
    setDoNotTrack(dnt)
    setLoaded(true)
  }, [])

  useEffect(() => {
    window.va?.('beforeSend', beforeSendAnalyticsEvent)
  }, [consent?.analytics])

  const analyticsAllowed = consent?.analytics === true && !doNotTrack
  const showBanner = loaded && !consent
  const showManageButton = loaded && consent && !preferencesOpen

  const legalLinks = useMemo(
    () => (
      <span className="cookie-consent-links">
        <Link href="/legal?doc=cookies">{text.cookies}</Link>
        <Link href="/legal?doc=privacy">{text.privacy}</Link>
      </span>
    ),
    [text.cookies, text.privacy]
  )

  function saveConsent(nextAnalyticsEnabled: boolean) {
    const storedConsent = writeStoredConsent(nextAnalyticsEnabled && !doNotTrack)

    setConsent(storedConsent)
    setAnalyticsEnabled(storedConsent.analytics && !doNotTrack)
    setPreferencesOpen(false)
  }

  return (
    <>
      {analyticsAllowed ? <Analytics beforeSend={beforeSendAnalyticsEvent} /> : null}

      {showBanner ? (
        <section className="cookie-consent" aria-labelledby="cookie-consent-title">
          <div className="cookie-consent-copy">
            <h2 id="cookie-consent-title">{text.title}</h2>
            <p>{text.body}</p>
            {legalLinks}
          </div>
          <div className="cookie-consent-actions">
            <button type="button" className="cookie-secondary" onClick={() => saveConsent(false)}>
              {text.rejectOptional}
            </button>
            <button type="button" className="cookie-secondary" onClick={() => setPreferencesOpen(true)}>
              {text.customize}
            </button>
            <button type="button" className="cookie-primary" onClick={() => saveConsent(true)}>
              {text.acceptAll}
            </button>
          </div>
        </section>
      ) : null}

      {showManageButton ? (
        <button type="button" className="cookie-manage" onClick={() => setPreferencesOpen(true)}>
          {text.manage}
        </button>
      ) : null}

      {preferencesOpen ? (
        <div className="cookie-modal" role="dialog" aria-modal="true" aria-labelledby="cookie-settings-title">
          <div className="cookie-modal-panel">
            <div className="cookie-modal-header">
              <h2 id="cookie-settings-title">{text.title}</h2>
              {consent ? (
                <button type="button" className="cookie-icon-button" onClick={() => setPreferencesOpen(false)} aria-label={text.close}>
                  ×
                </button>
              ) : null}
            </div>

            <p className="cookie-modal-intro">{text.body}</p>

            <div className="cookie-option">
              <div>
                <strong>{text.essentialTitle}</strong>
                <p>{text.essentialBody}</p>
              </div>
              <span>{text.alwaysOn}</span>
            </div>

            <label className={doNotTrack ? 'cookie-option is-disabled' : 'cookie-option'}>
              <div>
                <strong>{text.analyticsTitle}</strong>
                <p>{text.analyticsBody}</p>
                {doNotTrack ? <p className="cookie-dnt">{text.dnt}</p> : null}
              </div>
              <input
                type="checkbox"
                checked={analyticsEnabled}
                disabled={doNotTrack}
                onChange={(event) => setAnalyticsEnabled(event.target.checked)}
              />
            </label>

            {legalLinks}

            <div className="cookie-modal-actions">
              <button type="button" className="cookie-secondary" onClick={() => saveConsent(false)}>
                {text.rejectOptional}
              </button>
              <button type="button" className="cookie-primary" onClick={() => saveConsent(analyticsEnabled)}>
                {text.save}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .cookie-consent,
        .cookie-modal-panel,
        .cookie-manage {
          color: #0f172a;
          background: #ffffff;
          border: 1px solid #dbe4f0;
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.18);
        }

        .cookie-consent {
          position: fixed;
          left: 18px;
          right: 18px;
          bottom: 18px;
          z-index: 6200;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 18px;
          align-items: center;
          max-width: 1120px;
          margin: 0 auto;
          padding: 18px;
          border-radius: 8px;
        }

        .cookie-consent h2,
        .cookie-modal h2 {
          margin: 0;
          font-size: 20px;
          line-height: 1.2;
          letter-spacing: 0;
        }

        .cookie-consent p,
        .cookie-modal p {
          margin: 7px 0 0;
          color: #475569;
          font-size: 14px;
          line-height: 1.5;
        }

        .cookie-consent-links {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 10px;
          font-size: 13px;
          font-weight: 800;
        }

        .cookie-consent-links a {
          color: #2563eb;
          text-decoration: none;
        }

        .cookie-consent-actions,
        .cookie-modal-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
        }

        .cookie-consent button,
        .cookie-modal button,
        .cookie-manage {
          min-height: 40px;
          border-radius: 8px;
          padding: 9px 14px;
          font-size: 13px;
          font-weight: 850;
          letter-spacing: 0;
          cursor: pointer;
        }

        .cookie-primary {
          border: 1px solid #111827;
          background: #111827;
          color: #ffffff;
        }

        .cookie-secondary,
        .cookie-icon-button,
        .cookie-manage {
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #0f172a;
        }

        .cookie-manage {
          position: fixed;
          left: 16px;
          bottom: 16px;
          z-index: 4200;
          min-height: 34px;
          padding: 7px 10px;
          box-shadow: 0 12px 34px rgba(15, 23, 42, 0.12);
        }

        .cookie-modal {
          position: fixed;
          inset: 0;
          z-index: 6300;
          display: grid;
          place-items: center;
          padding: 18px;
          background: rgba(2, 6, 23, 0.58);
          backdrop-filter: blur(10px);
        }

        .cookie-modal-panel {
          width: min(100%, 640px);
          display: grid;
          gap: 14px;
          border-radius: 8px;
          padding: 20px;
        }

        .cookie-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .cookie-icon-button {
          width: 38px;
          min-height: 38px;
          padding: 0;
          font-size: 20px;
          line-height: 1;
        }

        .cookie-modal-intro {
          margin-top: 0;
        }

        .cookie-option {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 14px;
          align-items: center;
          padding: 14px;
          border: 1px solid #dbe4f0;
          border-radius: 8px;
          background: #f8fafc;
        }

        .cookie-option strong {
          display: block;
          font-size: 14px;
          line-height: 1.25;
        }

        .cookie-option span {
          color: #334155;
          font-size: 12px;
          font-weight: 850;
          white-space: nowrap;
        }

        .cookie-option input {
          width: 22px;
          height: 22px;
          accent-color: #111827;
        }

        .cookie-option.is-disabled {
          opacity: 0.72;
        }

        .cookie-dnt {
          color: #92400e;
        }

        @media (prefers-color-scheme: dark) {
          .cookie-consent,
          .cookie-modal-panel,
          .cookie-manage {
            color: #f8fafc;
            background: #0f172a;
            border-color: #334155;
          }

          .cookie-consent p,
          .cookie-modal p {
            color: #cbd5e1;
          }

          .cookie-option {
            background: #111827;
            border-color: #334155;
          }

          .cookie-secondary,
          .cookie-icon-button,
          .cookie-manage {
            background: #111827;
            border-color: #475569;
            color: #f8fafc;
          }

          .cookie-primary {
            border-color: #f8fafc;
            background: #f8fafc;
            color: #111827;
          }

          .cookie-option span {
            color: #e2e8f0;
          }
        }

        @media (max-width: 760px) {
          .cookie-consent {
            grid-template-columns: 1fr;
            left: 10px;
            right: 10px;
            bottom: 10px;
            padding: 15px;
          }

          .cookie-consent-actions,
          .cookie-modal-actions {
            justify-content: stretch;
          }

          .cookie-consent-actions button,
          .cookie-modal-actions button {
            flex: 1 1 100%;
          }

          .cookie-option {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  )
}
