import { laborHistoryId, type LaborSource } from '@/lib/labor-history'

export const approvedLaborSourceCode = 'LABOR_APPROVED_SOURCE_IMMUTABLE'
export function isApprovedLaborSourceError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'message' in error
    && error.message === approvedLaborSourceCode)
}

/** Navigation only: the destination must reauthorize the actor, company and source. */
export function laborSourceReviewHref(scope: {
  companyId: string; actorProfileId: string; jobId: string; profileId: string; source: LaborSource
}): string {
  if (!['shift', 'log', 'assignment'].includes(scope.source.kind)) throw new Error('Invalid labor source')
  const query = new URLSearchParams({
    company: laborHistoryId(scope.companyId), actor: laborHistoryId(scope.actorProfileId),
    job: laborHistoryId(scope.jobId), worker: laborHistoryId(scope.profileId),
    sourceKind: scope.source.kind, source: laborHistoryId(scope.source.id),
  })
  return `/labor?${query.toString()}`
}


/** Validate a server error link against this rendered row, then return our canonical local URL. */
export function safeLaborSourceReviewHref(value: unknown, scope: Parameters<typeof laborSourceReviewHref>[0]): string | null {
  if (typeof value !== 'string' || !value.startsWith('/labor?')) return null
  try {
    const expected = laborSourceReviewHref(scope)
    const parsed = new URL(value, 'https://diriqo.invalid')
    const canonical = new URL(expected, 'https://diriqo.invalid')
    if (parsed.origin !== canonical.origin || parsed.pathname !== '/labor' || parsed.hash
      || [...parsed.searchParams.keys()].length !== [...canonical.searchParams.keys()].length) return null
    for (const [key, expectedValue] of canonical.searchParams) {
      const values = parsed.searchParams.getAll(key)
      if (values.length !== 1 || values[0] !== expectedValue) return null
    }
    return expected
  } catch { return null }
}
