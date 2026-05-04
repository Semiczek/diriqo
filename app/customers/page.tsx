import DashboardShell from '@/components/DashboardShell'
import CustomersPageClient from '@/components/CustomersPageClient'
import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type CustomerContact = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
}

type Customer = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  created_at: string | null
  customer_contacts?: CustomerContact[] | null
}

export default async function CustomersPage() {
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return (
      <DashboardShell activeItem="customers">
        <main
          style={{
            maxWidth: '1100px',
            fontFamily: 'Arial, Helvetica, sans-serif',
            color: '#111827',
          }}
        >
          <div
            style={{
              border: '1px solid #fecaca',
              borderRadius: '16px',
              padding: '24px',
              backgroundColor: '#fef2f2',
              color: '#991b1b',
            }}
          >
            Aktivni firma nebyla nalezena.
          </div>
        </main>
      </DashboardShell>
    )
  }

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('customers')
    .select(
      `
        id,
        name,
        email,
        phone,
        created_at,
        customer_contacts (
          id,
          full_name,
          email,
          phone
        )
      `
    )
    .eq('company_id', activeCompany.companyId)
    .order('created_at', { ascending: false })

  return (
    <DashboardShell activeItem="customers">
      <main
        style={{
          maxWidth: '1100px',
          fontFamily: 'Arial, Helvetica, sans-serif',
          color: '#111827',
        }}
      >
        <CustomersPageClient
          customers={((data ?? []) as Customer[])}
          error={error?.message ?? null}
        />
      </main>
    </DashboardShell>
  )
}
