'use client'

import { FormEvent, useState } from 'react'

import { getPublicAppBaseUrl } from '@/lib/public-app-url'
import { supabase } from '@/lib/supabase'

const PENDING_SIGNUP_EMAIL_KEY = 'diriqo.pendingSignupEmail'

type AuthResendConfirmationFormProps = {
  initialEmail?: string
}

function getConfirmationRedirectTo() {
  return new URL('/auth/callback', getPublicAppBaseUrl()).toString()
}

function getResendErrorMessage(message: string | undefined) {
  const normalized = (message ?? '').toLowerCase()

  if (normalized.includes('rate') || normalized.includes('frequency')) {
    return 'Nový e-mail nejde poslat tak rychle po sobě. Počkejte prosím chvilku a zkuste to znovu.'
  }

  if (normalized.includes('email') && normalized.includes('invalid')) {
    return 'Zadaný e-mail nevypadá správně.'
  }

  return message || 'Nový potvrzovací e-mail se nepodařilo odeslat.'
}

export default function AuthResendConfirmationForm({ initialEmail }: AuthResendConfirmationFormProps) {
  const [email, setEmail] = useState(() => {
    if (initialEmail) return initialEmail
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(PENDING_SIGNUP_EMAIL_KEY) ?? ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedEmail = email.trim()
    if (!normalizedEmail) return

    setSubmitting(true)
    setMessage(null)
    setError(null)

    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: normalizedEmail,
      options: {
        emailRedirectTo: getConfirmationRedirectTo(),
      },
    })

    if (resendError) {
      setError(getResendErrorMessage(resendError.message))
      setSubmitting(false)
      return
    }

    window.localStorage.setItem(PENDING_SIGNUP_EMAIL_KEY, normalizedEmail)
    setMessage('Pokud e-mail patří k nepotvrzené registraci, poslali jsme nový potvrzovací odkaz.')
    setSubmitting(false)
  }

  return (
    <form className="auth-resend-form" onSubmit={handleSubmit}>
      <label className="auth-resend-label" htmlFor="auth-resend-email">
        E-mail použitý při registraci
      </label>
      <div className="auth-resend-row">
        <input
          id="auth-resend-email"
          className="auth-resend-input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="firma@example.cz"
          autoComplete="email"
          required
        />
        <button className="auth-resend-button" type="submit" disabled={submitting}>
          {submitting ? 'Odesílám...' : 'Poslat nový odkaz'}
        </button>
      </div>
      {message ? <p className="auth-resend-message">{message}</p> : null}
      {error ? <p className="auth-resend-error">{error}</p> : null}
    </form>
  )
}
