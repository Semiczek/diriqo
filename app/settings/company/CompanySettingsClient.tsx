'use client'

import { type FormEvent, type ReactNode, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import {
  getPayTypeLabel,
  type CompanyBillingSettings,
  type CompanyPayrollSettings,
  type CompanySettings,
} from '@/lib/company-settings-shared'
import {
  companyCountryOptions,
  companyCurrencyOptions,
  companyLanguageOptions,
  getCompanyCountryConfig,
} from '@/lib/company-country-config'
import { COMPANY_TIME_ZONE_OPTIONS } from '@/lib/company-timezone'
import { mainPlans, type PlanKey } from '@/lib/plans'
import type { BillingInterval } from '@/lib/billing-shared'
import {
  updateCompanyBasicInfo,
  updateCompanyBillingSettings,
  updateCompanyJobSettings,
  updateCompanyMemberRole,
  updateCompanyPayrollSettings,
  updateWorkerPaymentSettings,
  type SettingsActionResult,
} from './actions'

type CompanyRow = {
  id: string
  name: string | null
  country_code?: string | null
  default_language?: string | null
  default_currency?: string | null
  registration_number?: string | null
  tax_number?: string | null
  vat_number?: string | null
  company_number?: string | null
  billing_country?: string | null
  ico?: string | null
  dic?: string | null
  email?: string | null
  phone?: string | null
  web?: string | null
  logo_url?: string | null
  address?: string | null
  currency?: string | null
  locale?: string | null
  timezone?: string | null
}

type WorkerPaymentRow = {
  worker_type: string | null
  pay_type_override: string | null
  payday_day_override: number | null
  payday_weekday_override: number | null
  hourly_rate: number | null
  fixed_rate_per_job: number | null
  advances_enabled_override: boolean | null
  advance_limit_amount_override: number | null
  contractor_company_name: string | null
  contractor_registration_no: string | null
  contractor_vat_no: string | null
  contractor_invoice_required: boolean | null
}

type MemberRow = {
  id: string | null
  profileId: string | null
  fullName: string
  email: string | null
  role: string
  isActive: boolean
  paymentSettings?: WorkerPaymentRow | null
}

type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired' | 'incomplete'

type SubscriptionView = {
  id: string
  company_id: string
  plan_key: PlanKey
  billing_interval?: BillingInterval | null
  status: SubscriptionStatus
  trial_started_at: string | null
  trial_ends_at: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_price_id: string | null
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  updated_at: string
}

type Props = {
  company: CompanyRow
  companySettings: CompanySettings
  payrollSettings: CompanyPayrollSettings
  billingSettings: CompanyBillingSettings
  subscription: SubscriptionView | null
  members: MemberRow[]
}

type TabKey = 'overview' | 'basic' | 'payroll' | 'jobs' | 'billing' | 'subscription' | 'users'

const tabs: Array<{ key: TabKey; label: string; description: string }> = [
  { key: 'overview', label: 'Přehled', description: 'Stav nastavení firmy' },
  { key: 'basic', label: 'Základní údaje', description: 'Identita, kontakt, měna' },
  { key: 'payroll', label: 'Pracovníci a výplaty', description: 'Sazby, zálohy, výjimky' },
  { key: 'jobs', label: 'Zakázky', description: 'Workflow a povinné podklady' },
  { key: 'billing', label: 'Fakturace', description: 'DPH, splatnost, banka' },
  { key: 'subscription', label: 'Předplatné', description: 'Plán, zkušební období, platby' },
  { key: 'users', label: 'Uživatelé', description: 'Členové a role firmy' },
]

const languageLabels: Record<string, string> = {
  cs: 'Čeština',
  sk: 'Slovenčina',
  en: 'English',
  de: 'Deutsch',
  pl: 'Polski',
  hu: 'Magyar',
  fr: 'Français',
  it: 'Italiano',
  es: 'Español',
  pt: 'Português',
  nl: 'Nederlands',
  da: 'Dansk',
  sv: 'Svenska',
  fi: 'Suomi',
  no: 'Norsk',
}

function countryCodeFromCompany(company: CompanyRow) {
  const direct = company.country_code?.trim().toUpperCase()
  if (direct) return direct

  const legacyCountry = company.billing_country?.trim().toLowerCase()
  if (legacyCountry === 'czech republic' || legacyCountry === 'ceska republika') return 'CZ'
  if (legacyCountry === 'slovakia') return 'SK'
  if (legacyCountry === 'germany') return 'DE'
  if (legacyCountry === 'austria') return 'AT'
  if (legacyCountry === 'united kingdom') return 'UK'
  if (legacyCountry === 'united states') return 'US'

  return 'ZZ'
}

function languageFromCompany(company: CompanyRow, fallback: string) {
  if (company.default_language?.trim()) return company.default_language.trim().toLowerCase()
  const locale = company.locale?.trim().toLowerCase()
  if (locale?.startsWith('cs')) return 'cs'
  if (locale?.startsWith('sk')) return 'sk'
  if (locale?.startsWith('de')) return 'de'
  if (locale?.startsWith('en')) return 'en'
  return fallback
}

export default function CompanySettingsClient({
  company,
  companySettings,
  payrollSettings,
  billingSettings,
  subscription,
  members,
}: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [expandedWorkerId, setExpandedWorkerId] = useState<string | null>(null)
  const [message, setMessage] = useState<SettingsActionResult | null>(null)
  const [isPending, startTransition] = useTransition()
  const initialCountryCode = countryCodeFromCompany(company)
  const initialCountryConfig = getCompanyCountryConfig(initialCountryCode)
  const [countryCode, setCountryCode] = useState(initialCountryConfig.countryCode)
  const [language, setLanguage] = useState(languageFromCompany(company, initialCountryConfig.defaultLanguage))
  const [currency, setCurrency] = useState(
    company.default_currency?.trim() || company.currency?.trim() || initialCountryConfig.defaultCurrency,
  )
  const countryConfig = getCompanyCountryConfig(countryCode)

  function submitWith(action: (formData: FormData) => Promise<SettingsActionResult>) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const form = event.currentTarget
      const formData = new FormData(form)

      startTransition(async () => {
        const result = await action(formData)
        setMessage(result)
        if (result.ok) router.refresh()
      })
    }
  }

  return (
    <div style={pageStyle}>
      <section className="company-settings-hero" style={{ ...panelStyle, ...heroStyle }}>
        <div>
          <div style={eyebrowStyle}>SaaS nastavení</div>
          <h1 style={heroTitleStyle}>Nastavení společnosti</h1>
          <p style={mutedStyle}>
            {company.name || 'Diriqo'} má tady základní firemní údaje, pracovníky, zakázky a výchozí údaje pro doklady.
          </p>
        </div>
        <div style={heroStatStyle}>
          <span style={labelStyle}>Aktivní firma</span>
          <strong style={heroStatValueStyle}>{company.name || 'Diriqo'}</strong>
          <span style={heroStatMetaStyle}>
            {members.filter((member) => member.isActive).length} aktivních členů
          </span>
        </div>
      </section>

      <div className="company-settings-layout" style={settingsLayoutStyle}>
        <aside style={tabsStyle} aria-label="Sekce nastavení">
          {tabs.map((tab) => {
            const active = activeTab === tab.key

            return (
              <button
                key={tab.key}
                className="company-settings-tab"
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  setActiveTab(tab.key)
                  setMessage(null)
                }}
                style={{
                  ...tabButtonStyle,
                  ...(active ? activeTabButtonStyle : {}),
                }}
              >
                <span style={tabDotStyle} />
                <span style={{ minWidth: 0 }}>
                  <span style={tabLabelStyle}>{tab.label}</span>
                  <span style={tabDescriptionStyle}>{tab.description}</span>
                </span>
              </button>
            )
          })}
        </aside>

        <section style={contentStyle}>
          {message ? <Message result={message} /> : null}

          {activeTab === 'overview' ? (
            <Overview
              company={company}
              companySettings={companySettings}
              payrollSettings={payrollSettings}
              billingSettings={billingSettings}
              subscription={subscription}
              activeWorkersCount={members.filter((member) => member.isActive).length}
              onNavigate={setActiveTab}
            />
          ) : null}

          {activeTab === 'basic' ? (
            <form style={panelStyle} onSubmit={submitWith(updateCompanyBasicInfo)}>
              <SectionHeader title="Základní údaje" description="Identita firmy pro aplikaci, faktury a komunikaci." />
              <div style={formGridStyle}>
                <Field label="Název společnosti" name="name" defaultValue={company.name ?? ''} required />
                <SelectField
                  label="Země"
                  name="country_code"
                  value={countryCode}
                  onChange={(nextCountryCode) => {
                    const nextConfig = getCompanyCountryConfig(nextCountryCode)
                    setCountryCode(nextConfig.countryCode)

                    if (window.confirm('Nabídnout jazyk a měnu podle vybrané země?')) {
                      setLanguage(nextConfig.defaultLanguage)
                      setCurrency(nextConfig.defaultCurrency)
                    }
                  }}
                  options={companyCountryOptions.map((option) => [option.value, option.label])}
                />
                <SelectField
                  label="Jazyk"
                  name="default_language"
                  value={language}
                  onChange={setLanguage}
                  options={companyLanguageOptions.map((option) => [option, languageLabels[option] ?? option.toUpperCase()])}
                />
                <SelectField
                  label="Měna"
                  name="default_currency"
                  value={currency}
                  onChange={setCurrency}
                  options={companyCurrencyOptions.map((option) => [option, option])}
                />
                <Field
                  label={countryConfig.registrationNumberLabel}
                  name="registration_number"
                  defaultValue={company.registration_number ?? company.company_number ?? company.ico ?? ''}
                  maxLength={64}
                />
                <Field
                  label={countryConfig.taxNumberLabel}
                  name="tax_number"
                  defaultValue={company.tax_number ?? company.vat_number ?? company.dic ?? ''}
                  maxLength={64}
                />
                <Field label="E-mail" name="email" defaultValue={company.email ?? ''} type="email" />
                <Field label="Telefon" name="phone" defaultValue={company.phone ?? ''} />
                <Field label="Web" name="web" defaultValue={company.web ?? ''} />
                <LogoField logoUrl={company.logo_url ?? null} />
                <SelectField
                  label="Časové pásmo"
                  name="timezone"
                  defaultValue={company.timezone ?? 'Europe/Prague'}
                  options={COMPANY_TIME_ZONE_OPTIONS.map((option) => [option.value, option.label])}
                />
                <Field label="Adresa" name="address" defaultValue={company.address ?? ''} wide />
              </div>
              <SubmitButton pending={isPending}>Uložit základní údaje</SubmitButton>
            </form>
          ) : null}

          {activeTab === 'payroll' ? (
            <div style={contentStyle}>
              <form style={panelStyle} onSubmit={submitWith(updateCompanyPayrollSettings)}>
                <SectionHeader
                  title="Pracovníci a výplaty"
                  description="Výchozí pravidla pro interní pracovníky, externisty a zálohy."
                />
                <div style={formGridStyle}>
                  <SelectField label="Výchozí typ pracovníka" name="default_worker_type" defaultValue={payrollSettings.default_worker_type} options={[['employee', 'Interní pracovník'], ['contractor', 'Externista / subdodavatel']]} />
                  <SelectField label="Typ výplaty" name="default_pay_type" defaultValue={payrollSettings.default_pay_type} options={[['after_shift', 'Po směně'], ['weekly', 'Týdně'], ['biweekly', 'Každých 14 dní'], ['monthly', 'Měsíčně']]} />
                  <Field label="Den výplaty v měsíci" name="payday_day" defaultValue={payrollSettings.payday_day ?? ''} type="number" />
                  <SelectField label="Limit zálohy" name="advance_limit_type" defaultValue={payrollSettings.advance_limit_type} options={[['monthly_amount', 'Měsíční částka'], ['percent_of_earned', 'Procento z vydělaného']]} />
                  <SelectField label="Frekvence záloh" name="advance_frequency" defaultValue={payrollSettings.advance_frequency} options={[['per_shift', 'Po směně'], ['weekly', 'Týdně'], ['biweekly', 'Každých 14 dní'], ['monthly', 'Měsíčně']]} />
                  <Field label="Maximální záloha" name="advance_limit_amount" defaultValue={payrollSettings.advance_limit_amount ?? ''} type="number" />
                  <Field label="Limit v %" name="advance_limit_percent" defaultValue={payrollSettings.advance_limit_percent ?? ''} type="number" />
                  <Field label="Výchozí hodinová sazba" name="default_hourly_rate" defaultValue={payrollSettings.default_hourly_rate ?? ''} type="number" />
                  <SelectField label="Výchozí způsob nákladu externisty" name="default_contractor_cost_mode" defaultValue={payrollSettings.default_contractor_cost_mode} options={[['hourly', 'Hodinově'], ['fixed_per_job', 'Fixně za zakázku'], ['invoice', 'Fakturou']]} />
                  <CheckboxField label="Povolit zálohy" name="advances_enabled" defaultChecked={payrollSettings.advances_enabled} />
                </div>
                <SubmitButton pending={isPending}>Uložit výplatní nastavení</SubmitButton>
              </form>

              <section style={panelStyle}>
                <SectionHeader
                  title="Individuální výjimky"
                  description="Ulož konkrétní sazbu, typ pracovníka nebo zálohy pro jednotlivé členy firmy."
                />
                <div style={contentStyle}>
                  {members.map((member) => {
                    const workerKey = member.profileId ?? member.id ?? member.fullName
                    const isExpanded = expandedWorkerId === workerKey

                    return (
                      <div key={workerKey} style={workerAccordionStyle}>
                        <button
                          type="button"
                          style={workerAccordionButtonStyle}
                          onClick={() => setExpandedWorkerId(isExpanded ? null : workerKey)}
                        >
                          <span>
                            <strong>{member.fullName}</strong>
                            <span style={workerMetaStyle}>{member.email ?? 'Bez e-mailu'} · {roleLabel(member.role)}</span>
                          </span>
                          <span style={pillStyle}>{isExpanded ? 'Skrýt' : 'Upravit'}</span>
                        </button>
                        {isExpanded ? (
                          <WorkerPaymentForm
                            member={member}
                            pending={isPending}
                            onSubmit={submitWith(updateWorkerPaymentSettings)}
                          />
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === 'jobs' ? (
            <form style={panelStyle} onSubmit={submitWith(updateCompanyJobSettings)}>
              <SectionHeader title="Zakázkové workflow" description="Pravidla pro dokončování práce, kontrolu a povinné podklady." />
              <div style={formGridStyle}>
                <SelectField label="Po dokončení pracovníkem" name="default_job_status_after_worker_done" defaultValue={companySettings.default_job_status_after_worker_done} options={[['waiting_check', 'Čeká na kontrolu'], ['done', 'Rovnou hotovo']]} />
                <CheckboxField label="Vyžadovat kontrolu zakázky" name="require_job_check" defaultChecked={companySettings.require_job_check} />
                <CheckboxField label="Povolit vícedenní zakázky" name="allow_multi_day_jobs" defaultChecked={companySettings.allow_multi_day_jobs} />
                <CheckboxField label="Vyžadovat fotky před/po" name="require_before_after_photos" defaultChecked={companySettings.require_before_after_photos} />
                <CheckboxField label="Vyžadovat checklist" name="require_checklist_completion" defaultChecked={companySettings.require_checklist_completion} />
                <CheckboxField label="Vyžadovat měření času práce" name="require_work_time_tracking" defaultChecked={companySettings.require_work_time_tracking} />
              </div>
              <SubmitButton pending={isPending}>Uložit workflow</SubmitButton>
            </form>
          ) : null}

          {activeTab === 'billing' ? (
            <form style={panelStyle} onSubmit={submitWith(updateCompanyBillingSettings)}>
              <SectionHeader
                title="Fakturace"
                description="Tady nastavíš jen výchozí hodnoty pro nové faktury a cenové nabídky. Samotné faktury se dál vytvářejí v sekci Fakturace."
              />
              <InfoBox>
                Prefix a další číslo určují číselnou řadu nových faktur. Splatnost se předvyplní do nové faktury, ale u konkrétní faktury ji můžeš změnit. Bankovní údaje se použijí pro platbu a QR kód.
              </InfoBox>
              <div style={formGridStyle}>
                <CheckboxField label="Plátce DPH" name="is_vat_payer" defaultChecked={billingSettings.is_vat_payer} />
                <Field label="Výchozí sazba DPH" name="default_vat_rate" defaultValue={billingSettings.default_vat_rate} type="number" />
                <Field label="Výchozí splatnost ve dnech" name="default_invoice_due_days" defaultValue={billingSettings.default_invoice_due_days} type="number" />
                <Field label="Prefix faktur" name="invoice_prefix" defaultValue={billingSettings.invoice_prefix} />
                <Field label="Další číslo faktury" name="next_invoice_number" defaultValue={billingSettings.next_invoice_number} type="number" />
                <Field label="Bankovní účet" name="bank_account" defaultValue={billingSettings.bank_account ?? ''} />
                <Field label="IBAN" name="iban" defaultValue={billingSettings.iban ?? ''} />
                <Field label="SWIFT" name="swift" defaultValue={billingSettings.swift ?? ''} />
              </div>
              <SubmitButton pending={isPending}>Uložit fakturaci</SubmitButton>
            </form>
          ) : null}

          {activeTab === 'subscription' ? (
            <SubscriptionPanel
              subscription={subscription}
              activeWorkersCount={members.filter((member) => member.isActive).length}
              onMessage={setMessage}
            />
          ) : null}

          {activeTab === 'users' ? (
            <section style={panelStyle}>
              <SectionHeader title="Uživatelé" description="Přehled členů firmy a jejich rolí." />
              <div style={contentStyle}>
                {members.map((member) => (
                  <form key={member.profileId ?? member.id} style={userRowStyle} onSubmit={submitWith(updateCompanyMemberRole)}>
                    <input type="hidden" name="member_id" value={member.id ?? ''} />
                    <div>
                      <strong>{member.fullName}</strong>
                      <div style={mutedStyle}>{member.email ?? 'Bez e-mailu'}</div>
                    </div>
                    <div style={userRoleControlsStyle}>
                      <select name="role" defaultValue={member.role} style={compactSelectStyle}>
                        {member.role === 'super_admin' ? <option value="super_admin">Super admin</option> : null}
                        <option value="company_admin">Admin firmy</option>
                        <option value="manager">Manažer</option>
                        <option value="worker">Pracovník</option>
                      </select>
                      <SubmitButton pending={isPending} compact>Uložit roli</SubmitButton>
                    </div>
                  </form>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      </div>
      <style>{`
        .company-settings-tab:focus {
          outline: none;
        }

        .company-settings-tab:focus-visible {
          outline: 2px solid rgba(37, 99, 235, 0.55);
          outline-offset: 3px;
        }

        @media (max-width: 900px) {
          .company-settings-hero,
          .company-settings-layout {
            display: grid !important;
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}

function WorkerPaymentForm({
  member,
  pending,
  onSubmit,
}: {
  member: MemberRow
  pending: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const settings = member.paymentSettings
  const advancesMode =
    settings?.advances_enabled_override == null
      ? 'inherit'
      : settings.advances_enabled_override
        ? 'enabled'
        : 'disabled'

  return (
    <form style={workerCardStyle} onSubmit={onSubmit}>
      <input type="hidden" name="profile_id" value={member.profileId ?? ''} />
      <div>
        <strong style={workerNameStyle}>{member.fullName}</strong>
        <span style={mutedStyle}>
          {member.email ?? 'Bez e-mailu'} · {roleLabel(member.role)}
        </span>
      </div>
      <div style={miniGridStyle}>
        <SelectField label="Typ" name="worker_type" defaultValue={settings?.worker_type ?? 'employee'} options={[['employee', 'Interní'], ['contractor', 'Externista']]} />
        <SelectField label="Výplata" name="pay_type_override" defaultValue={settings?.pay_type_override ?? ''} options={[['', 'Firemní nastavení'], ['after_shift', 'Po směně'], ['weekly', 'Týdně'], ['biweekly', 'Každých 14 dní'], ['monthly', 'Měsíčně']]} />
        <Field label="Den v měsíci" name="payday_day_override" defaultValue={settings?.payday_day_override ?? ''} type="number" />
        <Field label="Sazba Kč/h" name="hourly_rate" defaultValue={settings?.hourly_rate ?? ''} type="number" />
        <Field label="Fix za zakázku" name="fixed_rate_per_job" defaultValue={settings?.fixed_rate_per_job ?? ''} type="number" />
        <SelectField label="Zálohy" name="advances_enabled_override_mode" defaultValue={advancesMode} options={[['inherit', 'Firemní nastavení'], ['enabled', 'Povolit'], ['disabled', 'Zakázat']]} />
        <Field label="Limit zálohy" name="advance_limit_amount_override" defaultValue={settings?.advance_limit_amount_override ?? ''} type="number" />
        <Field label="Firma externisty" name="contractor_company_name" defaultValue={settings?.contractor_company_name ?? ''} />
        <Field label="IČO externisty" name="contractor_registration_no" defaultValue={settings?.contractor_registration_no ?? ''} />
        <Field label="DIČ externisty" name="contractor_vat_no" defaultValue={settings?.contractor_vat_no ?? ''} />
        <CheckboxField label="Vyžadovat fakturu externisty" name="contractor_invoice_required" defaultChecked={settings?.contractor_invoice_required === true} />
      </div>
      <SubmitButton pending={pending} compact>Uložit pracovníka</SubmitButton>
    </form>
  )
}

function Overview({
  company,
  companySettings,
  payrollSettings,
  billingSettings,
  subscription,
  activeWorkersCount,
  onNavigate,
}: {
  company: CompanyRow
  companySettings: CompanySettings
  payrollSettings: CompanyPayrollSettings
  billingSettings: CompanyBillingSettings
  subscription: SubscriptionView | null
  activeWorkersCount: number
  onNavigate: (tab: TabKey) => void
}) {
  const plan = getDisplayPlan(subscription?.plan_key)

  return (
    <section style={panelStyle}>
      <SectionHeader title="Přehled nastavení" description="Rychlá kontrola toho, jak je firma nastavená." />
      <div style={overviewGridStyle}>
        <SummaryCard label="Firma" value={company.name || 'Diriqo'} detail={company.email || 'E-mail není nastavený'} onClick={() => onNavigate('basic')} />
        <SummaryCard label="Pracovníci" value={`${activeWorkersCount}`} detail="Aktivní členové firmy" onClick={() => onNavigate('users')} />
        <SummaryCard label="Předplatné" value={plan.name} detail={subscriptionStatusText(subscription)} onClick={() => onNavigate('subscription')} />
        <SummaryCard label="Výplaty" value={getPayTypeLabel(payrollSettings.default_pay_type)} detail={`Výchozí sazba ${payrollSettings.default_hourly_rate ?? 0} Kč/h`} onClick={() => onNavigate('payroll')} />
        <SummaryCard label="Zakázky" value={companySettings.default_job_status_after_worker_done === 'done' ? 'Rovnou hotovo' : 'Čeká na kontrolu'} detail={companySettings.require_work_time_tracking ? 'Čas práce je povinný' : 'Čas práce je volitelný'} onClick={() => onNavigate('jobs')} />
        <SummaryCard label="Doklady" value={`${billingSettings.default_invoice_due_days} dnů`} detail={`Prefix faktur ${billingSettings.invoice_prefix}`} onClick={() => onNavigate('billing')} />
      </div>
    </section>
  )
}

function getDisplayPlan(planKey: PlanKey | null | undefined) {
  return mainPlans.find((plan) => plan.key === planKey) ?? mainPlans[0]
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Není nastaveno'
  return new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
}

function getTrialDaysLeft(subscription: SubscriptionView | null) {
  if (!subscription || subscription.status !== 'trialing' || !subscription.trial_ends_at) return 0
  const diff = new Date(subscription.trial_ends_at).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)))
}

function subscriptionStatusText(subscription: SubscriptionView | null) {
  if (!subscription) return 'Zkušební období zatím není založené'
  if (subscription.status === 'trialing') return `Zkušební období: ${getTrialDaysLeft(subscription)} dní zbývá`
  if (subscription.status === 'active') return 'Aktivní předplatné'
  if (subscription.status === 'past_due') return 'Platba po splatnosti'
  if (subscription.status === 'canceled') return 'Zrušeno'
  if (subscription.status === 'expired') return 'Neaktivní'
  return 'Nedokončená platba'
}

function subscriptionStatusLabel(status: SubscriptionStatus | null | undefined) {
  if (status === 'trialing') return 'Zkušební období'
  if (status === 'active') return 'Aktivní'
  if (status === 'past_due') return 'Po splatnosti'
  if (status === 'canceled') return 'Zrušeno'
  if (status === 'expired') return 'Neaktivní'
  if (status === 'incomplete') return 'Nedokončené'
  return 'Nenastaveno'
}

function formatMonthlyPrice(price: number | null) {
  return price === null ? 'Individuálně' : `${price.toLocaleString('cs-CZ')} € / měsíc`
}

function formatYearlyPrice(price: number | null) {
  return price === null ? 'Individuálně' : `${price.toLocaleString('cs-CZ')} € / rok`
}

function formatWorkerLimit(limit: number | null) {
  return limit === null ? 'Bez pevného limitu' : `${limit} pracovníků`
}

function SubscriptionPanel({
  subscription,
  activeWorkersCount,
  onMessage,
}: {
  subscription: SubscriptionView | null
  activeWorkersCount: number
  onMessage: (result: SettingsActionResult | null) => void
}) {
  const [billingPending, setBillingPending] = useState<string | null>(null)
  const currentPlan = getDisplayPlan(subscription?.plan_key)
  const trialDaysLeft = getTrialDaysLeft(subscription)

  async function startCheckout(planKey: PlanKey, billingInterval: BillingInterval) {
    const pendingKey = `${planKey}-${billingInterval}`
    setBillingPending(pendingKey)
    onMessage(null)

    try {
      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_key: planKey, billing_interval: billingInterval }),
      })
      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string }

      if (!response.ok || !payload.url) {
        onMessage({ ok: false, message: payload.error ?? 'Nepodařilo se otevřít Stripe Checkout.' })
        return
      }

      window.location.href = payload.url
    } finally {
      setBillingPending(null)
    }
  }

  async function openCustomerPortal() {
    setBillingPending('portal')
    onMessage(null)

    try {
      const response = await fetch('/api/stripe/create-portal-session', { method: 'POST' })
      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string }

      if (!response.ok || !payload.url) {
        onMessage({ ok: false, message: payload.error ?? 'Nepodařilo se otevřít správu předplatného.' })
        return
      }

      window.location.href = payload.url
    } finally {
      setBillingPending(null)
    }
  }

  const currentBillingInterval: BillingInterval = subscription?.billing_interval === 'yearly' ? 'yearly' : 'monthly'
  const currentInterval = currentBillingInterval === 'yearly' ? 'ročně' : 'měsíčně'

  return (
    <section style={panelStyle}>
      <SectionHeader
        title="Předplatné"
        description="Tady vidíš aktuální plán, zkušební období, další platbu a čtyři dostupné tarify."
      />

      <div style={subscriptionHeroStyle}>
        <div>
          <span style={labelStyle}>Aktuální plán</span>
          <strong style={subscriptionPlanStyle}>{currentPlan.name}</strong>
          <span style={summaryDetailStyle}>{formatMonthlyPrice(currentPlan.priceMonthly)} · {currentInterval} · {formatWorkerLimit(currentPlan.workerLimit)}</span>
        </div>
        <div style={subscriptionStatusCardStyle}>
          <span style={labelStyle}>Stav</span>
          <strong style={subscriptionStatusValueStyle}>{subscriptionStatusLabel(subscription?.status)}</strong>
          <span style={summaryDetailStyle}>{subscriptionStatusText(subscription)}</span>
        </div>
      </div>

      <div style={overviewGridStyle}>
        <div style={metricCardStyle}>
          <span style={labelStyle}>Zkušební období</span>
          <strong style={summaryValueStyle}>{subscription?.status === 'trialing' ? `${trialDaysLeft} dní` : 'Hotovo'}</strong>
          <span style={summaryDetailStyle}>Končí {formatDate(subscription?.trial_ends_at)}</span>
        </div>
        <div style={metricCardStyle}>
          <span style={labelStyle}>Další prodloužení</span>
          <strong style={summaryValueStyle}>{formatDate(subscription?.current_period_end)}</strong>
          <span style={summaryDetailStyle}>{subscription?.cancel_at_period_end ? 'Předplatné se na konci období zruší' : 'Podle aktivního Stripe předplatného'}</span>
        </div>
        <div style={metricCardStyle}>
          <span style={labelStyle}>Pracovníci</span>
          <strong style={summaryValueStyle}>{activeWorkersCount} / {currentPlan.workerLimit ?? '∞'}</strong>
          <span style={summaryDetailStyle}>Aktivní členové vůči limitu plánu</span>
        </div>
      </div>

      {subscription?.stripe_customer_id ? (
        <button type="button" style={secondaryButtonStyle} disabled={billingPending === 'portal'} onClick={openCustomerPortal}>
          {billingPending === 'portal' ? 'Otevírám...' : 'Spravovat předplatné'}
        </button>
      ) : null}

      <div style={subscriptionSectionStyle}>
        <SectionHeader title="Plány" description="Vyber plán podle velikosti týmu. Growth je doporučený pro většinu rostoucích firem." />
        <div style={planGridStyle}>
          {mainPlans.map((plan) => {
            const isCurrent = plan.key === currentPlan.key
            const monthlyPendingKey = `${plan.key}-monthly`
            const yearlyPendingKey = `${plan.key}-yearly`
            const isCurrentMonthly = isCurrent && currentBillingInterval === 'monthly'
            const isCurrentYearly = isCurrent && currentBillingInterval === 'yearly'

            return (
              <article key={plan.key} style={plan.recommended ? recommendedPlanCardStyle : planCardStyle}>
                <div style={planCardHeaderStyle}>
                  <h3 style={planTitleStyle}>{plan.name}</h3>
                  {plan.recommended ? <span style={badgeStyle}>Doporučené</span> : null}
                </div>
                <strong style={priceStyle}>{formatMonthlyPrice(plan.priceMonthly)}</strong>
                <span style={summaryDetailStyle}>{formatYearlyPrice(plan.priceYearly)} · 2 měsíce zdarma</span>
                <span style={summaryDetailStyle}>{formatWorkerLimit(plan.workerLimit)}</span>
                <div style={planActionsStyle}>
                  <button
                    type="button"
                    style={isCurrentMonthly ? secondaryButtonStyle : primaryButtonStyle}
                    disabled={isCurrentMonthly || billingPending === monthlyPendingKey}
                    onClick={() => startCheckout(plan.key, 'monthly')}
                  >
                    {isCurrentMonthly ? 'Aktuální plán' : billingPending === monthlyPendingKey ? 'Připravuji...' : 'Měsíčně'}
                  </button>
                  <button
                    type="button"
                    style={isCurrentYearly ? secondaryButtonStyle : primaryButtonStyle}
                    disabled={isCurrentYearly || billingPending === yearlyPendingKey}
                    onClick={() => startCheckout(plan.key, 'yearly')}
                  >
                    {isCurrentYearly ? 'Aktuální plán' : billingPending === yearlyPendingKey ? 'Připravuji...' : 'Ročně'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </div>

    </section>
  )
}

function Message({ result }: { result: SettingsActionResult }) {
  return <div style={{ ...messageStyle, ...(result.ok ? successStyle : errorStyle) }}>{result.message}</div>
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <header style={{ marginBottom: '16px' }}>
      <h2 style={sectionTitleStyle}>{title}</h2>
      <p style={{ ...mutedStyle, marginTop: '7px' }}>{description}</p>
    </header>
  )
}

function Field({
  label,
  name,
  defaultValue,
  type = 'text',
  required = false,
  wide = false,
  maxLength,
}: {
  label: string
  name: string
  defaultValue: string | number
  type?: string
  required?: boolean
  wide?: boolean
  maxLength?: number
}) {
  return (
    <label style={{ ...fieldStyle, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={labelStyle}>{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
        style={inputStyle}
      />
    </label>
  )
}

function SelectField({
  label,
  name,
  defaultValue,
  value,
  onChange,
  options,
}: {
  label: string
  name: string
  defaultValue?: string
  value?: string
  onChange?: (value: string) => void
  options: Array<readonly [string, string]>
}) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      <select
        name={name}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        style={inputStyle}
      >
        {options.map(([value, optionLabel]) => (
          <option key={value} value={value}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function CheckboxField({ label, name, defaultChecked }: { label: string; name: string; defaultChecked: boolean }) {
  return (
    <label style={checkboxStyle}>
      <input name={name} type="checkbox" defaultChecked={defaultChecked} style={{ width: '18px', height: '18px' }} />
      <span>{label}</span>
    </label>
  )
}

function LogoField({ logoUrl }: { logoUrl: string | null }) {
  return (
    <div style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
      <span style={labelStyle}>Logo firmy</span>
      <div style={logoUploadStyle}>
        {logoUrl ? (
          <div style={logoPreviewStyle}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="Logo firmy" style={logoImageStyle} />
          </div>
        ) : (
          <div style={logoPlaceholderStyle}>Bez loga</div>
        )}
        <div style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
          <input name="logo_file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={inputStyle} />
          <input name="logo_url" type="url" defaultValue={logoUrl ?? ''} placeholder="Nebo vlož URL loga" style={inputStyle} />
          <span style={mutedStyle}>
            Logo se uloží k firmě a nové cenové nabídky ho už umí zobrazit. U nových faktur se uloží do údajů dodavatele pro další použití.
          </span>
        </div>
      </div>
    </div>
  )
}

function SubmitButton({ children, pending, compact = false }: { children: string; pending: boolean; compact?: boolean }) {
  return (
    <button type="submit" disabled={pending} style={{ ...primaryButtonStyle, marginTop: compact ? 0 : '18px' }}>
      {pending ? 'Ukládám...' : children}
    </button>
  )
}

function InfoBox({ children }: { children: ReactNode }) {
  return <p style={infoBoxStyle}>{children}</p>
}

function SummaryCard({ label, value, detail, onClick }: { label: string; value: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={summaryCardStyle}>
      <span style={labelStyle}>{label}</span>
      <strong style={summaryValueStyle}>{value}</strong>
      <span style={summaryDetailStyle}>{detail}</span>
    </button>
  )
}

function roleLabel(role: string) {
  if (role === 'super_admin') return 'Super admin'
  if (role === 'company_admin') return 'Admin firmy'
  if (role === 'manager') return 'Manažer'
  return 'Pracovník'
}

const pageStyle = { display: 'grid', gap: '12px' } as const
const contentStyle = { display: 'grid', gap: '16px', minWidth: 0 } as const

const panelStyle = {
  borderRadius: '20px',
  border: '1px solid rgba(203, 213, 225, 0.76)',
  background: '#ffffff',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.065)',
  padding: '18px 20px',
} as const

const heroStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '14px',
  background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(6,182,212,0.10) 62%, #ffffff)',
} as const

const heroTitleStyle = {
  margin: '7px 0 0',
  fontSize: '32px',
  lineHeight: 1.08,
  color: '#0f172a',
} as const

const heroStatStyle = {
  borderRadius: '14px',
  border: '1px solid rgba(203, 213, 225, 0.78)',
  background: 'rgba(255,255,255,0.76)',
  padding: '9px 11px',
  minWidth: '220px',
  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.045)',
} as const

const heroStatValueStyle = { display: 'block', marginTop: '8px', fontSize: '24px', color: '#0f172a' } as const
const heroStatMetaStyle = { display: 'block', marginTop: '8px', color: '#64748b', fontWeight: 750 } as const

const settingsLayoutStyle = {
  display: 'grid',
  gridTemplateColumns: '280px minmax(0, 1fr)',
  gap: '18px',
} as const

const tabsStyle = {
  borderRadius: '24px',
  border: '1px solid rgba(203, 213, 225, 0.76)',
  background: '#ffffff',
  boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
  alignSelf: 'start',
  display: 'grid',
  gap: '6px',
  padding: '12px',
  position: 'sticky',
  top: '18px',
} as const

const tabButtonStyle = {
  minHeight: '58px',
  borderRadius: '16px',
  border: '1px solid transparent',
  background: 'transparent',
  color: '#475569',
  textAlign: 'left',
  padding: '10px 12px',
  cursor: 'pointer',
  display: 'grid',
  gridTemplateColumns: '9px minmax(0, 1fr)',
  alignItems: 'center',
  gap: '11px',
} as const

const activeTabButtonStyle = {
  background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(6,182,212,0.12))',
  borderColor: 'rgba(37, 99, 235, 0.18)',
  color: '#0f172a',
} as const

const tabDotStyle = {
  width: '9px',
  height: '9px',
  borderRadius: '999px',
  background: 'linear-gradient(135deg, #7c3aed, #06b6d4)',
} as const

const tabLabelStyle = { display: 'block', fontSize: '15px', fontWeight: 900, lineHeight: 1.2 } as const
const tabDescriptionStyle = { display: 'block', marginTop: '3px', fontSize: '12px', color: '#64748b', fontWeight: 700 } as const

const formGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: '14px',
} as const

const miniGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  gap: '10px',
} as const

const overviewGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px',
} as const

const fieldStyle = { display: 'grid', gap: '7px', minWidth: 0 } as const

const inputStyle = {
  minHeight: '48px',
  width: '100%',
  boxSizing: 'border-box',
  borderRadius: '14px',
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  padding: '10px 13px',
  color: '#0f172a',
  fontSize: '16px',
  fontWeight: 700,
} as const

const compactSelectStyle = {
  ...inputStyle,
  minHeight: '40px',
  fontSize: '14px',
} as const

const checkboxStyle = {
  minHeight: '54px',
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  borderRadius: '16px',
  border: '1px solid #dbe4ef',
  background: '#f8fafc',
  padding: '12px 14px',
  color: '#0f172a',
  fontSize: '15px',
  fontWeight: 850,
} as const

const primaryButtonStyle = {
  minHeight: '48px',
  borderRadius: '999px',
  border: 0,
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 48%, #06b6d4 100%)',
  color: '#ffffff',
  padding: '0 22px',
  fontSize: '16px',
  fontWeight: 950,
  cursor: 'pointer',
  boxShadow: '0 16px 34px rgba(37, 99, 235, 0.22)',
} as const

const summaryCardStyle = {
  minHeight: '150px',
  borderRadius: '20px',
  border: '1px solid #dbe4ef',
  background: '#f8fafc',
  padding: '18px',
  textAlign: 'left',
  cursor: 'pointer',
} as const

const summaryValueStyle = { display: 'block', marginTop: '9px', fontSize: '26px', color: '#0f172a' } as const
const summaryDetailStyle = { display: 'block', marginTop: '8px', color: '#64748b', fontWeight: 700 } as const

const metricCardStyle = {
  ...summaryCardStyle,
  cursor: 'default',
} as const

const subscriptionHeroStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '14px',
  alignItems: 'stretch',
  borderRadius: '20px',
  border: '1px solid rgba(37, 99, 235, 0.14)',
  background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(6,182,212,0.10), #ffffff)',
  padding: '18px',
  marginBottom: '14px',
} as const

const subscriptionPlanStyle = {
  display: 'block',
  marginTop: '8px',
  color: '#0f172a',
  fontSize: '34px',
  lineHeight: 1.05,
} as const

const subscriptionStatusCardStyle = {
  borderRadius: '18px',
  border: '1px solid rgba(203, 213, 225, 0.78)',
  background: 'rgba(255,255,255,0.78)',
  padding: '16px',
} as const

const subscriptionStatusValueStyle = {
  display: 'block',
  marginTop: '8px',
  color: '#0f172a',
  fontSize: '24px',
} as const

const subscriptionSectionStyle = {
  display: 'grid',
  gap: '12px',
  marginTop: '18px',
} as const

const planGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(205px, 1fr))',
  gap: '12px',
} as const

const planCardStyle = {
  display: 'grid',
  gap: '12px',
  alignContent: 'start',
  borderRadius: '18px',
  border: '1px solid #dbe4ef',
  background: '#ffffff',
  padding: '16px',
} as const

const recommendedPlanCardStyle = {
  ...planCardStyle,
  borderColor: '#93c5fd',
  boxShadow: '0 16px 34px rgba(37, 99, 235, 0.12)',
} as const

const planCardHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '10px',
} as const

const planActionsStyle = {
  display: 'grid',
  gap: '8px',
} as const

const planTitleStyle = { margin: 0, color: '#0f172a', fontSize: '20px' } as const
const priceStyle = { marginTop: '2px', color: '#0f172a', fontSize: '24px', fontWeight: 950 } as const

const secondaryButtonStyle = {
  minHeight: '46px',
  borderRadius: '999px',
  border: '1px solid #bfdbfe',
  background: '#ffffff',
  color: '#1d4ed8',
  padding: '0 18px',
  fontSize: '15px',
  fontWeight: 950,
  cursor: 'pointer',
} as const

const badgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '26px',
  borderRadius: '999px',
  border: '1px solid #bfdbfe',
  background: '#eff6ff',
  color: '#1d4ed8',
  padding: '3px 9px',
  fontSize: '12px',
  fontWeight: 950,
  whiteSpace: 'nowrap',
} as const

const infoBoxStyle = {
  margin: '0 0 16px',
  borderRadius: '16px',
  border: '1px solid rgba(37, 99, 235, 0.16)',
  background: '#eff6ff',
  color: '#1e3a8a',
  padding: '12px 14px',
  fontSize: '14px',
  fontWeight: 750,
  lineHeight: 1.45,
} as const

const logoUploadStyle = {
  display: 'grid',
  gridTemplateColumns: '120px minmax(0, 1fr)',
  gap: '14px',
  alignItems: 'start',
  borderRadius: '16px',
  border: '1px solid #dbe4ef',
  background: '#f8fafc',
  padding: '14px',
} as const

const logoPreviewStyle = {
  width: '120px',
  height: '120px',
  borderRadius: '16px',
  border: '1px solid #dbe4ef',
  background: '#ffffff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
} as const

const logoImageStyle = {
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
} as const

const logoPlaceholderStyle = {
  ...logoPreviewStyle,
  color: '#64748b',
  fontWeight: 850,
} as const

const workerCardStyle = {
  display: 'grid',
  gap: '12px',
  borderRadius: '18px',
  border: 0,
  background: '#f8fafc',
  padding: '0 14px 14px',
} as const

const workerNameStyle = { display: 'block', fontSize: '18px', color: '#0f172a' } as const

const workerAccordionStyle = {
  borderRadius: '16px',
  border: '1px solid #dbe4ef',
  background: '#f8fafc',
  overflow: 'hidden',
} as const

const workerAccordionButtonStyle = {
  width: '100%',
  border: 0,
  background: 'transparent',
  padding: '14px 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '14px',
  color: '#0f172a',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: '16px',
  fontWeight: 900,
} as const

const workerMetaStyle = {
  display: 'block',
  marginTop: '4px',
  color: '#64748b',
  fontSize: '13px',
  fontWeight: 700,
} as const

const userRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: '14px',
  borderRadius: '16px',
  border: '1px solid #dbe4ef',
  background: '#f8fafc',
  padding: '14px 16px',
} as const

const userRoleControlsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
} as const

const pillStyle = {
  borderRadius: '999px',
  background: '#eef5ff',
  border: '1px solid rgba(37, 99, 235, 0.16)',
  color: '#1d4ed8',
  padding: '7px 10px',
  fontSize: '13px',
  fontWeight: 900,
  whiteSpace: 'nowrap',
} as const

const messageStyle = { borderRadius: '16px', border: '1px solid', padding: '13px 15px', fontWeight: 850 } as const
const successStyle = { borderColor: 'rgba(34,197,94,0.32)', background: '#f0fdf4', color: '#166534' } as const
const errorStyle = { borderColor: 'rgba(239,68,68,0.32)', background: '#fef2f2', color: '#991b1b' } as const

const eyebrowStyle = {
  display: 'inline-flex',
  borderRadius: '999px',
  border: '1px solid rgba(124,58,237,0.18)',
  background: 'rgba(255,255,255,0.72)',
  color: '#5b21b6',
  padding: '4px 9px',
  fontSize: '11px',
  fontWeight: 950,
} as const

const sectionTitleStyle = { margin: 0, fontSize: '28px', lineHeight: 1.1, color: '#0f172a' } as const
const labelStyle = { color: '#64748b', fontSize: '13px', fontWeight: 900 } as const

const mutedStyle = {
  margin: '7px 0 0',
  color: '#64748b',
  fontSize: '14px',
  fontWeight: 700,
  lineHeight: 1.45,
} as const
