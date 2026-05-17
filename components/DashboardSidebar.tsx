'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useI18n } from './I18nProvider'
import type { CompanyModuleKey } from '@/lib/company-settings-shared'

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
  | 'costs'
  | 'help'
  | 'account'
  | 'companySettings'
  | 'billing'
  | 'setupGuide'

type DashboardSidebarProps = {
  activeItem?: SidebarItemKey
  enabledModules?: Partial<Record<CompanyModuleKey, boolean>> | null
  mobileOpen?: boolean
  onNavigate?: () => void
}

export default function DashboardSidebar({
  activeItem,
  enabledModules = null,
  mobileOpen = false,
  onNavigate,
}: DashboardSidebarProps) {
  const pathname = usePathname()
  const { dictionary } = useI18n()

  const menuGroups: Array<{
    title: string
    items: Array<{
      href: string
      label: string
      key: SidebarItemKey
      icon: string
      module?: CompanyModuleKey
    }>
  }> = [
    {
      title: dictionary.navigation.mainGroup,
      items: [
        { href: '/', label: dictionary.navigation.dashboard, key: 'dashboard', icon: 'P' },
        { href: '/jobs', label: dictionary.navigation.jobs, key: 'jobs', icon: 'Z', module: 'jobs' },
        { href: '/customers', label: dictionary.navigation.customers, key: 'customers', icon: 'K' },
      ],
    },
    {
      title: dictionary.navigation.teamGroup,
      items: [
        { href: '/workers', label: dictionary.navigation.workers, key: 'workers', icon: 'T', module: 'workers' },
        { href: '/calendar', label: dictionary.navigation.calendar, key: 'calendar', icon: 'C', module: 'calendar' },
        { href: '/absences', label: dictionary.navigation.absences, key: 'absences', icon: '!', module: 'workers' },
        {
          href: '/advance-requests',
          label: dictionary.navigation.advanceRequests,
          key: 'advanceRequests',
          icon: '+',
          module: 'payroll',
        },
      ],
    },
    {
      title: dictionary.navigation.financeGroup,
      items: [
        { href: '/invoices', label: dictionary.navigation.invoices, key: 'invoices', icon: 'Kč', module: 'invoices' },
        { href: '/costs', label: dictionary.navigation.costs, key: 'costs', icon: 'N', module: 'finance' },
        { href: '/kalkulace', label: dictionary.navigation.calculations, key: 'kalkulace', icon: 'Σ', module: 'quotes' },
        { href: '/cenove-nabidky', label: dictionary.navigation.quotes, key: 'quotes', icon: '%', module: 'quotes' },
      ],
    },
    {
      title: dictionary.navigation.settingsGroup,
      items: [
        { href: '/settings/company', label: dictionary.navigation.companySettings, key: 'companySettings', icon: 'S' },
        { href: '/?onboarding=open', label: dictionary.navigation.setupGuide, key: 'setupGuide', icon: 'OK' },
        { href: '/ucet', label: dictionary.navigation.account, key: 'account', icon: '?' },
      ],
    },
    {
      title: dictionary.navigation.supportGroup,
      items: [
        { href: '/help', label: dictionary.navigation.help, key: 'help', icon: '?' },
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
            style={{
              position: 'relative',
              width: '184px',
              maxWidth: '100%',
              height: '64px',
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Image
              src="/diriqo-logo-full.png"
              alt="Diriqo"
              fill
              priority
              sizes="184px"
              style={{
                objectFit: 'contain',
                objectPosition: 'left center',
                filter: 'drop-shadow(0 10px 22px rgba(6, 182, 212, 0.18))',
              }}
            />
          </div>
        </div>

        <nav className="dashboard-sidebar-nav" style={{ position: 'relative', zIndex: 1, display: 'grid', gap: '9px', flex: 1, minHeight: 0 }}>
          {menuGroups
            .map((group) => ({
              ...group,
              items: group.items.filter(
                (item) =>
                  item.key !== 'account' &&
                  (!item.module || enabledModules?.[item.module] !== false)
              ),
            }))
            .filter((group) => group.items.length > 0)
            .map((group) => (
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
              {group.items.map((item) => {
                const isPathActive =
                  pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(item.href))
                const isActive = activeItem ? activeItem === item.key : isPathActive

                return (
                  <Link
                    key={item.href}
                    className={`dashboard-sidebar-link${isActive ? ' is-active' : ''}`}
                    href={item.href}
                    data-tour={`nav-${item.key}`}
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


