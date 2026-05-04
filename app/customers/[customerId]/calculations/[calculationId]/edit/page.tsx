import Link from 'next/link'
import CalculationEditForm from '@/components/CalculationEditForm'
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
  const supabase = await createSupabaseServerClient()

  const [{ data: calculation, error: calculationError }, { data: items, error: itemsError }] =
    await Promise.all([
      supabase
        .from('calculations')
        .select('id, title, description, status, calculation_date, internal_note, customers(id, name)')
        .eq('id', calculationId)
        .eq('customer_id', customerId)
        .maybeSingle(),
      supabase
        .from('calculation_items')
        .select('item_type, name, description, quantity, unit, unit_cost, unit_price, vat_rate, note')
        .eq('calculation_id', calculationId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
    ])

  if (calculationError || itemsError || !calculation) {
    return (
      <DashboardShell activeItem="customers">
        <main style={pageShellStyle}>
          <p>{dictionary.customers.calculationEditPage.notFound}</p>
        </main>
      </DashboardShell>
    )
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
          calculationId={calculation.id}
          customerId={customerId}
          cancelHref={`/customers/${customerId}/calculations/${calculationId}`}
          detailHref={`/customers/${customerId}/calculations/${calculationId}`}
          initialValues={{
            title: calculation.title,
            description: calculation.description ?? '',
            status: calculation.status === 'ready' ? 'ready' : 'draft',
            calculationDate:
              calculation.calculation_date ?? new Date().toISOString().slice(0, 10),
            internalNote: calculation.internal_note ?? '',
            customerItems: calculationItems
              .filter((item) => item.item_type === 'customer')
              .map((item) => ({
                itemType: item.item_type,
                name: item.name,
                description: item.description,
                quantity: item.quantity,
                unit: item.unit,
                unitCost: item.unit_cost,
                unitPrice: item.unit_price,
                vatRate: item.vat_rate,
                note: item.note,
              })),
            costItems: calculationItems
              .filter((item) => item.item_type !== 'customer')
              .map((item) => ({
                itemType: item.item_type,
                name: item.name,
                description: item.description,
                quantity: item.quantity,
                unit: item.unit,
                unitCost: item.unit_cost,
                unitPrice: item.unit_price,
                vatRate: item.vat_rate,
                note: item.note,
              })),
          }}
        />
      </main>
    </DashboardShell>
  )
}
