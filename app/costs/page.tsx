import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { CSSProperties, ReactNode } from 'react'

import DashboardShell from '@/components/DashboardShell'
import {
  fixedCostCategories,
  formatCostCurrency,
  getFixedCostMonthlyAmount,
  getRecurrenceLabel,
  isOneTimeExpense,
  jobExpenseCategories,
  normalizeCurrency,
  oneTimeExpenseCategories,
  recurrenceOptions,
  toCostNumber,
  type ExpenseRow,
  type FixedCostRow,
} from '@/lib/costs'
import { listJobEconomicsSummaries } from '@/lib/dal/economics'
import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

import {
  createExpense,
  createFixedCost,
  deleteExpense,
  deleteFixedCost,
  updateExpense,
  updateFixedCost,
} from './actions'

type PageProps = {
  searchParams: Promise<{
    month?: string
    tab?: string
    notice?: string
    error?: string
  }>
}

type CostTab = 'overview' | 'fixed' | 'job' | 'one_time'

type JobOption = {
  id: string
  title: string | null
  start_at: string | null
  created_at: string | null
}

type ExpenseWithJob = ExpenseRow & {
  jobs?:
    | {
        id: string | null
        title: string | null
      }
    | {
        id: string | null
        title: string | null
      }[]
    | null
}

const tabs: Array<{ key: CostTab; label: string }> = [
  { key: 'overview', label: 'Přehled' },
  { key: 'fixed', label: 'Fixní náklady' },
  { key: 'job', label: 'Náklady zakázek' },
  { key: 'one_time', label: 'Jednorázové' },
]

function getCurrentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function normalizeMonthValue(value: string | undefined) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : getCurrentMonthValue()
}

function normalizeTab(value: string | undefined): CostTab {
  return tabs.some((tab) => tab.key === value) ? (value as CostTab) : 'overview'
}

function getMonthRange(monthValue: string) {
  const [yearText, monthText] = monthValue.split('-')
  const year = Number.parseInt(yearText, 10)
  const monthIndex = Number.parseInt(monthText, 10) - 1
  const start = new Date(Date.UTC(year, monthIndex, 1))
  const end = new Date(Date.UTC(year, monthIndex + 1, 1))

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function buildCostsHref(month: string, tab: CostTab) {
  const params = new URLSearchParams()
  params.set('month', month)
  if (tab !== 'overview') params.set('tab', tab)
  const query = params.toString()
  return query ? `/costs?${query}` : '/costs'
}

function relationToSingle<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('cs-CZ')
}

function getJobTitle(jobId: string | null, jobs: JobOption[]) {
  if (!jobId) return 'Bez zakázky'
  return jobs.find((job) => job.id === jobId)?.title || 'Zakázka bez názvu'
}

function MessageBox({ tone, children }: { tone: 'success' | 'danger' | 'info'; children: ReactNode }) {
  const palette = {
    success: ['#ecfdf5', '#166534', '#bbf7d0'],
    danger: ['#fef2f2', '#991b1b', '#fecaca'],
    info: ['#eff6ff', '#1e3a8a', '#bfdbfe'],
  }[tone]

  return (
    <div
      style={{
        border: `1px solid ${palette[2]}`,
        background: palette[0],
        color: palette[1],
        borderRadius: 14,
        padding: '13px 15px',
        fontWeight: 750,
      }}
    >
      {children}
    </div>
  )
}

function KpiCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail?: string
  tone?: 'neutral' | 'green' | 'blue' | 'orange'
}) {
  const tones = {
    neutral: ['#ffffff', '#0f172a', '#64748b'],
    green: ['#f0fdf4', '#166534', '#4b5563'],
    blue: ['#eff6ff', '#1d4ed8', '#475569'],
    orange: ['#fff7ed', '#c2410c', '#64748b'],
  }[tone]

  return (
    <div style={{ ...cardStyle, background: tones[0] }}>
      <div style={{ color: '#64748b', fontSize: 13, fontWeight: 800 }}>{label}</div>
      <div style={{ color: tones[1], fontSize: 27, lineHeight: 1.1, fontWeight: 900 }}>{value}</div>
      {detail ? <div style={{ color: tones[2], fontSize: 12, fontWeight: 700 }}>{detail}</div> : null}
    </div>
  )
}

function HiddenContext({ month, tab }: { month: string; tab: CostTab }) {
  return (
    <>
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="tab" value={tab} />
    </>
  )
}

function CategorySelect({
  name = 'category',
  categories,
  defaultValue,
}: {
  name?: string
  categories: readonly string[]
  defaultValue?: string | null
}) {
  const value = defaultValue ?? categories[0] ?? 'Ostatní'
  const hasValue = categories.includes(value)

  return (
    <select name={name} defaultValue={value} style={inputStyle}>
      {!hasValue ? <option value={value}>{value}</option> : null}
      {categories.map((category) => (
        <option key={category} value={category}>
          {category}
        </option>
      ))}
    </select>
  )
}

function JobSelect({
  jobs,
  defaultValue,
}: {
  jobs: JobOption[]
  defaultValue?: string | null
}) {
  return (
    <select name="job_id" defaultValue={defaultValue ?? ''} style={inputStyle}>
      <option value="">Bez zakázky</option>
      {jobs.map((job) => (
        <option key={job.id} value={job.id}>
          {job.title || 'Zakázka bez názvu'}
        </option>
      ))}
    </select>
  )
}

function FixedCostCreateForm({
  month,
  currency,
}: {
  month: string
  currency: string
}) {
  return (
    <section id="fixed-form" style={panelStyle}>
      <div>
        <h2 style={sectionTitleStyle}>Přidat fixní náklad</h2>
        <p style={mutedTextStyle}>Například nájem, energie, leasing nebo software.</p>
      </div>
      <form action={createFixedCost} style={formGridStyle}>
        <HiddenContext month={month} tab="fixed" />
        <label style={fieldStyle}>
          <span>Název</span>
          <input name="name" required placeholder="Nájem kanceláře" style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          <span>Kategorie</span>
          <CategorySelect categories={fixedCostCategories} />
        </label>
        <label style={fieldStyle}>
          <span>Částka</span>
          <input name="amount" required type="number" min="0" step="0.01" style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          <span>Měna</span>
          <input name="currency" defaultValue={currency} required style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          <span>Den splatnosti v měsíci</span>
          <input name="due_day" type="number" min="1" max="31" placeholder="15" style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          <span>Opakování</span>
          <select name="recurrence" defaultValue="monthly" style={inputStyle}>
            {recurrenceOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          <span>Začátek</span>
          <input name="start_date" type="date" defaultValue={`${month}-01`} style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          <span>Konec</span>
          <input name="end_date" type="date" style={inputStyle} />
        </label>
        <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
          <span>Poznámka</span>
          <textarea name="note" rows={3} style={textareaStyle} />
        </label>
        <label style={checkboxStyle}>
          <input name="is_active" type="checkbox" defaultChecked />
          Aktivní
        </label>
        <button type="submit" style={primaryButtonStyle}>
          Uložit fixní náklad
        </button>
      </form>
    </section>
  )
}

function ExpenseCreateForm({
  month,
  currency,
  jobs,
  mode,
}: {
  month: string
  currency: string
  jobs: JobOption[]
  mode: 'job' | 'one_time'
}) {
  const isJobMode = mode === 'job'

  return (
    <section id="expense-form" style={panelStyle}>
      <div>
        <h2 style={sectionTitleStyle}>{isJobMode ? 'Přidat náklad zakázky' : 'Přidat jednorázový náklad'}</h2>
        <p style={mutedTextStyle}>
          {isJobMode
            ? 'Materiál, doprava, externista nebo jiný ruční provozní náklad.'
            : 'Výdaj mimo běžný měsíční režim, například servis nebo vybavení.'}
        </p>
      </div>
      <form action={createExpense} style={formGridStyle}>
        <HiddenContext month={month} tab={mode} />
        <input type="hidden" name="source" value="manual" />
        {isJobMode ? (
          <label style={fieldStyle}>
            <span>Zakázka</span>
            <JobSelect jobs={jobs} />
          </label>
        ) : null}
        <label style={fieldStyle}>
          <span>Název</span>
          <input name="name" required placeholder={isJobMode ? 'Materiál na zakázku' : 'Servis auta'} style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          <span>Kategorie</span>
          <CategorySelect categories={isJobMode ? jobExpenseCategories : oneTimeExpenseCategories} />
        </label>
        <label style={fieldStyle}>
          <span>Částka</span>
          <input name="amount" required type="number" min="0" step="0.01" style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          <span>Měna</span>
          <input name="currency" defaultValue={currency} required style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          <span>Datum</span>
          <input name="expense_date" type="date" defaultValue={`${month}-01`} style={inputStyle} />
        </label>
        <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
          <span>Poznámka</span>
          <textarea name="note" rows={3} style={textareaStyle} />
        </label>
        <button type="submit" style={primaryButtonStyle}>
          Přidat náklad
        </button>
      </form>
    </section>
  )
}

function FixedCostsTable({
  costs,
  month,
  currency,
}: {
  costs: FixedCostRow[]
  month: string
  currency: string
}) {
  return (
    <section style={panelStyle}>
      <div>
        <h2 style={sectionTitleStyle}>Fixní náklady</h2>
        <p style={mutedTextStyle}>Přidej první fixní náklad, například nájem, energie nebo leasing.</p>
      </div>
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th>Název</th>
              <th>Kategorie</th>
              <th>Částka</th>
              <th>Splatnost</th>
              <th>Opakování</th>
              <th>Stav</th>
              <th>Akce</th>
            </tr>
          </thead>
          <tbody>
            {costs.length === 0 ? (
              <tr>
                <td colSpan={7} style={emptyCellStyle}>
                  Zatím zde nejsou žádné náklady.
                </td>
              </tr>
            ) : (
              costs.map((cost) => (
                <tr key={cost.id}>
                  <td>
                    <strong>{cost.name}</strong>
                    {cost.note ? <div style={noteStyle}>{cost.note}</div> : null}
                  </td>
                  <td>{cost.category}</td>
                  <td>{formatCostCurrency(toCostNumber(cost.amount), cost.currency ?? currency)}</td>
                  <td>{cost.due_day ? `${cost.due_day}. den` : '—'}</td>
                  <td>{getRecurrenceLabel(cost.recurrence)}</td>
                  <td>
                    <span style={cost.is_active === false ? inactiveBadgeStyle : activeBadgeStyle}>
                      {cost.is_active === false ? 'Neaktivní' : 'Aktivní'}
                    </span>
                  </td>
                  <td>
                    <details>
                      <summary style={summaryStyle}>Upravit</summary>
                      <form action={updateFixedCost} style={inlineFormStyle}>
                        <HiddenContext month={month} tab="fixed" />
                        <input type="hidden" name="id" value={cost.id} />
                        <input name="name" defaultValue={cost.name} required style={inputStyle} />
                        <CategorySelect categories={fixedCostCategories} defaultValue={cost.category} />
                        <input name="amount" defaultValue={String(cost.amount)} required type="number" min="0" step="0.01" style={inputStyle} />
                        <input name="currency" defaultValue={normalizeCurrency(cost.currency, currency)} required style={inputStyle} />
                        <input name="due_day" defaultValue={cost.due_day ?? ''} type="number" min="1" max="31" style={inputStyle} />
                        <select name="recurrence" defaultValue={cost.recurrence ?? 'monthly'} style={inputStyle}>
                          {recurrenceOptions.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <input name="start_date" type="date" defaultValue={cost.start_date ?? `${month}-01`} style={inputStyle} />
                        <input name="end_date" type="date" defaultValue={cost.end_date ?? ''} style={inputStyle} />
                        <textarea name="note" defaultValue={cost.note ?? ''} rows={2} style={textareaStyle} />
                        <label style={checkboxStyle}>
                          <input name="is_active" type="checkbox" defaultChecked={cost.is_active !== false} />
                          Aktivní
                        </label>
                        <button type="submit" style={smallPrimaryButtonStyle}>Uložit</button>
                      </form>
                      <form action={deleteFixedCost} style={{ marginTop: 8 }}>
                        <HiddenContext month={month} tab="fixed" />
                        <input type="hidden" name="id" value={cost.id} />
                        <button type="submit" style={dangerButtonStyle}>Smazat</button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ExpensesTable({
  title,
  description,
  expenses,
  month,
  currency,
  jobs,
  tab,
}: {
  title: string
  description: string
  expenses: ExpenseWithJob[]
  month: string
  currency: string
  jobs: JobOption[]
  tab: CostTab
}) {
  const categoryOptions = tab === 'one_time' ? oneTimeExpenseCategories : jobExpenseCategories

  return (
    <section style={panelStyle}>
      <div>
        <h2 style={sectionTitleStyle}>{title}</h2>
        <p style={mutedTextStyle}>{description}</p>
      </div>
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th>Datum</th>
              <th>Zakázka</th>
              <th>Název</th>
              <th>Kategorie</th>
              <th>Částka</th>
              <th>Zdroj</th>
              <th>Poznámka</th>
              <th>Akce</th>
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 ? (
              <tr>
                <td colSpan={8} style={emptyCellStyle}>
                  Zatím zde nejsou žádné náklady.
                </td>
              </tr>
            ) : (
              expenses.map((expense) => {
                const job = relationToSingle(expense.jobs)
                const jobTitle = job?.title ?? getJobTitle(expense.job_id, jobs)

                return (
                  <tr key={expense.id}>
                    <td>{formatDate(expense.expense_date)}</td>
                    <td>{expense.job_id ? jobTitle : 'Bez zakázky'}</td>
                    <td><strong>{expense.name}</strong></td>
                    <td>{expense.category}</td>
                    <td>{formatCostCurrency(toCostNumber(expense.amount), expense.currency ?? currency)}</td>
                    <td>{expense.source ?? 'manual'}</td>
                    <td>{expense.note || '—'}</td>
                    <td>
                      <details>
                        <summary style={summaryStyle}>Upravit</summary>
                        <form action={updateExpense} style={inlineFormStyle}>
                          <HiddenContext month={month} tab={tab} />
                          <input type="hidden" name="id" value={expense.id} />
                          <input type="hidden" name="source" value={expense.source ?? 'manual'} />
                          <JobSelect jobs={jobs} defaultValue={expense.job_id} />
                          <input name="name" defaultValue={expense.name} required style={inputStyle} />
                          <CategorySelect categories={categoryOptions} defaultValue={expense.category} />
                          <input name="amount" defaultValue={String(expense.amount)} required type="number" min="0" step="0.01" style={inputStyle} />
                          <input name="currency" defaultValue={normalizeCurrency(expense.currency, currency)} required style={inputStyle} />
                          <input name="expense_date" type="date" defaultValue={expense.expense_date ?? `${month}-01`} style={inputStyle} />
                          <textarea name="note" defaultValue={expense.note ?? ''} rows={2} style={textareaStyle} />
                          <button type="submit" style={smallPrimaryButtonStyle}>Uložit</button>
                        </form>
                        <form action={deleteExpense} style={{ marginTop: 8 }}>
                          <HiddenContext month={month} tab={tab} />
                          <input type="hidden" name="id" value={expense.id} />
                          <button type="submit" style={dangerButtonStyle}>Smazat</button>
                        </form>
                      </details>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default async function CostsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const selectedMonth = normalizeMonthValue(params.month)
  const activeTab = normalizeTab(params.tab)
  const monthRange = getMonthRange(selectedMonth)
  const access = await requireCompanyRole('company_admin', 'super_admin')

  if (!access.ok) {
    redirect('/sign-in?error=no-hub-access')
  }

  const supabase = await createSupabaseServerClient()
  const companyId = access.value.companyId
  const loadErrors: string[] = []

  const [companyResponse, fixedCostsResponse, expensesResponse, jobsResponse, monthJobsResponse] = await Promise.all([
    supabase.from('companies').select('currency').eq('id', companyId).maybeSingle(),
    supabase
      .from('fixed_costs')
      .select('id, company_id, name, category, amount, currency, due_day, recurrence, start_date, end_date, is_active, note, created_at, updated_at')
      .eq('company_id', companyId)
      .order('is_active', { ascending: false })
      .order('category', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('expenses')
      .select('id, company_id, job_id, worker_id, name, category, amount, currency, expense_date, source, note, created_at, updated_at, jobs(id, title)')
      .eq('company_id', companyId)
      .gte('expense_date', monthRange.start)
      .lt('expense_date', monthRange.end)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('jobs')
      .select('id, title, start_at, created_at')
      .eq('company_id', companyId)
      .order('start_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('jobs')
      .select('id')
      .eq('company_id', companyId)
      .gte('start_at', monthRange.start)
      .lt('start_at', monthRange.end)
      .limit(500),
  ])

  if (companyResponse.error) loadErrors.push(companyResponse.error.message)
  if (fixedCostsResponse.error) loadErrors.push(fixedCostsResponse.error.message)
  if (expensesResponse.error) loadErrors.push(expensesResponse.error.message)
  if (jobsResponse.error) loadErrors.push(jobsResponse.error.message)
  if (monthJobsResponse.error) loadErrors.push(monthJobsResponse.error.message)

  const defaultCurrency = normalizeCurrency(
    (companyResponse.data as { currency?: string | null } | null)?.currency,
    'CZK',
  )
  const fixedCosts = (fixedCostsResponse.data ?? []) as FixedCostRow[]
  const expenses = (expensesResponse.data ?? []) as ExpenseWithJob[]
  const jobs = (jobsResponse.data ?? []) as JobOption[]
  const monthJobIds = ((monthJobsResponse.data ?? []) as Array<{ id: string | null }>).map((job) => job.id).filter((id): id is string => Boolean(id))

  let monthlyJobProfit: number | null = null

  try {
    const economics = await listJobEconomicsSummaries(
      {
        supabase,
        companyId,
      },
      monthJobIds,
    )
    monthlyJobProfit = economics.reduce((sum, item) => sum + toCostNumber(item.profit_total), 0)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nepodařilo se načíst ekonomiku zakázek.'
    loadErrors.push(message)
  }

  const fixedCostsTotal = fixedCosts.reduce(
    (sum, cost) => sum + getFixedCostMonthlyAmount(cost, monthRange.start, monthRange.end),
    0,
  )
  const expensesTotal = expenses.reduce((sum, expense) => sum + toCostNumber(expense.amount), 0)
  const jobExpenses = expenses.filter((expense) => Boolean(expense.job_id))
  const oneTimeExpenses = expenses.filter(isOneTimeExpense)
  const jobExpensesTotal = jobExpenses.reduce((sum, expense) => sum + toCostNumber(expense.amount), 0)
  const oneTimeExpensesTotal = oneTimeExpenses.reduce((sum, expense) => sum + toCostNumber(expense.amount), 0)
  const costsTotal = fixedCostsTotal + expensesTotal
  const operationalResult = monthlyJobProfit == null ? null : monthlyJobProfit - fixedCostsTotal - expensesTotal
  const visibleExpenses =
    activeTab === 'job'
      ? jobExpenses
      : activeTab === 'one_time'
        ? oneTimeExpenses
        : expenses

  return (
    <DashboardShell activeItem="costs">
      <main style={pageStyle}>
        <header style={heroStyle}>
          <div>
            <div style={eyebrowStyle}>Finance</div>
            <h1 style={titleStyle}>Náklady</h1>
            <p style={subtitleStyle}>
              Jednoduchý přehled toho, co firma platí. Ne účetnictví, ale praktický provozní pohled.
            </p>
          </div>
          <div style={heroActionsStyle}>
            <a href="#expense-form" data-tour="add-expense-button" style={secondaryButtonStyle}>Přidat náklad</a>
            <a href="#fixed-form" data-tour="add-fixed-cost-button" style={primaryLinkButtonStyle}>Přidat fixní náklad</a>
          </div>
        </header>

        {params.notice ? <MessageBox tone="success">{params.notice}</MessageBox> : null}
        {params.error ? <MessageBox tone="danger">{params.error}</MessageBox> : null}
        {loadErrors.length > 0 ? (
          <MessageBox tone="danger">Některá data se nepodařilo načíst: {loadErrors.join(' · ')}</MessageBox>
        ) : null}

        <form method="get" style={filterStyle}>
          <input type="hidden" name="tab" value={activeTab} />
          <label style={fieldStyle}>
            <span>Měsíc</span>
            <input name="month" data-tour="costs-month-filter" type="month" defaultValue={selectedMonth} style={inputStyle} />
          </label>
          <button type="submit" style={smallPrimaryButtonStyle}>Zobrazit</button>
        </form>

        <section style={kpiGridStyle}>
          <KpiCard label="Fixní náklady" value={formatCostCurrency(fixedCostsTotal, defaultCurrency)} detail="monthly + one_time podle měsíce" tone="blue" />
          <KpiCard label="Náklady zakázek" value={formatCostCurrency(jobExpensesTotal, defaultCurrency)} detail="ruční náklady navázané na zakázku" tone="orange" />
          <KpiCard label="Jednorázové náklady" value={formatCostCurrency(oneTimeExpensesTotal, defaultCurrency)} detail="mimo běžný měsíční režim" />
          <KpiCard label="Celkem tento měsíc" value={formatCostCurrency(costsTotal, defaultCurrency)} detail="fixní + ruční náklady" />
          <KpiCard
            label="Orientační výsledek"
            value={operationalResult == null ? '—' : formatCostCurrency(operationalResult, defaultCurrency)}
            detail={monthlyJobProfit == null ? 'ekonomika zakázek není dostupná' : 'provozní pohled, ne účetní výsledek'}
            tone={operationalResult != null && operationalResult >= 0 ? 'green' : 'orange'}
          />
        </section>

        <MessageBox tone="info">
          Tento přehled slouží pro orientační řízení firmy. Nenahrazuje účetnictví.
        </MessageBox>

        <nav style={tabsStyle} aria-label="Sekce nákladů">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={buildCostsHref(selectedMonth, tab.key)}
              style={tab.key === activeTab ? activeTabStyle : tabStyle}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {activeTab === 'fixed' ? (
          <>
            <FixedCostCreateForm month={selectedMonth} currency={defaultCurrency} />
            <FixedCostsTable costs={fixedCosts} month={selectedMonth} currency={defaultCurrency} />
          </>
        ) : null}

        {activeTab === 'job' ? (
          <>
            <ExpenseCreateForm month={selectedMonth} currency={defaultCurrency} jobs={jobs} mode="job" />
            <ExpensesTable
              title="Náklady zakázek"
              description="Přidej náklad k zakázce, například materiál, dopravu nebo externistu."
              expenses={visibleExpenses}
              month={selectedMonth}
              currency={defaultCurrency}
              jobs={jobs}
              tab="job"
            />
          </>
        ) : null}

        {activeTab === 'one_time' ? (
          <>
            <ExpenseCreateForm month={selectedMonth} currency={defaultCurrency} jobs={jobs} mode="one_time" />
            <ExpensesTable
              title="Jednorázové náklady"
              description="Výdaje mimo běžný měsíční režim."
              expenses={visibleExpenses}
              month={selectedMonth}
              currency={defaultCurrency}
              jobs={jobs}
              tab="one_time"
            />
          </>
        ) : null}

        {activeTab === 'overview' ? (
          <>
            <ExpensesTable
              title="Přehled ručních nákladů"
              description="Ruční provozní náklady za vybraný měsíc."
              expenses={visibleExpenses}
              month={selectedMonth}
              currency={defaultCurrency}
              jobs={jobs}
              tab="overview"
            />
            <FixedCostsTable costs={fixedCosts} month={selectedMonth} currency={defaultCurrency} />
          </>
        ) : null}
      </main>
    </DashboardShell>
  )
}

const pageStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  color: '#111827',
  paddingBottom: 48,
}

const heroStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 14,
  alignItems: 'start',
  borderRadius: 20,
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background:
    'radial-gradient(circle at 8% 8%, rgba(124, 58, 237, 0.14), transparent 28%), radial-gradient(circle at 100% 0%, rgba(6, 182, 212, 0.14), transparent 28%), linear-gradient(135deg, rgba(255,255,255,0.96), rgba(248,250,252,0.95))',
  padding: '18px 20px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.065)',
}

const eyebrowStyle: CSSProperties = {
  display: 'inline-flex',
  borderRadius: 999,
  padding: '4px 9px',
  marginBottom: 8,
  background: 'rgba(37, 99, 235, 0.1)',
  border: '1px solid rgba(37, 99, 235, 0.18)',
  color: '#1d4ed8',
  fontSize: 11,
  fontWeight: 850,
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 32,
  lineHeight: 1.08,
  color: '#020617',
}

const subtitleStyle: CSSProperties = {
  margin: '7px 0 0',
  color: '#475569',
  lineHeight: 1.45,
  fontSize: 14,
  maxWidth: 660,
}

const heroActionsStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
}

const kpiGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 12,
}

const cardStyle: CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: 18,
  padding: 18,
  display: 'grid',
  gap: 8,
  boxShadow: '0 14px 34px rgba(15, 23, 42, 0.06)',
}

const panelStyle: CSSProperties = {
  display: 'grid',
  gap: 16,
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: 22,
  background: 'rgba(255, 255, 255, 0.94)',
  padding: 20,
  boxShadow: '0 18px 44px rgba(15, 23, 42, 0.06)',
}

const filterStyle: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'end',
  flexWrap: 'wrap',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: 18,
  background: '#ffffff',
  padding: 16,
}

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: 22,
}

const mutedTextStyle: CSSProperties = {
  margin: '6px 0 0',
  color: '#64748b',
  lineHeight: 1.5,
  fontWeight: 650,
}

const formGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: 12,
}

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  color: '#111827',
  fontSize: 13,
  fontWeight: 800,
}

const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: 42,
  borderRadius: 12,
  border: '1px solid #d1d5db',
  background: '#ffffff',
  color: '#111827',
  padding: '0 12px',
  font: 'inherit',
  boxSizing: 'border-box',
}

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 80,
  padding: 12,
  resize: 'vertical',
}

const checkboxStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontWeight: 800,
}

const primaryButtonStyle: CSSProperties = {
  minHeight: 44,
  border: 0,
  borderRadius: 999,
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
  color: '#ffffff',
  padding: '0 18px',
  fontWeight: 900,
  cursor: 'pointer',
}

const smallPrimaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  minHeight: 38,
  fontSize: 13,
}

const primaryLinkButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
}

const secondaryButtonStyle: CSSProperties = {
  minHeight: 44,
  borderRadius: 999,
  border: '1px solid rgba(37, 99, 235, 0.24)',
  background: '#ffffff',
  color: '#1d4ed8',
  padding: '0 18px',
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
  fontWeight: 900,
}

const dangerButtonStyle: CSSProperties = {
  border: '1px solid #fecaca',
  borderRadius: 999,
  background: '#fef2f2',
  color: '#991b1b',
  padding: '8px 12px',
  fontWeight: 850,
  cursor: 'pointer',
}

const tabsStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  borderBottom: '1px solid rgba(148, 163, 184, 0.22)',
  paddingBottom: 8,
}

const tabStyle: CSSProperties = {
  borderRadius: 999,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: '#ffffff',
  color: '#475569',
  padding: '9px 13px',
  textDecoration: 'none',
  fontWeight: 850,
}

const activeTabStyle: CSSProperties = {
  ...tabStyle,
  borderColor: 'rgba(37, 99, 235, 0.28)',
  background: '#eff6ff',
  color: '#1d4ed8',
}

const tableWrapStyle: CSSProperties = {
  overflowX: 'auto',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  minWidth: 920,
}

const emptyCellStyle: CSSProperties = {
  padding: 18,
  color: '#64748b',
  fontWeight: 750,
}

const noteStyle: CSSProperties = {
  color: '#64748b',
  fontSize: 12,
  marginTop: 4,
}

const activeBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  borderRadius: 999,
  background: '#dcfce7',
  color: '#166534',
  padding: '5px 9px',
  fontSize: 12,
  fontWeight: 850,
}

const inactiveBadgeStyle: CSSProperties = {
  ...activeBadgeStyle,
  background: '#f3f4f6',
  color: '#4b5563',
}

const summaryStyle: CSSProperties = {
  cursor: 'pointer',
  color: '#2563eb',
  fontWeight: 850,
}

const inlineFormStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  minWidth: 260,
  marginTop: 10,
}
