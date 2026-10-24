'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useI18n } from './I18nProvider'
import type { CompanyModuleKey } from '@/lib/company-settings-shared'
import AppIcon, { type AppIconName } from './ui/AppIcon'

type SidebarItemKey =
  | 'dashboard'
  | 'jobs'
  | 'calendar'
  | 'customers'
  | 'leads'
  | 'workers'
  | 'labor'
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
  | 'inventory'
  | 'setupGuide'
  | 'legalTerms'
  | 'legalPrivacy'
  | 'legalGdpr'

type DashboardSidebarProps = {
  officeEnabled?: boolean
  inventoryWarehouseId?: string
  activeItem?: SidebarItemKey
  enabledModules?: Partial<Record<CompanyModuleKey, boolean>> | null
  availableProducts?: string[]
  showModuleCatalog?: boolean
  showCoreNavigation?: boolean
  mobileOpen?: boolean
  onNavigate?: () => void
  compact?: boolean
  documentNavigation?: boolean
  onExpand?: () => void
}

export default function DashboardSidebar({
  officeEnabled = false,
  inventoryWarehouseId = '',
  activeItem,
  enabledModules = null,
  availableProducts = [],
  showModuleCatalog = false,
  showCoreNavigation = false,
  mobileOpen = false,
  onNavigate,
  compact = false,
  documentNavigation = false,
  onExpand,
}: DashboardSidebarProps) {
  const pathname = usePathname()
  // Office uses document navigation so pending edits can block leaving.
  const NavigationLink = documentNavigation ? 'a' : Link
  const { dictionary, locale } = useI18n()
  const sidebarRef = useRef<HTMLElement>(null)
  const navigationText = {
    cs: { core: 'ZÁKLAD', modules: 'Základ a moduly', label: 'Hlavní navigace' },
    en: { core: 'CORE', modules: 'Core and modules', label: 'Main navigation' },
    de: { core: 'BASIS', modules: 'Basis und Module', label: 'Hauptnavigation' },
  }[locale]

  useEffect(() => {
    if (!mobileOpen || !window.matchMedia('(max-width: 767px)').matches) return
    const sidebar = sidebarRef.current
    if (!sidebar) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sidebar.querySelector<HTMLButtonElement>('.dashboard-sidebar-close')?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onNavigate?.()
      }
      if (event.key !== 'Tab' || !sidebar) return
      const controls = Array.from(sidebar.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary'))
        .filter((element) => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    function handleResize() {
      if (!window.matchMedia('(max-width: 767px)').matches) onNavigate?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleResize)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleResize)
    }
  }, [mobileOpen, onNavigate])

  type NavItem = { href: string; label: string; key: SidebarItemKey; icon: AppIconName; module?: CompanyModuleKey }
  const primaryItems: NavItem[] = [
    { href: '/', label: dictionary.navigation.dashboard, key: 'dashboard', icon: 'dashboard' },
    { href: '/jobs', label: dictionary.navigation.jobs, key: 'jobs', icon: 'jobs', module: 'jobs' },
    { href: '/customers', label: dictionary.navigation.customers, key: 'customers', icon: 'customers' },
    { href: '/calendar', label: dictionary.navigation.calendar, key: 'calendar', icon: 'calendar', module: 'calendar' },
    { href: '/workers', label: dictionary.navigation.workers, key: 'workers', icon: 'workers', module: 'workers' },
    { href: '/invoices', label: dictionary.navigation.invoices, key: 'invoices', icon: 'invoices', module: 'invoices' },
  ]
  const moreItems: NavItem[] = [
    { href: '/cenove-nabidky', label: dictionary.navigation.quotes, key: 'quotes', icon: 'quotes', module: 'quotes' },
    { href: '/kalkulace', label: dictionary.navigation.calculations, key: 'kalkulace', icon: 'costs', module: 'quotes' },
    { href: '/costs', label: dictionary.navigation.costs, key: 'costs', icon: 'costs', module: 'finance' },
    { href: '/labor', label: { cs: 'Pracovní výkazy', en: 'Work submissions', de: 'Arbeitsnachweise' }[locale], key: 'labor', icon: 'calendar', module: 'workers' },
    { href: '/absences', label: dictionary.navigation.absences, key: 'absences', icon: 'calendar', module: 'workers' },
    { href: '/advance-requests', label: dictionary.navigation.advanceRequests, key: 'advanceRequests', icon: 'costs', module: 'payroll' },
  ]
  const productItems: (NavItem & { product: string })[] = [
    { href: '/smart-quotes', label: 'Chytré nabídky', key: 'modules', icon: 'quotes', product: 'smart_quotes' },
    { href: '/fleet', label: 'Vozidla', key: 'modules', icon: 'calendar', product: 'fleet' },
    { href: '/pos', label: 'DiriPOS', key: 'modules', icon: 'costs', product: 'pos' },
  ]
  const visibleProducts = productItems.filter(item => availableProducts.includes(item.product))
  const inventoryEnabled = availableProducts.includes('inventory')
  const inventoryActive = pathname === '/inventory' || pathname.startsWith('/inventory/')
  const inventoryText = {
    cs: { title: 'Sklad', stock: 'Zásoby', documents: 'Příjem a výdej', transfers: 'Převody', orders: 'Objednávky', suppliers: 'Dodavatelé', movements: 'Historie pohybů', warehouses: 'Nastavení skladů', ocr: 'Načíst doklad (OCR)', expand: 'Rozbalit navigaci' },
    en: { title: 'Inventory', stock: 'Stock', documents: 'Receipts and issues', transfers: 'Transfers', orders: 'Orders', suppliers: 'Suppliers', movements: 'Movement history', warehouses: 'Warehouse settings', ocr: 'Read document (OCR)', expand: 'Expand navigation' },
    de: { title: 'Lager', stock: 'Bestände', documents: 'Ein- und Ausgänge', transfers: 'Umlagerungen', orders: 'Bestellungen', suppliers: 'Lieferanten', movements: 'Bewegungen', warehouses: 'Lagereinstellungen', ocr: 'Beleg lesen (OCR)', expand: 'Navigation erweitern' },
  }[locale]
  const inventoryLinks = [
    ['stock', inventoryText.stock], ['documents', inventoryText.documents], ['documents&kind=transfer', inventoryText.transfers],
    ['orders', inventoryText.orders], ['suppliers', inventoryText.suppliers], ['movements', inventoryText.movements], ['warehouses', inventoryText.warehouses],
  ]
  const settingsItems: NavItem[] = showCoreNavigation ? [
    ...(showModuleCatalog ? [{ href: '/billing/modules', label: navigationText.modules, key: 'modules' as const, icon: 'modules' as const }] : []),
    { href: '/?onboarding=open', label: dictionary.navigation.setupGuide, key: 'setupGuide', icon: 'guide' },
    { href: '/settings/company', label: dictionary.navigation.companySettings, key: 'companySettings', icon: 'settings' },
  ] : []
  const isAvailable = (item: NavItem) => !item.module || enabledModules?.[item.module] !== false
  const isItemActive = (item: NavItem) => item.key === 'modules'
    ? pathname === item.href || pathname.startsWith(item.href + '/')
    : activeItem ? activeItem === item.key : pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
  const visibleMore = showCoreNavigation ? moreItems.filter(isAvailable) : []
  const moreLabel = { cs: 'Další agenda', en: 'More tools', de: 'Weitere Bereiche' }[locale]
  const workspaceLabel = { cs: 'Pracovní prostor', en: 'Workspace', de: 'Arbeitsbereich' }[locale]

  function renderItem(item: NavItem) {
    const isActive = isItemActive(item)
    return (
      <NavigationLink key={item.href} className={`dashboard-sidebar-link${isActive ? ' is-active' : ''}`} href={item.href}
        aria-label={item.label} title={compact ? item.label : undefined} aria-current={isActive ? 'page' : undefined} data-tour={`nav-${item.key}`} onClick={onNavigate}>
        <AppIcon name={item.icon} size={19} />
        <span>{item.label}</span>
      </NavigationLink>
    )
  }

  return (
    <aside id="dashboard-navigation" ref={sidebarRef} aria-label={navigationText.label}
      role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen ? true : undefined}
      className={`dashboard-sidebar${compact ? ' is-compact' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}>
      <div className="dq-sidebar-brand">
        {compact && <button type="button" className="office-navigation-expand" aria-label={inventoryText.expand} title={inventoryText.expand} onClick={onExpand}><AppIcon name="more" /></button>}
        <NavigationLink href={showCoreNavigation ? '/' : '/moje-prace'} aria-label="Diriqo" onClick={onNavigate}>
          <Image src="/diriqo-logo-icon.png" alt="" width={34} height={34} priority />
          <span>diriqo<span className="dq-brand-dot">.</span></span>
        </NavigationLink>
        <button type="button" className="dashboard-sidebar-close" aria-label={dictionary.common.closeMenu} onClick={onNavigate}>
          <AppIcon name="close" />
        </button>
      </div>
      <nav aria-label={navigationText.label} className="dashboard-sidebar-nav">
        <div className="dq-nav-section">
          <p className="dq-nav-label">{workspaceLabel}</p>
          {showCoreNavigation ? primaryItems.filter(isAvailable).map(renderItem) : renderItem({href: '/moje-prace', label: {cs:'Moje práce',en:'My work',de:'Meine Arbeit'}[locale], key:'dashboard',icon:'jobs'})}
          {renderItem({ href: '/diriqent', label: 'Diriqent', key: 'modules', icon: 'guide' })}
          {officeEnabled ? (
            // A new document prevents Office's global CSS/print rules from leaking to the host.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/office" onClick={onNavigate} className={`dashboard-sidebar-link${pathname === '/office' ? ' is-active' : ''}`} aria-label="Diriqo Office" title={compact ? 'Diriqo Office' : undefined} aria-current={pathname === '/office' ? 'page' : undefined}><AppIcon name="quotes" size={19} /><span>Diriqo Office</span></a>
          ) : null}
        </div>
        {visibleMore.length > 0 ? (
          <details className="dq-nav-more" open={visibleMore.some(isItemActive) ? true : undefined}>
            <summary aria-label={moreLabel} title={compact ? moreLabel : undefined} onClick={event => { if (compact) { event.preventDefault(); onExpand?.() } }}><AppIcon name="more" size={19} /><span>{moreLabel}</span><AppIcon name="down" size={15} /></summary>
            <div className="dq-nav-more-items">{visibleMore.map(renderItem)}</div>
          </details>
        ) : null}
        {visibleProducts.length > 0 || inventoryEnabled ? <div className="dq-nav-section">
          <p className="dq-nav-label">{ { cs: 'Vaše moduly', en: 'Your modules', de: 'Ihre Module' }[locale] }</p>
          {inventoryEnabled && <details className={`dq-nav-more dq-nav-inventory${inventoryActive ? ' is-active' : ''}`} open={!compact && inventoryActive ? true : undefined}>
            <summary aria-label={inventoryText.title} title={compact ? inventoryText.title : undefined} onClick={event => { if (compact) { event.preventDefault(); onExpand?.() } }}><AppIcon name="modules" size={19} /><span>{inventoryText.title}</span><AppIcon name="down" size={15} /></summary>
            <div className="dq-nav-more-items">{inventoryLinks.map(([tab, label]) => <NavigationLink key={tab} href={`/inventory?tab=${tab}${inventoryWarehouseId ? `&warehouse=${encodeURIComponent(inventoryWarehouseId)}` : ''}`} className="dashboard-sidebar-link" onClick={onNavigate}>{label}</NavigationLink>)}<NavigationLink href={`/diriqent/ocr?domain=inventory${inventoryWarehouseId ? `&warehouse=${encodeURIComponent(inventoryWarehouseId)}` : ''}`} className="dashboard-sidebar-link" onClick={onNavigate}>{inventoryText.ocr}</NavigationLink></div>
          </details>}
          {visibleProducts.map(renderItem)}
        </div> : null}
        {settingsItems.length > 0 ? <div className="dq-nav-section dq-nav-settings">
          <p className="dq-nav-label">{dictionary.navigation.settingsGroup}</p>
          {settingsItems.map(renderItem)}
        </div> : null}
      </nav>
      {showCoreNavigation ? <div className="dq-sidebar-footer">
        {renderItem({ href: '/help', label: dictionary.navigation.help, key: 'help', icon: 'help' })}
        <div className="dq-legal-links">
          <NavigationLink href="/settings/legal?doc=terms" onClick={onNavigate}>{dictionary.navigation.terms}</NavigationLink>
          <NavigationLink href="/settings/legal?doc=privacy" onClick={onNavigate}>{dictionary.navigation.privacy}</NavigationLink>
          <NavigationLink href="/settings/legal?doc=dpa" onClick={onNavigate}>{dictionary.navigation.gdpr}</NavigationLink>
        </div>
      </div> : null}
    </aside>
  )
}
