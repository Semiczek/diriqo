import styles from './onboarding.module.css'
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
  const nextStep = checklist.steps.find((step) => !step.done)
  const nextStepTitle = nextStep ? labels[stepContent[nextStep.key].titleKey] : null

  if (checklist.isComplete && !forceOpen) return null

  if (!shouldShowFull) {
    return (
      <section className={styles.banner}>
        <div className={styles.bannerHeading}>
          <span className={styles.progressCount}>{progressText}</span>
          <div>
            <strong>{labels.bannerTitle}</strong>
            {nextStepTitle ? <p>{nextStepTitle}</p> : null}
          </div>
        </div>
        <form action={reopenCompanyOnboardingAction}>
          <button type="submit" className={styles.secondaryButton}>{labels.reopen}</button>
        </form>
      </section>
    )
  }

  if (checklist.isComplete) {
    return (
      <section className={styles.completed}>
        <span className={styles.completeMark} aria-hidden="true">✓</span>
        <div className={styles.completeCopy}>
          <h2>{labels.doneTitle}</h2>
          <p>{labels.doneText}</p>
        </div>
        <Link href="/" className={styles.secondaryButton}>{labels.goDashboard}</Link>
      </section>
    )
  }

  return (
    <section className={styles.panel} aria-labelledby="company-setup-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>{labels.progress} {progressText}</p>
          <h2 id="company-setup-title">{labels.title}</h2>
          <p className={styles.intro}>{labels.intro}</p>
        </div>
        <form action={dismissCompanyOnboardingAction}>
          <button type="submit" className={styles.textButton}>{labels.minimize}</button>
        </form>
      </div>

      <progress value={checklist.completed} max={checklist.total}
        aria-label={`${labels.progress} ${progressText}`} className={styles.progress} />

      {errorMessage ? <div role="alert" className={styles.error}>{errorMessage}</div> : null}

      <div className={styles.steps}>
        {checklist.steps.map((step, index) => {
          const content = stepContent[step.key]
          const isNext = step.key === nextStep?.key
          const isWorkerStep = step.key === 'first_worker'

          return (
            <article key={step.key} id={`onboarding-${step.key}`}
              className={`${styles.step} ${step.done ? styles.doneStep : isNext ? styles.nextStep : ''}`}>
              <span className={`${styles.stepNumber} ${step.done ? styles.doneNumber : ''}`} aria-hidden="true">
                {step.done ? '✓' : String(index + 1)}
              </span>
              <div className={styles.stepCopy}>
                <h3>{labels[content.titleKey]}</h3>
                {!step.done ? <p>{labels[content.textKey]}</p> : null}

                {isWorkerStep && !step.done ? (
                  <details className={styles.workerDetails} open={isNext || Boolean(errorMessage)}>
                    <summary>{labels.workerUseMe}</summary>
                    <form action={useMeAsWorkerAction} className={styles.workerForm}>
                      <label className={styles.field}>
                        <span>{labels.workerName}</span>
                        <input name="full_name" defaultValue={checklist.profileName ?? checklist.profileEmail ?? ''}
                          required className={styles.input} autoComplete="name" />
                      </label>
                      <div className={styles.fieldRow}>
                        <label className={styles.field}>
                          <span>{labels.hourlyRate}</span>
                          <input name="default_hourly_rate" type="number" min="0" step="0.01"
                            defaultValue={checklist.defaultHourlyRate ?? ''} required className={styles.input} inputMode="decimal" />
                        </label>
                        <label className={styles.field}>
                          <span>{labels.workerType}</span>
                          <select name="worker_type" defaultValue="employee" className={styles.input}>
                            <option value="employee">{labels.workerTypeInternal}</option>
                            <option value="contractor">{labels.workerTypeExternal}</option>
                          </select>
                        </label>
                      </div>
                      <div className={styles.workerActions}>
                        <button type="submit" className={styles.primaryButton}>{labels.workerUseMe}</button>
                        <Link href={step.href} className={styles.textButton}>{labels.workerCreateNew}</Link>
                      </div>
                    </form>
                  </details>
                ) : null}
              </div>
              {step.done ? <span className={styles.doneLabel}>{labels.completeSetup}</span>
                : !isWorkerStep ? <Link href={step.href} className={isNext ? styles.primaryButton : styles.secondaryButton}
                  aria-label={`${labels.continue}: ${labels[content.titleKey]}`}>
                  {labels.continue}<span aria-hidden="true">→</span>
                </Link> : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
