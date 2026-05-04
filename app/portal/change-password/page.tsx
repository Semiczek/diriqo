'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import PortalShell from '@/components/portal/PortalShell'
import { supabase } from '@/lib/supabase'

export default function PortalChangePasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)

    if (password.length < 8) {
      setError('Nové heslo musí mít alespoň 8 znaků.')
      setSaving(false)
      return
    }

    if (password !== passwordConfirm) {
      setError('Hesla se neshodují.')
      setSaving(false)
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message || 'Nepodařilo se změnit heslo.')
      setSaving(false)
      return
    }

    setMessage('Heslo bylo úspěšně změněno.')
    setSaving(false)
    router.refresh()
  }

  return (
    <PortalShell title="Změna hesla">
      <div style={{ display: 'grid', gap: '20px' }}>
        <Link href="/portal" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 700 }}>
          ← Zpět do portálu
        </Link>

        <section
          style={{
            borderRadius: '18px',
            border: '1px solid #e5e7eb',
            backgroundColor: '#ffffff',
            padding: '24px',
            maxWidth: '640px',
          }}
        >
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
              <span style={{ fontWeight: 700 }}>Potvrzení nového hesla</span>
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
              disabled={saving}
              style={{
                width: 'fit-content',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: '#111827',
                color: '#ffffff',
                padding: '12px 18px',
                fontWeight: 700,
              }}
            >
              {saving ? 'Ukládám heslo...' : 'Změnit heslo'}
            </button>
          </form>
        </section>
      </div>
    </PortalShell>
  )
}
