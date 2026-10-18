/** Roles come from the current server membership, never from a prompt or a client claim. */
export type DiriqentScope = 'worker' | 'manager' | 'company_admin'
export const DIRIQENT_POLICY_VERSION = 'diriqent-role-scopes-v1'

export function diriqentScope(role: unknown): DiriqentScope | null {
  if (role === 'super_admin' || role === 'company_admin') return 'company_admin'
  if (role === 'manager' || role === 'worker') return role
  return null
}

export function canReadDiriqentScope(role: unknown, scope: unknown): boolean {
  const current = diriqentScope(role)
  if (!current || !['worker', 'manager', 'company_admin'].includes(String(scope))) return false
  const rank = { worker: 0, manager: 1, company_admin: 2 }
  return rank[current] >= rank[scope as DiriqentScope]
}

/** A new app must not serve privileged history against the old two-level schema. */
export function assertDiriqentPolicy(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object'
    || (value as Record<string, unknown>).policyVersion !== DIRIQENT_POLICY_VERSION) {
    throw new Error('Práce s daty čeká na aktualizaci ochrany oprávnění. Podpora bez kreditu zůstává dostupná.')
  }
}

export function assertDiriqentRecords(role: unknown, records: unknown): void {
  if (!Array.isArray(records) || records.some(row => !row || typeof row !== 'object'
    || !canReadDiriqentScope(role, row.access_scope))) {
    throw new Error('Historie není dostupná v aktuálním rozsahu oprávnění.')
  }
}

export function diriqentScopeLabel(role: unknown): string {
  switch (diriqentScope(role)) {
    case 'company_admin': return 'Správa firmy'
    case 'manager': return 'Provozní přehled bez údajů vyhrazených správci firmy'
    case 'worker': return 'Vlastní práce a přidělené zakázky'
    default: return 'Přístup není dostupný'
  }
}

export type DiriqentIdentity = { companyId: string; profileId: string; role: string }
export function matchesDiriqentIdentity(expected: DiriqentIdentity, actual: unknown): boolean {
  if (!actual || typeof actual !== 'object') return false
  const value = actual as Record<string, unknown>
  return diriqentScope(value.role) !== null && value.companyId === expected.companyId
    && value.profileId === expected.profileId && value.role === expected.role
}
