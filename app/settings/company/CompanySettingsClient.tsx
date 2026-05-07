'use client'

import { FormEvent, useState, useTransition } from 'react'

import {
  COMPANY_MODULE_KEYS,
  getContractorCostModeLabel,
  getPayTypeLabel,
  type CompanyBillingSettings,
  type CompanyModuleKey,
  type CompanyPayrollSettings,
  type CompanySettings,
} from '@/lib/company-settings-shared'
import {
  updateCompanyBasicInfo,
  updateCompanyBillingSettings,
  updateCompanyJobSettings,
  updateCompanyModules,
  updateCompanyPayrollSettings,
  updateWorkerPaymentSettings,
  type SettingsActionResult,
} from './actions'

type CompanyRow = {
  id: string
  name: string | null
  ico?: string | null
  dic?: string | null
  email?: string | null
  phone?: string | null
  web?: string | null
  address?: string | null
  currency?: string | null
  locale?: string | null
  timezone?: string | null
}

type MemberRow = {
  id: string | null
  profileId: string | null
  fullName: string
  email: string | null
  role: string
  isActive: boolean
}

type Props = {
  company: CompanyRow
  companySettings: CompanySettings
  payrollSettings: CompanyPayrollSettings
  billingSettings: CompanyBillingSettings
  modules: Record<CompanyModuleKey, boolean>
  members: MemberRow[]
}

type TabKey = 'overview' | 'basic' | 'payroll' | 'jobs' | 'billing' | 'modules' | 'users'

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Přehled' },
  { key: 'basic', label: 'Základní údaje' },
  { key: 'payroll', label: 'Pracovníci a výplaty' },
  { key: 'jobs', label: 'Zakázky' },
  { key: 'billing', label: 'Fakturace' },
  { key: 'modules', label: 'Moduly' },
  { key: 'users', label: 'Uživatelé' },
]

const moduleLabels: Record<CompanyModuleKey, string> = {
  jobs: 'Zakázky',
  workers: 'Pracovníci',
  shifts: 'Směny',
  finance: 'Finance',
  calendar: 'Kalendář',
  quotes: 'Nabídky',
  invoices: 'Fakturace',
  photos: 'Fotky',
  customer_portal: 'Zákaznický portál',
  public_leads: 'Poptávky z webu',
  email: 'E-mail',
  payroll: 'Výplaty',
}

export default function CompanySettingsClient({
  company,
  companySettings,
  payrollSettings,
  billingSettings,
  modules,
  members,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [message, setMessage] = useState<SettingsActionResult | null>(null)
  const [isPending, startTransition] = useTransition()

  function submitWith(action: (formData: FormData) => Promise<SettingsActionResult>) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const formData = new FormData(event.currentTarget)
      startTransition(async () => {
        setMessage(await action(formData))
      })
    }
  }

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      <section className="company-settings-hero" style={{ ...panelStyle, ...heroStyle }}>
        <div>
          <div style={eyebrowStyle}>SaaS nastavení</div>
          <h1 style={{ margin: '8px 0', fontSize: 'clamp(32px, 4vw, 54px)', lineHeight: 1 }}>
            Nastavení společnosti
          </h1>
          <p style={mutedStyle}>
            {company.name || 'Diriqo'} má tady základní firemní údaje, workflow, fakturaci a zapnuté moduly.
          </p>
        </div>
        <div style={heroStatStyle}>
          <span style={labelStyle}>Aktivní firma</span>
          <strong style={{ display: 'block', marginTop: '8px', fontSize: '24px' }}>
            {company.name || 'Diriqo'}
          </strong>
          <span style={{ display: 'block', marginTop: '8px', color: '#64748b', fontWeight: 750 }}>
            {members.filter((member) => member.isActive).length} aktivních členů
          </span>
        </div>
      </section>

      <div className="company-settings-layout" style={settingsLayoutStyle}>
        <aside style={tabsStyle} aria-label="Sekce nastavení">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveTab(tab.key)
                setMessage(null)
              }}
              style={{
                ...tabButtonStyle,
                ...(activeTab === tab.key ? activeTabButtonStyle : {}),
              }}
            >
              {tab.label}
            </button>
          ))}
        </aside>

        <section style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
          {message ? <Message result={message} /> : null}

          {activeTab === 'overview' ? (
            <Overview
              company={company}
              companySettings={companySettings}
              payrollSettings={payrollSettings}
              billingSettings={billingSettings}
              modules={modules}
              onNavigate={setActiveTab}
            />
          ) : null}

          {activeTab === 'basic' ? (
            <form style={panelStyle} onSubmit={submitWith(updateCompanyBasicInfo)}>
              <SectionHeader title="Základní údaje" description="Identita firmy pro aplikaci, faktury a komunikaci." />
              <div style={formGridStyle}>
                <Field label="Název společnosti" name="name" defaultValue={company.name ?? ''} required />
                <Field label="IČO" name="ico" defaultValue={company.ico ?? ''} />
                <Field label="DIČ" name="dic" defaultValue={company.dic ?? ''} />
                <Field label="E-mail" name="email" defaultValue={company.email ?? ''} type="email" />
                <Field label="Telefon" name="phone" defaultValue={company.phone ?? ''} />
                <Field label="Web" name="web" defaultValue={company.web ?? ''} />
                <Field label="Měna" name="currency" defaultValue={company.currency ?? 'CZK'} />
                <Field label="Jazyk" name="locale" defaultValue={company.locale ?? 'cs-CZ'} />
                <Field label="Časové pásmo" name="timezone" defaultValue={company.timezone ?? 'Europe/Prague'} />
                <Field label="Adresa" name="address" defaultValue={company.address ?? ''} wide />
              </div>
              <SubmitButton pending={isPending}>Uložit základní údaje</SubmitButton>
            </form>
          ) : null}

          {activeTab === 'payroll' ? (
            <div style={{ display: 'grid', gap: '16px' }}>
              <form style={panelStyle} onSubmit={submitWith(updateCompanyPayrollSettings)}>
                <SectionHeader
                  title="Pracovníci a výplaty"
                  description="Výchozí pravidla pro interní pracovníky, externisty a zálohy."
                />
                <div style={formGridStyle}>
                  <SelectField label="Výchozí typ pracovníka" name="default_worker_type" defaultValue={payrollSettings.default_worker_type} options={[['employee', 'Interní pracovník'], ['contractor', 'Externista / subdodavatel']]} />
                  <SelectField label="Typ výplaty" name="default_pay_type" defaultValue={payrollSettings.default_pay_type} options={[['after_shift', 'Po směně'], ['weekly', 'Týdně'], ['biweekly', 'Každých 14 dní'], ['monthly', 'Měsíčně']]} />
                  <Field label="Den výplaty v měsíci" name="payday_day" defaultValue={payrollSettings.payday_day ?? ''} type="number" />
                  <Field label="Den výplaty v týdnu" name="payday_weekday" defaultValue={payrollSettings.payday_weekday ?? ''} type="number" />
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
                <SectionHeader title="Individuální výjimky" description="MVP přehled pracovníků. Výjimku můžeš uložit u konkrétní osoby." />
                <div style={{ display: 'grid', gap: '12px' }}>
                  {members.map((member) => (
                    <form key={member.profileId ?? member.id} style={workerCardStyle} onSubmit={submitWith(updateWorkerPaymentSettings)}>
                      <input type="hidden" name="profile_id" value={member.profileId ?? ''} />
                      <div>
                        <strong style={{ display: 'block', fontSize: '18px' }}>{member.fullName}</strong>
                        <span style={mutedStyle}>{member.email ?? 'Bez e-mailu'} · {roleLabel(member.role)}</span>
                      </div>
                      <div style={miniGridStyle}>
                        <SelectField label="Typ" name="worker_type" defaultValue="employee" options={[['employee', 'Interní'], ['contractor', 'Externista']]} />
                        <SelectField label="Výplata" name="pay_type_override" defaultValue="" options={[['', 'Firemní nastavení'], ['after_shift', 'Po směně'], ['weekly', 'Týdně'], ['biweekly', 'Každých 14 dní'], ['monthly', 'Měsíčně']]} />
                        <Field label="Sazba Kč/h" name="hourly_rate" defaultValue="" type="number" />
                        <Field label="Fix za zakázku" name="fixed_rate_per_job" defaultValue="" type="number" />
                      </div>
                      <SubmitButton pending={isPending} compact>Uložit pracovníka</SubmitButton>
                    </form>
                  ))}
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
              <SectionHeader title="Fakturace" description="Výchozí splatnost, DPH a bankovní údaje pro nové faktury." />
              <div style={formGridStyle}>
                <CheckboxField label="Používat fakturaci v systému" name="billing_enabled" defaultChecked={billingSettings.billing_enabled} />
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

          {activeTab === 'modules' ? (
            <form style={panelStyle} onSubmit={submitWith(updateCompanyModules)}>
              <SectionHeader title="Zapnuté moduly" description="Jednoduchý základ pro budoucí SaaS tarify a příplatkové funkce." />
              <div style={moduleGridStyle}>
                {COMPANY_MODULE_KEYS.map((moduleKey) => (
                  <CheckboxField key={moduleKey} label={moduleLabels[moduleKey]} name={`module_${moduleKey}`} defaultChecked={modules[moduleKey]} />
                ))}
              </div>
              <SubmitButton pending={isPending}>Uložit moduly</SubmitButton>
            </form>
          ) : null}

          {activeTab === 'users' ? (
            <section style={panelStyle}>
              <SectionHeader title="Uživatelé" description="MVP seznam členů firmy. Později sem přijde pozvání uživatelů a správa rolí." />
              <div style={{ display: 'grid', gap: '10px' }}>
                {members.map((member) => (
                  <div key={member.profileId ?? member.id} style={userRowStyle}>
                    <div>
                      <strong>{member.fullName}</strong>
                      <div style={mutedStyle}>{member.email ?? 'Bez e-mailu'}</div>
                    </div>
                    <span style={pillStyle}>{roleLabel(member.role)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      </div>
      <style>{`
        @media (max-width: 900px) {
          .company-settings-hero,
          .company-settings-layout {
            display: grid !important;
            grid-template-columns: 1fr !important;
          }

          .company-settings-hero {
            gap: 14px !important;
          }
        }
      `}</style>
    </div>
  )
}

function Overview({
  company,
  companySettings,
  payrollSettings,
  billingSettings,
  modules,
  onNavigate,
}: {
  company: CompanyRow
  companySettings: CompanySettings
  payrollSettings: CompanyPayrollSettings
  billingSettings: CompanyBillingSettings
  modules: Record<CompanyModuleKey, boolean>
  onNavigate: (tab: TabKey) => void
}) {
  const enabledModules = COMPANY_MODULE_KEYS.filter((key) => modules[key]).length

  return (
    <section style={panelStyle}>
      <SectionHeader title="Přehled nastavení" description="Rychlá kontrola toho, jak je firma nastavená." />
      <div style={overviewGridStyle}>
        <SummaryCard label="Firma" value={company.name || 'Diriqo'} detail={company.email || 'E-mail není nastavený'} onClick={() => onNavigate('basic')} />
        <SummaryCard label="Výplaty" value={getPayTypeLabel(payrollSettings.default_pay_type)} detail={`Výchozí sazba ${payrollSettings.default_hourly_rate ?? 0} Kč/h`} onClick={() => onNavigate('payroll')} />
        <SummaryCard label="Zakázky" value={companySettings.default_job_status_after_worker_done === 'done' ? 'Rovnou hotovo' : 'Čeká na kontrolu'} detail={companySettings.require_work_time_tracking ? 'Čas práce je povinný' : 'Čas práce je volitelný'} onClick={() => onNavigate('jobs')} />
        <SummaryCard label="Fakturace" value={billingSettings.billing_enabled ? 'Zapnutá' : 'Vypnutá'} detail={`Splatnost ${billingSettings.default_invoice_due_days} dní`} onClick={() => onNavigate('billing')} />
        <SummaryCard label="Moduly" value={`${enabledModules}/${COMPANY_MODULE_KEYS.length}`} detail={getContractorCostModeLabel(payrollSettings.default_contractor_cost_mode)} onClick={() => onNavigate('modules')} />
      </div>
    </section>
  )
}

function Message({ result }: { result: SettingsActionResult }) {
  return (
    <div style={{ ...messageStyle, ...(result.ok ? successStyle : errorStyle) }}>
      {result.message}
    </div>
  )
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <header style={{ marginBottom: '16px' }}>
      <h2 style={{ margin: 0, fontSize: '28px', lineHeight: 1.1 }}>{title}</h2>
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
}: {
  label: string
  name: string
  defaultValue: string | number
  type?: string
  required?: boolean
  wide?: boolean
}) {
  return (
    <label style={{ ...fieldStyle, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={labelStyle}>{label}</span>
      <input name={name} type={type} defaultValue={defaultValue} required={required} style={inputStyle} />
    </label>
  )
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string
  name: string
  defaultValue: string
  options: Array<[string, string]>
}) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      <select name={name} defaultValue={defaultValue} style={inputStyle}>
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

function SubmitButton({ children, pending, compact = false }: { children: string; pending: boolean; compact?: boolean }) {
  return (
    <button type="submit" disabled={pending} style={{ ...primaryButtonStyle, marginTop: compact ? 0 : '18px' }}>
      {pending ? 'Ukládám...' : children}
    </button>
  )
}

function SummaryCard({ label, value, detail, onClick }: { label: string; value: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={summaryCardStyle}>
      <span style={labelStyle}>{label}</span>
      <strong style={{ display: 'block', marginTop: '9px', fontSize: '26px', color: '#0f172a' }}>{value}</strong>
      <span style={{ display: 'block', marginTop: '8px', color: '#64748b', fontWeight: 700 }}>{detail}</span>
    </button>
  )
}

function roleLabel(role: string) {
  if (role === 'super_admin') return 'Super admin'
  if (role === 'company_admin') return 'Admin firmy'
  if (role === 'manager') return 'Manažer'
  return 'Pracovník'
}

const panelStyle = {
  borderRadius: '24px',
  border: '1px solid rgba(203, 213, 225, 0.76)',
  background: '#ffffff',
  boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
  padding: '24px',
} as const

const heroStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'stretch',
  gap: '18px',
  background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(6,182,212,0.10) 62%, #ffffff)',
} as const

const heroStatStyle = {
  borderRadius: '22px',
  border: '1px solid rgba(203, 213, 225, 0.78)',
  background: 'rgba(255,255,255,0.76)',
  padding: '22px',
  minWidth: '260px',
  boxShadow: '0 16px 36px rgba(15, 23, 42, 0.08)',
} as const

const settingsLayoutStyle = {
  display: 'grid',
  gridTemplateColumns: '240px minmax(0, 1fr)',
  gap: '18px',
} as const

const tabsStyle = {
  borderRadius: '24px',
  border: '1px solid rgba(203, 213, 225, 0.76)',
  background: '#ffffff',
  boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
  alignSelf: 'start',
  display: 'grid',
  gap: '8px',
  padding: '14px',
  position: 'sticky',
  top: '18px',
} as const

const tabButtonStyle = {
  minHeight: '46px',
  borderRadius: '14px',
  border: '1px solid transparent',
  background: 'transparent',
  color: '#475569',
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: '15px',
  fontWeight: 850,
  cursor: 'pointer',
} as const

const activeTabButtonStyle = {
  background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(6,182,212,0.12))',
  borderColor: 'rgba(37, 99, 235, 0.18)',
  color: '#0f172a',
} as const

const formGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: '14px',
} as const

const miniGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: '10px',
} as const

const moduleGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '12px',
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

const workerCardStyle = {
  display: 'grid',
  gap: '12px',
  borderRadius: '18px',
  border: '1px solid #dbe4ef',
  background: '#f8fafc',
  padding: '16px',
} as const

const userRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '14px',
  borderRadius: '16px',
  border: '1px solid #dbe4ef',
  background: '#f8fafc',
  padding: '14px 16px',
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
  padding: '7px 12px',
  fontSize: '13px',
  fontWeight: 950,
} as const

const labelStyle = { color: '#64748b', fontSize: '13px', fontWeight: 900 } as const

const mutedStyle = {
  margin: 0,
  color: '#64748b',
  fontSize: '16px',
  fontWeight: 700,
  lineHeight: 1.45,
} as const
