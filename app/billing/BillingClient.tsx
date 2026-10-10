import type { PlanKey } from '@/lib/plans'
import styles from './billing.module.css'

type PricingPlanView = {
  key: PlanKey
  name: string
  workerLimit: number | null
  priceMonthly: number
  priceYearly: number
  currency: 'EUR'
  recommended: boolean
}

type BillingClientProps = {
  mainPlans: PricingPlanView[]
}

function formatMonthlyPrice(plan: PricingPlanView) {
  return `${plan.priceMonthly.toLocaleString('cs-CZ')} ${plan.currency} / měsíc`
}

function formatYearlyPrice(plan: PricingPlanView) {
  return `${plan.priceYearly.toLocaleString('cs-CZ')} ${plan.currency} / rok`
}

function formatWorkerLimit(value: number | null) {
  return value === null ? 'Individuální limit pracovníků' : `${value} aktivních pracovníků`
}

export default function BillingClient({ mainPlans }: BillingClientProps) {
  return (
    <details className={styles.legacy}>
      <summary>
        <div><h2>Dosavadní firemní tarify</h2><p>Přehled původního předplatného v EUR</p></div>
        <span aria-hidden="true" className={styles.expandIcon}>+</span>
      </summary>
      <div className={styles.legacyContent}>
        <p className={styles.description}>
          Tyto ceny a limity platí pro původní předplatné. Samostatné moduly mají vlastní licence.
        </p>
        <div className={styles.plansGrid}>
          {mainPlans.map((plan) => (
            <article key={plan.key} className={styles.planCard}>
              <h3>{plan.name}</h3>
              <p className={styles.price}>{formatMonthlyPrice(plan)}</p>
              <p className={styles.muted}>{formatYearlyPrice(plan)} · 2 měsíce zdarma</p>
              <p className={styles.muted}>{formatWorkerLimit(plan.workerLimit)}</p>
            </article>
          ))}
        </div>
      </div>
    </details>
  )
}
