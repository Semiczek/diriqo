'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import DashboardShell from '@/components/DashboardShell'
import { getCompanyRoleLabel } from '@/lib/hub-access'
import { supabase } from '@/lib/supabase'
import { getAdvanceFrequencyLabel, getPayrollTypeLabel } from '@/lib/payroll-settings'
import { updateAccountPayrollSettingsAction } from './actions'

type AccountContext = {
  companyId?: string
  companyName?: string | null
  profileId?: string
  profileName?: string | null
  profileEmail?: string | null
  role?: string | null
  companyMemberships?: CompanyMembership[]
}

type CompanyMembership = {
  id?: string | null
  companyId: string
  companyName?: string | null
  role?: string | null
  isActive?: boolean
}

type CompanyBilling = {
  companyId?: string
  name?: string | null
  billingName?: string | null
  companyNumber?: string | null
  vatNumber?: string | null
  billingStreet?: string | null
  billingCity?: string | null
  billingPostalCode?: string | null
  billingCountry?: string | null
  bankAccountNumber?: string | null
  bankCode?: string | null
  iban?: string | null
  swiftBic?: string | null
  aresLastCheckedAt?: string | null
}

type AresLookupPayload = {
  error?: string
  ico?: string | null
  dic?: string | null
  name?: string | null
  billingStreet?: string | null
  billingCity?: string | null
  billingPostalCode?: string | null
  billingCountry?: string | null
}

function formatRole(role: string | null | undefined) {
  return getCompanyRoleLabel(role)
}

function DetailItem({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div
      style={{
        borderRadius: '18px',
        border: '1px solid rgba(148, 163, 184, 0.22)',
        background: 'linear-gradient(135deg, rgba(248,250,252,0.95), rgba(239,246,255,0.72))',
        padding: '14px',
        display: 'grid',
        gap: '6px',
        minWidth: 0,
      }}
    >
      <span style={{ color: '#6b7280', fontSize: '12px', fontWeight: 700 }}>
        {label}
      </span>
      <strong
        style={{
          color: '#111827',
          fontSize: '15px',
          lineHeight: 1.35,
          overflowWrap: 'anywhere',
        }}
      >
        {value?.trim() || 'Není dostupné'}
      </strong>
    </div>
  )
}

function CompanyMembershipRow({ membership }: { membership: CompanyMembership }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(120px, auto) minmax(86px, auto)',
        gap: '12px',
        alignItems: 'center',
        borderRadius: '18px',
        border: membership.isActive ? '1px solid rgba(34, 197, 94, 0.35)' : '1px solid rgba(148, 163, 184, 0.22)',
        background: membership.isActive
          ? 'linear-gradient(135deg, rgba(240,253,244,0.98), rgba(236,253,245,0.72))'
          : 'linear-gradient(135deg, rgba(248,250,252,0.95), rgba(239,246,255,0.62))',
        padding: '14px',
      }}
    >
      <div style={{ display: 'grid', gap: '4px', minWidth: 0 }}>
        <strong style={{ overflowWrap: 'anywhere' }}>
          {membership.companyName?.trim() || 'Firma bez názvu'}
        </strong>
        <span style={{ color: '#6b7280', fontSize: '12px', overflowWrap: 'anywhere' }}>
          {membership.companyId}
        </span>
      </div>
      <div style={{ color: '#111827', fontWeight: 700 }}>
        {formatRole(membership.role)}
      </div>
      <div
        style={{
          justifySelf: 'end',
          borderRadius: '999px',
          border: membership.isActive ? '1px solid #86efac' : '1px solid #d1d5db',
          backgroundColor: membership.isActive ? '#dcfce7' : '#ffffff',
          color: membership.isActive ? '#166534' : '#6b7280',
          padding: '6px 10px',
          fontSize: '12px',
          fontWeight: 800,
          whiteSpace: 'nowrap',
        }}
      >
        {membership.isActive ? 'Aktivní' : 'Přiřazeno'}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '46px',
  borderRadius: '14px',
  border: '1px solid #d1d5db',
  padding: '0 14px',
  fontSize: '14px',
  boxSizing: 'border-box',
  backgroundColor: '#ffffff',
  color: '#111827',
}

const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: '8px',
  fontWeight: 700,
}

type CompanyPayrollSettings = {
  company_id?: string | null
  payroll_type: string
  payroll_day_of_month: number | null
  payroll_weekday: number | null
  payroll_anchor_date: string | null
  allow_advances: boolean
  advance_limit_amount: number | null
  advance_frequency: string | null
}

const profileBadge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '7px 10px',
  borderRadius: '999px',
  backgroundColor: 'rgba(255, 255, 255, 0.72)',
  border: '1px solid rgba(203, 213, 225, 0.9)',
  color: '#334155',
  fontSize: '13px',
  fontWeight: 850,
}

function normalizeIco(value: string) {
  return value.replace(/\D/g, '')
}

async function readJsonResponse<T>(response: Response): Promise<T & { error?: string }> {
  const text = await response.text()

  if (!text.trim()) {
    return {
      error: response.ok ? undefined : `Server vrátil prázdnou odpověď (${response.status}).`,
    } as T & { error?: string }
  }

  try {
    return JSON.parse(text) as T & { error?: string }
  } catch {
    return {
      error: `Server nevrátil platný JSON (${response.status}): ${text.slice(0, 180)}`,
    } as T & { error?: string }
  }
}

export default function AccountPage() {
  const [email, setEmail] = useState<string | null>(null)
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [accountContext, setAccountContext] = useState<AccountContext | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [billingName, setBillingName] = useState('')
  const [companyNumber, setCompanyNumber] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [billingStreet, setBillingStreet] = useState('')
  const [billingCity, setBillingCity] = useState('')
  const [billingPostalCode, setBillingPostalCode] = useState('')
  const [billingCountry, setBillingCountry] = useState('Česká republika')
  const [bankAccountNumber, setBankAccountNumber] = useState('')
  const [bankCode, setBankCode] = useState('')
  const [iban, setIban] = useState('')
  const [swiftBic, setSwiftBic] = useState('')
  const [payrollType, setPayrollType] = useState('monthly')
  const [payrollDayOfMonth, setPayrollDayOfMonth] = useState('18')
  const [payrollWeekday, setPayrollWeekday] = useState('1')
  const [payrollAnchorDate, setPayrollAnchorDate] = useState('')
  const [allowAdvances, setAllowAdvances] = useState(true)
  const [advanceLimitAmount, setAdvanceLimitAmount] = useState('')
  const [advanceFrequency, setAdvanceFrequency] = useState('monthly')
  const [aresLastCheckedAt, setAresLastCheckedAt] = useState<string | null>(null)
  const [aresLoadedThisEdit, setAresLoadedThisEdit] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [loadingUser, setLoadingUser] = useState(true)
  const [loadingAres, setLoadingAres] = useState(false)
  const [savingBilling, setSavingBilling] = useState(false)
  const [savingPayrollSettings, setSavingPayrollSettings] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [billingMessage, setBillingMessage] = useState<string | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [payrollSettingsMessage, setPayrollSettingsMessage] = useState<string | null>(null)
  const [payrollSettingsError, setPayrollSettingsError] = useState<string | null>(null)
  const profileDisplayName =
    accountContext?.profileName?.trim() || email?.split('@')[0] || 'Uživatel Diriqo'
  const profileDisplayEmail = email || accountContext?.profileEmail || 'E-mail není dostupný'
  const profileInitials = profileDisplayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'DU'

  function applyCompanyBilling(payload: CompanyBilling) {
    setCompanyName(payload.name ?? '')
    setBillingName(payload.billingName ?? '')
    setCompanyNumber(payload.companyNumber ?? '')
    setVatNumber(payload.vatNumber ?? '')
    setBillingStreet(payload.billingStreet ?? '')
    setBillingCity(payload.billingCity ?? '')
    setBillingPostalCode(payload.billingPostalCode ?? '')
    setBillingCountry(payload.billingCountry ?? 'Česká republika')
    setBankAccountNumber(payload.bankAccountNumber ?? '')
    setBankCode(payload.bankCode ?? '')
    setIban(payload.iban ?? '')
    setSwiftBic(payload.swiftBic ?? '')
    setAresLastCheckedAt(payload.aresLastCheckedAt ?? null)
    setAresLoadedThisEdit(false)
  }

  function applyPayrollSettings(payload: Partial<CompanyPayrollSettings> | null) {
    setPayrollType(payload?.payroll_type ?? 'monthly')
    setPayrollDayOfMonth(payload?.payroll_day_of_month != null ? String(payload.payroll_day_of_month) : '18')
    setPayrollWeekday(payload?.payroll_weekday != null ? String(payload.payroll_weekday) : '1')
    setPayrollAnchorDate(payload?.payroll_anchor_date ?? '')
    setAllowAdvances(payload?.allow_advances ?? true)
    setAdvanceLimitAmount(payload?.advance_limit_amount != null ? String(payload.advance_limit_amount) : '')
    setAdvanceFrequency(payload?.advance_frequency ?? 'monthly')
  }

  useEffect(() => {
    let active = true

    async function loadUser() {
      try {
        const [userResponse, activeCompanyResponse, companyBillingResponse] = await Promise.all([
          supabase.auth.getUser(),
          fetch('/api/active-company', { cache: 'no-store' }),
          fetch('/api/company-billing', { cache: 'no-store' }),
        ])

        if (!active) return

        if (userResponse.error) {
          setError(userResponse.error.message || 'Nepodařilo se načíst účet.')
        } else {
          setEmail(userResponse.data.user?.email ?? null)
          setAuthUserId(userResponse.data.user?.id ?? null)
        }

        if (activeCompanyResponse.ok) {
          const payload = (await activeCompanyResponse.json()) as AccountContext

          setAccountContext(payload)

          if (payload.companyId) {
            const payrollSettingsResponse = await supabase
              .from('company_payroll_settings')
              .select('company_id, payroll_type, payroll_day_of_month, payroll_weekday, payroll_anchor_date, allow_advances, advance_limit_amount, advance_frequency')
              .eq('company_id', payload.companyId)
              .maybeSingle()

            if (!payrollSettingsResponse.error) {
              applyPayrollSettings(payrollSettingsResponse.data as CompanyPayrollSettings | null)
            }
          }
        }

        if (companyBillingResponse.ok) {
          const payload = (await companyBillingResponse.json()) as CompanyBilling

          applyCompanyBilling(payload)
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Nepodařilo se načíst účet.')
        }
      } finally {
        if (active) {
          setLoadingUser(false)
        }
      }
    }

    void loadUser()

    return () => {
      active = false
    }
  }, [])

  async function handleLoadCompanyFromAres() {
    if (loadingAres || savingBilling) return

    const normalizedCompanyNumber = normalizeIco(companyNumber)

    if (normalizedCompanyNumber.length !== 8) {
      setBillingError('IČO musí mít 8 číslic.')
      return
    }

    setBillingError(null)
    setBillingMessage(null)
    setLoadingAres(true)

    try {
      const response = await fetch(`/api/ares?ico=${normalizedCompanyNumber}`, { cache: 'no-store' })
      const payload = await readJsonResponse<AresLookupPayload>(response)

      if (!response.ok) {
        throw new Error(payload.error || 'Nepodařilo se načíst data z ARES.')
      }

      setCompanyNumber(payload.ico ?? normalizedCompanyNumber)
      setVatNumber(payload.dic ?? '')
      setCompanyName(payload.name ?? companyName)
      setBillingName(payload.name ?? billingName)
      setBillingStreet(payload.billingStreet ?? '')
      setBillingCity(payload.billingCity ?? '')
      setBillingPostalCode(payload.billingPostalCode ?? '')
      setBillingCountry(payload.billingCountry ?? 'Česká republika')
      setAresLoadedThisEdit(true)
      setBillingMessage('Údaje z ARES byly načtené. Zkontrolujte je a uložte.')
    } catch (lookupError) {
      setBillingError(
        lookupError instanceof Error ? lookupError.message : 'Nepodařilo se načíst data z ARES.'
      )
    } finally {
      setLoadingAres(false)
    }
  }

  async function handleBillingSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingBilling) return

    const normalizedCompanyNumber = normalizeIco(companyNumber)

    if (!companyName.trim()) {
      setBillingError('Název firmy je povinný.')
      return
    }

    if (normalizedCompanyNumber && normalizedCompanyNumber.length !== 8) {
      setBillingError('IČO musí mít 8 číslic.')
      return
    }

    setSavingBilling(true)
    setBillingError(null)
    setBillingMessage(null)

    try {
      const response = await fetch('/api/company-billing', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: companyName,
          billingName,
          companyNumber: normalizedCompanyNumber,
          vatNumber,
          billingStreet,
          billingCity,
          billingPostalCode,
          billingCountry,
          bankAccountNumber,
          bankCode,
          iban: iban.trim() || null,
          swiftBic: swiftBic.trim() || null,
          aresLoaded: aresLoadedThisEdit,
        }),
      })
      const payload = await readJsonResponse<CompanyBilling>(response)

      if (!response.ok) {
        throw new Error(payload.error || 'Nepodařilo se uložit fakturační údaje.')
      }

      applyCompanyBilling(payload)
      setBillingMessage('Fakturační údaje firmy byly uložené.')
    } catch (saveError) {
      setBillingError(
        saveError instanceof Error ? saveError.message : 'Nepodařilo se uložit fakturační údaje.'
      )
    } finally {
      setSavingBilling(false)
    }
  }

  async function handlePayrollSettingsSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingPayrollSettings || !accountContext?.companyId) return

    const dayOfMonth = payrollDayOfMonth ? Number(payrollDayOfMonth) : null
    const weekday = payrollWeekday ? Number(payrollWeekday) : null
    const advanceLimit = advanceLimitAmount ? Number(advanceLimitAmount.replace(',', '.')) : null

    if ((dayOfMonth != null && (!Number.isFinite(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) ||
      (weekday != null && (!Number.isFinite(weekday) || weekday < 1 || weekday > 7)) ||
      (advanceLimit != null && (!Number.isFinite(advanceLimit) || advanceLimit < 0))) {
      setPayrollSettingsError('Zkontrolujte den výplaty a limit záloh.')
      return
    }

    setSavingPayrollSettings(true)
    setPayrollSettingsError(null)
    setPayrollSettingsMessage(null)

    const updateResponse = await updateAccountPayrollSettingsAction({
      companyId: accountContext.companyId,
      payrollType,
      payrollDayOfMonth: dayOfMonth,
      payrollWeekday: weekday,
      payrollAnchorDate,
      allowAdvances,
      advanceLimitAmount: advanceLimit,
      advanceFrequency,
    })
    const upsertError = { message: updateResponse.ok ? '' : updateResponse.error }

    if (!updateResponse.ok) {
      setPayrollSettingsError(upsertError.message || 'Nepodařilo se uložit výplatní nastavení.')
      setSavingPayrollSettings(false)
      return
    }

    applyPayrollSettings(updateResponse.settings as CompanyPayrollSettings)
    setPayrollSettingsMessage('Firemní nastavení výplat bylo uložené.')
    setSavingPayrollSettings(false)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)

    if (password.length < 8) {
      setError('Nové heslo musí mít alespoň 8 znaků.')
      setSaving(false)
      return
    }

    if (password !== passwordConfirm) {
      setError('Hesla se neshodují.')
      setSaving(false)
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message || 'Nepodařilo se změnit heslo.')
      setSaving(false)
      return
    }

    setPassword('')
    setPasswordConfirm('')
    setMessage('Heslo bylo úspěšně změněno.')
    setSaving(false)
  }

  return (
    <DashboardShell activeItem="account">
      <div style={{ display: 'grid', gap: '12px' }}>
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            gap: '14px',
            alignItems: 'center',
            borderRadius: '20px',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            background:
              'radial-gradient(circle at 6% 10%, rgba(124, 58, 237, 0.16), transparent 28%), radial-gradient(circle at 100% 0%, rgba(6, 182, 212, 0.18), transparent 28%), linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(239,246,255,0.92) 55%, rgba(240,253,250,0.9) 100%)',
            padding: '18px 20px',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.065)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: '54px',
              height: '54px',
              borderRadius: '18px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #14b8a6 100%)',
              color: '#ffffff',
              fontSize: '18px',
              fontWeight: 950,
              boxShadow: '0 10px 22px rgba(37, 99, 235, 0.16)',
            }}
          >
            {profileInitials}
          </div>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '999px',
                padding: '4px 9px',
                marginBottom: '8px',
                background: 'rgba(124, 58, 237, 0.1)',
                border: '1px solid rgba(124, 58, 237, 0.2)',
                color: '#5b21b6',
                fontSize: '11px',
                fontWeight: 850,
                letterSpacing: '0.02em',
              }}
            >
              Účet a firma
            </div>
            <h1 style={{ margin: 0, color: '#020617', fontSize: '32px', lineHeight: 1.08 }}>
              Můj účet
            </h1>
            <p style={{ margin: '7px 0 10px', color: '#475569', fontSize: '14px', lineHeight: 1.45 }}>
              Přihlášení, aktivní firma a role v systému.
            </p>
            <h2 style={{ margin: 0, color: '#0f172a', fontSize: '26px', lineHeight: 1.15 }}>
              {loadingUser ? 'Načítám profil...' : profileDisplayName}
            </h2>
            <p style={{ margin: '6px 0 14px', color: '#64748b', overflowWrap: 'anywhere' }}>
              {loadingUser ? 'Načítám e-mail...' : profileDisplayEmail}
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={profileBadge}>Role: {loadingUser ? 'Načítám...' : formatRole(accountContext?.role)}</span>
              <span style={profileBadge}>
                Firma: {loadingUser ? 'Načítám...' : accountContext?.companyName || 'Není vybraná'}
              </span>
            </div>
          </div>
        </section>

        <div style={{ display: 'none' }}>
          <Link href="/" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 700 }}>
            ← Zpět na dashboard
          </Link>
          <h1 style={{ margin: '18px 0 8px 0', fontSize: '34px', lineHeight: 1.1 }}>Můj účet</h1>
          <p style={{ margin: 0, color: '#6b7280', lineHeight: 1.6 }}>
            Přehled přihlášeného účtu, aktivní firmy a bezpečnostní nastavení.
          </p>
        </div>

        <section
          style={{
            borderRadius: '24px',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            background: 'rgba(255, 255, 255, 0.9)',
            padding: '24px',
            boxShadow: '0 18px 44px rgba(15, 23, 42, 0.06)',
          }}
        >
          <div style={{ marginBottom: '18px' }}>
            <h2 style={{ margin: 0, fontSize: '22px' }}>Přihlášení a firma</h2>
            <p style={{ margin: '8px 0 0 0', color: '#6b7280', lineHeight: 1.6 }}>
              Tyto údaje určují, pod jakým účtem a v jaké firmě právě pracujete.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px',
            }}
          >
            <DetailItem
              label="Přihlášený e-mail"
              value={loadingUser ? 'Načítám...' : email || accountContext?.profileEmail}
            />
            <DetailItem
              label="Profil"
              value={loadingUser ? 'Načítám...' : accountContext?.profileName}
            />
            <DetailItem
              label="Aktivní firma"
              value={loadingUser ? 'Načítám...' : accountContext?.companyName}
            />
            <DetailItem
              label="Role ve firmě"
              value={loadingUser ? 'Načítám...' : formatRole(accountContext?.role)}
            />
          </div>

          <details
            style={{
              marginTop: '14px',
              borderRadius: '14px',
              border: '1px solid #e5e7eb',
              backgroundColor: '#f8fafc',
              padding: '12px 14px',
            }}
          >
            <summary style={{ cursor: 'pointer', color: '#475569', fontWeight: 800 }}>
              Technické informace
            </summary>
            <div style={{ display: 'grid', gap: '8px', marginTop: '12px', color: '#64748b', fontSize: '12px' }}>
              <div style={{ overflowWrap: 'anywhere' }}>Profile ID: {loadingUser ? 'Načítám...' : accountContext?.profileId || 'Není dostupné'}</div>
              <div style={{ overflowWrap: 'anywhere' }}>Auth user ID: {loadingUser ? 'Načítám...' : authUserId || 'Není dostupné'}</div>
              <div style={{ overflowWrap: 'anywhere' }}>Company ID: {loadingUser ? 'Načítám...' : accountContext?.companyId || 'Není dostupné'}</div>
            </div>
          </details>
        </section>

        <section
          style={{
            borderRadius: '24px',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            background: 'rgba(255, 255, 255, 0.9)',
            padding: '24px',
            boxShadow: '0 18px 44px rgba(15, 23, 42, 0.06)',
          }}
        >
          <div style={{ marginBottom: '18px' }}>
            <h2 style={{ margin: 0, fontSize: '22px' }}>Firemní nastavení výplat</h2>
            <p style={{ margin: '8px 0 0 0', color: '#6b7280', lineHeight: 1.6 }}>
              Výchozí pravidla pro interní pracovníky. Externí pracovníci a subdodavatelé tento výplatní režim nepoužívají.
            </p>
          </div>

          <form onSubmit={handlePayrollSettingsSubmit} style={{ display: 'grid', gap: '16px' }}>
            <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label style={labelStyle}>
                <span>Typ výplaty</span>
                <select value={payrollType} onChange={(event) => setPayrollType(event.target.value)} style={inputStyle}>
                  <option value="shift">Po směně</option>
                  <option value="weekly">Týdně</option>
                  <option value="biweekly">Jednou za 14 dní</option>
                  <option value="monthly">Měsíčně</option>
                </select>
              </label>

              {payrollType === 'monthly' ? (
                <label style={labelStyle}>
                  <span>Den v měsíci</span>
                  <input type="number" min="1" max="31" value={payrollDayOfMonth} onChange={(event) => setPayrollDayOfMonth(event.target.value)} style={inputStyle} />
                </label>
              ) : null}

              {payrollType === 'weekly' || payrollType === 'biweekly' ? (
                <label style={labelStyle}>
                  <span>Den v týdnu</span>
                  <select value={payrollWeekday} onChange={(event) => setPayrollWeekday(event.target.value)} style={inputStyle}>
                    <option value="1">Pondělí</option>
                    <option value="2">Úterý</option>
                    <option value="3">Středa</option>
                    <option value="4">Čtvrtek</option>
                    <option value="5">Pátek</option>
                    <option value="6">Sobota</option>
                    <option value="7">Neděle</option>
                  </select>
                </label>
              ) : null}

              {payrollType === 'biweekly' ? (
                <label style={labelStyle}>
                  <span>Začátek 14denního cyklu</span>
                  <input type="date" value={payrollAnchorDate} onChange={(event) => setPayrollAnchorDate(event.target.value)} style={inputStyle} />
                </label>
              ) : null}
            </div>

            <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input type="checkbox" checked={allowAdvances} onChange={(event) => setAllowAdvances(event.target.checked)} />
                <span>Povolit zálohy interním pracovníkům</span>
              </label>

              <label style={labelStyle}>
                <span>Limit záloh</span>
                <input value={advanceLimitAmount} onChange={(event) => setAdvanceLimitAmount(event.target.value)} inputMode="decimal" placeholder="Bez limitu" style={inputStyle} />
              </label>

              <label style={labelStyle}>
                <span>Frekvence záloh</span>
                <select value={advanceFrequency} onChange={(event) => setAdvanceFrequency(event.target.value)} style={inputStyle}>
                  <option value="anytime">Kdykoliv</option>
                  <option value="weekly">Týdně</option>
                  <option value="monthly">Měsíčně</option>
                </select>
              </label>
            </div>

            <div style={{ color: '#64748b', fontSize: '13px', fontWeight: 700 }}>
              Aktuálně: {getPayrollTypeLabel(payrollType)}, zálohy {allowAdvances ? 'povoleny' : 'nepovoleny'}, frekvence {getAdvanceFrequencyLabel(advanceFrequency)}.
            </div>

            {payrollSettingsMessage ? (
              <div style={{ borderRadius: '8px', border: '1px solid #bbf7d0', backgroundColor: '#f0fdf4', color: '#166534', padding: '12px 14px' }}>
                {payrollSettingsMessage}
              </div>
            ) : null}

            {payrollSettingsError ? (
              <div style={{ borderRadius: '8px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', padding: '12px 14px' }}>
                {payrollSettingsError}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={savingPayrollSettings || loadingUser || !accountContext?.companyId}
              style={{
                width: 'fit-content',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: savingPayrollSettings || loadingUser ? '#374151' : '#111827',
                color: '#ffffff',
                padding: '12px 18px',
                fontWeight: 800,
                cursor: savingPayrollSettings || loadingUser ? 'default' : 'pointer',
              }}
            >
              {savingPayrollSettings ? 'Ukládám nastavení...' : 'Uložit výplatní nastavení'}
            </button>
          </form>
        </section>

        <section
          style={{
            borderRadius: '24px',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            background: 'rgba(255, 255, 255, 0.9)',
            padding: '24px',
            boxShadow: '0 18px 44px rgba(15, 23, 42, 0.06)',
          }}
        >
          <div style={{ marginBottom: '18px' }}>
            <h2 style={{ margin: 0, fontSize: '22px' }}>Napojení na firmy</h2>
            <p style={{ margin: '8px 0 0 0', color: '#6b7280', lineHeight: 1.6 }}>
              Seznam firem, ve kterých má tento profil aktivní přístup.
            </p>
          </div>

          <div style={{ display: 'grid', gap: '10px' }}>
            {loadingUser ? (
              <div
                style={{
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  backgroundColor: '#f9fafb',
                  padding: '14px',
                  color: '#6b7280',
                  fontWeight: 700,
                }}
              >
                Načítám firmy...
              </div>
            ) : accountContext?.companyMemberships?.length ? (
              accountContext.companyMemberships.map((membership) => (
                <CompanyMembershipRow
                  key={`${membership.companyId}-${membership.id ?? 'membership'}`}
                  membership={membership}
                />
              ))
            ) : (
              <div
                style={{
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  backgroundColor: '#f9fafb',
                  padding: '14px',
                  color: '#6b7280',
                  fontWeight: 700,
                }}
              >
                Další firmy nejsou přiřazené.
              </div>
            )}
          </div>
        </section>

        <section
          style={{
            borderRadius: '24px',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            background: 'rgba(255, 255, 255, 0.9)',
            padding: '24px',
            boxShadow: '0 18px 44px rgba(15, 23, 42, 0.06)',
          }}
        >
          <div style={{ marginBottom: '18px' }}>
            <h2 style={{ margin: 0, fontSize: '22px' }}>Fakturační údaje aktivní firmy</h2>
            <p style={{ margin: '8px 0 0 0', color: '#6b7280', lineHeight: 1.6 }}>
              Tyto údaje se použijí pro fakturaci firmy, pod kterou jste právě přihlášení.
            </p>
          </div>

          <form onSubmit={handleBillingSubmit} style={{ display: 'grid', gap: '16px' }}>
            <label style={labelStyle}>
              <span>Název firmy</span>
              <input
                type="text"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                required
                style={inputStyle}
              />
            </label>

            <div
              style={{
                display: 'grid',
                gap: '12px',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                alignItems: 'end',
              }}
            >
              <label style={labelStyle}>
                <span>IČO</span>
                <input
                  type="text"
                  value={companyNumber}
                  onChange={(event) => {
                    setCompanyNumber(event.target.value)
                    setAresLoadedThisEdit(false)
                  }}
                  placeholder="12345678"
                  style={inputStyle}
                />
              </label>

              <button
                type="button"
                onClick={handleLoadCompanyFromAres}
                disabled={loadingAres || savingBilling}
                style={{
                  height: '46px',
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  backgroundColor: '#f3f4f6',
                  color: '#111827',
                  padding: '0 16px',
                  fontWeight: 800,
                  cursor: loadingAres || savingBilling ? 'default' : 'pointer',
                  opacity: loadingAres || savingBilling ? 0.7 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {loadingAres ? 'Načítám z ARES...' : 'Načíst z ARES'}
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gap: '12px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <label style={labelStyle}>
                <span>Fakturační název</span>
                <input
                  type="text"
                  value={billingName}
                  onChange={(event) => setBillingName(event.target.value)}
                  style={inputStyle}
                />
              </label>

              <label style={labelStyle}>
                <span>DIČ</span>
                <input
                  type="text"
                  value={vatNumber}
                  onChange={(event) => setVatNumber(event.target.value)}
                  placeholder="CZ12345678"
                  style={inputStyle}
                />
              </label>
            </div>

            <label style={labelStyle}>
              <span>Ulice a číslo</span>
              <input
                type="text"
                value={billingStreet}
                onChange={(event) => setBillingStreet(event.target.value)}
                style={inputStyle}
              />
            </label>

            <div
              style={{
                display: 'grid',
                gap: '12px',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(150px, 220px)',
              }}
            >
              <label style={labelStyle}>
                <span>Město</span>
                <input
                  type="text"
                  value={billingCity}
                  onChange={(event) => setBillingCity(event.target.value)}
                  style={inputStyle}
                />
              </label>

              <label style={labelStyle}>
                <span>PSČ</span>
                <input
                  type="text"
                  value={billingPostalCode}
                  onChange={(event) => setBillingPostalCode(event.target.value)}
                  style={inputStyle}
                />
              </label>
            </div>

            <label style={labelStyle}>
              <span>Stát</span>
              <input
                type="text"
                value={billingCountry}
                onChange={(event) => setBillingCountry(event.target.value)}
                style={inputStyle}
              />
            </label>

            <div
              style={{
                display: 'grid',
                gap: '12px',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(120px, 180px)',
              }}
            >
              <label style={labelStyle}>
                <span>Číslo účtu</span>
                <input
                  type="text"
                  value={bankAccountNumber}
                  onChange={(event) => setBankAccountNumber(event.target.value)}
                  placeholder="123456789"
                  style={inputStyle}
                />
              </label>

              <label style={labelStyle}>
                <span>Kód banky</span>
                <input
                  type="text"
                  value={bankCode}
                  onChange={(event) => setBankCode(event.target.value)}
                  placeholder="0100"
                  style={inputStyle}
                />
              </label>
            </div>

            <div
              style={{
                display: 'grid',
                gap: '12px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <label style={labelStyle}>
                <span>IBAN (volitelné)</span>
                <input
                  type="text"
                  value={iban}
                  onChange={(event) => setIban(event.target.value)}
                  style={inputStyle}
                />
              </label>

              <label style={labelStyle}>
                <span>SWIFT/BIC (volitelné)</span>
                <input
                  type="text"
                  value={swiftBic}
                  onChange={(event) => setSwiftBic(event.target.value)}
                  style={inputStyle}
                />
              </label>
            </div>

            {aresLastCheckedAt ? (
              <div style={{ color: '#6b7280', fontSize: '13px', fontWeight: 700 }}>
                ARES naposledy: {new Date(aresLastCheckedAt).toLocaleString('cs-CZ')}
              </div>
            ) : null}

            {billingMessage ? (
              <div
                style={{
                  borderRadius: '8px',
                  border: '1px solid #bbf7d0',
                  backgroundColor: '#f0fdf4',
                  color: '#166534',
                  padding: '12px 14px',
                }}
              >
                {billingMessage}
              </div>
            ) : null}

            {billingError ? (
              <div
                style={{
                  borderRadius: '8px',
                  border: '1px solid #fecaca',
                  backgroundColor: '#fef2f2',
                  color: '#991b1b',
                  padding: '12px 14px',
                }}
              >
                {billingError}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={savingBilling || loadingUser}
              style={{
                width: 'fit-content',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: savingBilling || loadingUser ? '#374151' : '#111827',
                color: '#ffffff',
                padding: '12px 18px',
                fontWeight: 800,
                cursor: savingBilling || loadingUser ? 'default' : 'pointer',
              }}
            >
              {savingBilling ? 'Ukládám fakturační údaje...' : 'Uložit fakturační údaje'}
            </button>
          </form>
        </section>

        <section
          style={{
            borderRadius: '24px',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            background: 'rgba(255, 255, 255, 0.9)',
            padding: '24px',
            maxWidth: '640px',
            boxShadow: '0 18px 44px rgba(15, 23, 42, 0.06)',
          }}
        >
          <div style={{ marginBottom: '18px' }}>
            <h2 style={{ margin: 0, fontSize: '22px' }}>Změna hesla</h2>
            <p style={{ margin: '8px 0 0 0', color: '#6b7280', lineHeight: 1.6 }}>
              Nové heslo se uloží k aktuálně přihlášenému účtu.
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>Nové heslo</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
                style={{
                  height: '46px',
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  padding: '0 14px',
                  fontSize: '14px',
                }}
              />
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>Potvrzení nového hesla</span>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                autoComplete="new-password"
                required
                style={{
                  height: '46px',
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  padding: '0 14px',
                  fontSize: '14px',
                }}
              />
            </label>

            {message ? (
              <div
                style={{
                  borderRadius: '8px',
                  border: '1px solid #bbf7d0',
                  backgroundColor: '#f0fdf4',
                  color: '#166534',
                  padding: '12px 14px',
                }}
              >
                {message}
              </div>
            ) : null}

            {error ? (
              <div
                style={{
                  borderRadius: '8px',
                  border: '1px solid #fecaca',
                  backgroundColor: '#fef2f2',
                  color: '#991b1b',
                  padding: '12px 14px',
                }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              style={{
                width: 'fit-content',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: saving ? '#374151' : '#111827',
                color: '#ffffff',
                padding: '12px 18px',
                fontWeight: 700,
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              {saving ? 'Ukládám heslo...' : 'Změnit heslo'}
            </button>
          </form>
        </section>
      </div>
    </DashboardShell>
  )
}
