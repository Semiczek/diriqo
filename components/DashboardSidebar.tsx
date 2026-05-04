'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useI18n } from './I18nProvider'

type SidebarItemKey =
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

type DashboardSidebarProps = {
  activeItem?: SidebarItemKey
  loggingOut?: boolean
  mobileOpen?: boolean
  onNavigate?: () => void
  onLogout?: () => void
}

export default function DashboardSidebar({
  activeItem,
  loggingOut = false,
  mobileOpen = false,
  onNavigate,
  onLogout,
}: DashboardSidebarProps) {
  const pathname = usePathname()
  const { dictionary } = useI18n()
  const activeCompanyName = dictionary.common.appName

  const menuGroups: Array<{
    title: string
    items: Array<{
      href: string
      label: string
      key: SidebarItemKey
      icon: string
    }>
  }> = [
    {
      title: 'HLAVNÍ',
      items: [
        { href: '/', label: dictionary.navigation.dashboard, key: 'dashboard', icon: '⌂' },
        { href: '/jobs', label: dictionary.navigation.jobs, key: 'jobs', icon: '▦' },
        { href: '/customers', label: dictionary.navigation.customers, key: 'customers', icon: '◇' },
      ],
    },
    {
      title: 'TÝM',
      items: [
        { href: '/workers', label: dictionary.navigation.workers, key: 'workers', icon: '◉' },
        { href: '/calendar', label: dictionary.navigation.calendar, key: 'calendar', icon: '□' },
        { href: '/absences', label: dictionary.navigation.absences, key: 'absences', icon: '!' },
        {
          href: '/advance-requests',
          label: dictionary.navigation.advanceRequests,
          key: 'advanceRequests',
          icon: '+',
        },
      ],
    },
    {
      title: 'FINANCE',
      items: [
        { href: '/invoices', label: 'Fakturace', key: 'invoices', icon: 'Kč' },
        { href: '/kalkulace', label: dictionary.navigation.calculations, key: 'kalkulace', icon: '∑' },
        { href: '/cenove-nabidky', label: dictionary.navigation.quotes, key: 'quotes', icon: '%' },
      ],
    },
    {
      title: 'NASTAVENÍ',
      items: [
        { href: '/ucet', label: 'Můj účet', key: 'account', icon: '?' },
      ],
    },
    {
      title: 'PODPORA',
      items: [
        { href: '/napoveda', label: dictionary.navigation.help, key: 'help', icon: '?' },
      ],
    },
  ]

  return (
    <>
      <aside
        className={`dashboard-sidebar${mobileOpen ? ' is-mobile-open' : ''}`}
        style={{
          width: '276px',
          background:
            'linear-gradient(180deg, rgba(5, 8, 22, 0.98) 0%, rgba(7, 19, 38, 0.98) 52%, rgba(8, 28, 47, 0.98) 100%)',
          backdropFilter: 'blur(18px)',
          color: '#ffffff',
          padding: '15px 14px 14px',
          boxSizing: 'border-box',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'hidden',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.04), 18px 0 52px rgba(2, 6, 23, 0.18)',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '-92px',
            top: '-72px',
            width: '230px',
            height: '210px',
            borderRadius: '999px',
            background: 'radial-gradient(circle, rgba(124, 58, 237, 0.18), transparent 66%)',
            filter: 'blur(8px)',
            pointerEvents: 'none',
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: '-120px',
            bottom: '8%',
            width: '220px',
            height: '260px',
            borderRadius: '999px',
            background: 'radial-gradient(circle, rgba(6, 182, 212, 0.13), transparent 68%)',
            filter: 'blur(10px)',
            pointerEvents: 'none',
          }}
        />

        <div style={{ position: 'relative', marginBottom: '9px', padding: '4px 2px 2px' }}>
          <button
            type="button"
            className="dashboard-sidebar-close"
            aria-label="Zavřít menu"
            onClick={onNavigate}
          >
            ×
          </button>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '8px',
              top: '4px',
              width: '138px',
              height: '66px',
              background: 'radial-gradient(circle at 18% 52%, rgba(124, 58, 237, 0.28), rgba(6, 182, 212, 0.12), transparent 68%)',
              filter: 'blur(16px)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'relative',
              width: '138px',
              maxWidth: '100%',
              height: '48px',
              marginBottom: '2px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <img
              src="/diriqo-logo-full.png"
              alt="Diriqo"
              style={{
                width: '100%',
                height: 'auto',
                objectFit: 'contain',
                objectPosition: 'left center',
                filter: 'drop-shadow(0 10px 22px rgba(6, 182, 212, 0.18))',
              }}
            />
          </div>
        </div>

        <nav className="dashboard-sidebar-nav" style={{ position: 'relative', zIndex: 1, display: 'grid', gap: '9px', flex: 1, minHeight: 0 }}>
          {menuGroups.filter((group) => group.items.some((item) => item.key !== 'account')).map((group) => (
            <div key={group.title} style={{ display: 'grid', gap: '4px' }}>
              <div
                style={{
                  padding: '0 10px 2px',
                  fontSize: '10px',
                  letterSpacing: '0.14em',
                  color: 'rgba(226, 232, 240, 0.52)',
                  fontWeight: 900,
                }}
              >
                {group.title}
              </div>
              {group.items.filter((item) => item.key !== 'account').map((item) => {
                const isPathActive =
                  pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(item.href))
                const isActive = activeItem ? activeItem === item.key : isPathActive

                return (
                  <Link
                    key={item.href}
                    className={`dashboard-sidebar-link${isActive ? ' is-active' : ''}`}
                    href={item.href}
                    onClick={onNavigate}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '9px',
                      padding: '7px 9px',
                      borderRadius: '13px',
                      textDecoration: 'none',
                      color: isActive ? '#ffffff' : 'rgba(248, 250, 252, 0.82)',
                      background: isActive
                        ? 'linear-gradient(135deg, rgba(124, 58, 237, 0.86) 0%, rgba(37, 99, 235, 0.72) 54%, rgba(6, 182, 212, 0.56) 100%)'
                        : 'rgba(255,255,255,0.035)',
                      border: isActive
                        ? '1px solid rgba(255,255,255,0.14)'
                        : '1px solid rgba(255,255,255,0.055)',
                      boxShadow: isActive
                        ? '0 16px 34px rgba(37, 99, 235, 0.24), 0 0 0 1px rgba(6, 182, 212, 0.08), inset 0 1px 0 rgba(255,255,255,0.16)'
                        : 'none',
                      fontWeight: isActive ? 850 : 680,
                      transition: 'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: '22px',
                          height: '22px',
                          borderRadius: '9px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          backgroundColor: isActive ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)',
                          border: isActive ? '1px solid rgba(255,255,255,0.22)' : '1px solid rgba(255,255,255,0.10)',
                          boxShadow: isActive ? 'inset 0 1px 0 rgba(255,255,255,0.16)' : 'inset 0 1px 0 rgba(255,255,255,0.05)',
                        }}
                      >
                        <span
                          style={{
                            width: isActive ? '10px' : '7px',
                            height: isActive ? '10px' : '7px',
                            borderRadius: '999px',
                            background: isActive
                              ? 'linear-gradient(135deg, #ffffff, #67e8f9)'
                              : 'rgba(203, 213, 225, 0.72)',
                            boxShadow: isActive ? '0 0 12px rgba(6, 182, 212, 0.6)' : 'none',
                          }}
                        />
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                    </span>
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div
          style={{
            display: 'none',
            marginTop: 'auto',
            paddingTop: '14px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            gap: '8px',
          }}
        >
          <div
            style={{
              padding: '12px',
              borderRadius: '18px',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.04))',
              border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
                  color: '#ffffff',
                  fontWeight: 950,
                  flexShrink: 0,
                }}
              >
                AA
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 850, color: '#ffffff' }}>Adam Admin</div>
                <div style={{ fontSize: '12px', color: 'rgba(226,232,240,0.72)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeCompanyName}
                </div>
              </div>
            </div>
            <Link href="/ucet" onClick={onNavigate} style={sidebarMiniLink}>
              Můj účet
            </Link>
          </div>

          <Link href="/napoveda" onClick={onNavigate} style={sidebarFooterLink}>
            <span>?</span>
            <span>{dictionary.navigation.help}</span>
          </Link>
          {onLogout ? (
            <button
              type="button"
              onClick={onLogout}
              disabled={loggingOut}
              style={{
                ...sidebarFooterLink,
                width: '100%',
                border: '1px solid rgba(255,255,255,0.1)',
                cursor: loggingOut ? 'default' : 'pointer',
                opacity: loggingOut ? 0.72 : 1,
              }}
            >
              <span>×</span>
              <span>{loggingOut ? dictionary.common.loggingOut : dictionary.common.logout}</span>
            </button>
          ) : null}
        </div>
      </aside>

      <style>{`
        .dashboard-sidebar-nav {
          max-height: none;
          overflow-y: auto;
          padding-right: 5px;
          padding-bottom: 6px;
          scrollbar-width: thin;
          scrollbar-color: rgba(148, 163, 184, 0.28) transparent;
        }

        .dashboard-sidebar-nav::-webkit-scrollbar {
          width: 5px;
        }

        .dashboard-sidebar-nav::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.26);
          border-radius: 999px;
        }

        .dashboard-sidebar-nav::-webkit-scrollbar-thumb:hover {
          background: rgba(6, 182, 212, 0.34);
        }

        @media (min-width: 1180px) and (min-height: 910px) {
          .dashboard-sidebar-nav {
            max-height: none;
            overflow-y: visible;
            padding-right: 0;
          }
        }

        @media (max-height: 820px), (max-width: 1024px), (hover: none) {
          .dashboard-sidebar {
            padding-bottom: 18px !important;
          }

          .dashboard-sidebar-nav {
            max-height: none;
          }
        }
      `}</style>
    </>
  )
}

const sidebarFooterLink = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '9px 11px',
  borderRadius: '14px',
  backgroundColor: 'rgba(255,255,255,0.045)',
  color: '#ffffff',
  textDecoration: 'none',
  fontSize: '13px',
  fontWeight: 800,
  boxSizing: 'border-box',
} as const

const sidebarMiniLink = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  padding: '8px 10px',
  borderRadius: '12px',
  backgroundColor: 'rgba(255,255,255,0.08)',
  color: '#ffffff',
  textDecoration: 'none',
  fontSize: '13px',
  fontWeight: 850,
} as const

