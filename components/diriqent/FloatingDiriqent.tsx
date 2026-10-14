'use client'

import dynamic from 'next/dynamic'
import { useRef, useState, type RefObject } from 'react'
import styles from './floating-diriqent.module.css'

// The closed launcher has no requests, timers, chat state or AI dependencies.
const DiriqentPanel = dynamic(() => import('./DiriqentPanel'), { ssr: false })

type Props = {
  launcherRef?: RefObject<HTMLButtonElement | null>
  guideActive?: boolean
  onToggleGuide?: () => void
  onOpenGuide?: () => void
  keepWorkspaceOpen?: boolean
}

export default function FloatingDiriqent({ launcherRef, guideActive = false, onToggleGuide, onOpenGuide, keepWorkspaceOpen = false }: Props) {
  const ownRef = useRef<HTMLButtonElement>(null)
  const buttonRef = launcherRef ?? ownRef
  const [open, setOpen] = useState(false)
  function close() {
    setOpen(false)
    buttonRef.current?.focus({ preventScroll: true })
  }
  return <>
    <button ref={buttonRef} type="button" className={styles.launcher} data-tour="floating-help-button"
      aria-label={guideActive ? 'Otevřít průvodce aplikací' : 'Otevřít Diriqenta – podpora zdarma'}
      aria-haspopup="dialog" aria-expanded={open || guideActive} aria-controls={open ? 'floating-diriqent' : undefined}
      title="Diriqent – váš pomocník v Diriqu"
      onClick={() => guideActive && onToggleGuide ? onToggleGuide() : setOpen(true)}>
      <svg className={styles.character} viewBox="0 0 80 86" fill="none" aria-hidden="true">
        <ellipse cx="39" cy="80" rx="25" ry="4" fill="#d9d1f1" />
        <path d="M28 61 25 76M48 61 52 76" stroke="#514078" strokeWidth="9" strokeLinecap="round" />
        <path d="M25 43C15 44 12 52 12 59M51 44C62 43 64 32 66 27" stroke="#9273ed" strokeWidth="9" strokeLinecap="round" />
        <path d="M25 47C25 39 51 39 51 47L54 64C46 70 29 70 22 64Z" fill="#7952d6" />
        <path d="m34 46 5 6 5-6" stroke="#ede6ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="16" y="7" width="45" height="36" rx="17" fill="#f7f3ff" stroke="#7952d6" strokeWidth="3" />
        <path d="M23 15C31 8 48 9 53 15" stroke="#ddd0ff" strokeWidth="4" strokeLinecap="round" />
        <ellipse cx="30" cy="25" rx="3" ry="4" fill="#433061" /><ellipse cx="47" cy="25" rx="3" ry="4" fill="#433061" />
        <path d="M33 33Q39 38 45 33" stroke="#7952d6" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="67" cy="23" r="6" fill="#f7f3ff" stroke="#7952d6" strokeWidth="2" />
      </svg>
      <span>Diriqent</span>
    </button>
    {open && <DiriqentPanel onClose={close} keepWorkspaceOpen={keepWorkspaceOpen} onOpenGuide={onOpenGuide ? () => { close(); onOpenGuide() } : undefined} />}
  </>
}
