export const HUB_ALLOWED_ROLES = [
  'super_admin',
  'company_admin',
] as const

export const COMPANY_MEMBER_ROLES = [
  'super_admin',
  'company_admin',
  'manager',
  'worker',
] as const

export function normalizeCompanyRole(role: string | null | undefined) {
  return (role ?? '').toString().trim().toLowerCase()
}

export function getCompanyRoleLabel(role: string | null | undefined) {
  const normalized = normalizeCompanyRole(role)

  if (normalized === 'super_admin') return 'Super admin'
  if (normalized === 'company_admin') return 'Admin firmy'
  if (normalized === 'manager') return 'Manažer'
  if (normalized === 'worker') return 'Pracovník'
  if (normalized === 'owner') return 'Vlastník'
  if (normalized === 'admin') return 'Administrátor'
  if (normalized === 'dispatcher') return 'Dispečer'
  if (normalized === 'accountant') return 'Účetní'

  return role?.trim() || 'Role není dostupná'
}

export function hasHubAccessRole(role: string | null | undefined) {
  return HUB_ALLOWED_ROLES.includes(
    normalizeCompanyRole(role) as (typeof HUB_ALLOWED_ROLES)[number]
  )
}

export function hasAnyHubAccessRole(roles: Array<string | null | undefined>) {
  return roles.some((role) => hasHubAccessRole(role))
}

export function hasCompanyMemberRole(role: string | null | undefined) {
  return COMPANY_MEMBER_ROLES.includes(
    normalizeCompanyRole(role) as (typeof COMPANY_MEMBER_ROLES)[number]
  )
}

export function hasAnyCompanyRole(
  role: string | null | undefined,
  allowedRoles: readonly string[]
) {
  const normalizedRole = normalizeCompanyRole(role)
  return allowedRoles.some((allowedRole) => normalizeCompanyRole(allowedRole) === normalizedRole)
}
