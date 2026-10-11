import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { MOBILE_ENTRY_COOKIE, mobileEntryPath } from '@/lib/mobile-access'
import styles from './onboarding.module.css'

import { chooseOnboardingMode } from '@/app/onboarding/actions'
import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUserOnboardingState } from '@/lib/user-onboarding'

type OnboardingPageProps = {
  searchParams: Promise<{
    again?: string
  }>
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const params = await searchParams
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/sign-in')
  }

  const activeCompany = await getActiveCompanyContext({
    allowedRoles: ['super_admin', 'company_admin', 'manager', 'worker'],
  })

  if (!activeCompany) {
    redirect('/onboarding/company')
  }

  const state = await getUserOnboardingState(user.id, activeCompany.companyId)
  const canShowAgain = params.again === '1' || params.again === 'true'

  if (state?.onboarding_completed && !canShowAgain) {
    redirect(mobileEntryPath((await cookies()).get(MOBILE_ENTRY_COOKIE)?.value) ?? '/')
  }

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand}><span aria-hidden="true">d.</span>Diriqo</div>
          <p className={styles.company}>{activeCompany.companyName || 'Vaše firma'}</p>
          <h1>Jak chcete začít?</h1>
          <p>Projděte si Diriqo, nebo rovnou začněte pracovat. Ke všemu se můžete později vrátit.</p>
        </header>

        <form action={chooseOnboardingMode} className={styles.recommendedCard}>
          <input type="hidden" name="mode" value="quick" />
          <div className={styles.cardTop}>
            <span className={styles.icon} aria-hidden="true">↗</span>
            <span className={styles.badge}>Doporučeno · 2–4 minuty</span>
          </div>
          <div>
            <h2>Rychle se zorientovat</h2>
            <p>Ukážeme vám, kde najdete zákazníky, zakázky, tým a kalendář.</p>
          </div>
          <button type="submit" className={styles.primaryButton}>Ukázat mi Diriqo<span aria-hidden="true">→</span></button>
        </form>

        <form action={chooseOnboardingMode} className={styles.secondaryCard}>
          <input type="hidden" name="mode" value="detailed" />
          <div>
            <h2>Nastavit firmu krok za krokem</h2>
            <p>Podrobný průvodce od nastavení firmy po první zakázku.</p>
          </div>
          <button type="submit" className={styles.secondaryButton}>Spustit průvodce</button>
        </form>

        <form action={chooseOnboardingMode} className={styles.skipForm}>
          <input type="hidden" name="mode" value="skipped" />
          <button type="submit" className={styles.textButton}>Začít rovnou pracovat<span aria-hidden="true">→</span></button>
        </form>
        <p className={styles.footnote}>Průvodce můžete kdykoliv zavřít a znovu otevřít z hlavního menu.</p>
      </section>
    </main>
  )
}
