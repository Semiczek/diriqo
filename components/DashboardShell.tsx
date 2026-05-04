'use client'

import Link from 'next/link'
import { ReactNode, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { supabase } from '@/lib/supabase'
import AdminAuthGuard from './AdminAuthGuard'
import DashboardSidebar from './DashboardSidebar'
import LanguageSwitcher from './LanguageSwitcher'
import { useI18n } from './I18nProvider'

type DashboardShellProps = {
  children: ReactNode
  activeItem?:
    | 'dashboard'
    | 'jobs'
    | 'calendar'
    | 'customers'
    | 'leads'
    | 'workers'
    | 'advanceRequests'
    | 'absences'
    | 'kalkulace'
    | 'quotes'
    | 'invoices'
    | 'help'
    | 'account'
}

type CompanyMembership = {
  id: string | null
  companyId: string
  companyName: string | null
  role: string | null
  isActive: boolean
}

type ActiveCompanyPayload = {
  companyId: string
  companyName: string | null
  companyMemberships: CompanyMembership[]
}

export default function DashboardShell({
  children,
  activeItem = 'dashboard',
}: DashboardShellProps) {
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false)
  const [switchingCompanyId, setSwitchingCompanyId] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeCompany, setActiveCompany] = useState<ActiveCompanyPayload | null>(null)
  const { dictionary } = useI18n()

  useEffect(() => {
    let cancelled = false

    async function loadActiveCompany() {
      try {
        const response = await fetch('/api/active-company', { cache: 'no-store' })

        if (!response.ok) return

        const payload = (await response.json()) as ActiveCompanyPayload

        if (!cancelled) {
          setActiveCompany({
            companyId: payload.companyId,
            companyName: payload.companyName?.trim() || null,
            companyMemberships: payload.companyMemberships ?? [],
          })
        }
      } catch {
      }
    }

    void loadActiveCompany()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleLogout() {
    setUserMenuOpen(false)
    setCompanyMenuOpen(false)
    setLoggingOut(true)

    const { error } = await supabase.auth.signOut()

    if (error) {
      alert(error.message || dictionary.common.logoutFailed)
      setLoggingOut(false)
      return
    }

    router.replace('/login')
  }

  async function handleCompanySwitch(companyId: string) {
    if (!companyId || switchingCompanyId) return

    if (companyId === activeCompany?.companyId) {
      setCompanyMenuOpen(false)
      return
    }

    setSwitchingCompanyId(companyId)

    try {
      const response = await fetch('/api/active-company', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ companyId }),
      })

      if (!response.ok) {
        alert('Firmu se nepodařilo přepnout.')
        return
      }

      setCompanyMenuOpen(false)
      setUserMenuOpen(false)
      router.replace('/')
      router.refresh()
    } finally {
      setSwitchingCompanyId(null)
    }
  }

  const activeCompanyName = activeCompany?.companyName || dictionary.common.appName
  const companyMemberships = activeCompany?.companyMemberships ?? []

  return (
    <AdminAuthGuard>
      <main
        style={{
          minHeight: '100vh',
          background: 'linear-gradient(180deg, #f7f9fd 0%, #eef4fb 100%)',
          color: '#111827',
        }}
      >
        <div
          className="dashboard-layout"
          style={{
            display: 'flex',
            minHeight: '100vh',
          }}
        >
          {mobileMenuOpen ? (
            <button
              type="button"
              className="dashboard-sidebar-backdrop"
              aria-label="Zavřít menu"
              onClick={() => setMobileMenuOpen(false)}
            />
          ) : null}

          <DashboardSidebar
            activeItem={activeItem}
            mobileOpen={mobileMenuOpen}
            onNavigate={() => setMobileMenuOpen(false)}
          />

          <section
            className="dashboard-main"
            style={{
              flex: 1,
              padding: '18px 28px 32px',
              minWidth: 0,
            }}
          >
            <div
              className="dashboard-main-inner"
              style={{
                maxWidth: '1200px',
                margin: '0 auto',
                width: '100%',
              }}
            >
              <div
                className="dashboard-topbar"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '10px',
                  flexWrap: 'wrap',
                  marginBottom: '14px',
                  padding: '7px 10px',
                  borderRadius: '16px',
                  backgroundColor: 'rgba(255,255,255,0.72)',
                  border: '1px solid rgba(226, 232, 240, 0.9)',
                  boxShadow: '0 12px 26px rgba(15, 23, 42, 0.05)',
                  backdropFilter: 'blur(14px)',
                  position: 'relative',
                  zIndex: 100,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <button
                    type="button"
                    className="dashboard-mobile-menu-button"
                    aria-label="Otevřít menu"
                    aria-expanded={mobileMenuOpen}
                    onClick={() => setMobileMenuOpen(true)}
                  >
                    <span />
                    <span />
                    <span />
                  </button>
                  <div
                    className="dashboard-topbar-title"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px',
                      minWidth: 0,
                      color: '#64748b',
                      fontSize: '13px',
                      fontWeight: 800,
                    }}
                  >
                    <span style={{ position: 'relative', minWidth: 0 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setCompanyMenuOpen((open) => !open)
                          setUserMenuOpen(false)
                        }}
                        aria-expanded={companyMenuOpen}
                        aria-haspopup="menu"
                        style={{
                          maxWidth: '260px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '5px 9px',
                          borderRadius: '999px',
                          border: companyMenuOpen
                            ? '1px solid rgba(37, 99, 235, 0.28)'
                            : '1px solid rgba(148, 163, 184, 0.24)',
                          background: companyMenuOpen ? '#eef5ff' : 'rgba(255,255,255,0.72)',
                          color: '#334155',
                          fontSize: '13px',
                          fontWeight: 850,
                          cursor: 'pointer',
                          boxShadow: companyMenuOpen ? '0 10px 22px rgba(37, 99, 235, 0.12)' : 'none',
                        }}
                      >
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {activeCompanyName}
                        </span>
                        <span style={{ color: '#64748b', fontSize: '11px', lineHeight: 1 }}>
                          {companyMenuOpen ? '^' : 'v'}
                        </span>
                      </button>

                      {companyMenuOpen ? (
                        <div
                          role="menu"
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 'calc(100% + 10px)',
                            width: '280px',
                            borderRadius: '16px',
                            border: '1px solid rgba(148, 163, 184, 0.24)',
                            background: 'rgba(255,255,255,0.98)',
                            boxShadow: '0 22px 50px rgba(15, 23, 42, 0.16)',
                            padding: '8px',
                            zIndex: 1000,
                          }}
                        >
                          <div
                            style={{
                              padding: '7px 8px 8px',
                              color: '#64748b',
                              fontSize: '11px',
                              fontWeight: 900,
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                            }}
                          >
                            Aktivni firma
                          </div>
                          {companyMemberships.length > 0 ? (
                            companyMemberships.map((membership) => {
                              const isActive = membership.companyId === activeCompany?.companyId
                              const isSwitching = switchingCompanyId === membership.companyId

                              return (
                                <button
                                  key={membership.companyId}
                                  type="button"
                                  role="menuitem"
                                  onClick={() => void handleCompanySwitch(membership.companyId)}
                                  disabled={Boolean(switchingCompanyId)}
                                  className="topbar-company-menu-item"
                                  style={{
                                    width: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '10px',
                                    padding: '10px 9px',
                                    border: 0,
                                    borderRadius: '12px',
                                    background: isActive ? '#eef5ff' : 'transparent',
                                    color: '#0f172a',
                                    cursor: switchingCompanyId ? 'default' : 'pointer',
                                    textAlign: 'left',
                                  }}
                                >
                                  <span style={{ minWidth: 0 }}>
                                    <span
                                      style={{
                                        display: 'block',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        fontSize: '14px',
                                        fontWeight: 850,
                                      }}
                                    >
                                      {membership.companyName || 'Firma bez nazvu'}
                                    </span>
                                    {membership.role ? (
                                      <span
                                        style={{
                                          display: 'block',
                                          marginTop: '2px',
                                          color: '#64748b',
                                          fontSize: '12px',
                                          fontWeight: 700,
                                        }}
                                      >
                                        {membership.role}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span
                                    style={{
                                      width: '22px',
                                      height: '22px',
                                      borderRadius: '999px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0,
                                      background: isActive
                                        ? 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)'
                                        : '#f1f5f9',
                                      color: isActive ? '#ffffff' : '#94a3b8',
                                      fontSize: '12px',
                                      fontWeight: 950,
                                    }}
                                  >
                                    {isSwitching ? '...' : isActive ? '✓' : ''}
                                  </span>
                                </button>
                              )
                            })
                          ) : (
                            <div
                              style={{
                                padding: '10px 9px',
                                color: '#64748b',
                                fontSize: '13px',
                                fontWeight: 700,
                              }}
                            >
                              Zadna dalsi firma neni k dispozici.
                            </div>
                          )}
                        </div>
                      ) : null}
                    </span>
                  </div>
                </div>
                <div className="dashboard-topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <LanguageSwitcher compact />
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen((open) => !open)
                        setCompanyMenuOpen(false)
                      }}
                      aria-expanded={userMenuOpen}
                      aria-haspopup="menu"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 10px 6px 7px',
                        borderRadius: '999px',
                        backgroundColor: userMenuOpen ? '#eef5ff' : '#f8fafc',
                        border: userMenuOpen ? '1px solid rgba(37, 99, 235, 0.24)' : '1px solid #e2e8f0',
                        color: '#334155',
                        fontSize: '13px',
                        fontWeight: 850,
                        cursor: 'pointer',
                        boxShadow: userMenuOpen ? '0 10px 22px rgba(37, 99, 235, 0.12)' : 'none',
                      }}
                    >
                      <span
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '9px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
                          color: '#ffffff',
                          fontSize: '11px',
                          fontWeight: 950,
                        }}
                      >
                        AA
                      </span>
                      <span>Adam Admin</span>
                        <span style={{ color: '#64748b', fontSize: '12px', lineHeight: 1 }}>
                          {userMenuOpen ? '▲' : '▼'}
                        </span>
                    </button>

                    {userMenuOpen ? (
                      <div
                        role="menu"
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 'calc(100% + 10px)',
                          width: '230px',
                          borderRadius: '16px',
                          border: '1px solid rgba(148, 163, 184, 0.22)',
                          background: 'rgba(255,255,255,0.98)',
                          boxShadow: '0 22px 50px rgba(15, 23, 42, 0.16)',
                          padding: '10px',
                          zIndex: 1000,
                        }}
                      >
                        <div style={{ padding: '8px 9px 10px' }}>
                          <div style={{ color: '#0f172a', fontSize: '14px', fontWeight: 900 }}>
                            Adam Admin
                          </div>
                        </div>
                        <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0 7px' }} />
                        <Link className="topbar-user-menu-item" href="/ucet" onClick={() => setUserMenuOpen(false)} style={topbarMenuItem}>
                          Můj účet
                        </Link>
                        <Link className="topbar-user-menu-item" href="/napoveda" onClick={() => setUserMenuOpen(false)} style={topbarMenuItem}>
                          Nápověda
                        </Link>
                        <button
                          className="topbar-user-menu-item"
                          type="button"
                          onClick={handleLogout}
                          disabled={loggingOut}
                          style={{
                            ...topbarMenuItem,
                            width: '100%',
                            border: 0,
                            cursor: loggingOut ? 'default' : 'pointer',
                            opacity: loggingOut ? 0.72 : 1,
                            textAlign: 'left',
                          }}
                        >
                          {loggingOut ? dictionary.common.loggingOut : dictionary.common.logout}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {children}
              <Link
                href="/napoveda"
                className="floating-help-button"
                aria-label="Nápověda"
                title="Nápověda"
              >
                ?
              </Link>
              <style>{`
                .topbar-company-menu-item:hover {
                  background: #f8fafc !important;
                }

                .topbar-user-menu-item:hover {
                  background: #f1f5f9 !important;
                  color: #0f172a !important;
                }
              `}</style>
            </div>
          </section>
        </div>
      </main>
    </AdminAuthGuard>
  )
}

const topbarMenuItem = {
  display: 'block',
  borderRadius: '12px',
  padding: '10px 9px',
  background: 'transparent',
  color: '#334155',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 760,
  boxSizing: 'border-box',
} as const

function getActiveLabel(activeItem: DashboardShellProps['activeItem']) {
  if (activeItem === 'jobs') return 'Zakázky'
  if (activeItem === 'customers') return 'Zákazníci'
  if (activeItem === 'workers') return 'Pracovníci'
  if (activeItem === 'calendar') return 'Kalendář'
  if (activeItem === 'invoices') return 'Fakturace'
  if (activeItem === 'account') return 'Můj účet'
  if (activeItem === 'help') return 'Nápověda'
  return 'Přehled'
}
