import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import {
  PrimaryAction,
  SecondaryAction,
  StatusPill,
  cardTitleStyle,
  emptyStateStyle,
  errorStateStyle,
  eyebrowStyle,
  heroCardStyle,
  heroContentStyle,
  heroTextStyle,
  heroTitleStyle,
  metaGridStyle,
  metaItemStyle,
  metaLabelStyle,
  metaValueStyle,
  mutedTextStyle,
  pageShellStyle,
  resourceCardStyle,
} from '@/components/SaasPageLayout'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type PageProps = {
  params: Promise<{
    customerId: string
  }>
}

type CalculationRow = {
  id: string
  title: string
  description: string | null
  status: 'draft' | 'ready' | 'archived' | null
  calculation_date: string | null
  total_price: number | null
  subtotal_cost: number | null
  subtotal_price: number | null
  created_at: string | null
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return '—'

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('cs-CZ')
}

function getProfit(totalPrice: number | null | undefined, subtotalCost: number | null | undefined) {
  return Number(totalPrice ?? 0) - Number(subtotalCost ?? 0)
}

function getStatusLabel(status: CalculationRow['status']) {
  if (status === 'ready') return 'Hotovo'
  if (status === 'archived') return 'Archiv'
  return 'Koncept'
}

function getStatusTone(status: CalculationRow['status']) {
  if (status === 'ready') return 'green'
  if (status === 'archived') return 'gray'
  return 'blue'
}

function getStatusStyle(status: CalculationRow['status']): React.CSSProperties {
  if (status === 'ready') {
    return {
      backgroundColor: '#dcfce7',
      color: '#166534',
      border: '1px solid #bbf7d0',
    }
  }

  if (status === 'archived') {
    return {
      backgroundColor: '#f3f4f6',
      color: '#4b5563',
      border: '1px solid #d1d5db',
    }
  }

  return {
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
    border: '1px solid #bfdbfe',
  }
}

export default async function CustomerCalculationsPage({ params }: PageProps) {
  const { customerId } = await params
  const supabase = await createSupabaseServerClient()

  const [{ data: customer, error: customerError }, { data: calculations, error: calculationsError }] =
    await Promise.all([
      supabase.from('customers').select('id, name').eq('id', customerId).maybeSingle(),
      supabase
        .from('calculations')
        .select(
          'id, title, description, status, calculation_date, total_price, subtotal_cost, subtotal_price, created_at'
        )
        .eq('customer_id', customerId)
        .order('calculation_date', { ascending: false })
        .order('created_at', { ascending: false }),
    ])

  if (customerError || !customer) {
    return (
      <DashboardShell activeItem="customers">
        <main style={pageShellStyle}>
          <p>Zákazník nebyl nalezen.</p>
        </main>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell activeItem="customers">
      <main style={pageShellStyle}>
        <section style={heroCardStyle}>
          <div style={heroContentStyle}>
            <div style={eyebrowStyle}>Zákazník</div>
            <h1 style={heroTitleStyle}>Kalkulace</h1>
            <p style={heroTextStyle}>{customer.name || 'Bez názvu zákazníka'}</p>
          </div>
          <PrimaryAction href={`/customers/${customerId}/calculations/new`}>+ Nová kalkulace</PrimaryAction>
        </section>

        <div style={{ display: 'none', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
          <div>
            <Link href={`/customers/${customerId}`} style={{ display: 'inline-block', marginBottom: '14px', color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>
              ← Zpět na zákazníka
            </Link>
            <h1 style={{ margin: 0, fontSize: '40px', lineHeight: 1.1 }}>Kalkulace</h1>
            <p style={{ margin: '10px 0 0 0', color: '#6b7280' }}>{customer.name || 'Bez názvu zákazníka'}</p>
          </div>

          <Link
            href={`/customers/${customerId}/calculations/new`}
            style={{
              display: 'inline-block',
              backgroundColor: '#000000',
              color: '#ffffff',
              textDecoration: 'none',
              fontWeight: '700',
              fontSize: '16px',
              padding: '14px 20px',
              borderRadius: '14px',
              whiteSpace: 'nowrap',
              height: 'fit-content',
            }}
          >
            + Nová kalkulace
          </Link>
        </div>

        {calculationsError ? (
          <div style={{ border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '16px', padding: '20px' }}>
            Nepodařilo se načíst kalkulace: {calculationsError.message}
          </div>
        ) : !calculations || calculations.length === 0 ? (
          <div style={{ border: '1px solid #e5e7eb', backgroundColor: '#ffffff', borderRadius: '16px', padding: '20px', color: '#6b7280' }}>
            Zatím tu nejsou žádné kalkulace.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '14px' }}>
            {(calculations as CalculationRow[]).map((calculation) => (
              <Link
                key={calculation.id}
                href={`/customers/${customerId}/calculations/${calculation.id}`}
                style={{
                  display: 'block',
                  textDecoration: 'none',
                  border: '1px solid #e5e7eb',
                  backgroundColor: '#ffffff',
                  borderRadius: '16px',
                  padding: '20px',
                  color: '#111827',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '10px' }}>
                      {calculation.title}
                    </div>
                    <div style={{ color: '#4b5563', marginBottom: '6px' }}>
                      <strong>Popis:</strong> {calculation.description || '—'}
                    </div>
                    <div style={{ color: '#4b5563', marginBottom: '6px' }}>
                      <strong>Datum:</strong> {formatDate(calculation.calculation_date)}
                    </div>
                    <div style={{ color: '#4b5563', marginBottom: '6px' }}>
                      <strong>Náklady:</strong> {formatCurrency(calculation.subtotal_cost)}
                    </div>
                    <div style={{ color: '#4b5563', marginBottom: '6px' }}>
                      <strong>Cena:</strong> {formatCurrency(calculation.total_price ?? calculation.subtotal_price)}
                    </div>
                    <div style={{ color: '#166534' }}>
                      <strong>Zisk:</strong>{' '}
                      {formatCurrency(
                        getProfit(
                          calculation.total_price ?? calculation.subtotal_price,
                          calculation.subtotal_cost
                        )
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      ...getStatusStyle(calculation.status),
                      display: 'inline-block',
                      height: 'fit-content',
                      padding: '8px 12px',
                      borderRadius: '999px',
                      fontSize: '14px',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {getStatusLabel(calculation.status)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </DashboardShell>
  )
}
