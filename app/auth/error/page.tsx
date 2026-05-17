import Image from 'next/image'
import Link from 'next/link'

import AuthResendConfirmationForm from './AuthResendConfirmationForm'

type AuthErrorPageProps = {
  searchParams?: Promise<{
    error?: string
    error_code?: string
    error_description?: string
    email?: string
  }>
}

type AuthErrorCopy = {
  eyebrow: string
  title: string
  description: string
  hint: string
}

export const dynamic = 'force-dynamic'

function getAuthErrorCopy(errorCode?: string, errorDescription?: string): AuthErrorCopy {
  const normalizedCode = errorCode?.trim().toLowerCase()
  const normalizedDescription = errorDescription?.trim().toLowerCase() ?? ''

  if (
    normalizedCode === 'otp_expired' ||
    normalizedDescription.includes('expired') ||
    normalizedDescription.includes('invalid')
  ) {
    return {
      eyebrow: 'Odkaz není platný',
      title: 'Potvrzovací odkaz už nejde použít',
      description:
        'Tenhle e-mailový odkaz vypršel, byl už použitý, nebo vede na starou adresu aplikace.',
      hint: 'Vraťte se na registraci a pošlete si nový potvrzovací e-mail.',
    }
  }

  if (normalizedCode === 'auth_callback_failed') {
    return {
      eyebrow: 'Přihlášení se nedokončilo',
      title: 'Ověření odkazu se nepovedlo',
      description:
        'Aplikace dostala odpověď ze Supabase, ale nepodařilo se z ní vytvořit přihlášení.',
      hint: 'Zkuste si poslat nový odkaz nebo se přihlaste klasicky e-mailem a heslem.',
    }
  }

  if (normalizedCode === 'missing_session') {
    return {
      eyebrow: 'Chybí přihlášení',
      title: 'Odkaz neotevřel aktivní relaci',
      description:
        'Ověřovací krok proběhl bez aktivního přihlášení. Nejčastěji pomůže otevřít nový odkaz.',
      hint: 'Pokračujte přes registraci nebo přihlášení.',
    }
  }

  return {
    eyebrow: 'Odkaz se nepovedlo otevřít',
    title: 'Něco se pokazilo při ověření',
    description:
      'Odkaz z e-mailu jsme zachytili, ale Supabase ho odmítl dokončit.',
    hint: 'Zkuste si poslat nový odkaz. Pokud problém trvá, kontaktujte podporu.',
  }
}

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const params = searchParams ? await searchParams : {}
  const copy = getAuthErrorCopy(params.error_code, params.error_description)
  const technicalCode = params.error_code || params.error

  return (
    <main className="auth-error-page">
      <style>{styles}</style>

      <section className="auth-error-shell" aria-label={copy.title}>
        <Link href="https://diriqo.com" className="auth-error-logo" aria-label="Diriqo">
          <Image src="/diriqo-logo-full.png" alt="Diriqo" fill priority sizes="190px" style={{ objectFit: 'contain' }} />
        </Link>

        <p className="auth-error-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="auth-error-description">{copy.description}</p>
        <p className="auth-error-hint">{copy.hint}</p>

        <AuthResendConfirmationForm initialEmail={params.email} />

        <div className="auth-error-actions">
          <Link href="/register?locale=cs" className="auth-error-secondary">
            Zpět na registraci
          </Link>
          <Link href="/sign-in" className="auth-error-secondary">
            Přihlásit se
          </Link>
        </div>

        {technicalCode ? (
          <p className="auth-error-code">
            Technický kód: <span>{technicalCode}</span>
          </p>
        ) : null}
      </section>
    </main>
  )
}

const styles = `
  .auth-error-page {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    color: #ffffff;
    background:
      linear-gradient(90deg, rgba(5, 83, 110, 0.62) 0%, rgba(9, 21, 58, 0.74) 48%, rgba(45, 28, 112, 0.82) 100%),
      radial-gradient(circle at 18% 18%, rgba(20, 184, 166, 0.18), transparent 28%),
      linear-gradient(135deg, #042437 0%, #080d2a 48%, #150b44 100%);
  }

  .auth-error-page::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
    background-size: 68px 68px;
    mask-image: linear-gradient(to bottom, transparent, black 16%, black 84%, transparent);
  }

  .auth-error-shell {
    position: relative;
    z-index: 1;
    width: min(100%, 640px);
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 20px;
    background: rgba(24, 31, 74, 0.86);
    box-shadow: 0 24px 70px rgba(3, 7, 28, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    padding: clamp(24px, 5vw, 42px);
  }

  .auth-error-logo {
    position: relative;
    display: block;
    width: 188px;
    height: 58px;
    margin-bottom: 34px;
  }

  .auth-error-eyebrow {
    margin: 0 0 14px;
    color: #8cecff;
    font-size: 14px;
    font-weight: 950;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .auth-error-shell h1 {
    margin: 0;
    font-size: clamp(34px, 6vw, 54px);
    line-height: 1.02;
    font-weight: 950;
    letter-spacing: 0;
  }

  .auth-error-description,
  .auth-error-hint {
    margin: 20px 0 0;
    color: rgba(226, 232, 240, 0.9);
    font-size: 18px;
    line-height: 1.6;
    font-weight: 620;
  }

  .auth-error-hint {
    color: #ffffff;
    font-weight: 850;
  }

  .auth-error-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 22px;
  }

  .auth-error-actions a {
    min-height: 52px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    padding: 0 22px;
    text-decoration: none;
    font-size: 16px;
    font-weight: 900;
  }

  .auth-error-primary {
    background: linear-gradient(135deg, #7c4dff 0%, #168eea 56%, #05b6d3 100%);
    color: #ffffff;
    box-shadow: 0 16px 34px rgba(5, 182, 211, 0.2);
  }

  .auth-error-secondary {
    border: 1px solid rgba(148, 163, 255, 0.42);
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.94);
  }

  .auth-resend-form {
    display: grid;
    gap: 10px;
    margin-top: 26px;
    border: 1px solid rgba(148, 163, 255, 0.34);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.08);
    padding: 16px;
  }

  .auth-resend-label {
    color: rgba(255, 255, 255, 0.9);
    font-size: 14px;
    font-weight: 900;
  }

  .auth-resend-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
  }

  .auth-resend-input {
    min-height: 50px;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.34);
    border-radius: 9px;
    background: rgba(248, 250, 252, 0.96);
    color: #08111f;
    padding: 11px 13px;
    font-size: 16px;
    font-weight: 760;
    outline: 0;
  }

  .auth-resend-input:focus {
    border-color: #67e8f9;
    box-shadow: 0 0 0 4px rgba(34, 211, 238, 0.18);
  }

  .auth-resend-button {
    min-height: 50px;
    border: 0;
    border-radius: 9px;
    padding: 0 18px;
    background: linear-gradient(135deg, #7c4dff 0%, #168eea 56%, #05b6d3 100%);
    color: #ffffff;
    font-size: 15px;
    font-weight: 900;
    cursor: pointer;
    box-shadow: 0 16px 34px rgba(5, 182, 211, 0.18);
  }

  .auth-resend-button:disabled {
    cursor: wait;
    opacity: 0.7;
  }

  .auth-resend-message,
  .auth-resend-error {
    margin: 2px 0 0;
    border-radius: 9px;
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.45;
    font-weight: 800;
  }

  .auth-resend-message {
    border: 1px solid rgba(187, 247, 208, 0.54);
    background: rgba(20, 83, 45, 0.42);
    color: #dcfce7;
  }

  .auth-resend-error {
    border: 1px solid rgba(254, 202, 202, 0.62);
    background: rgba(127, 29, 29, 0.42);
    color: #fee2e2;
  }

  @media (max-width: 640px) {
    .auth-resend-row {
      grid-template-columns: 1fr;
    }
  }

  .auth-error-code {
    margin: 28px 0 0;
    color: rgba(203, 213, 225, 0.72);
    font-size: 13px;
    line-height: 1.5;
  }

  .auth-error-code span {
    color: #bae6fd;
    font-weight: 850;
  }
`
