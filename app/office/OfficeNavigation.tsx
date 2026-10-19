'use client'

import Image from 'next/image'
import { useRef, useState, useSyncExternalStore } from 'react'
import DashboardSidebar from '@/components/DashboardSidebar'
import type { CompanyModuleKey } from '@/lib/company-settings-shared'
import { officeRailMessages } from '@/lib/office/context-messages'
import type { OfficeLocale } from '@diriqo/office/core'
import styles from './office.module.css'

export type OfficeNavigationContext = {
  enabledModules: Partial<Record<CompanyModuleKey, boolean>> | null
  availableProducts: string[]
  showCoreNavigation: boolean
  showModuleCatalog: boolean
}

const mobileQuery = '(max-width: 767px)'
function subscribeToViewport(onChange: () => void) {
  const media = window.matchMedia(mobileQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
const isMobileViewport = () => window.matchMedia(mobileQuery).matches
const serverViewport = () => false

export default function OfficeNavigation({ navigation, companyName, locale, disabled = false }: {
  navigation: OfficeNavigationContext; companyName: string; locale: OfficeLocale; disabled?: boolean
}) {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const mobileToggle = useRef<HTMLButtonElement>(null)
  const backdrop = useRef<HTMLButtonElement>(null)
  const isMobile = useSyncExternalStore(subscribeToViewport, isMobileViewport, serverViewport)
  const expanded = isMobile ? mobileOpen : pinned || hovered || focused
  const messages = officeRailMessages[locale] ?? officeRailMessages.cs
  const collapse = (restoreFocus = false) => {
    if (restoreFocus) (isMobile ? mobileToggle : toggle).current?.focus()
    setMobileOpen(false); setPinned(false); setHovered(false); setFocused(false)
  }

  return <>
    <a className={styles.skip} href="#office-workspace-content">{messages.skip}</a>
    <div className={styles.rail}>
      <div className={styles.mobileBar}>
        <button ref={mobileToggle} type="button" className={styles.mobileToggle}
          aria-label={mobileOpen ? messages.collapse : messages.expand}
          aria-expanded={isMobile && mobileOpen} aria-controls="office-diriqo-navigation"
          onClick={() => { if (mobileOpen) collapse(true); else setMobileOpen(true) }}
          onKeyDown={event => { if (event.key === 'Escape' && mobileOpen) { event.preventDefault(); collapse(true) } }}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Image src="/diriqo-logo-icon.png" alt="" width={28} height={28} />
        <span className={styles.mobileBrand}>diriqo<span>.</span></span>
        <span className={styles.mobileOffice}>Office</span>
      </div>
      {expanded ? <button ref={backdrop} type="button" className={styles.railBackdrop} aria-label={messages.collapse}
        onClick={() => collapse(true)} tabIndex={-1} /> : null}
      <div className={styles.railFrame} data-expanded={expanded} inert={isMobile && !mobileOpen}
        onPointerEnter={event => { if (!isMobile && event.pointerType === 'mouse') setHovered(true) }}
        onPointerLeave={() => setHovered(false)}
        onFocusCapture={event => { if (!isMobile && !toggle.current?.contains(event.target as Node)) setFocused(true) }}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setFocused(false)
            const next = event.relatedTarget as Node | null
            if (isMobile && !mobileToggle.current?.contains(next) && !backdrop.current?.contains(next)) setMobileOpen(false)
          }
        }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); collapse(true) } }}>
        <button ref={toggle} type="button" className={styles.railToggle}
          aria-label={expanded ? messages.collapse : messages.expand} title={expanded ? messages.collapse : messages.expand}
          aria-expanded={expanded} aria-controls="office-diriqo-navigation"
          onClick={() => { if (expanded) collapse(); else setPinned(true) }}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>
            <path d={expanded ? 'm16 9-3 3 3 3' : 'm13 9 3 3-3 3'} />
          </svg>
          {expanded ? <span>Office</span> : null}
        </button>
        <div id="office-diriqo-navigation" className={styles.railMenu} inert={disabled}>
          <DashboardSidebar officeEnabled enabledModules={navigation.enabledModules}
            availableProducts={navigation.availableProducts} showCoreNavigation={navigation.showCoreNavigation}
            showModuleCatalog={navigation.showModuleCatalog} compact={!expanded} documentNavigation
            onExpand={() => { if (isMobile) setMobileOpen(true); else setPinned(true) }} onNavigate={() => collapse()} />
        </div>
        <div className={styles.railCompany} title={companyName}>
          <span aria-hidden="true" className={styles.companyMark}>{companyName.slice(0, 1).toUpperCase()}</span>
          {expanded ? <span>{companyName}</span> : <span className={styles.srOnly}>{companyName}</span>}
        </div>
      </div>
    </div>
  </>
}
