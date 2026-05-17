'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'

import LanguageSwitcher from '@/components/LanguageSwitcher'
import { useI18n } from '@/components/I18nProvider'
import { getPublicAppBaseUrl } from '@/lib/public-app-url'
import { supabase } from '@/lib/supabase'

function mapResetError(message: string | undefined, fallback: string, invalidEmail: string) {
  const normalized = (message ?? '').toLowerCase()
  if (normalized.includes('email') && normalized.includes('invalid')) return invalidEmail
  return message || fallback
}

export default function ForgotPasswordPage() {
  const { dictionary } = useI18n()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setMessage(null)

    const redirectTo = new URL('/reset-password', getPublicAppBaseUrl()).toString()
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    })

    if (resetError) {
      setError(mapResetError(resetError.message, dictionary.auth.resetPasswordFailed, dictionary.auth.invalidEmail))
      setSubmitting(false)
      return
    }

    setMessage(dictionary.auth.resetEmailSent)
    setSubmitting(false)
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
          maxWidth: 420,
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
        <h1 style={{ margin: '0 0 8px', fontSize: 28, lineHeight: 1.15 }}>{dictionary.auth.forgotPasswordTitle}</h1>
        <p style={{ margin: '0 0 20px', color: '#5b6472', lineHeight: 1.5 }}>
          {dictionary.auth.forgotPasswordSubtitle}
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="email" style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 700 }}>
            {dictionary.auth.email}
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            style={{
              width: '100%',
              height: 44,
              borderRadius: 8,
              border: '1px solid #d1d5db',
              padding: '0 12px',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />

          {message ? (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: '#ecfdf5', color: '#166534' }}>
              {message}
            </div>
          ) : null}
          {error ? (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: '#fef2f2', color: '#991b1b' }}>
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              height: 44,
              marginTop: 16,
              border: 'none',
              borderRadius: 8,
              background: submitting ? '#9ca3af' : '#111827',
              color: '#ffffff',
              fontWeight: 800,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? dictionary.auth.sendingResetLink : dictionary.auth.sendResetLink}
          </button>
        </form>

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
