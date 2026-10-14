'use client'

import dynamic from 'next/dynamic'
import Image from 'next/image'
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
      {/* Original shared Diriqent artwork, byte-identical to JSPD Hub's fallback asset. */}
      <Image className={styles.character} src="/diriqent/diriqent-web-v001.png"
        width={76} height={76} sizes="(max-width: 640px) 64px, 76px" alt="" draggable={false} />
      <span>Diriqent</span>
    </button>
    {open && <DiriqentPanel onClose={close} keepWorkspaceOpen={keepWorkspaceOpen} onOpenGuide={onOpenGuide ? () => { close(); onOpenGuide() } : undefined} />}
  </>
}
