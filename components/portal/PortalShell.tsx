'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'

import { supabase } from '@/lib/supabase'

type PortalShellProps = {
  children: ReactNode
  title: string
  customerName?: string | null
}

const navItems = [
  { href: '/portal', label: 'Dashboard' },
  { href: '/portal/jobs', label: 'Zakázky' },
  { href: '/portal/offers', label: 'Nabídky' },
  { href: '/portal/invoices', label: 'Fakturace' },
] as const

export default function PortalShell({ children, title, customerName }: PortalShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)
  const activeHref =
    [...navItems]
      .sort((left, right) => right.href.length - left.href.length)
      .find((item) =>
        item.href === '/portal'
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`),
      )?.href ?? null

  async function handleLogout() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    router.replace('/portal/login')
    router.refresh()
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f5f7fb',
        color: '#111827',
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      <div
        className="portal-layout"
        style={{
          display: 'grid',
          gridTemplateColumns: '280px minmax(0, 1fr)',
          minHeight: '100vh',
        }}
      >
        <aside
          className="portal-sidebar"
          style={{
            background: 'linear-gradient(180deg, #171329 0%, #10172f 44%, #071923 100%)',
            color: '#ffffff',
            padding: '24px 20px',
            display: 'grid',
            alignContent: 'start',
            gap: '20px',
            borderRight: '1px solid rgba(0, 214, 255, 0.18)',
          }}
        >
          <div>
            <div
              style={{
                width: '178px',
                height: '64px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <img
                src="/diriqo-logo-full.png"
                alt="Diriqo Portal"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  objectPosition: 'left center',
                  filter: 'drop-shadow(0 0 14px rgba(0, 214, 255, 0.28))',
                }}
              />
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, lineHeight: 1.2 }}>
              {customerName || 'Zákaznický portál'}
            </div>
          </div>

          <nav style={{ display: 'grid', gap: '10px' }}>
            {navItems.map((item) => {
              const isActive = item.href === activeHref
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: 'block',
                    padding: '14px',
                    borderRadius: '10px',
                    textDecoration: 'none',
                    color: '#ffffff',
                    border: isActive
                      ? '1px solid rgba(0, 214, 255, 0.38)'
                      : '1px solid rgba(255,255,255,0.1)',
                    background: isActive
                      ? 'linear-gradient(135deg, rgba(236, 0, 255, 0.24), rgba(0, 174, 255, 0.2))'
                      : 'rgba(255,255,255,0.03)',
                    boxShadow: isActive
                      ? '0 0 24px rgba(0, 174, 255, 0.14), inset 0 0 18px rgba(236, 0, 255, 0.1)'
                      : 'none',
                    fontWeight: isActive ? 700 : 500,
                  }}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </aside>

        <section className="portal-main" style={{ padding: '32px 24px', minWidth: 0 }}>
          <div className="portal-main-inner" style={{ maxWidth: '1100px', margin: '0 auto' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '16px',
                flexWrap: 'wrap',
                marginBottom: '24px',
              }}
            >
              <div>
                <h1 style={{ margin: 0, fontSize: '34px', lineHeight: 1.1 }}>{title}</h1>
                <p style={{ margin: '8px 0 0 0', color: '#6b7280' }}>
                  Přehled pouze customer-safe dat pro váš účet.
                </p>
              </div>

              <div
                style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}
              >
                <Link
                  href="/portal/change-password"
                  style={{
                    textDecoration: 'none',
                    border: '1px solid #d1d5db',
                    backgroundColor: '#ffffff',
                    color: '#111827',
                    borderRadius: '12px',
                    padding: '10px 14px',
                    fontSize: '14px',
                    fontWeight: 700,
                  }}
                >
                  Změnit heslo
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  style={{
                    border: '1px solid #d1d5db',
                    backgroundColor: '#ffffff',
                    color: '#111827',
                    borderRadius: '12px',
                    padding: '10px 14px',
                    fontSize: '14px',
                    fontWeight: 700,
                    cursor: loggingOut ? 'default' : 'pointer',
                  }}
                >
                  {loggingOut ? 'Odhlašuji...' : 'Odhlásit se'}
                </button>
              </div>
            </div>

            {children}
          </div>
        </section>
      </div>
    </main>
  )
}
