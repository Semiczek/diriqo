'use client'

import { FormEvent, Suspense, useState } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'

import LanguageSwitcher from '@/components/LanguageSwitcher'
import { useI18n } from '@/components/I18nProvider'
import { hasAnyHubAccessRole } from '@/lib/hub-access'
import { supabase } from '@/lib/supabase'

type MembershipRow = {
  role: string | null
  is_active: boolean | null
}

function getErrorMessageFromParam(errorParam: string | null, dictionary: ReturnType<typeof useI18n>['dictionary']) {
  if (errorParam === 'no-hub-access') {
    return dictionary.auth.noHubAccess
  }

  if (errorParam === 'no-profile') {
    return dictionary.auth.noProfile
  }

  if (errorParam === 'no-membership') {
    return dictionary.auth.noMembership
  }

  return null
}

function getThrownMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { dictionary } = useI18n()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [loading, setLoading] = useState(false)
  const initialError = getErrorMessageFromParam(searchParams.get('error'), dictionary)

  const [error, setError] = useState<string | null>(initialError)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)

    if (mode === 'sign-up') {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
      })

      if (signUpError || !signUpData.user) {
        setError(signUpError?.message || 'Účet se nepodařilo vytvořit.')
        setLoading(false)
        return
      }

      if (!signUpData.session) {
        setNotice('Účet je vytvořený. Zkontroluj e-mail a po potvrzení se přihlas.')
        setLoading(false)
        return
      }

      router.replace('/onboarding')
      router.refresh()
      return
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError || !signInData.user) {
      setError(signInError?.message || dictionary.auth.signInFailed)
      setLoading(false)
      return
    }

    const authUserId = signInData.user.id

    try {
      let profileId: string | null = null

      const profileByAuth = await supabase
        .from('profiles')
        .select('id')
        .eq('auth_user_id', authUserId)
        .maybeSingle()

      if (profileByAuth.error) {
        await supabase.auth.signOut()
        setError(`${dictionary.auth.profileLoadFailed}: ${profileByAuth.error.message}`)
        setLoading(false)
        return
      }

      if (profileByAuth.data?.id) {
        profileId = profileByAuth.data.id
      } else {
        const profileByUser = await supabase
          .from('profiles')
          .select('id')
          .eq('user_id', authUserId)
          .maybeSingle()

        if (profileByUser.error) {
          await supabase.auth.signOut()
          setError(`${dictionary.auth.profileLoadFailed}: ${profileByUser.error.message}`)
          setLoading(false)
          return
        }

        if (profileByUser.data?.id) {
          profileId = profileByUser.data.id
        }
      }

      if (!profileId) {
        router.replace('/onboarding')
        router.refresh()
        return
      }

      const membershipsResponse = await supabase
        .from('company_members')
        .select('role, is_active')
        .eq('profile_id', profileId)
        .eq('is_active', true)

      if (membershipsResponse.error) {
        await supabase.auth.signOut()
        setError(`${dictionary.auth.permissionLoadFailed}: ${membershipsResponse.error.message}`)
        setLoading(false)
        return
      }

      const memberships = (membershipsResponse.data ?? []) as MembershipRow[]

      if (memberships.length === 0) {
        router.replace('/onboarding')
        router.refresh()
        return
      }

      const normalizedRoles = memberships.map((item) =>
        (item.role ?? '').toString().trim().toLowerCase()
      )

      const hasAllowedRole = hasAnyHubAccessRole(normalizedRoles)

      if (!hasAllowedRole) {
        await supabase.auth.signOut()
        setError(dictionary.auth.noHubAccess)
        setLoading(false)
        return
      }

      router.replace('/')
      router.refresh()
    } catch (err: unknown) {
      await supabase.auth.signOut()
      setError(getThrownMessage(err, dictionary.auth.unexpectedPermissionError))
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8fafc',
        padding: 16,
        boxSizing: 'border-box',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div
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
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 16,
            marginBottom: 10,
          }}
        >
          <LanguageSwitcher />
        </div>

        <div
          style={{
            marginBottom: 24,
            textAlign: 'center',
          }}
        >
          <Image
            src="/diriqo-logo-full.png"
            alt="Diriqo"
            width={360}
            height={180}
            priority
            style={{
              width: 'min(100%, 320px)',
              height: 'auto',
              objectFit: 'contain',
            }}
          />

          <p
            style={{
              marginTop: 8,
              marginBottom: 0,
              color: '#5b6472',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {dictionary.auth.subtitle}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'sign-up' ? (
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="fullName"
                style={{
                  display: 'block',
                  marginBottom: 6,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
                Jméno
              </label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jméno administrátora"
                autoComplete="name"
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
            </div>
          ) : null}

          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="email"
              style={{
                display: 'block',
                marginBottom: 6,
                fontSize: 14,
                fontWeight: 600,
                color: '#111827',
              }}
            >
              {dictionary.auth.email}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@firma.cz"
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
          </div>

          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                marginBottom: 6,
                fontSize: 14,
                fontWeight: 600,
                color: '#111827',
              }}
            >
              {dictionary.auth.password}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              autoComplete="current-password"
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
          </div>

          {error ? (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                borderRadius: 8,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: 14,
              }}
            >
              {error}
            </div>
          ) : null}

          {notice ? (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                borderRadius: 8,
                background: '#ecfdf5',
                border: '1px solid #bbf7d0',
                color: '#166534',
                fontSize: 14,
              }}
            >
              {notice}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              height: 44,
              border: 'none',
              borderRadius: 8,
              background: loading ? '#9ca3af' : '#111827',
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading
              ? mode === 'sign-up'
                ? 'Vytvářím účet...'
                : dictionary.auth.signingIn
              : mode === 'sign-up'
                ? 'Vytvořit účet'
                : dictionary.auth.signIn}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode((current) => (current === 'sign-in' ? 'sign-up' : 'sign-in'))
            setError(null)
            setNotice(null)
          }}
          style={{
            width: '100%',
            marginTop: 12,
            border: 'none',
            background: 'transparent',
            color: '#2563eb',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {mode === 'sign-up' ? 'Už mám účet' : 'Vytvořit novou firmu'}
        </button>
      </div>
    </div>
  )
}

function LoginPageFallback() {
  const { dictionary } = useI18n()

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8fafc',
        padding: 16,
        boxSizing: 'border-box',
        fontFamily: 'Arial, sans-serif',
        color: '#111827',
      }}
    >
      {dictionary.auth.loading}
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageContent />
    </Suspense>
  )
}
