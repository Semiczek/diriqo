'use client'

import Link from 'next/link'
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { supabase } from '@/lib/supabase'
import { notifyOfficeContextChanged } from '@/lib/office/client-context'
import AdminAuthGuard from './AdminAuthGuard'
import DashboardSidebar from './DashboardSidebar'
import AppIcon from './ui/AppIcon'
import FloatingHelpWidget from './FloatingHelpWidget'
import LegalConsentGate from './legal/LegalConsentGate'
import LanguageSwitcher from './LanguageSwitcher'
import { useI18n } from './I18nProvider'
import type { CompanyModuleKey } from '@/lib/company-settings-shared'
import { getCompanyRoleLabel } from '@/lib/hub-access'

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
    | 'costs'
    | 'help'
    | 'account'
    | 'companySettings'
    | 'billing'
    | 'modules'
    | 'setupGuide'
    | 'legalTerms'
    | 'legalPrivacy'
    | 'legalGdpr'
}

type CompanyMembership = {
  id: string | null
  companyId: string
  companyName: string | null
  role: string | null
  isActive: boolean
}

type ActiveCompanyPayload = {
  officeEnabled?: boolean
  companyId: string
  companyName: string | null
  profileId?: string | null
  profileName?: string | null
  profileEmail?: string | null
  role?: string | null
  companyMemberships: CompanyMembership[]
}

type CompanyModulesPayload = {
  modules?: Partial<Record<CompanyModuleKey, boolean>>
  companyId?: string
  availableProducts?: string[]
}

type DashboardContextPayload = {
  activeCompany: ActiveCompanyPayload
  modules: Partial<Record<CompanyModuleKey, boolean>> | null
  availableProducts: string[]
}

let dashboardContextCache: { value: DashboardContextPayload; expiresAt: number } | null = null

function clearDashboardContextCache() {
  dashboardContextCache = null
}
let dashboardContextPromise: Promise<DashboardContextPayload> | null = null

async function loadDashboardContext() {
  if (dashboardContextCache && dashboardContextCache.expiresAt > Date.now()) {
    return dashboardContextCache.value
  }

  dashboardContextPromise ??= Promise.all([
    fetch('/api/active-company', { cache: 'no-store' }),
    fetch('/api/company-modules', { cache: 'no-store' }),
  ])
    .then(async ([response, modulesResponse]) => {
      if (!response.ok) {
        throw new Error('active-company-load-failed')
      }

      const payload = (await response.json()) as ActiveCompanyPayload
      const modulesPayload = modulesResponse.ok
        ? ((await modulesResponse.json().catch(() => null)) as CompanyModulesPayload | null)
        : null

      const nextPayload: DashboardContextPayload = {
        activeCompany: payload,
        modules: modulesPayload?.companyId === payload.companyId ? modulesPayload.modules ?? null : null,
        availableProducts: modulesPayload?.companyId === payload.companyId ? modulesPayload.availableProducts ?? [] : [],
      }

      dashboardContextCache = {
        value: nextPayload,
        expiresAt: Date.now() + 10_000,
      }

      return nextPayload
    })
    .finally(() => {
      dashboardContextPromise = null
    })

  return dashboardContextPromise
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
  const mobileMenuOpenerRef = useRef<HTMLButtonElement | null>(null)
  const [activeCompany, setActiveCompany] = useState<ActiveCompanyPayload | null>(null)
  const [companyModules, setCompanyModules] = useState<Partial<Record<CompanyModuleKey, boolean>> | null>(null)
  const [availableProducts, setAvailableProducts] = useState<string[]>([])
  const [activeCompanyLoading, setActiveCompanyLoading] = useState(true)
  const [companySwitchError, setCompanySwitchError] = useState<string | null>(null)
  const { dictionary } = useI18n()
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), [])

  useEffect(() => {
    if (mobileMenuOpen) return
    const opener = mobileMenuOpenerRef.current
    mobileMenuOpenerRef.current = null
    // The closed state has removed inert before focus returns to the opener.
    if (opener?.isConnected && window.matchMedia('(max-width: 767px)').matches) {
      opener.focus({ preventScroll: true })
    }
  }, [mobileMenuOpen])

  useEffect(() => {
    let cancelled = false

    async function loadActiveCompany() {
      setActiveCompanyLoading(true)
      try {
        const payload = await loadDashboardContext()

        if (!cancelled) {
          setActiveCompany({
            companyId: payload.activeCompany.companyId,
            companyName: payload.activeCompany.companyName?.trim() || null,
            profileId: payload.activeCompany.profileId ?? null,
            profileName: payload.activeCompany.profileName?.trim() || null,
            profileEmail: payload.activeCompany.profileEmail?.trim() || null,
            role: payload.activeCompany.role ?? null,
            companyMemberships: payload.activeCompany.companyMemberships ?? [],
            officeEnabled: payload.activeCompany.officeEnabled === true,
          })
          setCompanyModules(payload.modules)
          setAvailableProducts(payload.availableProducts)
          setCompanySwitchError(null)
        }

      } catch {
        if (!cancelled) setCompanySwitchError(dictionary.common.activeCompanyLoadFailed)
      } finally {
        if (!cancelled) setActiveCompanyLoading(false)
      }
    }

    void loadActiveCompany()

    return () => {
      cancelled = true
    }
  }, [dictionary.common.activeCompanyLoadFailed])


  const topbarRef = useRef<HTMLElement>(null)
  const companyTriggerRef = useRef<HTMLButtonElement>(null)
  const userTriggerRef = useRef<HTMLButtonElement>(null)
  const { locale } = useI18n()
  const shellText = {
    cs: { skip: 'Přejít k obsahu', loading: 'Načítání' },
    en: { skip: 'Skip to content', loading: 'Loading' },
    de: { skip: 'Zum Inhalt', loading: 'Wird geladen' },
  }[locale]

  useEffect(() => {
    if (!companyMenuOpen && !userMenuOpen) return
    const trigger = companyMenuOpen ? companyTriggerRef.current : userTriggerRef.current
    function close() { setCompanyMenuOpen(false); setUserMenuOpen(false) }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !topbarRef.current?.contains(event.target)) close()
    }
    function onFocusIn(event: FocusEvent) {
      if (event.target instanceof Node && !topbarRef.current?.contains(event.target)) close()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close(); trigger?.focus() }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [companyMenuOpen, userMenuOpen])

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

    notifyOfficeContextChanged()
    router.replace('/sign-in')
  }

  async function handleCompanySwitch(companyId: string) {
    if (!companyId || switchingCompanyId) return

    if (companyId === activeCompany?.companyId) {
      setCompanyMenuOpen(false)
      return
    }

    setCompanySwitchError(null)
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
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        setCompanySwitchError(payload?.error || dictionary.common.companySwitchFailed)
        return
      }

      setCompanyMenuOpen(false)
      setUserMenuOpen(false)
      clearDashboardContextCache()
      notifyOfficeContextChanged()
      // Reload the workspace so client state and server data use the same company.
      window.location.assign('/')
    } catch {
      setCompanySwitchError(dictionary.common.companySwitchFailed)
    } finally {
      setSwitchingCompanyId(null)
    }
  }

  const activeCompanyName = activeCompany?.companyName || dictionary.common.appName
  const companyMemberships = activeCompany?.companyMemberships ?? []
  const userDisplayName =
    activeCompany?.profileName || activeCompany?.profileEmail || dictionary.common.userFallback
  const userSubtitle = activeCompany?.profileEmail || (activeCompany ? getCompanyRoleLabel(activeCompany.role) : '')
  const userInitials = getUserInitials(activeCompany?.profileName, activeCompany?.profileEmail)
  const canManageModules = ['company_admin', 'super_admin'].includes((activeCompany?.role ?? '').trim().toLowerCase())

  return (
    <AdminAuthGuard>
      <div className="dq-app">
        <a href="#workspace-content" className="dq-skip-link">{shellText.skip}</a>
        <div className="dashboard-layout">
          {mobileMenuOpen ? <button type="button" className="dashboard-sidebar-backdrop" aria-label={dictionary.common.closeMenu} onClick={closeMobileMenu} /> : null}
          <DashboardSidebar officeEnabled={activeCompany?.officeEnabled === true} activeItem={activeItem} enabledModules={companyModules} availableProducts={availableProducts} showModuleCatalog={canManageModules} showCoreNavigation={canManageModules}
            mobileOpen={mobileMenuOpen} onNavigate={closeMobileMenu} />
          <div className="dashboard-main" inert={mobileMenuOpen}>
            <header className="dashboard-topbar" ref={topbarRef}>
              <div className="dq-topbar-start">
                <button type="button" className="dashboard-mobile-menu-button" aria-label={dictionary.common.openMenu}
                  aria-expanded={mobileMenuOpen} aria-controls="dashboard-navigation"
                  onClick={(event) => {
                    mobileMenuOpenerRef.current = event.currentTarget
                    setCompanyMenuOpen(false)
                    setUserMenuOpen(false)
                    setMobileMenuOpen(true)
                  }}><AppIcon name="more" /></button>
                <div className="dq-company-switcher">
                  <button ref={companyTriggerRef} type="button" className="dq-company-trigger"
                    disabled={activeCompanyLoading} onClick={() => { setCompanyMenuOpen((open) => !open); setUserMenuOpen(false) }}
                    aria-expanded={companyMenuOpen} aria-controls="company-switcher-panel">
                    <span className="dq-company-avatar"><AppIcon name="company" size={18} /></span>
                    <span className="dq-company-name">{activeCompanyName}</span><AppIcon name="down" size={14} />
                  </button>
                  {companyMenuOpen ? (
                    <div id="company-switcher-panel" className="dq-popover dq-company-popover">
                      <p className="dq-popover-label">{dictionary.common.activeCompany}</p>
                      {companySwitchError ? <p className="dq-inline-error" role="alert">{companySwitchError}</p> : null}
                      {companyMemberships.length > 0 ? companyMemberships.map((membership) => {
                        const isActive = membership.companyId === activeCompany?.companyId
                        const isSwitching = switchingCompanyId === membership.companyId
                        return <button key={membership.companyId} type="button" className={`dq-company-option${isActive ? ' is-current' : ''}`}
                          aria-pressed={isActive} onClick={() => void handleCompanySwitch(membership.companyId)}
                          disabled={activeCompanyLoading || Boolean(switchingCompanyId)}>
                          <span><strong>{membership.companyName || dictionary.common.unnamedCompany}</strong>
                            {membership.role ? <small>{getCompanyRoleLabel(membership.role)}</small> : null}</span>
                          {isSwitching ? <span aria-label={shellText.loading}>…</span> : isActive ? <AppIcon name="check" size={17} /> : null}
                        </button>
                      }) : <p className="dq-popover-empty">{dictionary.common.noOtherCompanyAvailable}</p>}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="dashboard-topbar-actions">
                {canManageModules ? <Link href="/help" className="dq-header-help"><AppIcon name="help" size={18} /><span>{dictionary.navigation.help}</span></Link> : null}
                <div className="dq-user-switcher">
                  <button ref={userTriggerRef} type="button" className="dq-user-trigger" aria-label={userDisplayName}
                    aria-expanded={userMenuOpen} aria-controls="user-account-panel"
                    onClick={() => { setUserMenuOpen((open) => !open); setCompanyMenuOpen(false) }}>
                    <span className="dq-user-avatar">{userInitials}</span>
                    <span className="dq-user-name">{userDisplayName}</span><AppIcon name="down" size={14} />
                  </button>
                  {userMenuOpen ? (
                    <div id="user-account-panel" className="dq-popover dq-user-popover">
                      <div className="dq-user-summary"><strong>{userDisplayName}</strong>{userSubtitle ? <small>{userSubtitle}</small> : null}</div>
                      {canManageModules ? <Link className="dq-popover-item" href="/ucet" onClick={() => setUserMenuOpen(false)}><AppIcon name="workers" size={18} />{dictionary.navigation.account}</Link> : null}
                      <div className="dq-language-setting"><LanguageSwitcher compact /></div>
                      <button className="dq-popover-item" type="button" onClick={handleLogout} disabled={loggingOut}>
                        <AppIcon name="logout" size={18} />{loggingOut ? dictionary.common.loggingOut : dictionary.common.logout}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </header>
            {companySwitchError && !companyMenuOpen ? <div className="dq-context-error" role="alert">{companySwitchError}</div> : null}
            <div id="workspace-content" tabIndex={-1} className="dashboard-main-inner">{children}</div>
            <LegalConsentGate />
            <FloatingHelpWidget activeItem={activeItem} />
          </div>
        </div>
      </div>
    </AdminAuthGuard>
  )
}

function getUserInitials(name?: string | null, email?: string | null) {
  const parts = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()

  const emailName = (email ?? '').split('@')[0]?.trim()
  return emailName ? emailName.slice(0, 2).toUpperCase() : 'U'
}

