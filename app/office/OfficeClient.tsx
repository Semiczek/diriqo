'use client'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import { officeAction, officeTemplateVariables } from './actions'
import type { OfficeLocale, OfficeTransport } from '@diriqo/office/core'
import { createOfficeContextGuard, fetchOfficeContext, notifyOfficeContextChanged, OFFICE_CONTEXT_EVENT, OFFICE_CONTEXT_STORAGE_KEY, sameOfficeContext, switchOfficeCompany, type OfficeCompanyOption, type OfficeContextState } from '@/lib/office/client-context'
import { officeContextMessages, officeShellMessages } from '@/lib/office/context-messages'
import { assertOfficeHostPayload, assertOfficeHostUpload } from '@/lib/office/http-limits'
import '@diriqo/office/styles.css'
import { officeUploadUserMessage } from '@/lib/office/upload-messages'

const OfficeWorkspace = dynamic(() => import('@diriqo/office/client').then(m => m.OfficeWorkspace), {
  ssr: false,
  loading: () => <p>Diriqo Office…</p>,
})

async function fileResponse<T>(response: Response, locale: OfficeLocale = 'cs'): Promise<T> {
  const limitError = () => Object.assign(new Error('OFFICE_HOST_LIMIT'), { userMessage: officeUploadUserMessage('OFFICE_HOST_LIMIT', locale) })
  // Platform-level size failures may be HTML instead of our JSON response.
  if (response.status === 413 && !response.headers.get('content-type')?.includes('json')) {
    throw limitError()
  }
  // The host proxy redirects expired sessions to an HTML sign-in page.
  if (response.redirected || response.status === 401) throw new Error('OFFICE_UNAUTHENTICATED')
  if (!/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('OFFICE_INVALID_RESPONSE')
  }
  const body: unknown = await response.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    if (response.status === 413) throw limitError()
    throw new Error('OFFICE_INVALID_RESPONSE')
  }
  if (!response.ok) {
    const message = 'error' in body && typeof body.error === 'string' ? body.error : ''
    if (response.status === 413 && message !== 'OFFICE_IMPORT_LIMIT' && message !== 'OFFICE_HOST_LIMIT') throw limitError()
    const code = message.match(/^OFFICE_[A-Z_]+$/)?.[0] ?? 'OFFICE_REQUEST_FAILED'
    throw Object.assign(new Error(code), { userMessage: officeUploadUserMessage(code, locale) })
  }
  return body as T
}

export default function OfficeClient({ readOnly, tenantId, actorId, companyName, companies, locale = 'cs' }: {
  readOnly: boolean
  tenantId: string
  actorId: string
  companyName?: string | null
  companies?: OfficeCompanyOption[]
  locale?: OfficeLocale
}) {
  // A refreshed server tree must not remount the editor and discard its draft.
  // Only an explicit new tab/navigation opens a different company.
  const [pinned] = useState(() => ({
    tenantId, actorId, readOnly, companyName: companyName || tenantId,
    companies: companies?.length ? companies : [{ companyId: tenantId, companyName: companyName || tenantId }],
  }))
  const [contextState, setContextState] = useState<OfficeContextState>('ready')
  const [guard] = useState(() => createOfficeContextGuard(pinned, setContextState))
  const [selectedCompanyId, setSelectedCompanyId] = useState(tenantId)
  const [switching, setSwitching] = useState(false)
  const [switchFailed, setSwitchFailed] = useState(false)

  async function changeCompany() {
    if (switching) return
    setSwitching(true)
    setSwitchFailed(false)
    guard.pause()
    try {
      await switchOfficeCompany(selectedCompanyId, pinned.companies)
    } catch {
      setSwitchFailed(true)
      // A lost response may still have set the cookie. Invalidate other open tabs too.
      notifyOfficeContextChanged()
    } finally {
      setSwitching(false)
      void guard.check(fetchOfficeContext)
    }
  }

  useEffect(() => {
    if (!sameOfficeContext(pinned, { tenantId, actorId, readOnly })) {
      guard.pause('changed')
      void guard.check(fetchOfficeContext)
    }
  }, [pinned, tenantId, actorId, readOnly, guard])

  useEffect(() => {
    // Native file dialogs trigger focus; preserve pending replies when the company is unchanged.
    const verify = () => { void guard.check(fetchOfficeContext) }
    const invalidate = () => { void guard.check(fetchOfficeContext, true) }
    const visible = () => { if (document.visibilityState === 'visible') verify() }
    const storage = (event: StorageEvent) => {
      if (event.key === OFFICE_CONTEXT_STORAGE_KEY || event.key === null) invalidate()
    }
    const offline = () => guard.pause('unavailable')
    window.addEventListener(OFFICE_CONTEXT_EVENT, invalidate)
    window.addEventListener('storage', storage)
    window.addEventListener('focus', verify)
    window.addEventListener('pageshow', verify)
    window.addEventListener('online', verify)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', visible)
    // Also catch form-based switches, disabled storage and revoked memberships.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void guard.check(fetchOfficeContext)
    }, 30000)
    void guard.check(fetchOfficeContext)
    return () => {
      guard.cancelPending()
      window.clearInterval(timer)
      window.removeEventListener(OFFICE_CONTEXT_EVENT, invalidate)
      window.removeEventListener('storage', storage)
      window.removeEventListener('focus', verify)
      window.removeEventListener('pageshow', verify)
      window.removeEventListener('online', verify)
      window.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [guard])

  const transport = useMemo<OfficeTransport>(() => {
    async function perform<T>(operation: () => Promise<T>) {
      try {
        const ticket = guard.beginOperation()
        const result = await operation()
        guard.assertOperationCurrent(ticket)
        return result
      } catch (error) {
        if (guard.observeFailure(error)) void guard.check(fetchOfficeContext)
        if (error instanceof Error && /^OFFICE_(?:TENANT_CHANGED|CONTEXT_UNAVAILABLE)$/.test(error.message)) {
          const messages = officeContextMessages[locale] ?? officeContextMessages.cs
          Object.assign(error, { userMessage: error.message === 'OFFICE_TENANT_CHANGED' ? messages.changed : messages.unavailable })
        }
        throw error
      }
    }
    return {
      request: request => perform(async () => {
        assertOfficeHostPayload(request)
        const result = await officeAction(pinned.tenantId, request)
        if (!result.ok) throw new Error(result.error)
        return result.result
      }),
      templateVariables: link => perform(() => officeTemplateVariables(pinned.tenantId, link)),
      importFile: data => perform(async () => {
        assertOfficeHostUpload(data.get('file'))
        const response = await fetch('/api/office/files', {
          method: 'POST', headers: { 'X-Office-Tenant': pinned.tenantId }, body: data,
        })
        return fileResponse<Awaited<ReturnType<OfficeTransport['importFile']>>>(response, locale)
      }),
      exportFile: (id, format) => perform(async () => {
        const response = await fetch('/api/office/files?id=' + encodeURIComponent(id) + '&format=' + encodeURIComponent(format), {
          headers: { 'X-Office-Tenant': pinned.tenantId },
        })
        return fileResponse<Awaited<ReturnType<OfficeTransport['exportFile']>>>(response, locale)
      }),
    }
  }, [guard, pinned, locale])
  const messages = officeContextMessages[locale] ?? officeContextMessages.cs
  const shell = officeShellMessages[locale] ?? officeShellMessages.cs
  return <>
    <section aria-label={shell.company} style={{ padding: '12px 24px', borderBottom: '1px solid #d8dfeb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <strong>{shell.company}: {pinned.companyName}</strong>
        {pinned.companies.length > 1 && <>
          <select aria-label={shell.switchCompany} value={selectedCompanyId} disabled={switching}
            onChange={event => setSelectedCompanyId(event.target.value)}>
            {pinned.companies.map(company => <option key={company.companyId} value={company.companyId}>{company.companyName || company.companyId}</option>)}
          </select>
          <button type="button" disabled={switching} onClick={() => { void changeCompany() }}>{shell.switchCompany}</button>
        </>}
        <a href="/logout" target="_blank" rel="noopener noreferrer" title={shell.logoutHint}>{shell.logout}</a>
      </div>
      {pinned.companies.length > 1 && <p style={{ margin: '8px 0 0', fontSize: 13 }}>{shell.switchHint}</p>}
      {switchFailed && <p role="alert">{shell.switchFailed}</p>}
    </section>
    {contextState !== 'ready' && <aside role="status" aria-live="polite" data-office-context={contextState}
      style={{ padding: '16px 24px', background: '#fff7db', color: '#513b00', borderBottom: '1px solid #ddc87c' }}>
      <p style={{ margin: '0 0 8px' }}>{messages[contextState]}</p>
      {contextState !== 'checking' && <>
        <p style={{ margin: '0 0 12px', maxWidth: 1000 }}>{messages.recovery}</p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => { void guard.check(fetchOfficeContext, true) }}>{messages.verify}</button>
          {/* Keep this panel and its draft open; never auto-refresh on a company switch. */}
          <a href="/office" target="_blank" rel="noopener noreferrer">{messages.open}</a>
        </div>
      </>}
    </aside>}
    <OfficeWorkspace key={pinned.tenantId} transport={transport} readOnly={pinned.readOnly} locale={locale} />
  </>
}
