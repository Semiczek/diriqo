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
import { createSupabaseServerClient } from '@/lib/supabase-server'

type PageProps = {
  params: Promise<{
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

export default async function EditGlobalCalculationPage({ params }: PageProps) {
  const { calculationId } = await params
  const supabase = await createSupabaseServerClient()

  const [{ data: calculation, error: calculationError }, { data: items, error: itemsError }] =
    await Promise.all([
      supabase
        .from('calculations')
        .select('id, customer_id, title, description, status, calculation_date, internal_note, customers(id, name)')
        .eq('id', calculationId)
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
      <DashboardShell activeItem="kalkulace">
        <main style={pageShellStyle}>
          <p>Kalkulaci pro úpravu se nepodařilo načíst.</p>
        </main>
      </DashboardShell>
    )
  }

  const calculationItems = ((items ?? []) as CalculationItemRow[])
  const customer = Array.isArray(calculation.customers)
    ? calculation.customers[0] ?? null
    : calculation.customers ?? null

  return (
    <DashboardShell activeItem="kalkulace">
      <main
        style={pageShellStyle}
      >
        <Link
          href={`/kalkulace/${calculationId}`}
          style={{
            display: 'inline-block',
            marginBottom: '20px',
            color: '#2563eb',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Zpět na detail kalkulace
        </Link>

        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ margin: '0 0 8px 0', fontSize: '40px', lineHeight: 1.1 }}>
            Upravit kalkulaci
          </h1>
          <p style={{ margin: 0, color: '#6b7280' }}>
            {customer?.name || 'Bez zákazníka'}
          </p>
        </div>

        <CalculationEditForm
          calculationId={calculation.id}
          customerId={calculation.customer_id}
          cancelHref={`/kalkulace/${calculationId}`}
          detailHref={`/kalkulace/${calculationId}`}
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
