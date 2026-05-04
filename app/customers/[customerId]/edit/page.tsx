'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
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

  return (
    <DashboardShell activeItem="customers">
      <div
        style={{
          maxWidth: 720,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 32,
              fontWeight: 700,
              color: '#111827',
            }}
          >
            {dictionary.customers.customerEdit.title}
          </h1>

          <p
            style={{
              margin: 0,
              fontSize: 16,
              color: '#6b7280',
            }}
          >
            {dictionary.customers.customerEdit.subtitle}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link
            href={`/customers/${customerId}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px 14px',
              borderRadius: 10,
              textDecoration: 'none',
              border: '1px solid #d1d5db',
              color: '#111827',
              background: '#ffffff',
              fontWeight: 600,
            }}
          >
            {dictionary.customers.customerEdit.backToDetail}
          </Link>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: 16,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}
        >
          {loading ? (
            <div style={{ color: '#6b7280' }}>{dictionary.customers.customerEdit.loading}</div>
          ) : (
            <>
              <div>
                <label htmlFor="name" style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#111827' }}>
                  {dictionary.customers.customerEdit.customerName}
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={dictionary.customers.customerEdit.customerNamePlaceholder}
                  required
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, outline: 'none' }}
                />
              </div>

              <div>
                <label htmlFor="email" style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#111827' }}>
                  {dictionary.customers.customerEdit.mainEmail}
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={dictionary.customers.customerEdit.mainEmailPlaceholder}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, outline: 'none' }}
                />
              </div>

              <div>
                <label htmlFor="phone" style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#111827' }}>
                  {dictionary.customers.customerEdit.mainPhone}
                </label>
                <input
                  id="phone"
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={dictionary.customers.customerEdit.mainPhonePlaceholder}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, outline: 'none' }}
                />
              </div>

              <section style={{ border: '1px solid #e5e7eb', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111827' }}>
                    {dictionary.customers.customerEdit.billingTitle}
                  </h2>
                  <p style={{ margin: '8px 0 0 0', fontSize: 14, color: '#6b7280' }}>
                    {dictionary.customers.customerEdit.billingDescription}
                  </p>
                </div>

                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'end' }}>
                  <div>
                    <label htmlFor="companyNumber" style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#111827' }}>
                      {dictionary.customers.customerEdit.companyNumberLabel}
                    </label>
                    <input
                      id="companyNumber"
                      type="text"
                      value={companyNumber}
                      onChange={(e) => setCompanyNumber(e.target.value)}
                      placeholder={dictionary.customers.customerEdit.companyNumberPlaceholder}
                      style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, outline: 'none' }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleLoadFromAres}
                    disabled={saving || loadingAres}
                    style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid #d1d5db', background: '#ffffff', color: '#111827', fontWeight: 700, cursor: saving || loadingAres ? 'not-allowed' : 'pointer', opacity: saving || loadingAres ? 0.7 : 1 }}
                  >
                    {loadingAres ? dictionary.customers.customerEdit.loadingFromAres : dictionary.customers.customerEdit.loadFromAres}
                  </button>
                </div>

                <div>
                  <label htmlFor="vatNumber" style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#111827' }}>
                    {dictionary.customers.customerEdit.vatNumberLabel}
                  </label>
                  <input
                    id="vatNumber"
                    type="text"
                    value={vatNumber}
                    onChange={(e) => setVatNumber(e.target.value)}
                    placeholder={dictionary.customers.customerEdit.vatNumberPlaceholder}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, outline: 'none' }}
                  />
                </div>

                <div>
                  <label htmlFor="billingName" style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#111827' }}>
                    {dictionary.customers.customerEdit.billingNameLabel}
                  </label>
                  <input
                    id="billingName"
                    type="text"
                    value={billingName}
                    onChange={(e) => setBillingName(e.target.value)}
                    placeholder={dictionary.customers.customerEdit.billingNamePlaceholder}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, outline: 'none' }}
                  />
                </div>

                <div>
                  <label htmlFor="billingStreet" style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#111827' }}>
                    {dictionary.customers.customerEdit.streetLabel}
                  </label>
                  <input
                    id="billingStreet"
                    type="text"
                    value={billingStreet}
                    onChange={(e) => setBillingStreet(e.target.value)}
                    placeholder={dictionary.customers.customerEdit.streetPlaceholder}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, outline: 'none' }}
                  />
                </div>

                <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 180px)' }}>
                  <div>
                    <label htmlFor="billingCity" style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#111827' }}>
                      {dictionary.customers.customerEdit.cityLabel}
                    </label>
                    <input
                      id="billingCity"
                      type="text"
                      value={billingCity}
                      onChange={(e) => setBillingCity(e.target.value)}
                      placeholder={dictionary.customers.customerEdit.cityPlaceholder}
                      style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, outline: 'none' }}
                    />
                  </div>

                  <div>
                    <label htmlFor="billingPostalCode" style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#111827' }}>
                      {dictionary.customers.customerEdit.postalCodeLabel}
                    </label>
                    <input
                      id="billingPostalCode"
                      type="text"
                      value={billingPostalCode}
                      onChange={(e) => setBillingPostalCode(e.target.value)}
                      placeholder={dictionary.customers.customerEdit.postalCodePlaceholder}
                      style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, outline: 'none' }}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="billingCountry" style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#111827' }}>
                    {dictionary.customers.customerEdit.countryLabel}
                  </label>
                  <input
                    id="billingCountry"
                    type="text"
                    value={billingCountry}
                    onChange={(e) => setBillingCountry(e.target.value)}
                    placeholder={dictionary.customers.customerEdit.countryPlaceholder}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, outline: 'none' }}
                  />
                </div>
              </section>

              {error ? (
                <div style={{ padding: '12px 14px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 14 }}>
                  {error}
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: '12px 16px', borderRadius: 10, border: 'none', background: '#111827', color: '#ffffff', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? dictionary.customers.customerEdit.saving : dictionary.customers.customerEdit.saveChanges}
                </button>

                <Link
                  href={`/customers/${customerId}`}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '12px 16px', borderRadius: 10, textDecoration: 'none', border: '1px solid #d1d5db', color: '#111827', background: '#ffffff', fontWeight: 600 }}
                >
                  {dictionary.customers.customerEdit.cancel}
                </Link>
              </div>
            </>
          )}
        </form>
      </div>
    </DashboardShell>
  )
}
