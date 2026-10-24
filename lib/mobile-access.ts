import { hasCompanyMemberRole, normalizeCompanyRole } from '@/lib/hub-access'

export type MobileApp = 'my' | 'manager'
export const MOBILE_ENTRY_COOKIE = 'diriqo_mobile_entry'

export function mobileEntryPath(value: string | null | undefined): '/mobile/my' | '/mobile/manager' | null {
  return value === 'my' ? '/mobile/my' : value === 'manager' ? '/mobile/manager' : null
}

export function canUseMobileApp(role: string | null | undefined, app: MobileApp) {
  const normalized = normalizeCompanyRole(role)
  return app === 'my' ? hasCompanyMemberRole(normalized) : ['manager', 'company_admin', 'super_admin'].includes(normalized)
}

export function isMemberWorkspacePath(path: string) {
  return ['/labor', '/moje-prace', '/mobile/my', '/mobile/manager', '/api/job-photos', '/logout']
    .some(prefix => path === prefix || path.startsWith(prefix + '/'))
}
