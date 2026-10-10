import 'server-only'

/** Deployment-owned setting. Missing configuration must never mix test and live purchases. */
export function readModuleBillingMode(): boolean | null {
  if (process.env.DIRIQO_MODULE_BILLING_MODE === 'test') return false
  if (process.env.DIRIQO_MODULE_BILLING_MODE === 'live') return true
  return null
}
