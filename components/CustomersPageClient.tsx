'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

import { useI18n } from '@/components/I18nProvider'
import { primaryButtonStyle, secondaryButtonStyle } from '@/components/SaasPageLayout'
import styles from '@/components/OperationalUI.module.css'

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
  const { dictionary, locale } = useI18n()

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

  return (
    <div className={styles.page}>
      <header data-tour="customers-header" className={styles.header}>
        <div>
          <h1 className={styles.title}>{dictionary.customers.title}</h1>
          <p className={styles.subtitle}>{dictionary.customers.subtitle}</p>
        </div>
        <Link href="/customers/new" data-tour="new-customer-button" style={primaryButtonStyle}>
          + {dictionary.customers.newCustomer.replace(/^\+\s*/, '')}
        </Link>
      </header>

      <div data-tour="customers-search" className={styles.toolbar}>
        <label className={`${styles.field} ${styles.search}`}>
          <span>{locale === 'cs' ? 'Hledat zákazníka' : locale === 'de' ? 'Kunden suchen' : 'Find a customer'}</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder={dictionary.customers.searchPlaceholder} className={styles.input} />
        </label>
        <span className={styles.count} aria-live="polite">{filteredCustomers.length} / {customers.length}</span>
      </div>

      {error ? (
        <div className={styles.empty} role="alert">
          <h2>{dictionary.common.dataLoadFailed}</h2>
        </div>
      ) : customers.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.avatar} aria-hidden="true">+</span>
          <h2>{dictionary.customers.empty}</h2>
          <p>{dictionary.customers.emptyHint}</p>
          <Link href="/customers/new" style={primaryButtonStyle}>{dictionary.customers.newCustomer}</Link>
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div className={styles.empty}>
          <p>{dictionary.customers.noResults}</p>
          <button type="button" onClick={() => setSearch('')} style={secondaryButtonStyle}>
            {locale === 'cs' ? 'Vymazat hledání' : locale === 'de' ? 'Suche löschen' : 'Clear search'}
          </button>
        </div>
      ) : (
        <div data-tour="customers-list" className={styles.list}>
          {filteredCustomers.map((customer) => (
            <Link key={customer.id} href={`/customers/${customer.id}`} className={styles.resource}>
              <span className={styles.avatar} aria-hidden="true">
                {(customer.name || dictionary.customers.unnamedCustomer).trim().slice(0, 1).toUpperCase()}
              </span>
              <div className={styles.resourceBody}>
                <h2 className={styles.resourceTitle}>{customer.name || dictionary.customers.unnamedCustomer}</h2>
                <div className={styles.meta}>
                  {customer.email ? <span>{customer.email}</span> : null}
                  {customer.phone ? <span>{customer.phone}</span> : null}
                  {!customer.email && !customer.phone ? <span>{dictionary.customers.noContact}</span> : null}
                  {customer.customer_contacts?.length ? (
                    <span>{dictionary.customers.contacts}: {customer.customer_contacts.length}</span>
                  ) : null}
                </div>
              </div>
              <span className={styles.arrow} aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
