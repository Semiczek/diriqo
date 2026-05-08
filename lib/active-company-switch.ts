export type ActiveCompanySwitchMembership = {
  companyId: string
  companyName: string | null
}

export type ActiveCompanySwitchResult =
  | {
      ok: true
      company: ActiveCompanySwitchMembership
    }
  | {
      ok: false
      error: 'Company not available'
    }

export function resolveActiveCompanySwitch(
  requestedCompanyId: string | null | undefined,
  memberships: ActiveCompanySwitchMembership[],
): ActiveCompanySwitchResult {
  const companyId = requestedCompanyId?.trim() ?? ''
  const targetCompany = companyId
    ? memberships.find((membership) => membership.companyId === companyId)
    : null

  if (!targetCompany) {
    return {
      ok: false,
      error: 'Company not available',
    }
  }

  return {
    ok: true,
    company: targetCompany,
  }
}

