import Link from 'next/link'

import DashboardShell from '@/components/DashboardShell'
import { requireHubAccess } from '@/lib/require-hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ModuleAccessError, requirePaidCompanyCapability } from '@/lib/platform/module-operation-access'
import NewJobClient from './NewJobClient'

export default async function NewJobPage() {
  const activeCompany = await requireHubAccess()
  const supabase = await createSupabaseServerClient()

  try {
    await requirePaidCompanyCapability({ companyId: activeCompany.companyId, supabase }, 'core.jobs.create')
  } catch (error) {
    if (!(error instanceof ModuleAccessError)) throw error
    const unavailable = error.status === 503

    return (
      <DashboardShell activeItem="jobs">
        <main aria-labelledby="new-job-access-title" style={{ maxWidth: 760, margin: '0 auto', paddingBottom: 32 }}>
          <section role="alert" style={{ padding: 24, border: '1px solid #cbd5e1', borderRadius: 16, background: '#fff' }}>
            <h1 id="new-job-access-title" style={{ marginTop: 0 }}>
              {unavailable ? 'Předplatné se nepodařilo ověřit' : 'Vytvoření zakázky není dostupné'}
            </h1>
            <p>
              {unavailable
                ? 'Platnost předplatného teď nelze ověřit. Zkuste stránku obnovit později.'
                : error.message}
            </p>
            <nav aria-label="Další možnosti" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <Link href="/billing/modules" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
                Předplatné a moduly
              </Link>
              <Link href="/jobs" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
                Zpět na zakázky
              </Link>
            </nav>
          </section>
        </main>
      </DashboardShell>
    )
  }

  return <NewJobClient />
}
