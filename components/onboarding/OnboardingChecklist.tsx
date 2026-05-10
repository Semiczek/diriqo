import type { CSSProperties } from 'react'
import Link from 'next/link'

import {
  dismissCompanyOnboardingAction,
  reopenCompanyOnboardingAction,
  useMeAsWorkerAction,
} from '@/app/onboarding/setup/actions'
import type { CompanyOnboardingChecklist, CompanyOnboardingStepKey } from '@/lib/onboarding'

type OnboardingLabels = {
  title: string
  intro: string
  progress: string
  minimize: string
  continue: string
  skip: string
  completeSetup: string
  reopen: string
  bannerTitle: string
  doneTitle: string
  doneText: string
  goDashboard: string
  companyTitle: string
  companyText: string
  customerTitle: string
  customerText: string
  workerTitle: string
  workerText: string
  workerUseMe: string
  workerCreateNew: string
  workerName: string
  hourlyRate: string
  workerType: string
  workerTypeInternal: string
  workerTypeExternal: string
  jobTitle: string
  jobText: string
  errorWorkerRate: string
  errorWorkerSave: string
}

type Props = {
  checklist: CompanyOnboardingChecklist
  labels: OnboardingLabels
  forceOpen?: boolean
  errorCode?: string | null
}

const stepContent: Record<
  CompanyOnboardingStepKey,
  {
    titleKey: keyof OnboardingLabels
    textKey: keyof OnboardingLabels
  }
> = {
  company_profile: {
    titleKey: 'companyTitle',
    textKey: 'companyText',
  },
  first_customer: {
    titleKey: 'customerTitle',
    textKey: 'customerText',
  },
  first_worker: {
    titleKey: 'workerTitle',
    textKey: 'workerText',
  },
  first_job: {
    titleKey: 'jobTitle',
    textKey: 'jobText',
  },
}

function getErrorMessage(errorCode: string | null | undefined, labels: OnboardingLabels) {
  if (errorCode === 'worker-rate') return labels.errorWorkerRate
  if (errorCode === 'worker-save') return labels.errorWorkerSave
  return null
}

export default function OnboardingChecklist({
  checklist,
  labels,
  forceOpen = false,
  errorCode = null,
}: Props) {
  const progressText = `${checklist.completed}/${checklist.total}`
  const shouldShowFull = forceOpen || !checklist.isDismissed
  const errorMessage = getErrorMessage(errorCode, labels)

  if (checklist.isComplete && !forceOpen) {
    return null
  }

  if (!shouldShowFull) {
    return (
      <section style={bannerStyle}>
        <div>
          <strong>{labels.bannerTitle}: {progressText}</strong>
          <p style={bannerTextStyle}>{labels.intro}</p>
        </div>
        <div style={bannerActionsStyle}>
          <form action={reopenCompanyOnboardingAction}>
            <button type="submit" style={secondaryButtonStyle}>
              {labels.reopen}
            </button>
          </form>
          <Link href="/?onboarding=open" style={primaryLinkStyle}>
            {labels.continue}
          </Link>
        </div>
      </section>
    )
  }

  if (checklist.isComplete) {
    return (
      <section style={panelStyle}>
        <div style={panelHeaderStyle}>
          <div>
            <div style={eyebrowStyle}>{labels.progress} {progressText}</div>
            <h2 style={titleStyle}>{labels.doneTitle}</h2>
            <p style={introStyle}>{labels.doneText}</p>
          </div>
          <Link href="/" style={primaryLinkStyle}>
            {labels.goDashboard}
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section style={panelStyle}>
      <div style={panelHeaderStyle}>
        <div>
          <div style={eyebrowStyle}>{labels.progress} {progressText}</div>
          <h2 style={titleStyle}>{labels.title}</h2>
          <p style={introStyle}>{labels.intro}</p>
        </div>
        <form action={dismissCompanyOnboardingAction}>
          <button type="submit" style={secondaryButtonStyle}>
            {labels.minimize}
          </button>
        </form>
      </div>

      {errorMessage ? <div style={errorStyle}>{errorMessage}</div> : null}

      <div style={stepsGridStyle}>
        {checklist.steps.map((step, index) => {
          const content = stepContent[step.key]
          const isWorkerStep = step.key === 'first_worker'

          return (
            <article key={step.key} style={step.done ? doneStepStyle : stepStyle}>
              <div style={stepTopStyle}>
                <span style={step.done ? doneBadgeStyle : badgeStyle}>
                  {step.done ? 'OK' : String(index + 1)}
                </span>
                <div>
                  <h3 style={stepTitleStyle}>{labels[content.titleKey]}</h3>
                  <p style={stepTextStyle}>{labels[content.textKey]}</p>
                </div>
              </div>

              {isWorkerStep && !step.done ? (
                <div style={workerActionsStyle}>
                  <form action={useMeAsWorkerAction} style={workerFormStyle}>
                    <label style={fieldStyle}>
                      <span style={labelStyle}>{labels.workerName}</span>
                      <input
                        name="full_name"
                        defaultValue={checklist.profileName ?? checklist.profileEmail ?? ''}
                        required
                        style={inputStyle}
                      />
                    </label>
                    <label style={fieldStyle}>
                      <span style={labelStyle}>{labels.hourlyRate}</span>
                      <input
                        name="default_hourly_rate"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={checklist.defaultHourlyRate ?? ''}
                        required
                        style={inputStyle}
                      />
                    </label>
                    <label style={fieldStyle}>
                      <span style={labelStyle}>{labels.workerType}</span>
                      <select name="worker_type" defaultValue="employee" style={inputStyle}>
                        <option value="employee">{labels.workerTypeInternal}</option>
                        <option value="contractor">{labels.workerTypeExternal}</option>
                      </select>
                    </label>
                    <button type="submit" style={primaryButtonStyle}>
                      {labels.workerUseMe}
                    </button>
                  </form>
                  <Link href={step.href} style={secondaryLinkStyle}>
                    {labels.workerCreateNew}
                  </Link>
                </div>
              ) : (
                <div style={stepActionsStyle}>
                  {step.done ? (
                    <span style={doneTextStyle}>{labels.completeSetup}</span>
                  ) : (
                    <>
                      <Link href={step.href} style={primaryLinkStyle}>
                        {labels.continue}
                      </Link>
                      {step.key === 'company_profile' ? (
                        <span style={skipTextStyle}>{labels.skip}</span>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

const panelStyle: CSSProperties = {
  display: 'grid',
  gap: 18,
  borderRadius: 8,
  border: '1px solid rgba(37, 99, 235, 0.16)',
  background: '#ffffff',
  boxShadow: '0 14px 34px rgba(15, 23, 42, 0.07)',
  padding: 20,
}

const panelHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
}

const eyebrowStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#2563eb',
}

const titleStyle: CSSProperties = {
  margin: '7px 0',
  color: '#0f172a',
  fontSize: 24,
  lineHeight: 1.15,
}

const introStyle: CSSProperties = {
  margin: 0,
  maxWidth: 680,
  color: '#64748b',
  fontSize: 14,
  lineHeight: 1.6,
  fontWeight: 650,
}

const stepsGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 12,
}

const stepStyle: CSSProperties = {
  display: 'grid',
  gap: 14,
  alignContent: 'space-between',
  borderRadius: 8,
  border: '1px solid rgba(203, 213, 225, 0.9)',
  background: '#f8fafc',
  padding: 14,
}

const doneStepStyle: CSSProperties = {
  ...stepStyle,
  borderColor: '#bbf7d0',
  background: '#f0fdf4',
}

const stepTopStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
}

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 8,
  background: '#dbeafe',
  color: '#1d4ed8',
  fontSize: 13,
  fontWeight: 900,
  flex: '0 0 auto',
}

const doneBadgeStyle: CSSProperties = {
  ...badgeStyle,
  background: '#bbf7d0',
  color: '#166534',
}

const stepTitleStyle: CSSProperties = {
  margin: '1px 0 5px',
  color: '#0f172a',
  fontSize: 16,
  lineHeight: 1.25,
}

const stepTextStyle: CSSProperties = {
  margin: 0,
  color: '#64748b',
  fontSize: 13,
  lineHeight: 1.5,
  fontWeight: 620,
}

const stepActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
}

const workerActionsStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
}

const workerFormStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
}

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 5,
}

const labelStyle: CSSProperties = {
  color: '#334155',
  fontSize: 12,
  fontWeight: 850,
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 38,
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  padding: '8px 10px',
  color: '#0f172a',
  background: '#ffffff',
  fontSize: 14,
}

const primaryButtonStyle: CSSProperties = {
  border: 'none',
  borderRadius: 8,
  background: '#111827',
  color: '#ffffff',
  minHeight: 40,
  padding: '9px 12px',
  fontWeight: 900,
  cursor: 'pointer',
}

const primaryLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 38,
  borderRadius: 8,
  background: '#111827',
  color: '#ffffff',
  padding: '8px 12px',
  textDecoration: 'none',
  fontSize: 14,
  fontWeight: 900,
}

const secondaryButtonStyle: CSSProperties = {
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#0f172a',
  minHeight: 38,
  padding: '8px 12px',
  fontSize: 14,
  fontWeight: 850,
  cursor: 'pointer',
}

const secondaryLinkStyle: CSSProperties = {
  ...primaryLinkStyle,
  background: '#ffffff',
  color: '#0f172a',
  border: '1px solid #cbd5e1',
}

const doneTextStyle: CSSProperties = {
  color: '#166534',
  fontSize: 13,
  fontWeight: 900,
}

const skipTextStyle: CSSProperties = {
  color: '#64748b',
  fontSize: 13,
  fontWeight: 800,
}

const bannerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
  borderRadius: 8,
  border: '1px solid rgba(37, 99, 235, 0.16)',
  background: '#ffffff',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
  padding: '14px 16px',
}

const bannerTextStyle: CSSProperties = {
  margin: '4px 0 0',
  color: '#64748b',
  fontSize: 13,
  fontWeight: 650,
}

const bannerActionsStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
}

const errorStyle: CSSProperties = {
  borderRadius: 8,
  border: '1px solid #fecaca',
  background: '#fef2f2',
  color: '#991b1b',
  padding: '10px 12px',
  fontSize: 14,
  fontWeight: 750,
}
