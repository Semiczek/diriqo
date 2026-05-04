import Link from 'next/link'
import CalculationCreateForm from '@/components/CalculationCreateForm'
import DashboardShell from '@/components/DashboardShell'
import {
  SecondaryAction,
  eyebrowStyle,
  heroCardStyle,
  heroContentStyle,
  heroTextStyle,
  heroTitleStyle,
  pageShellStyle,
} from '@/components/SaasPageLayout'
import { getRequestDictionary } from '@/lib/i18n/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type PageProps = {
  params: Promise<{
    customerId: string
  }>
}

export default async function NewCustomerCalculationPage({ params }: PageProps) {
  const dictionary = await getRequestDictionary()
  const { customerId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, name, company_id')
    .eq('id', customerId)
    .maybeSingle()

  if (error || !customer?.company_id) {
    return (
      <DashboardShell activeItem="customers">
        <main style={pageShellStyle}>
          <p>{dictionary.customers.calculationNewPage.notFound}</p>
        </main>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell activeItem="customers">
      <main style={pageShellStyle}>
        <SecondaryAction href={`/customers/${customerId}/calculations`}>
          {dictionary.customers.calculationNewPage.backToCalculations}
        </SecondaryAction>

        <section style={heroCardStyle}>
          <div style={heroContentStyle}>
            <div style={eyebrowStyle}>Nová kalkulace</div>
            <h1 style={heroTitleStyle}>{dictionary.customers.calculationNewPage.title}</h1>
            <p style={heroTextStyle}>{customer.name || dictionary.customers.calculationNewPage.customerFallback}</p>
          </div>
        </section>

        <CalculationCreateForm
          customerId={customer.id}
          companyId={customer.company_id}
          cancelHref={`/customers/${customerId}/calculations`}
          customerName={customer.name || dictionary.customers.calculationNewPage.customerLabel}
        />
      </main>
    </DashboardShell>
  )
}
