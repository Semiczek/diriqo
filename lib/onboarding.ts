import 'server-only'

import type { SupabaseServerClient } from '@/lib/dal/auth'

export type FirstRunChecklistItem = {
  key: 'company' | 'currency' | 'workers' | 'customers' | 'quote' | 'job'
  label: string
  href: string
  done: boolean
}

export type FirstRunChecklist = {
  completed: number
  total: number
  items: FirstRunChecklistItem[]
}

function countFromResponse(response: { count: number | null }) {
  return response.count ?? 0
}

export async function getFirstRunChecklist(
  supabase: SupabaseServerClient,
  companyId: string,
): Promise<FirstRunChecklist> {
  const [companyResponse, workersResponse, customersResponse, quotesResponse, jobsResponse] =
    await Promise.all([
      supabase
        .from('companies')
        .select('name, currency')
        .eq('id', companyId)
        .maybeSingle(),
      supabase
        .from('company_members')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('is_active', true),
      supabase
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
      supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
    ])

  const company = (companyResponse.data ?? null) as {
    name?: string | null
    currency?: string | null
  } | null

  const items: FirstRunChecklistItem[] = [
    {
      key: 'company',
      label: 'Doplň název firmy',
      href: '/settings/company',
      done: Boolean(company?.name?.trim()),
    },
    {
      key: 'currency',
      label: 'Zkontroluj měnu a fakturaci',
      href: '/settings/company',
      done: Boolean(company?.currency?.trim()),
    },
    {
      key: 'workers',
      label: 'Přidej pracovníky',
      href: '/workers',
      done: countFromResponse(workersResponse) > 1,
    },
    {
      key: 'customers',
      label: 'Přidej zákazníka',
      href: '/customers/new',
      done: countFromResponse(customersResponse) > 0,
    },
    {
      key: 'quote',
      label: 'Vytvoř první nabídku',
      href: '/cenove-nabidky',
      done: countFromResponse(quotesResponse) > 0,
    },
    {
      key: 'job',
      label: 'Založ první zakázku',
      href: '/jobs/new',
      done: countFromResponse(jobsResponse) > 0,
    },
  ]

  return {
    completed: items.filter((item) => item.done).length,
    total: items.length,
    items,
  }
}
