'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import LanguageSwitcher from '@/components/LanguageSwitcher'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '@/lib/supabase'

export default function ResetPasswordPage() {
  const router = useRouter()
  const { dictionary } = useI18n()
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function prepareRecoverySession() {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
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
        setError(sessionError.message || dictionary.auth.resetPasswordFailed)
      } else {
        window.history.replaceState({}, document.title, '/reset-password')
      }

      setReady(true)
    }

    void prepareRecoverySession()

    return () => {
      active = false
    }
  }, [dictionary.auth.resetPasswordFailed])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setMessage(null)

    if (password.length < 8) {
      setError(dictionary.auth.passwordMinLength)
      setSubmitting(false)
      return
    }

    if (password !== passwordConfirm) {
      setError(dictionary.auth.passwordsDoNotMatch)
      setSubmitting(false)
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message || dictionary.auth.resetPasswordFailed)
      setSubmitting(false)
      return
    }

    setMessage(dictionary.auth.passwordSaved)
    setSubmitting(false)

    window.setTimeout(async () => {
      await supabase.auth.signOut()
      router.replace('/sign-in')
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
        padding: 16,
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 440,
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 24,
          boxSizing: 'border-box',
          boxShadow: '0 10px 30px rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <LanguageSwitcher />
        </div>
        <h1 style={{ margin: '0 0 8px', fontSize: 28, lineHeight: 1.15 }}>{dictionary.auth.resetPasswordTitle}</h1>
        <p style={{ margin: '0 0 20px', color: '#5b6472', lineHeight: 1.5 }}>
          {dictionary.auth.resetPasswordSubtitle}
        </p>

        {!ready ? (
          <div style={{ color: '#5b6472' }}>{dictionary.common.loading}</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
            <label style={{ display: 'grid', gap: 6, fontSize: 14, fontWeight: 700 }}>
              {dictionary.auth.newPassword}
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
                style={{ height: 44, borderRadius: 8, border: '1px solid #d1d5db', padding: '0 12px' }}
              />
            </label>

            <label style={{ display: 'grid', gap: 6, fontSize: 14, fontWeight: 700 }}>
              {dictionary.auth.confirmPassword}
              <input
                type="password"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                autoComplete="new-password"
                required
                style={{ height: 44, borderRadius: 8, border: '1px solid #d1d5db', padding: '0 12px' }}
              />
            </label>

            {message ? (
              <div style={{ padding: 12, borderRadius: 8, background: '#ecfdf5', color: '#166534' }}>{message}</div>
            ) : null}
            {error ? (
              <div style={{ padding: 12, borderRadius: 8, background: '#fef2f2', color: '#991b1b' }}>{error}</div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              style={{
                height: 44,
                border: 'none',
                borderRadius: 8,
                background: submitting ? '#9ca3af' : '#111827',
                color: '#ffffff',
                fontWeight: 800,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? dictionary.auth.savingNewPassword : dictionary.auth.saveNewPassword}
            </button>
          </form>
        )}

        <Link
          href="/sign-in"
          style={{ display: 'block', marginTop: 14, color: '#2563eb', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}
        >
          {dictionary.auth.backToSignIn}
        </Link>
      </section>
    </main>
  )
}
