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

          if (pathname !== '/sign-in') {
            router.replace('/sign-in')
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

        if (pathname !== '/sign-in') {
          router.replace('/sign-in')
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
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return

      if (session) {
        if (event !== 'INITIAL_SESSION') {
          void checkAuth()
        }
        return
      }

      setAllowed(false)
      setLoading(false)

      if (pathname !== '/sign-in') {
        router.replace('/sign-in')
      }
    })

    return () => {
      mounted = false
      window.clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [pathname, router])

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
