'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { supabase } from '@/lib/supabase'

export default function PortalResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function prepareRecoverySession() {
      const hash = window.location.hash.replace(/^#/, '')
      const hashParams = new URLSearchParams(hash)
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')

      if (!accessToken || !refreshToken) {
        setReady(true)
        return
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })

      if (!active) return

      if (sessionError) {
        setError(sessionError.message || 'Nepodařilo se otevřít formulář pro změnu hesla.')
      } else {
        window.history.replaceState({}, document.title, '/portal/reset-password')
      }

      setReady(true)
    }

    void prepareRecoverySession()

    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setMessage(null)

    if (password.length < 8) {
      setError('Nové heslo musí mít alespoň 8 znaků.')
      setSubmitting(false)
      return
    }

    if (password !== passwordConfirm) {
      setError('Hesla se neshodují.')
      setSubmitting(false)
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })

    if (updateError) {
      setError(updateError.message || 'Nepodařilo se uložit nové heslo.')
      setSubmitting(false)
      return
    }

    setMessage('Nové heslo bylo uloženo. Za chvíli budete přesměrováni do portálu.')
    setSubmitting(false)

    window.setTimeout(() => {
      router.replace('/portal')
      router.refresh()
    }, 1200)
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
          maxWidth: '460px',
          backgroundColor: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '20px',
          padding: '28px',
          boxShadow: '0 16px 48px rgba(15, 23, 42, 0.08)',
        }}
      >
        <div style={{ marginBottom: '22px' }}>
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
          <h1 style={{ margin: 0, fontSize: '30px', lineHeight: 1.1 }}>Nastavení hesla</h1>
          <p style={{ margin: '10px 0 0 0', color: '#6b7280', lineHeight: 1.6 }}>
            Zadejte nové heslo pro svůj zákaznický portál.
          </p>
        </div>

        {!ready ? (
          <div style={{ color: '#6b7280' }}>Připravuji formulář pro změnu hesla...</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>Nové heslo</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
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
              <span style={{ fontWeight: 700 }}>Potvrzení hesla</span>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                autoComplete="new-password"
                required
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
                }}
              >
                {message}
              </div>
            ) : null}

            {error ? (
              <div
                style={{
                  borderRadius: '12px',
                  border: '1px solid #fecaca',
                  backgroundColor: '#fef2f2',
                  color: '#991b1b',
                  padding: '12px 14px',
                }}
              >
                {error}
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
              }}
            >
              {submitting ? 'Ukládám nové heslo...' : 'Uložit nové heslo'}
            </button>
          </form>
        )}

        <div style={{ marginTop: '18px' }}>
          <Link href="/portal/login" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 700 }}>
            Zpět na přihlášení
          </Link>
        </div>
      </section>
    </main>
  )
}
