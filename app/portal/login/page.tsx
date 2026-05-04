'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { supabase } from '@/lib/supabase'

function getErrorMessage(error: string | null) {
  if (error === 'no-portal-access') {
    return 'Tento účet nemá aktivní přístup do zákaznického portálu.'
  }

  return null
}

export default function PortalLoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resetSending, setResetSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const initialError = useMemo(() => getErrorMessage(searchParams.get('error')), [searchParams])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setMessage(null)

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError || !data.user) {
      setError(signInError?.message || 'Přihlášení se nepovedlo.')
      setSubmitting(false)
      return
    }

    router.replace('/portal')
    router.refresh()
  }

  async function handleResetPassword() {
    setError(null)
    setMessage(null)

    if (!email.trim()) {
      setError('Nejprve vyplňte svůj e-mail.')
      return
    }

    setResetSending(true)

    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/portal/reset-password`
        : undefined

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    })

    if (resetError) {
      setError(resetError.message || 'Nepodařilo se odeslat e-mail pro změnu hesla.')
      setResetSending(false)
      return
    }

    setMessage('E-mail pro nastavení nového hesla byl odeslán.')
    setResetSending(false)
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#f8fafc',
        padding: '16px',
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: '430px',
          backgroundColor: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '20px',
          padding: '28px',
          boxShadow: '0 16px 48px rgba(15, 23, 42, 0.08)',
        }}
      >
        <div style={{ marginBottom: '24px' }}>
          <div
            style={{
              fontSize: '13px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#6b7280',
              marginBottom: '10px',
            }}
          >
            Diriqo Portal
          </div>
          <h1 style={{ margin: 0, fontSize: '32px', lineHeight: 1.1 }}>Přihlášení zákazníka</h1>
          <p style={{ margin: '10px 0 0 0', color: '#6b7280', lineHeight: 1.6 }}>
            Přihlaste se do zákaznického portálu a zobrazte své zakázky, poptávky a nabídky.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              style={{
                height: '46px',
                borderRadius: '12px',
                border: '1px solid #d1d5db',
                padding: '0 14px',
                fontSize: '14px',
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>Heslo</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              style={{
                height: '46px',
                borderRadius: '12px',
                border: '1px solid #d1d5db',
                padding: '0 14px',
                fontSize: '14px',
              }}
            />
          </label>

          {message ? (
            <div
              style={{
                borderRadius: '12px',
                border: '1px solid #bbf7d0',
                backgroundColor: '#f0fdf4',
                color: '#166534',
                padding: '12px 14px',
                lineHeight: 1.5,
              }}
            >
              {message}
            </div>
          ) : null}

          {(error || initialError) ? (
            <div
              style={{
                borderRadius: '12px',
                border: '1px solid #fecaca',
                backgroundColor: '#fef2f2',
                color: '#991b1b',
                padding: '12px 14px',
                lineHeight: 1.5,
              }}
            >
              {error || initialError}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            style={{
              height: '48px',
              borderRadius: '12px',
              border: 'none',
              backgroundColor: '#111827',
              color: '#ffffff',
              fontWeight: 700,
              cursor: submitting ? 'default' : 'pointer',
            }}
          >
            {submitting ? 'Přihlašuji...' : 'Přihlásit se'}
          </button>

          <button
            type="button"
            onClick={() => void handleResetPassword()}
            disabled={resetSending}
            style={{
              height: '46px',
              borderRadius: '12px',
              border: '1px solid #d1d5db',
              backgroundColor: '#ffffff',
              color: '#111827',
              fontWeight: 700,
              cursor: resetSending ? 'default' : 'pointer',
            }}
          >
            {resetSending ? 'Odesílám e-mail...' : 'Zapomněli jste heslo?'}
          </button>
        </form>
      </section>
    </main>
  )
}
