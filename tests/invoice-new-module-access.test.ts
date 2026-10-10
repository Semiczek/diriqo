import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  company: vi.fn(), client: vi.fn(), paid: vi.fn(), from: vi.fn(), rpc: vi.fn(),
  createForm: vi.fn(), overviewForm: vi.fn(), redirect: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/require-hub-access', () => ({ requireHubAccess: mocks.company }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.client }))
vi.mock('@/lib/platform/module-operation-access', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/platform/module-operation-access')>(),
  requirePaidCompanyCapability: mocks.paid,
}))
vi.mock('@/components/DashboardShell', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children),
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('../app/invoices/new/InvoiceCreateForm', () => ({
  default: mocks.createForm,
  InvoiceCreateItemTotal: () => null,
}))
vi.mock('../app/invoices/new/InvoiceOverviewFilterForm', () => ({ default: mocks.overviewForm }))

import NewInvoicePage from '../app/invoices/new/page'
import { ModuleAccessError } from '../lib/platform/module-operation-access'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const customerId = 'b1111111-1111-4111-8111-111111111111'
const supabase = { from: mocks.from, rpc: mocks.rpc }
const pageProps = () => ({ searchParams: Promise.resolve({ customerId, month: '2026-10' }) })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.company.mockResolvedValue({ companyId, profileId: 'verified-profile', role: 'company_admin' })
  mocks.client.mockResolvedValue(supabase)
  mocks.paid.mockResolvedValue(undefined)
  mocks.from.mockImplementation(() => { throw new Error('Unexpected business database access') })
  mocks.rpc.mockImplementation(() => { throw new Error('Unexpected business RPC') })
  mocks.createForm.mockImplementation(() => createElement('form', { 'data-testid': 'invoice-create' }))
  mocks.overviewForm.mockImplementation(() => createElement('form', { 'data-testid': 'invoice-overview' }))
})

// Invoke the actual async page, then render its resolved error tree with mocked shell/children.
// This checks the server entry-point boundary; it is not an authenticated Next.js E2E test.
describe('new invoice server page module access', () => {
  it.each([
    { status: 403, message: 'Pro tuto operaci potřebujete aktivní placený modul a jeho požadovaný základ.' },
    { status: 503, message: 'Placené oprávnění se nyní nepodařilo ověřit. Zkuste akci znovu později.' },
  ] as const)('renders a recoverable $status error without loading business data', async ({ status, message }) => {
    mocks.paid.mockRejectedValue(new ModuleAccessError(message, status))

    const html = renderToStaticMarkup(await NewInvoicePage(pageProps()))

    expect(mocks.paid).toHaveBeenCalledExactlyOnceWith({ companyId, supabase }, 'invoicing.invoice.issue')
    expect(html).toContain('Nová faktura')
    expect(html).toContain('role="alert"')
    expect(html).toContain(message)
    expect(html).toContain('href="/billing/modules"')
    expect(html).toContain('Přehled placených modulů')
    expect(html).toContain('href="/invoices"')
    expect(html).toContain('Zpět na faktury')
    expect(html).not.toContain('<form')
    expect(mocks.createForm).not.toHaveBeenCalled()
    expect(mocks.overviewForm).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('preserves the safe membership error for a stale company session', async () => {
    const message = 'Oprávnění k aktivní firmě se změnilo. Obnovte přihlášení a výběr firmy.'
    mocks.paid.mockRejectedValue(new ModuleAccessError(message, 403))

    const html = renderToStaticMarkup(await NewInvoicePage(pageProps()))

    expect(html).toContain(message)
    expect(html).not.toContain('Pro tuto operaci potřebujete aktivní placený modul')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('preserves the auth redirect before initializing the business client or checking the license', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' })
    mocks.company.mockRejectedValue(redirect)

    await expect(NewInvoicePage(pageProps())).rejects.toBe(redirect)

    expect(mocks.client).not.toHaveBeenCalled()
    expect(mocks.paid).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not turn an unexpected server failure into a module purchase prompt', async () => {
    const failure = new Error('Unexpected server failure')
    mocks.paid.mockRejectedValue(failure)

    await expect(NewInvoicePage(pageProps())).rejects.toBe(failure)

    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('awaits active-company permission before the first business query on the allowed path', async () => {
    let grantAccess!: () => void
    const permission = new Promise<void>((resolve) => { grantAccess = resolve })
    mocks.paid.mockReturnValue(permission)
    const firstQuery = new Error('Allowed path reached the first business query')
    mocks.from.mockImplementation(() => { throw firstQuery })

    const page = NewInvoicePage(pageProps())
    await vi.waitFor(() => {
      expect(mocks.paid).toHaveBeenCalledExactlyOnceWith({ companyId, supabase }, 'invoicing.invoice.issue')
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()

    grantAccess()
    await expect(page).rejects.toBe(firstQuery)

    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('customers')
    expect(mocks.company.mock.invocationCallOrder[0]).toBeLessThan(mocks.paid.mock.invocationCallOrder[0])
    expect(mocks.paid.mock.invocationCallOrder[0]).toBeLessThan(mocks.from.mock.invocationCallOrder[0])
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
