'use client'

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { createCustomerAction } from '@/app/customers/actions'

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

type BrowserAresAddress = {
  textovaAdresa?: string | null
  nazevObce?: string | null
  castObceNazev?: string | null
  psc?: string | null
  nazevStatu?: string | null
}

type BrowserAresSubject = {
  ico?: string | null
  dic?: string | null
  obchodniJmeno?: string | null
  sidlo?: BrowserAresAddress | null
}

function mapBrowserAresPayload(subject: BrowserAresSubject, fallbackIco: string): AresLookupPayload {
  return {
    ico: subject.ico?.trim() || fallbackIco,
    dic: subject.dic?.trim() || null,
    name: subject.obchodniJmeno?.trim() || null,
    billingStreet: subject.sidlo?.textovaAdresa?.trim() || null,
    billingCity: subject.sidlo?.nazevObce?.trim() || subject.sidlo?.castObceNazev?.trim() || null,
    billingPostalCode: subject.sidlo?.psc?.trim() || null,
    billingCountry: subject.sidlo?.nazevStatu?.trim() || 'Česká republika',
  }
}

function normalizeCountry(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function isCzechBillingCountry(value: string) {
  const normalizedCountry = normalizeCountry(value)

  return (
    normalizedCountry === 'cz' ||
    normalizedCountry === 'cr' ||
    normalizedCountry === 'cesko' ||
    normalizedCountry === 'ceska republika' ||
    normalizedCountry === 'czechia' ||
    normalizedCountry === 'czech republic'
  )
}

const pageStyle: CSSProperties = {
  display: 'grid',
  gap: '18px',
  width: '100%',
  maxWidth: '980px',
  margin: '0 auto',
  padding: '2px 0 48px',
  color: '#111827',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: '16px',
  flexWrap: 'wrap',
  padding: '22px',
  borderRadius: '22px',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255,255,255,0.88)',
  boxShadow: '0 18px 44px rgba(15, 23, 42, 0.08)',
}

const eyebrowStyle: CSSProperties = {
  margin: '0 0 7px',
  color: '#2563eb',
  fontSize: '12px',
  fontWeight: 900,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const titleStyle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: '34px',
  lineHeight: 1.1,
  fontWeight: 900,
}

const backLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '40px',
  padding: '9px 14px',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.36)',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 850,
}

const formCardStyle: CSSProperties = {
  display: 'grid',
  gap: '16px',
  padding: '22px',
  borderRadius: '22px',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255,255,255,0.92)',
  boxShadow: '0 14px 34px rgba(15, 23, 42, 0.06)',
}

export default function NewCustomerPage() {
  const router = useRouter()
  const { dictionary } = useI18n()
  const [shouldContinueToCalculation, setShouldContinueToCalculation] = useState(false)

  const [companyId, setCompanyId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [billingName, setBillingName] = useState('')
  const [billingStreet, setBillingStreet] = useState('')
  const [billingCity, setBillingCity] = useState('')
  const [billingPostalCode, setBillingPostalCode] = useState('')
  const [billingCountry, setBillingCountry] = useState(dictionary.customers.countryPlaceholder)
  const [companyNumber, setCompanyNumber] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingAres, setLoadingAres] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canLoadFromAres = isCzechBillingCountry(billingCountry)

  useEffect(() => {
    setShouldContinueToCalculation(new URLSearchParams(window.location.search).get('next') === 'calculation')
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadActiveCompany() {
      try {
        const response = await fetch('/api/active-company', { cache: 'no-store' })
        const payload = (await response.json()) as { error?: string; companyId?: string | null }

        if (!response.ok || !payload.companyId) {
          if (!cancelled) {
            setError(payload.error || dictionary.customers.activeCompanyMissing)
          }
          return
        }

        if (!cancelled) {
          setCompanyId(payload.companyId)
        }
      } catch {
        if (!cancelled) {
          setError(dictionary.customers.activeCompanyMissing)
        }
      }
    }

    void loadActiveCompany()

    return () => {
      cancelled = true
    }
  }, [dictionary.customers.activeCompanyMissing])

  async function handleLoadFromAres() {
    if (loading || loadingAres) return
    if (!canLoadFromAres) return

    const normalizedCompanyNumber = companyNumber.replace(/\D/g, '')

    if (normalizedCompanyNumber.length !== 8) {
      setError(dictionary.customers.companyNumberInvalid)
      return
    }

    setError(null)
    setLoadingAres(true)

    try {
      const response = await fetch(`/api/ares?ico=${normalizedCompanyNumber}`, { cache: 'no-store' })
      const payload = (await response.json()) as AresLookupPayload

      if (!response.ok) {
        setError(payload.error || dictionary.customers.aresLoadFailed)
        setLoadingAres(false)
        return
      }

      setCompanyNumber(payload.ico ?? normalizedCompanyNumber)
      setVatNumber(payload.dic ?? '')
      setBillingName(payload.name ?? '')
      setBillingStreet(payload.billingStreet ?? '')
      setBillingCity(payload.billingCity ?? '')
      setBillingPostalCode(payload.billingPostalCode ?? '')
      setBillingCountry(payload.billingCountry ?? dictionary.customers.countryPlaceholder)

      if (!name.trim() && payload.name) {
        setName(payload.name)
      }
    } catch {
      setError(dictionary.customers.aresLoadFailed)
    } finally {
      setLoadingAres(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return
    setError(null)

    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const trimmedPhone = phone.trim()
    const trimmedBillingName = billingName.trim()
    const trimmedBillingStreet = billingStreet.trim()
    const trimmedBillingCity = billingCity.trim()
    const trimmedBillingPostalCode = billingPostalCode.trim()
    const trimmedBillingCountry = billingCountry.trim()
    const trimmedCompanyNumber = companyNumber.replace(/\D/g, '')
    const trimmedVatNumber = vatNumber.trim()

    if (!trimmedName) {
      setError(dictionary.customers.nameRequired)
      return
    }

    if (!companyId) {
      setError(dictionary.customers.activeCompanyMissing)
      return
    }

    setLoading(true)

    const result = await createCustomerAction({
      name: trimmedName,
      email: trimmedEmail,
      phone: trimmedPhone,
      billingName: trimmedBillingName,
      billingStreet: trimmedBillingStreet,
      billingCity: trimmedBillingCity,
      billingPostalCode: trimmedBillingPostalCode,
      billingCountry: trimmedBillingCountry,
      companyNumber: trimmedCompanyNumber,
      vatNumber: trimmedVatNumber,
    })

    if (!result.ok) {
      setError(result.error || dictionary.customers.errorPrefix)
      setLoading(false)
      return
    }

    router.push(shouldContinueToCalculation ? `/customers/${result.customerId}/calculations/new` : `/customers/${result.customerId}`)
    router.refresh()
  }

  return (
    <DashboardShell activeItem="customers">
      <main style={pageStyle}>
        <header style={headerStyle}>
          <div>
            <p style={eyebrowStyle}>{shouldContinueToCalculation ? dictionary.customers.calculationFlowEyebrow : dictionary.navigation.customers}</p>
            <h1 style={titleStyle}>
              {shouldContinueToCalculation ? dictionary.customers.calculationFlowTitle : dictionary.customers.newCustomerTitle}
            </h1>
            {shouldContinueToCalculation ? (
              <p style={{ margin: '10px 0 0', color: '#64748b', fontSize: '16px', lineHeight: 1.5 }}>
                {dictionary.customers.calculationFlowDescription}
              </p>
            ) : null}
          </div>
          <Link href={shouldContinueToCalculation ? '/kalkulace/nova' : '/customers'} style={backLinkStyle} aria-label={shouldContinueToCalculation ? dictionary.customers.calculationFlowBack : dictionary.customers.backToCustomers}>
            {shouldContinueToCalculation ? dictionary.customers.calculationFlowBack : dictionary.customers.backToCustomers}
          </Link>
        </header>

        <section style={formCardStyle}>
          <form className="customer-create-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
            <div>
              <label htmlFor="name" style={{ display: 'block', marginBottom: '8px', fontWeight: '700', color: '#111827' }}>{dictionary.customers.customerNameRequiredLabel}</label>
              <input id="name" type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder={dictionary.customers.customerNamePlaceholder} style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', color: '#111827', backgroundColor: '#ffffff', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label htmlFor="email" style={{ display: 'block', marginBottom: '8px', fontWeight: '700', color: '#111827' }}>{dictionary.customers.emailLabel}</label>
              <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={dictionary.customers.emailPlaceholder} style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', color: '#111827', backgroundColor: '#ffffff', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label htmlFor="phone" style={{ display: 'block', marginBottom: '8px', fontWeight: '700', color: '#111827' }}>{dictionary.customers.phoneLabel}</label>
              <input id="phone" type="text" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={dictionary.customers.phonePlaceholder} style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', color: '#111827', backgroundColor: '#ffffff', boxSizing: 'border-box' }} />
            </div>

            <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', padding: '16px', display: 'grid', gap: '16px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '22px', lineHeight: '1.2', color: '#111827' }}>{dictionary.customers.billingSectionTitle}</h2>
                <p style={{ margin: '8px 0 0 0', color: '#6b7280' }}>{dictionary.customers.billingSectionDescription}</p>
              </div>

              <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: canLoadFromAres ? 'minmax(0, 1fr) auto' : '1fr', alignItems: 'end' }}>
                <div>
                  <label htmlFor="companyNumber" style={{ display: 'block', marginBottom: '8px', fontWeight: '700', color: '#111827' }}>{dictionary.customers.companyNumber}</label>
                  <input id="companyNumber" type="text" value={companyNumber} onChange={(event) => setCompanyNumber(event.target.value)} placeholder={dictionary.customers.companyNumberPlaceholder} style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', color: '#111827', backgroundColor: '#ffffff', boxSizing: 'border-box' }} />
                </div>

                {canLoadFromAres ? (
                  <button type="button" onClick={handleLoadFromAres} disabled={loading || loadingAres} style={{ backgroundColor: '#f3f4f6', color: '#111827', border: '1px solid #d1d5db', borderRadius: '12px', padding: '12px 18px', fontSize: '14px', fontWeight: '700', cursor: loading || loadingAres ? 'default' : 'pointer', opacity: loading || loadingAres ? 0.7 : 1 }}>
                    {loadingAres ? dictionary.customers.loadingFromAres : dictionary.customers.loadFromAres}
                  </button>
                ) : null}
              </div>

              <div><label htmlFor="vatNumber" style={{ display: 'block', marginBottom: '8px', fontWeight: '700', color: '#111827' }}>{dictionary.customers.vatNumber}</label><input id="vatNumber" type="text" value={vatNumber} onChange={(event) => setVatNumber(event.target.value)} placeholder={dictionary.customers.vatNumberPlaceholder} style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', color: '#111827', backgroundColor: '#ffffff', boxSizing: 'border-box' }} /></div>
              <div><label htmlFor="billingName" style={{ display: 'block', marginBottom: '8px', fontWeight: '700', color: '#111827' }}>{dictionary.customers.billingName}</label><input id="billingName" type="text" value={billingName} onChange={(event) => setBillingName(event.target.value)} placeholder={dictionary.customers.billingNamePlaceholder} style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', color: '#111827', backgroundColor: '#ffffff', boxSizing: 'border-box' }} /></div>
              <div><label htmlFor="billingStreet" style={{ display: 'block', marginBottom: '8px', fontWeight: '700', color: '#111827' }}>{dictionary.customers.street}</label><input id="billingStreet" type="text" value={billingStreet} onChange={(event) => setBillingStreet(event.target.value)} placeholder={dictionary.customers.streetPlaceholder} style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', color: '#111827', backgroundColor: '#ffffff', boxSizing: 'border-box' }} /></div>

              <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 180px)' }}>
                <div><label htmlFor="billingCity" style={{ display: 'block', marginBottom: '8px', fontWeight: '700', color: '#111827' }}>{dictionary.customers.city}</label><input id="billingCity" type="text" value={billingCity} onChange={(event) => setBillingCity(event.target.value)} placeholder={dictionary.customers.cityPlaceholder} style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', color: '#111827', backgroundColor: '#ffffff', boxSizing: 'border-box' }} /></div>
                <div><label htmlFor="billingPostalCode" style={{ display: 'block', marginBottom: '8px', fontWeight: '700', color: '#111827' }}>{dictionary.customers.postalCode}</label><input id="billingPostalCode" type="text" value={billingPostalCode} onChange={(event) => setBillingPostalCode(event.target.value)} placeholder={dictionary.customers.postalCodePlaceholder} style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', color: '#111827', backgroundColor: '#ffffff', boxSizing: 'border-box' }} /></div>
              </div>

              <div><label htmlFor="billingCountry" style={{ display: 'block', marginBottom: '8px', fontWeight: '700', color: '#111827' }}>{dictionary.customers.country}</label><input id="billingCountry" type="text" value={billingCountry} onChange={(event) => setBillingCountry(event.target.value)} placeholder={dictionary.customers.countryPlaceholder} style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', color: '#111827', backgroundColor: '#ffffff', boxSizing: 'border-box' }} /></div>
            </section>

            {error ? <div style={{ padding: '12px 14px', borderRadius: '12px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontWeight: '600' }}>{error}</div> : null}

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
              <button type="submit" disabled={loading || !companyId} style={{ backgroundColor: '#000000', color: '#ffffff', border: 'none', borderRadius: '12px', padding: '12px 18px', fontSize: '14px', fontWeight: '700', cursor: loading || !companyId ? 'default' : 'pointer', opacity: loading || !companyId ? 0.7 : 1 }}>
                {loading
                  ? dictionary.customers.creatingCustomer
                  : shouldContinueToCalculation
                    ? dictionary.customers.calculationFlowCreate
                    : dictionary.customers.createCustomer}
              </button>

              <Link href={shouldContinueToCalculation ? '/kalkulace/nova' : '/customers'} style={{ display: 'inline-block', backgroundColor: '#f3f4f6', color: '#111827', textDecoration: 'none', border: '1px solid #d1d5db', borderRadius: '12px', padding: '12px 18px', fontSize: '14px', fontWeight: '700' }}>
                {dictionary.customers.cancel}
              </Link>
            </div>
          </form>
        </section>
      </main>
    </DashboardShell>
  )
}
