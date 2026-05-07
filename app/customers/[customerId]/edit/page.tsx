'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import {
  errorStateStyle,
  eyebrowStyle,
  heroCardStyle,
  heroContentStyle,
  heroTextStyle,
  heroTitleStyle,
  inputStyle,
  pageShellStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionCardStyle,
} from '@/components/SaasPageLayout'
import { supabase } from '@/lib/supabase'

type Customer = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  billing_name: string | null
  billing_street: string | null
  billing_city: string | null
  billing_postal_code: string | null
  billing_country: string | null
  company_number: string | null
  vat_number: string | null
}

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

export default function EditCustomerPage() {
  const router = useRouter()
  const params = useParams()
  const { dictionary } = useI18n()
  const customerId = params.customerId as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [billingName, setBillingName] = useState('')
  const [billingStreet, setBillingStreet] = useState('')
  const [billingCity, setBillingCity] = useState('')
  const [billingPostalCode, setBillingPostalCode] = useState('')
  const [billingCountry, setBillingCountry] = useState('Ceska republika')
  const [companyNumber, setCompanyNumber] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [loadingAres, setLoadingAres] = useState(false)

  useEffect(() => {
    async function loadCustomer() {
      setLoading(true)
      setError(null)

      let { data, error } = await supabase
        .from('customers')
        .select(
          'id, name, email, phone, billing_name, billing_street, billing_city, billing_postal_code, billing_country, company_number, vat_number'
        )
        .eq('id', customerId)
        .single()

      if (error && isMissingCustomerBillingColumns(error)) {
        const fallbackResult = await supabase
          .from('customers')
          .select('id, name, email, phone')
          .eq('id', customerId)
          .single()

        data = (fallbackResult.data
          ? {
              ...fallbackResult.data,
              billing_name: null,
              billing_street: null,
              billing_city: null,
              billing_postal_code: null,
              billing_country: null,
              company_number: null,
              vat_number: null,
            }
          : null) as Customer | null
        error = fallbackResult.error
      }

      if (error || !data) {
        setError(dictionary.customers.customerEdit.loadFailed)
        setLoading(false)
        return
      }

      const customer = data as Customer

      setName(customer.name ?? '')
      setEmail(customer.email ?? '')
      setPhone(customer.phone ?? '')
      setBillingName(customer.billing_name ?? '')
      setBillingStreet(customer.billing_street ?? '')
      setBillingCity(customer.billing_city ?? '')
      setBillingPostalCode(customer.billing_postal_code ?? '')
      setBillingCountry(customer.billing_country ?? 'Ceska republika')
      setCompanyNumber(customer.company_number ?? '')
      setVatNumber(customer.vat_number ?? '')
      setLoading(false)
    }

    if (customerId) {
      void loadCustomer()
    }
  }, [customerId, dictionary.customers.customerEdit.loadFailed])

  async function handleLoadFromAres() {
    if (saving || loadingAres) return

    const normalizedCompanyNumber = companyNumber.replace(/\D/g, '')

    if (normalizedCompanyNumber.length !== 8) {
      setError(dictionary.customers.customerEdit.invalidCompanyNumber)
      return
    }

    setError(null)
    setLoadingAres(true)

    try {
      let payload: AresLookupPayload | null = null

      try {
        const response = await fetch(`/api/ares?ico=${normalizedCompanyNumber}`, {
          cache: 'no-store',
        })
        const routePayload = (await response.json()) as AresLookupPayload

        if (response.ok) {
          payload = routePayload
        } else {
          throw new Error(routePayload.error || 'ARES route failed')
        }
      } catch (routeError) {
        console.warn('Local ARES route failed, trying browser fallback:', routeError)

        const directResponse = await fetch(
          `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${normalizedCompanyNumber}`,
          {
            headers: {
              Accept: 'application/json',
            },
            cache: 'no-store',
          }
        )

        if (!directResponse.ok) {
          setError(dictionary.customers.customerEdit.aresLoadFailed)
          setLoadingAres(false)
          return
        }

        const directPayload = (await directResponse.json()) as BrowserAresSubject
        payload = mapBrowserAresPayload(directPayload, normalizedCompanyNumber)
      }

      if (!payload) {
        setError(dictionary.customers.customerEdit.aresLoadFailed)
        setLoadingAres(false)
        return
      }

      setCompanyNumber(payload.ico ?? normalizedCompanyNumber)
      setVatNumber(payload.dic ?? '')
      setBillingName(payload.name ?? '')
      setBillingStreet(payload.billingStreet ?? '')
      setBillingCity(payload.billingCity ?? '')
      setBillingPostalCode(payload.billingPostalCode ?? '')
      setBillingCountry(payload.billingCountry ?? 'Ceska republika')

      if (!name.trim() && payload.name) {
        setName(payload.name)
      }
    } catch (lookupError) {
      console.error('ARES lookup failed:', lookupError)
      setError(dictionary.customers.customerEdit.aresLoadFailed)
    } finally {
      setLoadingAres(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    setSaving(true)
    setError(null)

    let { error } = await supabase
      .from('customers')
      .update({
        name: name.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        billing_name: billingName.trim() || null,
        billing_street: billingStreet.trim() || null,
        billing_city: billingCity.trim() || null,
        billing_postal_code: billingPostalCode.trim() || null,
        billing_country: billingCountry.trim() || null,
        company_number: companyNumber.replace(/\D/g, '') || null,
        vat_number: vatNumber.trim() || null,
        ares_last_checked_at: companyNumber.replace(/\D/g, '')
          ? new Date().toISOString()
          : null,
      })
      .eq('id', customerId)

    if (error && isMissingCustomerBillingColumns(error)) {
      const fallbackResult = await supabase
        .from('customers')
        .update({
          name: name.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
        })
        .eq('id', customerId)

      error = fallbackResult.error
    }

    if (error) {
      setError(dictionary.customers.customerEdit.saveFailed)
      setSaving(false)
      return
    }

    router.push(`/customers/${customerId}`)
    router.refresh()
  }

  const labelStyle: React.CSSProperties = {
    display: 'grid',
    gap: 7,
    color: '#334155',
    fontSize: 13,
    fontWeight: 820,
  }

  const formSectionStyle: React.CSSProperties = {
    ...sectionCardStyle,
    padding: 22,
    display: 'grid',
    gap: 16,
    background:
      'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.9) 100%)',
  }

  const sectionTitleStyle: React.CSSProperties = {
    margin: 0,
    color: '#0f172a',
    fontSize: 24,
    lineHeight: 1.15,
    fontWeight: 900,
  }

  const sectionTextStyle: React.CSSProperties = {
    margin: '6px 0 0',
    color: '#64748b',
    fontSize: 14,
    lineHeight: 1.45,
  }

  const buttonResetStyle: React.CSSProperties = {
    appearance: 'none',
    WebkitAppearance: 'none',
    cursor: saving ? 'not-allowed' : 'pointer',
  }
  const normalizedBillingCountry = billingCountry
    .trim()
    .toLocaleLowerCase('cs-CZ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  const canUseAres =
    normalizedBillingCountry === '' ||
    normalizedBillingCountry === 'ceska republika' ||
    normalizedBillingCountry === 'cesko' ||
    normalizedBillingCountry === 'czech republic'

  return (
    <DashboardShell activeItem="customers">
      <main style={{ ...pageShellStyle, maxWidth: 1120 }}>
        <section style={heroCardStyle}>
          <div style={heroContentStyle}>
            <div style={eyebrowStyle}>Zákazník</div>
            <h1 style={heroTitleStyle}>{dictionary.customers.customerEdit.title}</h1>
            <p style={heroTextStyle}>{dictionary.customers.customerEdit.subtitle}</p>
          </div>

          <Link
            href={`/customers/${customerId}`}
            style={secondaryButtonStyle}
          >
            {dictionary.customers.customerEdit.backToDetail}
          </Link>
        </section>

        <form
          onSubmit={handleSubmit}
          style={{
            display: 'grid',
            gap: 18,
          }}
        >
          {loading ? (
            <section style={formSectionStyle}>
              <div style={{ color: '#64748b', fontWeight: 750 }}>
                {dictionary.customers.customerEdit.loading}
              </div>
            </section>
          ) : (
            <>
              <section style={formSectionStyle}>
                <div>
                  <h2 style={sectionTitleStyle}>Základní údaje</h2>
                  <p style={sectionTextStyle}>Jméno zákazníka a hlavní kontakt pro rychlou komunikaci.</p>
                </div>

                <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
                  <label htmlFor="name" style={labelStyle}>
                    {dictionary.customers.customerEdit.customerName}
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={dictionary.customers.customerEdit.customerNamePlaceholder}
                      required
                      style={inputStyle}
                    />
                  </label>

                  <label htmlFor="email" style={labelStyle}>
                    {dictionary.customers.customerEdit.mainEmail}
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={dictionary.customers.customerEdit.mainEmailPlaceholder}
                      style={inputStyle}
                    />
                  </label>

                  <label htmlFor="phone" style={labelStyle}>
                    {dictionary.customers.customerEdit.mainPhone}
                    <input
                      id="phone"
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={dictionary.customers.customerEdit.mainPhonePlaceholder}
                      style={inputStyle}
                    />
                  </label>
                </div>
              </section>

              <section style={formSectionStyle}>
                <div>
                  <h2 style={sectionTitleStyle}>{dictionary.customers.customerEdit.billingTitle}</h2>
                  <p style={sectionTextStyle}>{dictionary.customers.customerEdit.billingDescription}</p>
                </div>

                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'end' }}>
                  <label htmlFor="companyNumber" style={labelStyle}>
                    {dictionary.customers.customerEdit.companyNumberLabel}
                    <input
                      id="companyNumber"
                      type="text"
                      value={companyNumber}
                      onChange={(e) => setCompanyNumber(e.target.value)}
                      placeholder={dictionary.customers.customerEdit.companyNumberPlaceholder}
                      style={inputStyle}
                    />
                  </label>

                  {canUseAres ? (
                    <button
                      type="button"
                      onClick={handleLoadFromAres}
                      disabled={saving || loadingAres}
                      style={{
                        ...secondaryButtonStyle,
                        ...buttonResetStyle,
                        minHeight: 46,
                        opacity: saving || loadingAres ? 0.7 : 1,
                      }}
                    >
                      {loadingAres ? dictionary.customers.customerEdit.loadingFromAres : dictionary.customers.customerEdit.loadFromAres}
                    </button>
                  ) : null}
                </div>

                <label htmlFor="vatNumber" style={labelStyle}>
                  {dictionary.customers.customerEdit.vatNumberLabel}
                  <input
                    id="vatNumber"
                    type="text"
                    value={vatNumber}
                    onChange={(e) => setVatNumber(e.target.value)}
                    placeholder={dictionary.customers.customerEdit.vatNumberPlaceholder}
                    style={inputStyle}
                  />
                </label>

                <label htmlFor="billingName" style={labelStyle}>
                  {dictionary.customers.customerEdit.billingNameLabel}
                  <input
                    id="billingName"
                    type="text"
                    value={billingName}
                    onChange={(e) => setBillingName(e.target.value)}
                    placeholder={dictionary.customers.customerEdit.billingNamePlaceholder}
                    style={inputStyle}
                  />
                </label>

                <label htmlFor="billingStreet" style={labelStyle}>
                  {dictionary.customers.customerEdit.streetLabel}
                  <input
                    id="billingStreet"
                    type="text"
                    value={billingStreet}
                    onChange={(e) => setBillingStreet(e.target.value)}
                    placeholder={dictionary.customers.customerEdit.streetPlaceholder}
                    style={inputStyle}
                  />
                </label>

                <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 180px)' }}>
                  <label htmlFor="billingCity" style={labelStyle}>
                    {dictionary.customers.customerEdit.cityLabel}
                    <input
                      id="billingCity"
                      type="text"
                      value={billingCity}
                      onChange={(e) => setBillingCity(e.target.value)}
                      placeholder={dictionary.customers.customerEdit.cityPlaceholder}
                      style={inputStyle}
                    />
                  </label>

                  <label htmlFor="billingPostalCode" style={labelStyle}>
                    {dictionary.customers.customerEdit.postalCodeLabel}
                    <input
                      id="billingPostalCode"
                      type="text"
                      value={billingPostalCode}
                      onChange={(e) => setBillingPostalCode(e.target.value)}
                      placeholder={dictionary.customers.customerEdit.postalCodePlaceholder}
                      style={inputStyle}
                    />
                  </label>
                </div>

                <label htmlFor="billingCountry" style={labelStyle}>
                  {dictionary.customers.customerEdit.countryLabel}
                  <input
                    id="billingCountry"
                    type="text"
                    value={billingCountry}
                    onChange={(e) => setBillingCountry(e.target.value)}
                    placeholder={dictionary.customers.customerEdit.countryPlaceholder}
                    style={inputStyle}
                  />
                </label>
              </section>

              {error ? (
                <div style={errorStateStyle}>
                  {error}
                </div>
              ) : null}

              <div
                style={{
                  ...sectionCardStyle,
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  padding: 16,
                }}
              >
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    ...primaryButtonStyle,
                    ...buttonResetStyle,
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? dictionary.customers.customerEdit.saving : dictionary.customers.customerEdit.saveChanges}
                </button>

                <Link
                  href={`/customers/${customerId}`}
                  style={secondaryButtonStyle}
                >
                  {dictionary.customers.customerEdit.cancel}
                </Link>
              </div>
            </>
          )}
        </form>
      </main>
    </DashboardShell>
  )
}
