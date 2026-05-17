'use client'

import { FormEvent, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'

import { useI18n } from '@/components/I18nProvider'
import { normalizeBillingInterval, normalizePlanKey } from '@/lib/billing-shared'
import { LOCALES, type Locale } from '@/lib/i18n/config'
import { getPublicAppBaseUrl } from '@/lib/public-app-url'
import { supabase } from '@/lib/supabase'

type SignUpFormProps = {
  plan?: string
  interval?: string
  legalVersions: {
    terms: string
    privacy: string
  }
}

const localeLabels: Record<Locale, string> = {
  cs: 'Čeština',
  en: 'English',
  de: 'Deutsch',
}

const localeShortLabels: Record<Locale, string> = {
  cs: 'CZ',
  en: 'EN',
  de: 'DE',
}

const registerCopy: Record<
  Locale,
  {
    navFeatures: string
    navHow: string
    navPricing: string
    navIndustries: string
    navDemo: string
    navContact: string
    navLogin: string
    eyebrow: string
    title: string
    subtitle: string
    note: string
    submit: string
    submitting: string
    googleDisabled: string
    signInPrompt: string
    signInAction: string
    legalConsent: string
    legalRequired: string
    termsLink: string
    privacyLink: string
  }
> = {
  cs: {
    navFeatures: 'Funkce',
    navHow: 'Jak to funguje',
    navPricing: 'Ceník',
    navIndustries: 'Obory',
    navDemo: 'Demo',
    navContact: 'Kontakt',
    navLogin: 'Přihlášení',
    eyebrow: 'Registrace',
    title: 'Vytvořit účet',
    subtitle: 'Vytvořte účet, založte firmu a začněte spravovat zakázky, pracovníky a zákazníky během pár minut.',
    note: 'Nejprve si vytvoříte účet. Firmu nastavíte v dalším kroku.',
    submit: 'Pokračovat k založení firmy',
    submitting: 'Vytvářím účet...',
    googleDisabled: 'Google přihlášení zatím není nakonfigurované.',
    signInPrompt: 'Už účet máte?',
    signInAction: 'Přihlásit se',
    legalConsent: 'Souhlasím s podmínkami používání a beru na vědomí zpracování osobních údajů.',
    legalRequired: 'Pro vytvoření účtu je potřeba potvrdit podmínky používání a ochranu osobních údajů.',
    termsLink: 'Podmínky používání',
    privacyLink: 'Ochrana osobních údajů',
  },
  en: {
    navFeatures: 'Features',
    navHow: 'How it works',
    navPricing: 'Pricing',
    navIndustries: 'Industries',
    navDemo: 'Demo',
    navContact: 'Contact',
    navLogin: 'Sign in',
    eyebrow: 'Registration',
    title: 'Create account',
    subtitle: 'Create an account, set up your company and start managing jobs, workers and customers in minutes.',
    note: 'Create your account first. You will set up the company in the next step.',
    submit: 'Continue to company setup',
    submitting: 'Creating account...',
    googleDisabled: 'Google sign-in is not configured yet.',
    signInPrompt: 'Already have an account?',
    signInAction: 'Sign in',
    legalConsent: 'I agree to the Terms of Use and acknowledge the Privacy Notice.',
    legalRequired: 'You need to accept the Terms of Use and Privacy Notice to create an account.',
    termsLink: 'Terms of Use',
    privacyLink: 'Privacy Notice',
  },
  de: {
    navFeatures: 'Funktionen',
    navHow: 'So funktioniert es',
    navPricing: 'Preise',
    navIndustries: 'Branchen',
    navDemo: 'Demo',
    navContact: 'Kontakt',
    navLogin: 'Anmelden',
    eyebrow: 'Registrierung',
    title: 'Konto erstellen',
    subtitle: 'Erstellen Sie ein Konto, richten Sie Ihre Firma ein und verwalten Sie Aufträge, Mitarbeiter und Kunden in wenigen Minuten.',
    note: 'Erstellen Sie zuerst Ihr Konto. Die Firma richten Sie im nächsten Schritt ein.',
    submit: 'Weiter zur Firmeneinrichtung',
    submitting: 'Konto wird erstellt...',
    googleDisabled: 'Google-Anmeldung ist noch nicht konfiguriert.',
    signInPrompt: 'Sie haben schon ein Konto?',
    signInAction: 'Anmelden',
    legalConsent: 'Ich stimme den Nutzungsbedingungen zu und nehme die Datenschutzhinweise zur Kenntnis.',
    legalRequired: 'Zum Erstellen des Kontos musst du Nutzungsbedingungen und Datenschutz bestätigen.',
    termsLink: 'Nutzungsbedingungen',
    privacyLink: 'Datenschutz',
  },
}

function getAuthRedirectTo() {
  return new URL('/auth/callback', getPublicAppBaseUrl()).toString()
}

function getRegisterHref(locale: Locale) {
  return `/register?locale=${locale}`
}

export default function SignUpForm({ plan, interval, legalVersions }: SignUpFormProps) {
  const { dictionary, locale } = useI18n()
  const copy = registerCopy[locale]
  const intendedPlan = useMemo(() => normalizePlanKey(plan), [plan])
  const intendedInterval = useMemo(() => normalizeBillingInterval(interval), [interval])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [legalAccepted, setLegalAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [localeSaving, setLocaleSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleLocaleChange(nextLocale: Locale) {
    if (nextLocale === locale || localeSaving) return
    setLocaleSaving(true)

    try {
      await fetch('/api/locale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ locale: nextLocale }),
      })

      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.set('locale', nextLocale)
      window.location.assign(`${nextUrl.pathname}${nextUrl.search}`)
    } finally {
      setLocaleSaving(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)

    if (password.length < 8) {
      setError(dictionary.auth.passwordMinLength)
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError(dictionary.auth.passwordsDoNotMatch)
      setLoading(false)
      return
    }

    if (!legalAccepted) {
      setError(copy.legalRequired)
      setLoading(false)
      return
    }

    const normalizedEmail = email.trim()
    const legalAcceptedAt = new Date().toISOString()
    window.localStorage.setItem('diriqo.pendingSignupEmail', normalizedEmail)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: getAuthRedirectTo(),
        data: {
          intended_plan_key: intendedPlan,
          intended_billing_interval: intendedInterval,
          legal_acceptance: {
            accepted_at: legalAcceptedAt,
            locale,
            documents: {
              terms: legalVersions.terms,
              privacy: legalVersions.privacy,
            },
          },
        },
      },
    })

    if (signUpError || !data.user) {
      setError(signUpError?.message || dictionary.auth.createAccountFailed)
      setLoading(false)
      return
    }

    if (!data.session) {
      setNotice(dictionary.auth.accountCreatedCheckEmail)
      setLoading(false)
      return
    }

    window.localStorage.removeItem('diriqo.pendingSignupEmail')
    await fetch('/api/legal/accept', { method: 'POST' }).catch(() => null)
    window.location.assign('/onboarding/company')
  }

  return (
    <main className="register-page">
      <style>{registerStyles}</style>

      <header className="register-nav">
        <a className="register-brand" href="https://diriqo.com" aria-label="Diriqo">
          <Image
            src="/diriqo-logo-full.png"
            alt="Diriqo"
            fill
            priority
            sizes="190px"
            style={{
              objectFit: 'cover',
              objectPosition: 'left center',
              transform: 'translateX(-25%) scale(1.35)',
              transformOrigin: 'left center',
            }}
          />
        </a>

        <nav className="register-nav-links" aria-label="Diriqo">
          <a href="https://diriqo.com/#funkce">{copy.navFeatures}</a>
          <a href="https://diriqo.com/#jak-to-funguje">{copy.navHow}</a>
          <a href="https://diriqo.com/pricing">{copy.navPricing}</a>
          <a href="https://diriqo.com/#obory">{copy.navIndustries}</a>
          <a href="https://diriqo.com/#demo">{copy.navDemo}</a>
          <a href="https://diriqo.com/#kontakt">{copy.navContact}</a>
        </nav>

        <div className="register-nav-actions">
          <Link href="/sign-in" className="register-login">
            {copy.navLogin}
          </Link>
          <Link href={getRegisterHref(locale)} className="register-start">
            {dictionary.auth.startFree}
          </Link>
          <label className="register-language">
            <span>{localeShortLabels[locale]}</span>
            <select
              value={locale}
              disabled={localeSaving}
              aria-label={dictionary.common.language}
              onChange={(event) => handleLocaleChange(event.target.value as Locale)}
            >
              {LOCALES.map((supportedLocale) => (
                <option key={supportedLocale} value={supportedLocale}>
                  {localeLabels[supportedLocale]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <section className="register-content">
        <div className="register-copy">
          <p className="register-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="register-subtitle">{copy.subtitle}</p>
          <div className="register-note">{copy.note}</div>
        </div>

        <section className="register-card" aria-label={copy.title}>
          <form onSubmit={handleSubmit} className="register-form">
            <label>
              <span>{dictionary.auth.email}</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                autoComplete="email"
              />
            </label>

            <label>
              <span>{dictionary.auth.password}</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
              />
            </label>

            <label>
              <span>{dictionary.auth.confirmPassword}</span>
              <input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
              />
            </label>

            {error ? <div className="register-error">{error}</div> : null}
            {notice ? <div className="register-notice">{notice}</div> : null}

            <label className="register-legal-consent">
              <input
                type="checkbox"
                checked={legalAccepted}
                required
                onChange={(event) => setLegalAccepted(event.target.checked)}
              />
              <span>
                {copy.legalConsent}{' '}
                <Link href="/legal?doc=terms" target="_blank">
                  {copy.termsLink}
                </Link>
                {' · '}
                <Link href="/legal?doc=privacy" target="_blank">
                  {copy.privacyLink}
                </Link>
              </span>
            </label>

            <button type="submit" disabled={loading}>
              {loading ? copy.submitting : copy.submit}
            </button>
          </form>

          <button type="button" className="register-google" disabled>
            {copy.googleDisabled}
          </button>

          <p className="register-footer">
            {copy.signInPrompt}{' '}
            <Link href="/sign-in">{copy.signInAction}</Link>
          </p>
        </section>
      </section>
    </main>
  )
}

const registerStyles = `
  .register-page {
    min-height: 100vh;
    color: #ffffff;
    background:
      radial-gradient(circle at 65% 28%, rgba(120, 92, 255, 0.18), transparent 21%),
      linear-gradient(90deg, rgba(5, 83, 110, 0.7) 0%, rgba(9, 21, 58, 0.74) 48%, rgba(45, 28, 112, 0.86) 100%),
      radial-gradient(circle at 17% 21%, rgba(20, 184, 166, 0.2), transparent 28%),
      linear-gradient(135deg, #042437 0%, #080d2a 48%, #150b44 100%);
    overflow-x: hidden;
  }

  .register-page::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
    background-size: 68px 68px;
    mask-image: linear-gradient(to bottom, transparent, black 18%, black 82%, transparent);
  }

  .register-page::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(circle at 18% 19%, rgba(45, 212, 191, 0.45) 0 2px, transparent 3px),
      radial-gradient(circle at 37% 3%, rgba(124, 92, 255, 0.45) 0 2px, transparent 3px),
      radial-gradient(circle at 66% 26%, rgba(124, 92, 255, 0.32) 0 3px, transparent 4px),
      radial-gradient(circle at 10% 46%, rgba(124, 92, 255, 0.38) 0 3px, transparent 4px);
    opacity: 0.85;
  }

  .register-nav {
    min-height: 96px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: clamp(22px, 2.4vw, 42px);
    padding: 16px clamp(38px, 2.8vw, 54px);
    border-bottom: 1px solid rgba(45, 212, 191, 0.34);
    background: linear-gradient(90deg, rgba(7, 67, 94, 0.92), rgba(31, 32, 100, 0.88), rgba(70, 52, 130, 0.82));
    box-shadow: 0 16px 38px rgba(5, 7, 29, 0.22);
    position: relative;
    z-index: 2;
  }

  .register-brand {
    position: relative;
    width: 188px;
    height: 64px;
    flex: 0 0 auto;
    overflow: hidden;
  }

  .register-nav-links {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(30px, 4vw, 70px);
    flex: 1 1 auto;
    font-size: 16px;
    font-weight: 900;
  }

  .register-nav-links a,
  .register-nav-actions a {
    color: rgba(255, 255, 255, 0.92);
    text-decoration: none;
  }

  .register-nav-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 16px;
    flex: 0 0 auto;
  }

  .register-login,
  .register-start,
  .register-language {
    min-height: 54px;
    border-radius: 9px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 900;
  }

  .register-login {
    padding: 0 22px;
    border: 1px solid rgba(148, 163, 255, 0.42);
    background: rgba(255, 255, 255, 0.1);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  }

  .register-start {
    padding: 0 36px;
    background: linear-gradient(135deg, #7c5cff 0%, #178eea 58%, #05b6d3 100%);
    box-shadow: 0 15px 32px rgba(5, 182, 211, 0.24);
  }

  .register-language {
    gap: 10px;
    padding: 0 22px 0 12px;
    border: 1px solid rgba(148, 163, 255, 0.36);
    background: rgba(255, 255, 255, 0.1);
  }

  .register-language span {
    min-width: 44px;
    min-height: 42px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #7c5cff, #168eea);
    font-size: 14px;
  }

  .register-language select {
    min-width: 122px;
    border: 0;
    outline: 0;
    background: transparent;
    color: #ffffff;
    font: inherit;
    cursor: pointer;
  }

  .register-language option {
    color: #111827;
  }

  .register-content {
    position: relative;
    z-index: 1;
    min-height: calc(100vh - 96px);
    display: grid;
    grid-template-columns: minmax(420px, 0.64fr) minmax(560px, 1fr);
    gap: clamp(42px, 2.8vw, 54px);
    align-items: start;
    max-width: none;
    margin: 0 auto;
    padding: clamp(56px, 7vh, 74px) 40px 44px;
  }

  .register-copy {
    max-width: 680px;
  }

  .register-eyebrow {
    display: inline-flex;
    min-height: 46px;
    align-items: center;
    margin: 0 0 52px;
    padding: 0 22px;
    border: 1px solid rgba(125, 224, 242, 0.45);
    border-radius: 999px;
    background: rgba(125, 224, 242, 0.12);
    color: #8cecff;
    font-size: 18px;
    font-weight: 950;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .register-copy h1 {
    margin: 0;
    font-size: clamp(82px, 7.1vw, 132px);
    line-height: 0.92;
    font-weight: 950;
    letter-spacing: 0;
  }

  .register-subtitle {
    margin: 42px 0 0;
    max-width: 700px;
    color: rgba(226, 232, 240, 0.9);
    font-size: clamp(25px, 2.05vw, 32px);
    line-height: 1.55;
    font-weight: 760;
  }

  .register-note {
    margin-top: 44px;
    display: inline-flex;
    width: min(100%, 632px);
    min-height: 62px;
    align-items: center;
    padding: 0 22px;
    border: 1px solid rgba(148, 220, 255, 0.32);
    border-radius: 19px;
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
    font-size: 16px;
    font-weight: 900;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .register-card {
    width: 100%;
    margin-top: clamp(54px, 6.6vh, 78px);
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 22px;
    background: rgba(48, 55, 102, 0.82);
    box-shadow: 0 24px 70px rgba(3, 7, 28, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    padding: clamp(32px, 2.2vw, 40px);
  }

  .register-form {
    display: grid;
    gap: 22px;
  }

  .register-form label {
    display: grid;
    gap: 10px;
  }

  .register-form label span {
    color: rgba(255, 255, 255, 0.92);
    font-size: 17px;
    font-weight: 900;
  }

  .register-legal-consent {
    display: grid !important;
    grid-template-columns: 20px minmax(0, 1fr);
    align-items: start;
    gap: 12px !important;
    margin-top: 2px;
    padding: 14px;
    border: 1px solid rgba(125, 224, 242, 0.25);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.08);
  }

  .register-legal-consent input {
    width: 18px !important;
    height: 18px !important;
    min-height: 18px !important;
    margin: 2px 0 0;
    accent-color: #05b6d3;
  }

  .register-legal-consent span {
    color: rgba(226, 232, 240, 0.92) !important;
    font-size: 14px !important;
    line-height: 1.5;
    font-weight: 760 !important;
  }

  .register-legal-consent a {
    color: #7ee7ff;
    text-decoration: none;
  }

  .register-form input {
    width: 100%;
    min-height: 60px;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.34);
    border-radius: 9px;
    background: rgba(248, 250, 252, 0.94);
    color: #08111f;
    padding: 12px 16px;
    font-size: 20px;
    font-weight: 760;
    outline: 0;
  }

  .register-form input:focus {
    border-color: #67e8f9;
    box-shadow: 0 0 0 4px rgba(34, 211, 238, 0.18);
  }

  .register-form button,
  .register-google {
    width: 100%;
    min-height: 60px;
    border-radius: 9px;
    font-size: 20px;
    font-weight: 900;
  }

  .register-form button {
    margin-top: 8px;
    border: 0;
    background: linear-gradient(135deg, #7c4dff 0%, #168eea 56%, #05b6d3 100%);
    color: #ffffff;
    cursor: pointer;
    box-shadow: 0 16px 34px rgba(5, 182, 211, 0.2);
  }

  .register-form button:disabled {
    cursor: wait;
    opacity: 0.72;
  }

  .register-google {
    margin-top: 20px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.08);
    color: rgba(226, 232, 240, 0.7);
    cursor: not-allowed;
  }

  .register-footer {
    margin: 26px 0 0;
    text-align: center;
    color: rgba(255, 255, 255, 0.88);
    font-size: 16px;
    font-weight: 900;
  }

  .register-footer a {
    color: #7ee7ff;
    text-decoration: none;
  }

  .register-error,
  .register-notice {
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 14px;
    font-weight: 850;
    line-height: 1.45;
  }

  .register-error {
    border: 1px solid rgba(254, 202, 202, 0.72);
    background: rgba(127, 29, 29, 0.4);
    color: #fee2e2;
  }

  .register-notice {
    border: 1px solid rgba(187, 247, 208, 0.65);
    background: rgba(20, 83, 45, 0.42);
    color: #dcfce7;
  }

  @media (max-width: 1180px) {
    .register-nav-links {
      display: none;
    }

    .register-content {
      grid-template-columns: 1fr;
      max-width: 820px;
    }
  }

  @media (max-width: 760px) {
    .register-nav {
      align-items: flex-start;
      flex-direction: column;
      min-height: auto;
    }

    .register-nav-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .register-login,
    .register-start,
    .register-language {
      min-height: 46px;
      font-size: 15px;
    }

    .register-start {
      padding: 0 18px;
    }

    .register-language select {
      min-width: 104px;
    }

    .register-content {
      min-height: auto;
      padding: 34px 18px;
    }

    .register-card {
      padding: 22px;
    }

    .register-copy h1 {
      font-size: 48px;
    }
  }
`
