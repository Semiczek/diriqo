'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react'

import {
  getPageHelpDefinition,
  getHelpUiText,
  getOnboardingIntroTutorial,
  getTutorialById,
  type HelpPageKey,
  type TutorialStep,
  type TutorialDefinition,
} from '@/lib/help/tutorials'
import { useI18n } from '@/components/I18nProvider'
import type { Locale } from '@/lib/i18n/config'
import { dismissHelpPageAction, markTutorialCompletedAction } from '@/app/onboarding/actions'

type FloatingHelpWidgetProps = {
  activeItem?: string
}

type Rect = {
  top: number
  left: number
  width: number
  height: number
}

const ACTIVE_TUTORIAL_STORAGE_KEY = 'diriqo-active-tutorial'

function readSavedTutorialState(locale: Locale): { tutorialId: string; stepIndex: number } | null {
  if (typeof window === 'undefined') return null

  const saved = window.sessionStorage.getItem(ACTIVE_TUTORIAL_STORAGE_KEY)
  if (!saved) return null

  try {
    const parsed = JSON.parse(saved) as { id?: string; stepIndex?: number }
    const savedTutorial = getTutorialById(parsed.id, locale)
    if (!savedTutorial) return null

    return {
      tutorialId: savedTutorial.id,
      stepIndex: Math.min(Math.max(0, parsed.stepIndex ?? 0), savedTutorial.steps.length - 1),
    }
  } catch {
    window.sessionStorage.removeItem(ACTIVE_TUTORIAL_STORAGE_KEY)
    return null
  }
}

function persistActiveTutorial(definition: TutorialDefinition, stepIndex: number) {
  if (typeof window === 'undefined') return

  window.sessionStorage.setItem(
    ACTIVE_TUTORIAL_STORAGE_KEY,
    JSON.stringify({
      id: definition.id,
      stepIndex: Math.min(Math.max(0, stepIndex), definition.steps.length - 1),
    })
  )
}

function getPageKey(activeItem: string | undefined, pathname: string): HelpPageKey {
  if (activeItem === 'kalkulace' || pathname.startsWith('/kalkulace') || pathname.includes('/calculations')) {
    return 'calculations'
  }
  if (activeItem === 'quotes' || pathname.startsWith('/cenove-nabidky') || pathname.includes('/quotes')) {
    return 'quotes'
  }
  if (activeItem === 'invoices' || pathname.startsWith('/invoices')) return 'invoices'
  if (activeItem === 'leads' || pathname.startsWith('/poptavky')) return 'leads'
  if (activeItem === 'jobs' || pathname.startsWith('/jobs')) return 'jobs'
  if (activeItem === 'customers' || pathname.startsWith('/customers')) return 'customers'
  if (activeItem === 'workers' || pathname.startsWith('/workers')) return 'workers'
  if (activeItem === 'calendar' || pathname.startsWith('/calendar')) return 'calendar'
  if (activeItem === 'absences' || pathname.startsWith('/absences')) return 'absences'
  if (activeItem === 'advanceRequests' || pathname.startsWith('/advance-requests')) return 'advance_requests'
  if (activeItem === 'costs' || pathname.startsWith('/costs')) return 'costs'
  if (
    activeItem === 'billing' ||
    pathname.startsWith('/billing')
  ) {
    return 'finance'
  }
  if (
    activeItem === 'companySettings' ||
    activeItem === 'account' ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/ucet')
  ) {
    return 'settings'
  }

  return 'dashboard'
}

function getElementRect(selector: string): Rect | null {
  if (typeof document === 'undefined') return null

  const element = document.querySelector(selector)
  if (!element) return null

  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  const rect = element.getBoundingClientRect()

  return {
    top: Math.max(8, rect.top - 8),
    left: Math.max(8, rect.left - 8),
    width: rect.width + 16,
    height: rect.height + 16,
  }
}

function getTooltipStyle(rect: Rect | null, step?: TutorialStep | null): CSSProperties {
  const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  const width = Math.min(360, viewportWidth - 32)
  const viewportMargin = 16
  const maxHeight = Math.max(220, viewportHeight - viewportMargin * 2)
  const estimatedHeight = Math.min(440, maxHeight)

  if (!rect) {
    return {
      width,
      maxHeight,
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    }
  }

  const placement = step?.placement ?? 'bottom'
  const gap = 16
  let left = rect.left + rect.width / 2 - width / 2
  let top = rect.top + rect.height + gap

  if (placement === 'top') {
    top = rect.top - estimatedHeight - gap
  }

  if (placement === 'left') {
    left = rect.left - width - gap
    top = rect.top + rect.height / 2 - estimatedHeight / 2
  }

  if (placement === 'right') {
    left = rect.left + rect.width + gap
    top = rect.top + rect.height / 2 - estimatedHeight / 2
  }

  if (left < viewportMargin || left + width > viewportWidth - viewportMargin) {
    left = Math.min(Math.max(viewportMargin, left), viewportWidth - width - viewportMargin)
  }

  if (top < viewportMargin || top + estimatedHeight > viewportHeight - viewportMargin) {
    const belowTop = rect.top + rect.height + gap
    const aboveTop = rect.top - estimatedHeight - gap
    top = belowTop + estimatedHeight <= viewportHeight - viewportMargin ? belowTop : Math.max(viewportMargin, aboveTop)
  }

  return {
    width,
    maxHeight,
    left,
    top,
  }
}

export default function FloatingHelpWidget({ activeItem }: FloatingHelpWidgetProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { locale } = useI18n()
  const [isPending, startTransition] = useTransition()
  const [panelOpen, setPanelOpen] = useState(false)
  const [tutorialId, setTutorialId] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const [introStarted, setIntroStarted] = useState(false)
  const [savedTutorialLoaded, setSavedTutorialLoaded] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const pageKey = useMemo(() => getPageKey(activeItem, pathname), [activeItem, pathname])
  const help = getPageHelpDefinition(pageKey, locale)
  const helpUi = getHelpUiText(locale)
  const tutorial = useMemo(() => getTutorialById(tutorialId, locale), [locale, tutorialId])
  const currentStep = tutorial?.steps[stepIndex] ?? null
  const progressPercent = tutorial ? Math.round(((stepIndex + 1) / tutorial.steps.length) * 100) : 0

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPanelOpen(false)
      setTargetRect(null)
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [pathname])

  useEffect(() => {
    const savedTutorialState = readSavedTutorialState(locale)
    const timeout = window.setTimeout(() => {
      if (savedTutorialState) {
        setTutorialId(savedTutorialState.tutorialId)
        setStepIndex(savedTutorialState.stepIndex)
      }

      setSavedTutorialLoaded(true)
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [locale])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!savedTutorialLoaded) return

    if (!tutorialId || !tutorial) {
      window.sessionStorage.removeItem(ACTIVE_TUTORIAL_STORAGE_KEY)
      return
    }

    persistActiveTutorial(tutorial, stepIndex)
  }, [savedTutorialLoaded, stepIndex, tutorial, tutorialId])

  useEffect(() => {
    if (introStarted || typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const tourMode = params.get('tour')

    if (tourMode !== 'quick' && tourMode !== 'detailed') return

    const timeout = window.setTimeout(() => {
      setIntroStarted(true)
      setTutorialId(getOnboardingIntroTutorial(tourMode, locale).id)
      setStepIndex(0)
    }, 0)
    params.delete('tour')
    const nextSearch = params.toString()
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname, { scroll: false })

    return () => window.clearTimeout(timeout)
  }, [introStarted, locale, pathname, router])

  useEffect(() => {
    if (!currentStep) return

    if (tutorial?.id.startsWith('intro-help') && currentStep.id === 'current-page-help') {
      window.setTimeout(() => setPanelOpen(true), 0)
    }

    let retryTimeout: number | undefined
    let attempts = 0

    const updateRect = () => {
      const rect = getElementRect(currentStep.target)
      setTargetRect(rect)

      if (!rect && attempts < 24) {
        attempts += 1
        retryTimeout = window.setTimeout(updateRect, 150)
      }
    }

    const timeout = window.setTimeout(updateRect, 90)
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)

    return () => {
      window.clearTimeout(timeout)
      if (retryTimeout) window.clearTimeout(retryTimeout)
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
    }
  }, [currentStep, pathname, tutorial?.id])

  useEffect(() => {
    if (!currentStep || currentStep.action !== 'click') return
    const clickStep = currentStep

    function advanceAfterTargetClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest(clickStep.target)) return

      if (!tutorial) return

      const next = Math.min(stepIndex + 1, tutorial.steps.length - 1)
      persistActiveTutorial(tutorial, next)
      setStepIndex(next)
    }

    document.addEventListener('click', advanceAfterTargetClick, true)
    return () => document.removeEventListener('click', advanceAfterTargetClick, true)
  }, [currentStep, stepIndex, tutorial])

  function startTutorial(definition: TutorialDefinition) {
    setPanelOpen(false)
    persistActiveTutorial(definition, 0)
    setTutorialId(definition.id)
    setStepIndex(0)
  }

  function finishTutorial() {
    const finishedTutorialId = tutorialId
    setTutorialId(null)
    setStepIndex(0)
    setTargetRect(null)
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(ACTIVE_TUTORIAL_STORAGE_KEY)
    }

    if (finishedTutorialId) {
      startTransition(() => {
        void markTutorialCompletedAction(finishedTutorialId)
      })
    }

    buttonRef.current?.focus()
  }

  function closePanel() {
    setPanelOpen(false)
    startTransition(() => {
      void dismissHelpPageAction(pageKey)
    })
  }

  function nextStep() {
    if (!tutorial) return

    if (currentStep?.href && (currentStep.action === 'navigate' || currentStep.action === 'click')) {
      const next = Math.min(stepIndex + 1, tutorial.steps.length - 1)
      persistActiveTutorial(tutorial, next)
      setStepIndex(next)
      router.push(currentStep.href)
      return
    }

    if (stepIndex >= tutorial.steps.length - 1) {
      finishTutorial()
      return
    }

    setStepIndex((current) => current + 1)
  }

  function getPrimaryActionLabel() {
    if (!tutorial || !currentStep) return helpUi.continue
    if (stepIndex >= tutorial.steps.length - 1) return helpUi.done
    if (currentStep.action === 'click' && currentStep.href) return targetRect ? helpUi.goToForm : helpUi.goToNextPage
    if (currentStep.action === 'navigate') return helpUi.goToPage
    return helpUi.continue
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="floating-help-button"
        data-tour="floating-help-button"
        aria-label={helpUi.openHelp}
        title={helpUi.help}
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen((open) => !open)}
      >
        ?
      </button>

      {tutorial ? (
        <button
          type="button"
          data-tour="floating-help-panel"
          style={tutorialDockStyle}
          onClick={() => setPanelOpen((open) => !open)}
          aria-label={helpUi.openRunningHelp}
        >
          <span style={tutorialDockDotStyle} />
          <span style={{ minWidth: 0 }}>
            <span style={tutorialDockTitleStyle}>{helpUi.runningGuide}</span>
            <span style={tutorialDockTextStyle}>
              {helpUi.step} {stepIndex + 1} {helpUi.of} {tutorial.steps.length}
            </span>
          </span>
        </button>
      ) : null}

      {panelOpen && !tutorial ? (
        <aside
          data-tour="floating-help-panel"
          aria-label={`${helpUi.helpTitle}: ${help.label}`}
          style={panelStyle}
        >
          <div style={panelHeaderStyle}>
            <div>
              <div style={panelEyebrowStyle}>{helpUi.help}</div>
              <h2 style={panelTitleStyle}>{helpUi.helpTitle}: {help.label}</h2>
            </div>
            <button type="button" onClick={closePanel} style={iconButtonStyle} aria-label={helpUi.closeHelp}>
              ×
            </button>
          </div>

          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>{helpUi.shortGuide}</h3>
            <p style={descriptionStyle}>{help.shortDescription}</p>
            <ol style={stepsStyle}>
              {help.shortSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          <div style={panelActionsStyle}>
            <button type="button" onClick={() => startTutorial(help.tutorial)} style={primaryButtonStyle}>
              {helpUi.startGuide}
            </button>
            <Link href="/help" style={secondaryButtonStyle} onClick={() => setPanelOpen(false)}>
              {helpUi.openFullHelp}
            </Link>
          </div>

          <button type="button" onClick={closePanel} style={textButtonStyle} disabled={isPending}>
            {helpUi.close}
          </button>
        </aside>
      ) : null}

      {tutorial && currentStep ? (
        <div style={tourLayerStyle} aria-live="polite">
          <div style={tourDimStyle} />
          {targetRect ? <div style={{ ...highlightStyle, ...targetRect }} /> : null}
          <section style={{ ...tooltipStyle, ...getTooltipStyle(targetRect, currentStep) }}>
            <div style={tourHeaderStyle}>
              <div>
                <div style={tourMetaStyle}>
                  {tutorial.title}
                </div>
                <div style={tourStepStyle}>
                  {helpUi.step} {stepIndex + 1} {helpUi.of} {tutorial.steps.length}
                </div>
              </div>
              <button type="button" onClick={finishTutorial} style={tourCloseButtonStyle} aria-label={helpUi.endTutorial}>
                ×
              </button>
            </div>
            <div style={progressTrackStyle}>
              <span style={{ ...progressFillStyle, width: `${progressPercent}%` }} />
            </div>
            <h2 style={tourTitleStyle}>{currentStep.title}</h2>
            <p style={tourTextStyle}>{currentStep.content}</p>
            {!targetRect ? (
              <p style={tourFallbackStyle}>{helpUi.missingTarget}</p>
            ) : null}
            <div style={tourActionsStyle}>
              <button
                type="button"
                onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                disabled={stepIndex === 0}
                style={ghostButtonStyle}
              >
                {helpUi.back}
              </button>
              <button type="button" onClick={nextStep} style={ghostButtonStyle}>
                {helpUi.skipStep}
              </button>
              <button type="button" onClick={nextStep} style={primaryButtonStyle}>
                {getPrimaryActionLabel()}
              </button>
            </div>
            <button type="button" onClick={finishTutorial} style={exitButtonStyle}>
              {helpUi.endTutorial}
            </button>
          </section>
        </div>
      ) : null}
    </>
  )
}

const panelStyle: CSSProperties = {
  position: 'fixed',
  right: 24,
  bottom: 74,
  zIndex: 180,
  width: 'min(390px, calc(100vw - 28px))',
  maxHeight: 'min(680px, calc(100vh - 104px))',
  overflow: 'auto',
  borderRadius: 22,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.98)',
  boxShadow: '0 28px 70px rgba(15, 23, 42, 0.2)',
  padding: 18,
  display: 'grid',
  gap: 14,
}

const panelHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
}

const panelEyebrowStyle: CSSProperties = {
  color: '#2563eb',
  fontSize: 12,
  fontWeight: 900,
  textTransform: 'uppercase',
}

const panelTitleStyle: CSSProperties = {
  margin: '3px 0 0',
  color: '#0f172a',
  fontSize: 21,
  lineHeight: 1.2,
}

const iconButtonStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 999,
  border: '1px solid #e2e8f0',
  background: '#ffffff',
  color: '#334155',
  cursor: 'pointer',
  fontWeight: 900,
}

const sectionStyle: CSSProperties = {
  border: '1px solid rgba(226, 232, 240, 0.9)',
  borderRadius: 16,
  padding: 14,
  background: '#f8fafc',
}

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: 15,
  fontWeight: 900,
}

const descriptionStyle: CSSProperties = {
  margin: '7px 0 10px',
  color: '#475569',
  lineHeight: 1.5,
  fontSize: 14,
  fontWeight: 650,
}

const stepsStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  color: '#334155',
  display: 'grid',
  gap: 6,
  fontSize: 14,
  lineHeight: 1.45,
}

const panelActionsStyle: CSSProperties = {
  display: 'grid',
  gap: 9,
}

const primaryButtonStyle: CSSProperties = {
  minHeight: 40,
  border: 0,
  borderRadius: 999,
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
  color: '#ffffff',
  padding: '0 14px',
  fontWeight: 900,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  textDecoration: 'none',
}

const secondaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  background: '#ffffff',
  color: '#1d4ed8',
  border: '1px solid rgba(37, 99, 235, 0.24)',
}

const textButtonStyle: CSSProperties = {
  border: 0,
  background: 'transparent',
  color: '#64748b',
  cursor: 'pointer',
  fontWeight: 850,
  justifySelf: 'center',
}

const tutorialDockStyle: CSSProperties = {
  position: 'fixed',
  right: 72,
  bottom: 23,
  zIndex: 219,
  minHeight: 38,
  maxWidth: 'min(260px, calc(100vw - 96px))',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  borderRadius: 999,
  border: '1px solid rgba(37, 99, 235, 0.22)',
  background: 'rgba(255, 255, 255, 0.96)',
  color: '#0f172a',
  padding: '6px 11px 6px 8px',
  boxShadow: '0 16px 34px rgba(15, 23, 42, 0.16)',
  cursor: 'pointer',
}

const tutorialDockDotStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 999,
  flexShrink: 0,
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
  boxShadow: '0 0 0 4px rgba(37, 99, 235, 0.12)',
}

const tutorialDockTitleStyle: CSSProperties = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  fontWeight: 900,
  lineHeight: 1.1,
}

const tutorialDockTextStyle: CSSProperties = {
  display: 'block',
  color: '#64748b',
  fontSize: 11,
  fontWeight: 800,
  lineHeight: 1.15,
}

const tourLayerStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 220,
  pointerEvents: 'none',
}

const tourDimStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
}

const highlightStyle: CSSProperties = {
  position: 'fixed',
  borderRadius: 18,
  border: '2px solid #67e8f9',
  boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.24), 0 0 0 6px rgba(255,255,255,0.6), 0 18px 50px rgba(6, 182, 212, 0.34)',
}

const tooltipStyle: CSSProperties = {
  position: 'fixed',
  pointerEvents: 'auto',
  overflowY: 'auto',
  borderRadius: 22,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 28px 80px rgba(15, 23, 42, 0.28)',
  padding: 18,
  display: 'grid',
  gap: 12,
}

const tourHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
}

const tourMetaStyle: CSSProperties = {
  color: '#2563eb',
  fontSize: 12,
  fontWeight: 900,
  textTransform: 'uppercase',
}

const tourStepStyle: CSSProperties = {
  marginTop: 3,
  color: '#64748b',
  fontSize: 12,
  fontWeight: 850,
}

const tourCloseButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 999,
  border: '1px solid #e2e8f0',
  background: '#ffffff',
  color: '#334155',
  cursor: 'pointer',
  fontSize: 18,
  fontWeight: 900,
  lineHeight: 1,
}

const progressTrackStyle: CSSProperties = {
  height: 7,
  borderRadius: 999,
  background: '#e2e8f0',
  overflow: 'hidden',
}

const progressFillStyle: CSSProperties = {
  display: 'block',
  height: '100%',
  borderRadius: 999,
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
  transition: 'width 180ms ease',
}

const tourTitleStyle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: 22,
  lineHeight: 1.18,
}

const tourTextStyle: CSSProperties = {
  margin: 0,
  color: '#475569',
  lineHeight: 1.5,
  fontWeight: 650,
}

const tourFallbackStyle: CSSProperties = {
  margin: 0,
  borderRadius: 12,
  background: '#eff6ff',
  color: '#1e3a8a',
  padding: '9px 11px',
  fontSize: 13,
  fontWeight: 800,
}

const tourActionsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
}

const ghostButtonStyle: CSSProperties = {
  minHeight: 38,
  borderRadius: 999,
  border: '1px solid #e2e8f0',
  background: '#ffffff',
  color: '#334155',
  padding: '0 12px',
  fontWeight: 850,
  cursor: 'pointer',
}

const exitButtonStyle: CSSProperties = {
  ...textButtonStyle,
  justifySelf: 'start',
  color: '#991b1b',
}
