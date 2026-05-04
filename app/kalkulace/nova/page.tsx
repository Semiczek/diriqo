import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import {
  PrimaryAction,
  SecondaryAction,
  cardTitleStyle,
  emptyStateStyle,
  errorStateStyle,
  eyebrowStyle,
  heroCardStyle,
  heroContentStyle,
  heroTextStyle,
  heroTitleStyle,
  mutedTextStyle,
  pageShellStyle,
  resourceCardStyle,
  sectionCardStyle,
} from '@/components/SaasPageLayout'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type CustomerRow = {
  id: string
  name: string | null
}

export default async function NewCalculationStartPage() {
  const supabase = await createSupabaseServerClient()

  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, name')
    .order('name', { ascending: true })
    .limit(100)

  return (
    <DashboardShell activeItem="kalkulace">
      <main
        style={pageShellStyle}
      >
        <SecondaryAction href="/kalkulace">Zpět na kalkulace</SecondaryAction>

        <section style={heroCardStyle}>
          <div style={heroContentStyle}>
            <div style={eyebrowStyle}>Nová kalkulace</div>
            <h1 style={heroTitleStyle}>Vyber zákazníka</h1>
            <p style={heroTextStyle}>Nejprve vyber zákazníka, nebo založ interní kalkulaci bez vazby.</p>
          </div>
          <PrimaryAction href="/kalkulace/nova/bez-zakaznika">Vytvořit bez zákazníka</PrimaryAction>
        </section>

        {error ? (
          <div style={errorStateStyle}>
            Data se nepodařilo načíst. Technický detail je v konzoli.
          </div>
        ) : !customers || customers.length === 0 ? (
          <div style={emptyStateStyle}>
            <h2 style={{ margin: '0 0 8px', color: '#0f172a' }}>Nejsou tu žádní zákazníci.</h2>
            <p style={{ margin: '0 0 16px' }}>Nejprve založ zákazníka, nebo vytvoř kalkulaci bez zákazníka.</p>
            <PrimaryAction href="/customers/new">Nový zákazník</PrimaryAction>
          </div>
        ) : (
          <section style={{ ...sectionCardStyle, display: 'grid', gap: '12px' }}>
            <div>
              <h2 style={cardTitleStyle}>Zákazníci</h2>
              <p style={{ ...mutedTextStyle, margin: '6px 0 0' }}>Vyber, komu kalkulaci připravuješ.</p>
            </div>
            {(customers as CustomerRow[]).map((customer) => (
              <Link
                key={customer.id}
                href={`/customers/${customer.id}/calculations/new`}
                style={{ ...resourceCardStyle, padding: '15px 16px', fontWeight: 850 }}
              >
                {customer.name || 'Bez názvu zákazníka'}
              </Link>
            ))}
          </section>
        )}
      </main>
    </DashboardShell>
  )
}
