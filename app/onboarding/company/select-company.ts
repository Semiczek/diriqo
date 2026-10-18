'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCompanyContextForSwitch } from '@/lib/active-company'
import { hasHubAccessRole } from '@/lib/hub-access'

export async function selectExistingCompany(formData: FormData) {
  const companyId = formData.get('companyId')
  const company = typeof companyId === 'string' ? await getCompanyContextForSwitch(companyId) : null
  if (!company) redirect('/onboarding/company?selection=unavailable')

  ;(await cookies()).set({ name: 'active_company_id', value: company.companyId,
    path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  redirect(hasHubAccessRole(company.role) ? '/' : '/moje-prace')
}
