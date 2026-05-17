import Link from 'next/link'

import DashboardShell from '@/components/DashboardShell'
import WorkerInvitePanel from '@/app/workers/[workerId]/WorkerInvitePanel'
import { getWorkerName, type ProfileRow } from '@/app/workers/[workerId]/worker-detail-helpers'
import {
  SecondaryAction,
  cardTitleStyle,
  emptyStateStyle,
  errorStateStyle,
  heroCardStyle,
  heroTextStyle,
  heroTitleStyle,
  pageShellStyle,
  primaryButtonStyle,
  sectionCardStyle,
} from '@/components/SaasPageLayout'
import { getRequestLocale } from '@/lib/i18n/server'
import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type InvitePageProps = {
  params: Promise<{
    workerId: string
  }>
}

type LatestWorkerInviteRow = {
  id: string
  status: string | null
  expires_at: string | null
}

function renderError(message: string) {
  return (
    <DashboardShell activeItem="workers">
      <main style={pageShellStyle}>
        <div style={errorStateStyle}>{message}</div>
      </main>
    </DashboardShell>
  )
}

function renderNotFound() {
  return (
    <DashboardShell activeItem="workers">
      <main style={pageShellStyle}>
        <div style={emptyStateStyle}>Pracovník nebyl nalezen.</div>
      </main>
    </DashboardShell>
  )
}

export default async function WorkerInvitePage({ params }: InvitePageProps) {
  const { workerId } = await params
  const locale = await getRequestLocale()
  const access = await requireCompanyRole('company_admin', 'super_admin')

  if (!access.ok) {
    return renderError('Nemáte oprávnění pozvat pracovníka.')
  }

  const supabase = await createSupabaseServerClient()
  const memberResponse = await supabase
    .from('company_members')
    .select('id')
    .eq('company_id', access.value.companyId)
    .eq('profile_id', workerId)
    .eq('is_active', true)
    .maybeSingle()

  if (memberResponse.error) {
    return renderError(`Nepodařilo se ověřit pracovníka: ${memberResponse.error.message}`)
  }

  if (!memberResponse.data) {
    return renderNotFound()
  }

  const profileResponse = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, worker_status, activated_at, disabled_at, last_seen_at, device_registered_at')
    .eq('id', workerId)
    .maybeSingle()

  if (profileResponse.error) {
    return renderError(`Nepodařilo se načíst pracovníka: ${profileResponse.error.message}`)
  }

  const profile = profileResponse.data as ProfileRow | null
  if (!profile) return renderNotFound()

  const latestInviteResponse = await supabase
    .from('worker_invites')
    .select('id, status, expires_at')
    .eq('company_id', access.value.companyId)
    .eq('worker_profile_id', workerId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (latestInviteResponse.error) {
    return renderError(`Nepodařilo se načíst pozvánku: ${latestInviteResponse.error.message}`)
  }

  const latestInvite = (((latestInviteResponse.data ?? []) as unknown[]) as LatestWorkerInviteRow[])[0] ?? null
  const now = new Date()
  const latestInviteExpired =
    latestInvite?.status === 'pending' &&
    latestInvite.expires_at != null &&
    new Date(latestInvite.expires_at).getTime() <= now.getTime()
  const inviteStatus =
    profile.worker_status === 'disabled' || profile.disabled_at
      ? 'disabled'
      : profile.activated_at || profile.worker_status === 'active'
        ? 'active'
        : latestInviteExpired
          ? 'expired'
          : latestInvite?.status ?? profile.worker_status ?? 'not_invited'

  return (
    <DashboardShell activeItem="workers">
      <main style={{ ...pageShellStyle, maxWidth: '920px' }}>
        <SecondaryAction href="/workers">Zpět na pracovníky</SecondaryAction>

        <section style={heroCardStyle}>
          <div>
            <h1 style={heroTitleStyle}>Pozvat pracovníka</h1>
            <p style={heroTextStyle}>
              Připravte e-mail, WhatsApp zprávu, QR kód nebo odkaz pro {getWorkerName(profile)}.
            </p>
          </div>
          <Link href={`/workers/${workerId}`} style={primaryButtonStyle}>
            Pokračovat do karty pracovníka
          </Link>
        </section>

        <WorkerInvitePanel
          workerId={workerId}
          workerName={getWorkerName(profile)}
          phone={profile.phone ?? null}
          email={profile.email ?? null}
          locale={locale}
          autoCreate
          initialInvite={{
            inviteId: latestInvite?.id ?? null,
            inviteLink: null,
            inviteMessage: null,
            whatsappUrl: null,
            status: inviteStatus,
            expiresAt: latestInvite?.expires_at ?? null,
          }}
        />

        <section style={sectionCardStyle}>
          <h2 style={cardTitleStyle}>Co se stane dál</h2>
          <p style={{ margin: '8px 0 0', color: '#64748b', lineHeight: 1.5 }}>
            E-mail odejde přímo z aplikace. WhatsApp se otevře s předvyplněnou zprávou a odeslání ještě
            potvrdí člověk přímo ve WhatsAppu.
          </p>
        </section>
      </main>
    </DashboardShell>
  )
}
