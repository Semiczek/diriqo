import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import {
  PrimaryAction,
  StatusPill,
  cardTitleStyle,
  emptyStateStyle,
  errorStateStyle,
  eyebrowStyle,
  fieldLabelStyle,
  filterCardStyle,
  heroCardStyle,
  heroContentStyle,
  heroTextStyle,
  heroTitleStyle,
  inputStyle,
  metaGridStyle,
  metaItemStyle,
  metaLabelStyle,
  metaValueStyle,
  mutedTextStyle,
  pageShellStyle,
  primaryButtonStyle,
  resourceCardStyle,
} from '@/components/SaasPageLayout'
import { getActiveCompanyContext } from '@/lib/active-company'
import {
  formatMonthLabel,
  getMonthDateRange,
  resolveMonthValue,
  shiftMonthValue,
} from '@/lib/month-filter'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type CalculationRow = {
  id: string
  customer_id: string | null
  title: string
  description: string | null
  status: 'draft' | 'ready' | 'archived' | null
  calculation_date: string | null
  total_price: number | null
  subtotal_cost?: number | null
  subtotal_price?: number | null
  customers?:
    | {
        id: string
        name: string | null
      }[]
    | {
        id: string
        name: string | null
      }
    | null
}

type CustomerRow = {
  id: string
  name: string | null
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

type PageProps = {
  searchParams: Promise<{
    customer?: string
    month?: string
    sort?: string
  }>
}

export default async function KalkulacePage({ searchParams }: PageProps) {
  const supabase = await createSupabaseServerClient()
  const { customer = 'all', month: monthParam, sort = 'customer' } = await searchParams
  const activeCompany = await getActiveCompanyContext()
  const selectedMonth = resolveMonthValue(monthParam)
  const monthRange = getMonthDateRange(selectedMonth)
  const previousMonth = shiftMonthValue(selectedMonth, -1)
  const nextMonth = shiftMonthValue(selectedMonth, 1)

  if (!activeCompany) {
    return (
      <DashboardShell activeItem="kalkulace">
        <main style={pageShellStyle}>
          <div style={errorStateStyle}>
            Nemáte přístup do interního Hubu.
          </div>
        </main>
      </DashboardShell>
    )
  }

  const buildMonthHref = (targetMonth: string) => {
    const params = new URLSearchParams({ month: targetMonth })

    if (customer !== 'all') params.set('customer', customer)
    if (sort !== 'customer') params.set('sort', sort)

    return `/kalkulace?${params.toString()}`
  }

  const { data: customers } = await supabase
    .from('customers')
    .select('id, name')
    .eq('company_id', activeCompany.companyId)
    .order('name', { ascending: true })
    .limit(200)

  let calculationsQuery = supabase
    .from('calculations')
    .select(
      'id, customer_id, title, description, status, calculation_date, total_price, subtotal_cost, subtotal_price, customers(id, name)',
    )
    .eq('company_id', activeCompany.companyId)
    .gte('calculation_date', monthRange.from)
    .lte('calculation_date', monthRange.to)
    .order('calculation_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)

  if (customer === 'none') {
    calculationsQuery = calculationsQuery.is('customer_id', null)
  } else if (customer !== 'all') {
    calculationsQuery = calculationsQuery.eq('customer_id', customer)
  }

  const { data, error } = await calculationsQuery

  const calculations = (data ?? []).map((item) => ({
    ...item,
    customers: Array.isArray(item.customers) ? item.customers[0] ?? null : item.customers ?? null,
  })) as Array<
    Omit<CalculationRow, 'customers'> & {
      customers: {
        id: string
        name: string | null
      } | null
    }
  >

  const filteredCalculations = calculations
    .filter((item) => {
      if (customer === 'none') {
        return !item.customer_id
      }

      if (customer !== 'all') {
        return item.customer_id === customer
      }

      return true
    })
    .sort((left, right) => {
      if (sort === 'date_asc') {
        return (left.calculation_date ?? '').localeCompare(right.calculation_date ?? '')
      }

      if (sort === 'date_desc') {
        return (right.calculation_date ?? '').localeCompare(left.calculation_date ?? '')
      }

      const leftCustomer = left.customers?.name ?? 'Žádný zákazník'
      const rightCustomer = right.customers?.name ?? 'Žádný zákazník'
      const customerCompare = leftCustomer.localeCompare(rightCustomer, 'cs')

      if (customerCompare !== 0) return customerCompare

      return (right.calculation_date ?? '').localeCompare(left.calculation_date ?? '')
    })

  return (
    <DashboardShell activeItem="kalkulace">
      <main style={pageShellStyle}>
        <section data-tour="calculations-header" style={heroCardStyle}>
          <div style={heroContentStyle}>
            <div style={eyebrowStyle}>Finance</div>
            <h1 style={heroTitleStyle}>Kalkulace</h1>
            <p style={heroTextStyle}>Přehled posledních interních kalkulací napříč zákazníky.</p>
          </div>
          <PrimaryAction href="/kalkulace/nova" dataTour="new-calculation-button">+ Nová kalkulace</PrimaryAction>
        </section>

        <div
          data-tour="calculations-month"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            padding: '16px 20px',
            borderRadius: '16px',
            border: '1px solid #e5e7eb',
            backgroundColor: '#ffffff',
            marginBottom: '16px',
          }}
        >
          <Link
            href={buildMonthHref(previousMonth)}
            style={{
              color: '#111827',
              textDecoration: 'none',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            ← Předchozí měsíc
          </Link>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: 700 }}>
              Zobrazený měsíc
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800 }}>
              {formatMonthLabel(selectedMonth)}
            </div>
          </div>
          <Link
            href={buildMonthHref(nextMonth)}
            style={{
              color: '#111827',
              textDecoration: 'none',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            Další měsíc →
          </Link>
        </div>

        <form
          method="get"
          data-tour="calculations-filters"
          style={filterCardStyle}
        >
          <label style={fieldLabelStyle}>
            <span>Zákazník</span>
            <select
              name="customer"
              defaultValue={customer}
              style={inputStyle}
            >
              <option value="all">Všichni zákazníci</option>
              <option value="none">Bez zákazníka</option>
              {(customers as CustomerRow[] | null)?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name || 'Bez názvu zákazníka'}
                </option>
              ))}
            </select>
          </label>

          <label style={fieldLabelStyle}>
            <span>Měsíc</span>
            <input
              name="month"
              type="month"
              defaultValue={selectedMonth}
              style={inputStyle}
            />
          </label>

          <label style={fieldLabelStyle}>
            <span>Řazení</span>
            <select
              name="sort"
              defaultValue={sort}
              style={inputStyle}
            >
              <option value="customer">Podle zákazníka</option>
              <option value="date_desc">Datum od nejnovějších</option>
              <option value="date_asc">Datum od nejstarších</option>
            </select>
          </label>

          <button
            type="submit"
            style={{ ...primaryButtonStyle, cursor: 'pointer' }}
          >
            Filtrovat
          </button>
        </form>

        {error ? (
          <div style={errorStateStyle}>
            Data se nepodařilo načíst. Technický detail je v konzoli.
          </div>
        ) : filteredCalculations.length === 0 ? (
          <div data-tour="calculations-list" style={emptyStateStyle}>
            <div style={{ fontSize: '30px', marginBottom: '8px' }}>+</div>
            <h2 style={{ margin: '0 0 6px', color: '#0f172a' }}>Zatím tu nejsou žádné kalkulace.</h2>
            <p style={{ margin: '0 0 16px' }}>Vytvoř první kalkulaci a připrav z ní nabídku.</p>
            <PrimaryAction href="/kalkulace/nova">Nová kalkulace</PrimaryAction>
          </div>
        ) : (
          <div data-tour="calculations-list" style={{ display: 'grid', gap: '14px' }}>
            {filteredCalculations.map((item) => (
              <Link
                key={item.id}
                href={
                  item.customer_id
                    ? `/customers/${item.customer_id}/calculations/${item.id}`
                    : `/kalkulace/${item.id}`
                }
                style={resourceCardStyle}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <h2 style={cardTitleStyle}>{item.title}</h2>
                    <p style={{ ...mutedTextStyle, margin: '8px 0 0' }}>{item.description || 'Bez popisu'}</p>
                    <div style={metaGridStyle}>
                      <div style={metaItemStyle}><span style={metaLabelStyle}>Zákazník</span><span style={metaValueStyle}>{item.customers?.name || '—'}</span></div>
                      <div style={metaItemStyle}><span style={metaLabelStyle}>Datum</span><span style={metaValueStyle}>{formatDate(item.calculation_date)}</span></div>
                      <div style={metaItemStyle}><span style={metaLabelStyle}>Cena</span><span style={metaValueStyle}>{formatCurrency(item.total_price)}</span></div>
                      <div style={metaItemStyle}><span style={metaLabelStyle}>Zisk</span><span style={{ ...metaValueStyle, color: '#166534' }}>{formatCurrency(getProfit(item.total_price ?? item.subtotal_price, item.subtotal_cost))}</span></div>
                    </div>
                  </div>

                  <StatusPill tone={getStatusTone(item.status)}>{getStatusLabel(item.status)}</StatusPill>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </DashboardShell>
  )
}
