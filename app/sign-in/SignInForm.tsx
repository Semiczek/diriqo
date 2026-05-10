'use client'

import { FormEvent, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import LanguageSwitcher from '@/components/LanguageSwitcher'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '@/lib/supabase'

function getAuthErrorMessage(message: string | undefined, fallback: string, invalidEmail: string, invalidCredentials: string) {
  const normalized = (message ?? '').trim().toLowerCase()

  if (normalized.includes('invalid login credentials')) return invalidCredentials
  if (normalized.includes('email') && normalized.includes('invalid')) return invalidEmail

  return message || fallback
}

export default function SignInForm() {
  const searchParams = useSearchParams()
  const { dictionary } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(
    searchParams.get('error') === 'callback' ? dictionary.auth.signInFailed : null
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (signInError) {
      setError(
        getAuthErrorMessage(
          signInError.message,
          dictionary.auth.signInFailed,
          dictionary.auth.invalidEmail,
          dictionary.auth.invalidCredentials
        )
      )
      setLoading(false)
      return
    }

    window.location.assign('/auth/continue')
  }

  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        <div style={topBarStyle}>
          <LanguageSwitcher />
        </div>

        <div style={logoWrapStyle}>
          <Image src="/diriqo-logo-full.png" alt="Diriqo" fill priority sizes="260px" style={{ objectFit: 'contain' }} />
        </div>

        <div>
          <h1 style={titleStyle}>{dictionary.auth.signInTitle}</h1>
          <p style={subtitleStyle}>{dictionary.auth.signInSubtitle}</p>
        </div>

        <form onSubmit={handleSubmit} style={formStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>{dictionary.auth.email}</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              autoComplete="email"
              placeholder="admin@firma.cz"
              style={inputStyle}
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>{dictionary.auth.password}</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              autoComplete="current-password"
              style={inputStyle}
            />
          </label>

          <Link href="/forgot-password" style={smallLinkStyle}>
            {dictionary.auth.forgotPassword}
          </Link>

          {error ? <div style={errorStyle}>{error}</div> : null}

          <button type="submit" disabled={loading} style={{ ...buttonStyle, opacity: loading ? 0.72 : 1 }}>
            {loading ? dictionary.auth.signingIn : dictionary.auth.continue}
          </button>
        </form>

        <Link href="/sign-up" style={footerLinkStyle}>
          {dictionary.auth.dontHaveAccountStartFree}
        </Link>
      </section>
    </main>
  )
}

const pageStyle = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 16,
  background: '#f8fafc',
  color: '#111827',
} as const

const cardStyle = {
  width: 'min(100%, 430px)',
  display: 'grid',
  gap: 18,
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#ffffff',
  padding: 24,
  boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
} as const

const topBarStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
} as const

const logoWrapStyle = {
  position: 'relative',
  width: 260,
  height: 110,
  margin: '0 auto',
} as const

const titleStyle = {
  margin: 0,
  fontSize: 30,
  lineHeight: 1.1,
} as const

const subtitleStyle = {
  margin: '8px 0 0',
  color: '#64748b',
  fontSize: 14,
  lineHeight: 1.5,
} as const

const formStyle = {
  display: 'grid',
  gap: 14,
} as const

const fieldStyle = {
  display: 'grid',
  gap: 6,
} as const

const labelStyle = {
  color: '#334155',
  fontSize: 13,
  fontWeight: 850,
} as const

const inputStyle = {
  minHeight: 44,
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  padding: '8px 11px',
  fontSize: 15,
} as const

const buttonStyle = {
  minHeight: 44,
  border: 0,
  borderRadius: 8,
  background: '#111827',
  color: '#ffffff',
  fontWeight: 850,
  cursor: 'pointer',
} as const

const smallLinkStyle = {
  justifySelf: 'end',
  color: '#2563eb',
  fontSize: 13,
  fontWeight: 750,
  textDecoration: 'none',
} as const

const footerLinkStyle = {
  color: '#2563eb',
  fontSize: 14,
  fontWeight: 800,
  textAlign: 'center',
  textDecoration: 'none',
} as const

const errorStyle = {
  borderRadius: 8,
  border: '1px solid #fecaca',
  background: '#fef2f2',
  color: '#991b1b',
  padding: 11,
  fontSize: 14,
} as const
