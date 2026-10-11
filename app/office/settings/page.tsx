import { revalidatePath } from 'next/cache'
import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { hasPlatformAdminAccess } from '@/lib/platform/platform-admin'

async function requireOfficeAdmin() {
  const active = await getActiveCompanyContext()
  const supabase = await createSupabaseServerClient()
  if (!active || !(await hasPlatformAdminAccess(supabase))) throw new Error('OFFICE_FORBIDDEN')
  return { active, supabase }
}
async function update(form: FormData) {
  'use server'
  const { active, supabase } = await requireOfficeAdmin()
  if (form.get('companyId') !== active.companyId) throw new Error('OFFICE_TENANT_CHANGED')
  const { error } = await supabase.rpc('office_set_enabled', { p_company_id: active.companyId, p_enabled: form.get('enabled') === 'on' })
  if (error) throw new Error('OFFICE_SETTINGS_FAILED')
  revalidatePath('/office/settings')
}
export default async function OfficeSettings() {
  const { active, supabase } = await requireOfficeAdmin()
  const { data, error } = await supabase.from('office_settings').select('enabled').eq('company_id', active.companyId).maybeSingle()
  return (
    <main style={{ maxWidth: 700, margin: '60px auto', padding: 24 }}>
      {/* Clear the host's client-side menu cache after toggling the company flag. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/">← Diriqo</a>
      <h1>Diriqo Office</h1>
      <p>Aktivní firma: {active.companyName}</p>
      {error ? <p role="alert">Nejprve aplikujte připravenou Office migraci a Diriqo adaptér.</p> : (
        <form action={update}>
          <input type="hidden" name="companyId" value={active.companyId} />
          <label><input type="checkbox" name="enabled" defaultChecked={data?.enabled === true} /> Povolit Diriqo Office pro tuto firmu</label>
          <p><button type="submit">Uložit nastavení</button></p>
        </form>
      )}
      <p>Přepínač zachovává kontrolu oprávnění k modulům Diriqo. Po změně obnovte pracovní plochu. Vypnutí modulu ponechá uložená data.</p>
      {data?.enabled ? (
        // Enter Office with a fresh document, isolated from the host's loaded styles.
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a href="/office">Otevřít Diriqo Office →</a>
      ) : null}
    </main>
  )
}
