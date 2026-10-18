import Link from 'next/link'
import { aiError, aiWorkspace } from '@/lib/diriqent/server'
import { providerConfigured } from '@/lib/diriqent/provider'
import { supportContext } from '@/lib/diriqent/support-server'
import { supportSuggestions } from '@/lib/diriqent/support'
import { diriqentScopeLabel, matchesDiriqentIdentity } from '@/lib/diriqent/access'
import AiFrame from './Frame'
import ChatClient from './ChatClient'
import ContextBoundary from './ContextBoundary'
import SupportClient from './SupportClient'
import WorkClient from './WorkClient'
import styles from './diriqent.module.css'
export default async function DiriqentPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams
  let context
  try { context = await supportContext() }
  catch { return <AiFrame title="Diriqent"><p className={styles.notice}>Pro Diriqenta potřebujete platné přihlášení a členství v aktivní firmě.</p></AiFrame> }
  const identity = { companyId: context.companyId, profileId: context.profileId, role: context.role ?? '' }
  let content
  if (mode === 'work' || mode === 'advanced') {
    let workspace: { data: Awaited<ReturnType<typeof aiWorkspace>>; configured: boolean } | null = null
    let workspaceError = ''
    try {
      const data = await aiWorkspace()
      if (!matchesDiriqentIdentity(identity, { ...data, role: data.roleScope })) throw new Error('Firma nebo oprávnění se změnily. Obnovte stránku.')
      workspace = { data, configured: providerConfigured() }
    } catch (error) {
      workspaceError = aiError(error)
    }
    content = workspace
      ? mode === 'advanced'
        ? <WorkClient data={workspace.data} configured={workspace.configured} />
        : <ChatClient data={workspace.data} configured={workspace.configured} />
      : <div className={styles.stack}><p className={styles.notice}>{workspaceError}</p><Link href="/diriqent" className={styles.secondary}>Pokračovat v podpoře bez kreditu</Link></div>
  } else {
    content = <SupportClient identity={identity} suggestions={supportSuggestions(identity.role)} />
  }
  return <AiFrame title="Diriqent">
    <p className={styles.muted}>Rozsah přístupu: {diriqentScopeLabel(identity.role)}. Přístup se při každém požadavku znovu ověřuje.</p>
    <ContextBoundary key={`${identity.companyId}:${identity.profileId}:${identity.role}:${mode ?? 'support'}`} identity={identity}>{content}</ContextBoundary>
  </AiFrame>
}
