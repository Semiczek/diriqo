import Link from 'next/link'
import CalculationEditForm from '@/components/CalculationEditForm'
import { redirect } from 'next/navigation'
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
import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type PageProps = {
  params: Promise<{
    customerId: string
    calculationId: string
  }>
}

type CalculationItemRow = {
  item_type: string | null
  name: string
  description: string | null
  quantity: number | null
  unit: string | null
  unit_cost: number | null
  unit_price: number | null
  vat_rate: number | null
  note: string | null
}

export default async function EditCustomerCalculationPage({ params }: PageProps) {
  const dictionary = await getRequestDictionary()
  const { customerId, calculationId } = await params
  const activeCompany = await getActiveCompanyContext({ allowedRoles: ['company_admin', 'super_admin'] })
  if (!activeCompany) return <DashboardShell activeItem="kalkulace"><main style={pageShellStyle}><p>Kalkulace nejsou pro aktuální firmu nebo roli dostupné.</p></main></DashboardShell>
  const supabase = await createSupabaseServerClient()

  const [{ data: calculation, error: calculationError }, { data: items, error: itemsError }] =
    await Promise.all([
      supabase
        .from('calculations')
        .select('id, company_id, revision::text, currency, customer_id, title, description, status, calculation_date, internal_note, customers(id, name)')
        .eq('id', calculationId)
        .eq('company_id', activeCompany.companyId)
        .maybeSingle(),
      supabase
        .from('calculation_items')
        .select('item_type, name, description, quantity, unit, unit_cost, unit_price, vat_rate, note, calculations!inner(company_id)')
        .eq('calculation_id', calculationId)
        .eq('calculations.company_id', activeCompany.companyId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
    ])

  if (calculationError || itemsError || !calculation || !calculation.customer_id) {
    return (
      <DashboardShell activeItem="customers">
        <main style={pageShellStyle}>
          <p>{dictionary.customers.calculationEditPage.notFound}</p>
        </main>
      </DashboardShell>
    )
  }

  if (calculation.customer_id !== customerId) {
    redirect(`/customers/${calculation.customer_id}/calculations/${calculation.id}/edit`)
  }

  if ((calculation.status !== 'draft' && calculation.status !== 'ready') || !/^[1-9][0-9]*$/.test(calculation.revision)) {
    return <DashboardShell activeItem="kalkulace"><main style={pageShellStyle}><p>Tuto historickou kalkulaci nelze bezpečně upravit: její stav nebo revize nejsou podporované.</p></main></DashboardShell>
  }

  const calculationItems = (items ?? []) as CalculationItemRow[]
  const customer = Array.isArray(calculation.customers)
    ? calculation.customers[0] ?? null
    : calculation.customers ?? null

  return (
    <DashboardShell activeItem="customers">
      <main
        style={pageShellStyle}
      >
        <SecondaryAction href={`/customers/${customerId}/calculations/${calculationId}`}>
          {dictionary.customers.calculationEditPage.backToDetail}
        </SecondaryAction>

        <section style={heroCardStyle}>
          <div style={heroContentStyle}>
            <div style={eyebrowStyle}>Úprava kalkulace</div>
            <h1 style={heroTitleStyle}>{dictionary.customers.calculationEditPage.title}</h1>
            <p style={heroTextStyle}>{customer?.name || dictionary.customers.calculationEditPage.customerFallback}</p>
          </div>
        </section>

        <CalculationEditForm
          key={[activeCompany.companyId, activeCompany.profileId, calculation.id].join(':')}
          companyId={activeCompany.companyId}
          profileId={activeCompany.profileId}
          expectedRevision={calculation.revision}
          calculationId={calculation.id}
          customerId={customerId}
          cancelHref={`/customers/${customerId}/calculations/${calculationId}`}
          detailHref={`/customers/${customerId}/calculations/${calculationId}`}
          initialValues={{
            title: calculation.title,
            description: calculation.description ?? '',
            status: calculation.status,
            calculationDate:
              calculation.calculation_date ?? '',
            internalNote: calculation.internal_note ?? '',
            currency: calculation.currency,
            items: calculationItems.map((item) => ({
              itemType: item.item_type, name: item.name, description: item.description,
              quantity: item.quantity, unit: item.unit, unitCost: item.unit_cost,
              unitPrice: item.unit_price, vatRate: item.vat_rate, note: item.note,
            })),
          }}
        />
      </main>
    </DashboardShell>
  )
}
