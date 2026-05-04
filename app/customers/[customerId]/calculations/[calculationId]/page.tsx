import Link from 'next/link'
import CalculationDangerZone from '@/components/CalculationDangerZone'
import CreateQuoteFromCalculationButton from '@/components/CreateQuoteFromCalculationButton'
import DashboardShell from '@/components/DashboardShell'
import {
  SecondaryAction,
  StatusPill,
  eyebrowStyle,
  heroCardStyle,
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

type CalculationRow = {
  id: string
  company_id: string
  customer_id: string
  title: string
  description: string | null
  status: 'draft' | 'ready' | 'archived' | null
  calculation_date: string | null
  internal_note: string | null
  subtotal_cost: number | null
  subtotal_price: number | null
  margin_amount: number | null
  total_price: number | null
  currency: string | null
  customers?: {
    id: string
    name: string | null
  }[] | null
}

type CalculationItemRow = {
  id: string
  sort_order: number | null
  item_type: string | null
  name: string
  description: string | null
  quantity: number | null
  unit: string | null
  unit_cost: number | null
  unit_price: number | null
  vat_rate: number | null
  total_cost: number | null
  total_price: number | null
  note: string | null
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return '-'

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('cs-CZ')
}

function getStatusLabel(status: CalculationRow['status']) {
  if (status === 'ready') return 'Hotovo'
  if (status === 'archived') return 'Archiv'
  return 'Koncept'
}

function getStatusStyle(status: CalculationRow['status']): React.CSSProperties {
  if (status === 'ready') {
    return { backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }
  }

  if (status === 'archived') {
    return { backgroundColor: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db' }
  }

  return { backgroundColor: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe' }
}

function getItemTypeLabel(itemType: string | null | undefined) {
  if (itemType === 'labor') return 'Práce'
  if (itemType === 'material') return 'Materiál'
  if (itemType === 'rental') return 'Pronájmy'
  if (itemType === 'transport') return 'Doprava'
  if (itemType === 'accommodation') return 'Ubytování'
  return 'Ostatní'
}

const customerPanelStyle: React.CSSProperties = {
  padding: '16px',
  borderRadius: '14px',
  backgroundColor: '#f0fdf4',
  border: '1px solid #bbf7d0',
}

const costPanelStyle: React.CSSProperties = {
  padding: '16px',
  borderRadius: '14px',
  backgroundColor: '#fff7ed',
  border: '1px solid #fdba74',
}

const summaryPanelStyle: React.CSSProperties = {
  padding: '16px',
  borderRadius: '14px',
  backgroundColor: '#eff6ff',
  border: '1px solid #93c5fd',
}

export default async function CalculationDetailPage({ params }: PageProps) {
  const dictionary = await getRequestDictionary()
  const { customerId, calculationId } = await params
  const supabase = await createSupabaseServerClient()

  const [{ data: calculation, error: calculationError }, { data: items, error: itemsError }] =
    await Promise.all([
      supabase
        .from('calculations')
        .select(
          'id, company_id, customer_id, title, description, status, calculation_date, internal_note, subtotal_cost, subtotal_price, margin_amount, total_price, currency, customers(id, name)'
        )
        .eq('id', calculationId)
        .eq('customer_id', customerId)
        .maybeSingle(),
      supabase
        .from('calculation_items')
        .select(
          'id, sort_order, item_type, name, description, quantity, unit, unit_cost, unit_price, vat_rate, total_cost, total_price, note'
        )
        .eq('calculation_id', calculationId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
    ])

  if (calculationError || !calculation) {
    return (
      <DashboardShell activeItem="customers">
        <main style={pageShellStyle}>
          <p>{dictionary.customers.calculationDetail.notFound}</p>
        </main>
      </DashboardShell>
    )
  }

  const customer = Array.isArray(calculation.customers)
    ? calculation.customers[0] ?? null
    : calculation.customers ?? null

  const calculationItems = (items ?? []) as CalculationItemRow[]
  const customerItems = calculationItems.filter((item) => item.item_type === 'customer')
  const costItems = calculationItems.filter((item) => item.item_type !== 'customer')
  const totalPrice = Number(calculation.total_price ?? calculation.subtotal_price ?? 0)
  const totalCost = Number(calculation.subtotal_cost ?? 0)
  const profit = totalPrice - totalCost
  const marginPercent = totalPrice > 0 ? (profit / totalPrice) * 100 : 0
  const discountReserve = Math.max(0, profit - totalPrice * 0.5)

  return (
    <DashboardShell activeItem="customers">
      <main
        style={pageShellStyle}
      >
        <SecondaryAction href={`/customers/${customerId}/calculations`}>
          {dictionary.customers.calculationDetail.backToCalculations}
        </SecondaryAction>

        <section
          style={{
            ...heroCardStyle,
          }}
        >
          <div
            style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}
          >
            <div>
              <div style={eyebrowStyle}>Kalkulace</div>
              <h1 style={heroTitleStyle}>{calculation.title}</h1>
              <div style={heroTextStyle}>
                {customer?.name || dictionary.customers.calculationDetail.customerFallback}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <StatusPill tone={calculation.status === 'ready' ? 'green' : calculation.status === 'archived' ? 'gray' : 'blue'}>{getStatusLabel(calculation.status)}</StatusPill>

              <Link
                href={`/customers/${customerId}/calculations/${calculation.id}/edit`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  border: '1px solid #d1d5db',
                  backgroundColor: '#ffffff',
                  color: '#111827',
                  fontWeight: 700,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {dictionary.customers.calculationDetail.editCalculation}
              </Link>

              <CreateQuoteFromCalculationButton
                calculationId={calculation.id}
                customerId={customerId}
                companyId={calculation.company_id}
                title={calculation.title}
                internalNote={calculation.internal_note}
                subtotalPrice={Number(calculation.subtotal_price ?? 0)}
                totalPrice={Number(calculation.total_price ?? calculation.subtotal_price ?? 0)}
                currency={calculation.currency ?? 'CZK'}
                items={calculationItems.map((item) => ({
                  sortOrder: item.sort_order ?? 0,
                  name: item.name,
                  description: item.description,
                  quantity: Number(item.quantity ?? 0),
                  unit: item.unit,
                  unitPrice: Number(item.unit_price ?? 0),
                  vatRate: Number(item.vat_rate ?? 0),
                  totalPrice: Number(item.total_price ?? 0),
                  note: item.note,
                }))}
              />
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '16px',
              marginBottom: '16px',
            }}
          >
            <div style={customerPanelStyle}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#166534', marginBottom: '12px' }}>
                {dictionary.customers.calculationDetail.calculationSection}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
                <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#ffffff' }}>
                  <div style={{ color: '#166534', marginBottom: '6px' }}>
                    {dictionary.customers.calculationDetail.customerPrice}
                  </div>
                  <strong>{formatCurrency(calculation.total_price ?? calculation.subtotal_price)}</strong>
                </div>
                <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#ffffff' }}>
                  <div style={{ color: '#166534', marginBottom: '6px' }}>
                    {dictionary.customers.calculationDetail.expectedProfit}
                  </div>
                  <strong>{formatCurrency(calculation.margin_amount)}</strong>
                </div>
              </div>
            </div>

            <div style={costPanelStyle}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#c2410c', marginBottom: '12px' }}>
                {dictionary.customers.calculationDetail.costSection}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
                <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#ffffff' }}>
                  <div style={{ color: '#c2410c', marginBottom: '6px' }}>
                    {dictionary.customers.calculationDetail.date}
                  </div>
                  <strong>{formatDate(calculation.calculation_date)}</strong>
                </div>
                <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#ffffff' }}>
                  <div style={{ color: '#c2410c', marginBottom: '6px' }}>
                    {dictionary.customers.calculationDetail.costs}
                  </div>
                  <strong>{formatCurrency(calculation.subtotal_cost)}</strong>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '10px' }}>
            <div>
              <strong>{dictionary.customers.calculationDetail.description}:</strong>{' '}
              {calculation.description || '-'}
            </div>
            <div>
              <strong>{dictionary.customers.calculationDetail.internalNote}:</strong>{' '}
              {calculation.internal_note || '-'}
            </div>
          </div>

          <div style={{ ...summaryPanelStyle, marginTop: '16px' }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#1d4ed8', marginBottom: '12px' }}>
              {dictionary.customers.calculationDetail.marginSummary}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: '14px',
              }}
            >
              <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#ffffff' }}>
                <div style={{ color: '#1d4ed8', marginBottom: '6px' }}>
                  {dictionary.customers.calculationDetail.profit}
                </div>
                <strong>{formatCurrency(profit)}</strong>
              </div>
              <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#ffffff' }}>
                <div style={{ color: '#1d4ed8', marginBottom: '6px' }}>
                  {dictionary.customers.calculationDetail.margin}
                </div>
                <strong>{marginPercent.toFixed(1)} %</strong>
              </div>
              <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#ffffff' }}>
                <div style={{ color: '#1d4ed8', marginBottom: '6px' }}>
                  {dictionary.customers.calculationDetail.discountReserve}
                </div>
                <strong>{formatCurrency(discountReserve)}</strong>
              </div>
            </div>
          </div>
        </section>

        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            backgroundColor: '#ffffff',
            padding: '24px',
          }}
        >
          <h2 style={{ margin: '0 0 16px 0', fontSize: '24px' }}>
            {dictionary.customers.calculationDetail.items}
          </h2>

          {itemsError ? (
            <p style={{ color: '#b91c1c' }}>
              {dictionary.customers.calculationDetail.itemsLoadFailed}: {itemsError.message}
            </p>
          ) : calculationItems.length === 0 ? (
            <p style={{ color: '#6b7280' }}>{dictionary.customers.calculationDetail.noItems}</p>
          ) : (
            <div style={{ display: 'grid', gap: '20px' }}>
              <div style={customerPanelStyle}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#166534', marginBottom: '14px' }}>
                  {dictionary.customers.calculationDetail.calculationSection}
                </div>
                {customerItems.length === 0 ? (
                  <p style={{ margin: 0, color: '#6b7280' }}>
                    {dictionary.customers.calculationDetail.noCustomerItems}
                  </p>
                ) : (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    {customerItems.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          border: '1px solid #bbf7d0',
                          borderRadius: '14px',
                          backgroundColor: '#ffffff',
                          padding: '16px',
                          display: 'grid',
                          gap: '10px',
                        }}
                      >
                        <div style={{ fontSize: '18px', fontWeight: 700 }}>{item.name}</div>
                        {item.description && <div style={{ color: '#4b5563' }}>{item.description}</div>}
                        <div style={{ display: 'grid', gap: '8px' }}>
                          <div><strong>{dictionary.customers.calculationDetail.quantity}:</strong> {Number(item.quantity ?? 0)}</div>
                          <div><strong>{dictionary.customers.calculationDetail.unit}:</strong> {item.unit || '-'}</div>
                          <div><strong>{dictionary.customers.calculationDetail.unitPrice}:</strong> {formatCurrency(item.unit_price)}</div>
                          <div><strong>{dictionary.customers.calculationDetail.vatRate}:</strong> {item.vat_rate != null ? `${Number(item.vat_rate)} %` : '-'}</div>
                          <div><strong>{dictionary.customers.calculationDetail.totalPrice}:</strong> {formatCurrency(item.total_price)}</div>
                        </div>
                        <div><strong>{dictionary.customers.calculationDetail.note}:</strong> {item.note || '-'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={costPanelStyle}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#c2410c', marginBottom: '14px' }}>
                  {dictionary.customers.calculationDetail.costSection}
                </div>
                {costItems.length === 0 ? (
                  <p style={{ margin: 0, color: '#6b7280' }}>
                    {dictionary.customers.calculationDetail.noCostItems}
                  </p>
                ) : (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    {costItems.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          border: '1px solid #fdba74',
                          borderRadius: '14px',
                          backgroundColor: '#ffffff',
                          padding: '16px',
                          display: 'grid',
                          gap: '10px',
                        }}
                      >
                        <div style={{ fontSize: '18px', fontWeight: 700 }}>{item.name}</div>
                        {item.description && <div style={{ color: '#4b5563' }}>{item.description}</div>}
                        <div style={{ display: 'grid', gap: '8px' }}>
                          <div><strong>{dictionary.customers.calculationDetail.costType}:</strong> {getItemTypeLabel(item.item_type)}</div>
                          <div><strong>{dictionary.customers.calculationDetail.quantity}:</strong> {Number(item.quantity ?? 0)}</div>
                          <div><strong>{dictionary.customers.calculationDetail.unit}:</strong> {item.unit || '-'}</div>
                          <div><strong>{dictionary.customers.calculationDetail.unitCost}:</strong> {formatCurrency(item.unit_cost)}</div>
                          <div><strong>{dictionary.customers.calculationDetail.totalCost}:</strong> {formatCurrency(item.total_cost)}</div>
                        </div>
                        <div><strong>{dictionary.customers.calculationDetail.note}:</strong> {item.note || '-'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <CalculationDangerZone
          calculationId={calculation.id}
          backHref={`/customers/${customerId}/calculations`}
        />
      </main>
    </DashboardShell>
  )
}

