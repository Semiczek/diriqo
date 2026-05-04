'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'

import { useI18n } from '@/components/I18nProvider'

type CustomerContact = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
}

type Customer = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  created_at: string | null
  customer_contacts?: CustomerContact[] | null
}

type CustomersPageClientProps = {
  customers: Customer[]
  error?: string | null
}

export default function CustomersPageClient({
  customers,
  error = null,
}: CustomersPageClientProps) {
  const [search, setSearch] = useState('')
  const { dictionary } = useI18n()

  const filteredCustomers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    if (!normalizedSearch) return customers

    return customers.filter((customer) => {
      const customerName = customer.name?.toLowerCase() ?? ''
      const customerEmail = customer.email?.toLowerCase() ?? ''
      const customerPhone = customer.phone?.toLowerCase() ?? ''

      const contacts = customer.customer_contacts ?? []

      const matchesCustomer =
        customerName.includes(normalizedSearch) ||
        customerEmail.includes(normalizedSearch) ||
        customerPhone.includes(normalizedSearch)

      const matchesContact = contacts.some((contact) => {
        const contactName = contact.full_name?.toLowerCase() ?? ''
        const contactEmail = contact.email?.toLowerCase() ?? ''
        const contactPhone = contact.phone?.toLowerCase() ?? ''

        return (
          contactName.includes(normalizedSearch) ||
          contactEmail.includes(normalizedSearch) ||
          contactPhone.includes(normalizedSearch)
        )
      })

      return matchesCustomer || matchesContact
    })
  }, [customers, search])

  const cardStyle: CSSProperties = {
    border: '1px solid rgba(226, 232, 240, 0.9)',
    borderRadius: '22px',
    padding: '24px',
    background: 'linear-gradient(145deg, #ffffff 0%, #f8fbff 100%)',
    color: '#111827',
    marginBottom: '16px',
    textDecoration: 'none',
    display: 'block',
    boxShadow: '0 16px 36px rgba(15, 23, 42, 0.06)',
  }

  const mutedTextStyle: CSSProperties = {
    color: '#6b7280',
    fontSize: '14px',
    lineHeight: '1.5',
  }

  const labelStyle: CSSProperties = {
    fontWeight: 700,
    color: '#111827',
  }

  return (
    <>
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: '18px',
          marginBottom: '22px',
          flexWrap: 'wrap',
          padding: '28px',
          borderRadius: '28px',
          background:
            'linear-gradient(135deg, rgba(250,245,255,0.96) 0%, rgba(239,246,255,0.94) 50%, rgba(236,254,255,0.9) 100%)',
          border: '1px solid rgba(203, 213, 225, 0.78)',
          boxShadow: '0 22px 58px rgba(15, 23, 42, 0.10)',
        }}
      >
        <div>
          <div style={{ display: 'inline-flex', marginBottom: '12px', padding: '7px 11px', borderRadius: '999px', backgroundColor: 'rgba(255,255,255,0.72)', border: '1px solid rgba(124,58,237,0.2)', color: '#5b21b6', fontSize: '12px', fontWeight: 900 }}>
            CRM
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: '44px',
              lineHeight: '1.05',
              fontWeight: 850,
              color: '#0f172a',
            }}
          >
            {dictionary.customers.title}
          </h1>
          <p style={{ margin: '10px 0 0', color: '#475569', fontSize: '16px', lineHeight: 1.6 }}>
            Přehled firem, kontaktů a obchodních vztahů na jednom místě.
          </p>
        </div>

        <Link
          href="/customers/new"
          style={{
            display: 'inline-flex',
            background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
            color: '#ffffff',
            textDecoration: 'none',
            fontWeight: 900,
            fontSize: '16px',
            padding: '14px 20px',
            borderRadius: '999px',
            whiteSpace: 'nowrap',
            boxShadow: '0 16px 34px rgba(37, 99, 235, 0.22)',
          }}
        >
          {dictionary.customers.newCustomer}
        </Link>
      </div>

      <div style={{ marginBottom: '22px', padding: '14px', borderRadius: '20px', backgroundColor: 'rgba(255,255,255,0.78)', border: '1px solid rgba(226,232,240,0.9)', boxShadow: '0 12px 28px rgba(15,23,42,0.05)' }}>
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={dictionary.customers.searchPlaceholder}
          style={{
            width: '100%',
            maxWidth: '420px',
            padding: '14px 16px',
            borderRadius: '999px',
            border: '1px solid #d1d5db',
            fontSize: '16px',
            color: '#111827',
            outline: 'none',
            backgroundColor: '#ffffff',
          }}
        />
      </div>

      {error ? (
        <div style={cardStyle}>
          <p style={{ margin: 0, color: '#b91c1c', fontSize: '14px' }}>
            {dictionary.customers.errorPrefix}: data se nepodařilo načíst.
          </p>
        </div>
      ) : customers.length === 0 ? (
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, rgba(124,58,237,0.14), rgba(6,182,212,0.16))', color: '#2563eb', fontWeight: 950 }}>K</div>
            <div>
              <div style={{ color: '#0f172a', fontSize: '18px', fontWeight: 850, marginBottom: '4px' }}>Zatím tu nejsou zákazníci.</div>
              <p style={{ margin: 0, ...mutedTextStyle }}>Přidej prvního zákazníka a začni k němu tvořit zakázky.</p>
              <Link href="/customers/new" style={{ display: 'inline-flex', marginTop: '12px', padding: '9px 12px', borderRadius: '999px', background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)', color: '#ffffff', textDecoration: 'none', fontSize: '13px', fontWeight: 900 }}>
                {dictionary.customers.newCustomer}
              </Link>
            </div>
          </div>
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div style={cardStyle}>
          <p style={{ margin: 0, ...mutedTextStyle }}>{dictionary.customers.noResults}</p>
        </div>
      ) : (
        filteredCustomers.map((customer) => (
          <Link key={customer.id} href={`/customers/${customer.id}`} style={cardStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '16px',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '18px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  background: 'linear-gradient(135deg, rgba(124,58,237,0.16), rgba(6,182,212,0.18))',
                  color: '#2563eb',
                  fontWeight: 950,
                }}
              >
                {(customer.name || dictionary.customers.unnamedCustomer).trim().slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <h2
                  style={{
                    margin: '0 0 12px 0',
                    fontSize: '20px',
                    lineHeight: '1.2',
                    color: '#111827',
                  }}
                >
                  {customer.name || dictionary.customers.unnamedCustomer}
                </h2>

                <div style={{ marginBottom: '6px', fontSize: '16px' }}>
                  <span style={labelStyle}>{dictionary.customers.emailLabel}:</span>{' '}
                  <span style={{ color: '#4b5563' }}>{customer.email || '-'}</span>
                </div>

                <div style={{ marginBottom: '10px', fontSize: '16px' }}>
                  <span style={labelStyle}>{dictionary.customers.phoneLabel}:</span>{' '}
                  <span style={{ color: '#4b5563' }}>{customer.phone || '-'}</span>
                </div>

                {customer.customer_contacts && customer.customer_contacts.length > 0 ? (
                  <div style={{ marginTop: '10px' }}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: '#6b7280',
                        marginBottom: '6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {dictionary.customers.contacts}
                    </div>

                    <div style={{ display: 'grid', gap: '6px' }}>
                      {customer.customer_contacts.slice(0, 3).map((contact) => (
                        <div
                          key={contact.id}
                          style={{
                            fontSize: '14px',
                            color: '#4b5563',
                          }}
                        >
                          <strong style={{ color: '#111827' }}>
                            {contact.full_name || dictionary.customers.unnamedContact}
                          </strong>
                          {' - '}
                          {contact.email || contact.phone || dictionary.customers.noContact}
                        </div>
                      ))}

                      {customer.customer_contacts.length > 3 ? (
                        <div style={{ fontSize: '13px', color: '#6b7280' }}>
                          {dictionary.customers.moreContacts}:{' '}
                          {customer.customer_contacts.length - 3}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <span style={{ display: 'inline-flex', padding: '8px 11px', borderRadius: '999px', backgroundColor: '#eef2ff', color: '#3730a3', fontSize: '13px', fontWeight: 900 }}>
                Detail
              </span>
            </div>
          </Link>
        ))
      )}
    </>
  )
}
