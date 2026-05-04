export const HUB_ALLOWED_ROLES = [
  'super_admin',
  'company_admin',
] as const

export function normalizeCompanyRole(role: string | null | undefined) {
  return (role ?? '').toString().trim().toLowerCase()
}

export function hasHubAccessRole(role: string | null | undefined) {
  return HUB_ALLOWED_ROLES.includes(
    normalizeCompanyRole(role) as (typeof HUB_ALLOWED_ROLES)[number]
  )
}

export function hasAnyHubAccessRole(roles: Array<string | null | undefined>) {
  return roles.some((role) => hasHubAccessRole(role))
}
