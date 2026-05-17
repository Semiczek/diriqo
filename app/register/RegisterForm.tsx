'use client'

import { FormEvent, useMemo, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

import { normalizeBillingInterval, normalizePlanKey } from '@/lib/billing-shared'
import { supabase } from '@/lib/supabase'

function getAuthRedirectTo() {
  return `${window.location.origin}/auth/callback`
}

type RegisterFormProps = {
  plan?: string
  interval?: string
}

export default function RegisterForm({ plan, interval }: RegisterFormProps) {
  const router = useRouter()
  const intendedPlan = useMemo(() => normalizePlanKey(plan), [plan])
  const intendedInterval = useMemo(() => normalizeBillingInterval(interval), [interval])
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getAuthRedirectTo(),
        data: {
          full_name: fullName.trim(),
          intended_plan_key: intendedPlan,
          intended_billing_interval: intendedInterval,
        },
      },
    })

    if (signUpError || !data.user) {
      setError(signUpError?.message || 'Účet se nepodařilo vytvořit.')
      setLoading(false)
      return
    }

    if (!data.session) {
      setNotice('Účet byl vytvořen. Potvrď e-mail a potom se přihlas, onboarding si plán pamatuje v profilu.')
      setLoading(false)
      return
    }

    router.replace(`/onboarding?plan=${intendedPlan}&interval=${intendedInterval}`)
    router.refresh()
  }

  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        <div style={logoWrapStyle}>
          <Image src="/diriqo-logo-full.png" alt="Diriqo" fill priority sizes="240px" style={{ objectFit: 'contain' }} />
        </div>
        <div>
          <p style={eyebrowStyle}>Registrace aplikace</p>
          <h1 style={titleStyle}>Vytvoř účet firmy</h1>
          <p style={textStyle}>
            Zkušební období vždy začíná jako Starter na 7 dní bez karty. Požadovaný plán uložíme pro následnou aktivaci:{' '}
            <strong>{intendedPlan}</strong> / <strong>{intendedInterval}</strong>.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={formStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Jméno</span>
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
              autoComplete="name"
              style={inputStyle}
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>E-mail</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              autoComplete="email"
              style={inputStyle}
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Heslo</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              style={inputStyle}
            />
          </label>

          {error ? <div style={errorStyle}>{error}</div> : null}
          {notice ? <div style={noticeStyle}>{notice}</div> : null}

          <button type="submit" disabled={loading} style={{ ...buttonStyle, opacity: loading ? 0.72 : 1 }}>
            {loading ? 'Vytvářím účet...' : 'Vytvořit účet'}
          </button>
        </form>
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
  width: 'min(100%, 440px)',
  display: 'grid',
  gap: 18,
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#ffffff',
  padding: 24,
  boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
} as const

const logoWrapStyle = {
  position: 'relative',
  width: 240,
  height: 96,
  margin: '0 auto',
} as const

const eyebrowStyle = {
  margin: 0,
  color: '#2563eb',
  fontSize: 12,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
} as const

const titleStyle = {
  margin: '8px 0 0',
  fontSize: 30,
  lineHeight: 1.1,
} as const

const textStyle = {
  margin: '8px 0 0',
  color: '#475569',
  fontSize: 14,
  lineHeight: 1.6,
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
  fontSize: 13,
  fontWeight: 800,
  color: '#334155',
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

const errorStyle = {
  borderRadius: 8,
  border: '1px solid #fecaca',
  background: '#fef2f2',
  color: '#991b1b',
  padding: 11,
  fontSize: 14,
} as const

const noticeStyle = {
  borderRadius: 8,
  border: '1px solid #bbf7d0',
  background: '#f0fdf4',
  color: '#166534',
  padding: 11,
  fontSize: 14,
} as const
