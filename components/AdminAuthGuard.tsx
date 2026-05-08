'use client'

import { ReactNode, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { supabase } from '@/lib/supabase'
import { useI18n } from './I18nProvider'

type AdminAuthGuardProps = {
  children: ReactNode
}

export default function AdminAuthGuard({ children }: AdminAuthGuardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { dictionary } = useI18n()

  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    let mounted = true

    async function clearInvalidLocalSession() {
      await supabase.auth.signOut({ scope: 'local' })
    }

    async function checkAuth() {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession()

        if (!mounted) return

        if (error || !session) {
          await clearInvalidLocalSession()

          if (!mounted) return

          setAllowed(false)
          setLoading(false)

          if (pathname !== '/login') {
            router.replace('/login')
          }

          return
        }

        const activeCompanyResponse = await fetch('/api/active-company', {
          credentials: 'same-origin',
          cache: 'no-store',
        })

        if (!mounted) return

        if (!activeCompanyResponse.ok) {
          const portalUserResponse = await supabase
            .from('customer_portal_users')
            .select('id')
            .eq('auth_user_id', session.user.id)
            .eq('is_active', true)
            .maybeSingle()

          if (!mounted) return

          setAllowed(false)
          setLoading(false)

          if (portalUserResponse.data?.id) {
            router.replace('/portal')
            return
          }

          if (pathname !== '/onboarding') {
            router.replace('/onboarding')
          }

          return
        }

        setAllowed(true)
        setLoading(false)
      } catch {
        if (!mounted) return

        await clearInvalidLocalSession()

        if (!mounted) return

        setAllowed(false)
        setLoading(false)

        if (pathname !== '/login') {
          router.replace('/login')
        }
      }
    }

    void checkAuth()

    const timeout = window.setTimeout(() => {
      if (!mounted) return
      setLoading(false)
    }, 4000)

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return

      if (session) {
        void checkAuth()
        return
      }

      setAllowed(false)
      setLoading(false)

      if (pathname !== '/login') {
        router.replace('/login')
      }
    })

    return () => {
      mounted = false
      window.clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [dictionary.auth.verifyingSession, pathname, router])

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: 24,
            minWidth: 260,
            textAlign: 'center',
          }}
        >
          {dictionary.auth.verifyingSession}
        </div>
      </div>
    )
  }

  if (!allowed) {
    return null
  }

  return <>{children}</>
}
