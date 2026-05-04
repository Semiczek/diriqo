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
import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type NewStandaloneCalculationPageProps = {
  searchParams?: Promise<{
    leadId?: string | string[] | undefined
  }>
}

function getSingleSearchParam(value: string | string[] | undefined) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] ?? ''
  return ''
}

function formatLeadNote(lead: {
  name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  service_slug: string | null
  message: string | null
}) {
  return [
    `Poptávka: ${lead.company_name || lead.name || 'Bez názvu'}`,
    lead.name ? `Kontakt: ${lead.name}` : null,
    lead.email ? `E-mail: ${lead.email}` : null,
    lead.phone ? `Telefon: ${lead.phone}` : null,
    lead.service_slug ? `Služba: ${lead.service_slug}` : null,
    lead.message ? `Zpráva:\n${lead.message}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

async function resolveProfileIdForUser(
  authUserId: string,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
) {
  const profileByAuth = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (profileByAuth.data?.id) {
    return profileByAuth.data.id
  }

  const profileByUser = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', authUserId)
    .maybeSingle()

  return profileByUser.data?.id ?? null
}

export default async function NewStandaloneCalculationPage({ searchParams }: NewStandaloneCalculationPageProps) {
  const supabase = await createSupabaseServerClient()
  const activeCompany = await getActiveCompanyContext()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const leadId = getSingleSearchParam(resolvedSearchParams?.leadId).trim()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return (
      <DashboardShell activeItem="kalkulace">
        <main style={pageShellStyle}>
          <p>Nepodařilo se ověřit přihlášení.</p>
        </main>
      </DashboardShell>
    )
  }

  const profileId = await resolveProfileIdForUser(user.id, supabase)

  if (!profileId) {
    return (
      <DashboardShell activeItem="kalkulace">
        <main style={pageShellStyle}>
          <p>Nepodařilo se dohledat profil pro založení kalkulace.</p>
        </main>
      </DashboardShell>
    )
  }

  const companyId = activeCompany?.companyId ?? null

  if (!companyId) {
    return (
      <DashboardShell activeItem="kalkulace">
        <main style={pageShellStyle}>
          <p>Nepodařilo se dohledat aktivní firmu pro založení kalkulace.</p>
        </main>
      </DashboardShell>
    )
  }

  const leadResponse = leadId
    ? await supabase
        .from('leads')
        .select('id, name, company_name, email, phone, service_slug, message')
        .eq('id', leadId)
        .eq('company_id', companyId)
        .maybeSingle()
    : null
  const lead = leadResponse?.data ?? null
  const leadName = lead ? lead.company_name || lead.name || 'Poptávka' : null
  const initialTitle = leadName ? `Kalkulace - ${leadName}` : undefined
  const initialDescription = lead?.message ?? undefined
  const initialInternalNote = lead ? formatLeadNote(lead) : undefined

  return (
    <DashboardShell activeItem="kalkulace">
      <main
        style={pageShellStyle}
      >
        <SecondaryAction href="/kalkulace/nova">Zpět na výběr</SecondaryAction>

        <section style={heroCardStyle}>
          <div style={heroContentStyle}>
            <div style={eyebrowStyle}>Interní kalkulace</div>
            <h1 style={heroTitleStyle}>Nová kalkulace bez zákazníka</h1>
            <p style={heroTextStyle}>Tato kalkulace zatím nebude navázaná na konkrétního zákazníka.</p>
          </div>
        </section>

        <CalculationCreateForm
          companyId={companyId}
          customerName={leadName || 'Bez zákazníka'}
          cancelHref="/kalkulace"
          detailHrefBase="/kalkulace"
          initialTitle={initialTitle}
          initialDescription={initialDescription}
          initialInternalNote={initialInternalNote}
        />
      </main>
    </DashboardShell>
  )
}
