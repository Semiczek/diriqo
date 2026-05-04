'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '@/lib/supabase'

function isMissingCustomerBillingColumns(error: { message?: string | null } | null | undefined) {
  const message = error?.message ?? ''
  return (
    message.includes('billing_name') ||
    message.includes('billing_street') ||
    message.includes('billing_city') ||
    message.includes('billing_postal_code') ||
    message.includes('billing_country') ||
    message.includes('company_number') ||
    message.includes('vat_number') ||
    message.includes('ares_last_checked_at')
  )
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
    billingCountry: subject.sidlo?.nazevStatu?.trim() || 'Ceska republika',
  }
}

export default function NewCustomerPage() {
  const router = useRouter()
  const { dictionary } = useI18n()

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

    const normalizedCompanyNumber = companyNumber.replace(/\D/g, '')

    if (normalizedCompanyNumber.length !== 8) {
      setError(dictionary.customers.companyNumberInvalid)
      return
    }

    setError(null)
    setLoadingAres(true)

    try {
      let payload: AresLookupPayload | null = null

      try {
        const response = await fetch(`/api/ares?ico=${normalizedCompanyNumber}`, { cache: 'no-store' })
        const routePayload = (await response.json()) as AresLookupPayload

        if (response.ok) {
          payload = routePayload
        } else {
          throw new Error(routePayload.error || 'ARES route failed')
        }
      } catch {
        const directResponse = await fetch(
          `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${normalizedCompanyNumber}`,
          { headers: { Accept: 'application/json' }, cache: 'no-store' }
        )

        if (!directResponse.ok) {
          setError(dictionary.customers.aresLoadFailed)
          setLoadingAres(false)
          return
        }

        const directPayload = (await directResponse.json()) as BrowserAresSubject
        payload = mapBrowserAresPayload(directPayload, normalizedCompanyNumber)
      }

      if (!payload) {
        setError(dictionary.customers.aresLoadFailed)
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

    let { data, error: insertError } = await supabase
      .from('customers')
      .insert({
        company_id: companyId,
        name: trimmedName,
        email: trimmedEmail || null,
        phone: trimmedPhone || null,
        billing_name: trimmedBillingName || null,
        billing_street: trimmedBillingStreet || null,
        billing_city: trimmedBillingCity || null,
        billing_postal_code: trimmedBillingPostalCode || null,
        billing_country: trimmedBillingCountry || null,
        company_number: trimmedCompanyNumber || null,
        vat_number: trimmedVatNumber || null,
        ares_last_checked_at: trimmedCompanyNumber ? new Date().toISOString() : null,
      })
      .select('id')
      .single()

    if (insertError && isMissingCustomerBillingColumns(insertError)) {
      const fallbackResult = await supabase
        .from('customers')
        .insert({ company_id: companyId, name: trimmedName, email: trimmedEmail || null, phone: trimmedPhone || null })
        .select('id')
        .single()

      data = fallbackResult.data
      insertError = fallbackResult.error
    }

    if (insertError || !data) {
      setError(insertError?.message || dictionary.customers.errorPrefix)
      setLoading(false)
      return
    }

    router.push(`/customers/${data.id}`)
    router.refresh()
  }

  return (
    <DashboardShell activeItem="customers">
      <main style={{ maxWidth: '900px', fontFamily: 'Arial, Helvetica, sans-serif', color: '#111827' }}>
        <Link href="/customers" style={{ display: 'inline-block', marginBottom: '24px', color: '#2563eb', textDecoration: 'none', fontWeight: '600' }}>
          {dictionary.customers.backToCustomers}
        </Link>

        <section style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '16px', padding: '24px' }}>
          <h1 style={{ margin: '0 0 24px 0', fontSize: '32px', lineHeight: '1.2', color: '#111827' }}>{dictionary.customers.newCustomerTitle}</h1>

          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
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

              <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'end' }}>
                <div>
                  <label htmlFor="companyNumber" style={{ display: 'block', marginBottom: '8px', fontWeight: '700', color: '#111827' }}>{dictionary.customers.companyNumber}</label>
                  <input id="companyNumber" type="text" value={companyNumber} onChange={(event) => setCompanyNumber(event.target.value)} placeholder={dictionary.customers.companyNumberPlaceholder} style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', color: '#111827', backgroundColor: '#ffffff', boxSizing: 'border-box' }} />
                </div>

                <button type="button" onClick={handleLoadFromAres} disabled={loading || loadingAres} style={{ backgroundColor: '#f3f4f6', color: '#111827', border: '1px solid #d1d5db', borderRadius: '12px', padding: '12px 18px', fontSize: '14px', fontWeight: '700', cursor: loading || loadingAres ? 'default' : 'pointer', opacity: loading || loadingAres ? 0.7 : 1 }}>
                  {loadingAres ? dictionary.customers.loadingFromAres : dictionary.customers.loadFromAres}
                </button>
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
                {loading ? dictionary.customers.creatingCustomer : dictionary.customers.createCustomer}
              </button>

              <Link href="/customers" style={{ display: 'inline-block', backgroundColor: '#f3f4f6', color: '#111827', textDecoration: 'none', border: '1px solid #d1d5db', borderRadius: '12px', padding: '12px 18px', fontSize: '14px', fontWeight: '700' }}>
                {dictionary.customers.cancel}
              </Link>
            </div>
          </form>
        </section>
      </main>
    </DashboardShell>
  )
}
