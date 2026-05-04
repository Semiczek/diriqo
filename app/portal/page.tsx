import Link from 'next/link'

import PortalShell from '@/components/portal/PortalShell'
import { requirePortalUserContext } from '@/lib/customer-portal/auth'
import {
  getPortalInvoices,
  getPortalJobs,
  getPortalOffers,
} from '@/lib/customer-portal/data'

function statCard(label: string, value: number, tone: { bg: string; color: string; border: string }) {
  return (
    <article
      style={{
        padding: '20px',
        borderRadius: '18px',
        backgroundColor: tone.bg,
        color: tone.color,
        border: `1px solid ${tone.border}`,
      }}
    >
      <div style={{ fontSize: '14px', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '34px', fontWeight: 800 }}>{value}</div>
    </article>
  )
}

function sectionCard(title: string, href: string, items: Array<{ id: string; title: string; meta: string }>, emptyText: string) {
  return (
    <section
      style={{
        borderRadius: '18px',
        border: '1px solid #e5e7eb',
        backgroundColor: '#ffffff',
        padding: '22px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '12px',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '22px' }}>{title}</h2>
        <Link href={href} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 700 }}>
          {'Zobrazit v\u0161e'}
        </Link>
      </div>

      {items.length === 0 ? (
        <p style={{ margin: 0, color: '#6b7280' }}>{emptyText}</p>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                borderRadius: '14px',
                border: '1px solid #e5e7eb',
                padding: '14px 16px',
              }}
            >
              <div style={{ fontWeight: 700, color: '#111827' }}>{item.title}</div>
              <div style={{ color: '#6b7280', marginTop: '6px' }}>{item.meta}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default async function PortalDashboardPage() {
  const portalUser = await requirePortalUserContext()
  const [jobs, offers, invoices] = await Promise.all([
    getPortalJobs(portalUser.customerId),
    getPortalOffers(portalUser.customerId),
    getPortalInvoices(portalUser.customerId),
  ])

  const orderedCount = jobs.filter((job) => job.customerStatus === 'Objedn\u00e1no').length
  const activeCount = jobs.filter((job) => job.customerStatus === 'Prob\u00edh\u00e1').length
  const doneCount = jobs.filter((job) => job.customerStatus === 'Hotovo').length
  const unpaidCount = invoices.filter((invoice) => !invoice.paidAtLabel).length

  return (
    <PortalShell title="Dashboard" customerName={portalUser.customerName}>
      <div style={{ display: 'grid', gap: '24px' }}>
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '16px',
          }}
        >
          {statCard('Objednan\u00e9 zak\u00e1zky', orderedCount, {
            bg: '#eff6ff',
            color: '#1d4ed8',
            border: '#bfdbfe',
          })}
          {statCard('Prob\u00edhaj\u00edc\u00ed zak\u00e1zky', activeCount, {
            bg: '#fffbeb',
            color: '#b45309',
            border: '#fde68a',
          })}
          {statCard('Hotov\u00e9 zak\u00e1zky', doneCount, {
            bg: '#f0fdf4',
            color: '#166534',
            border: '#bbf7d0',
          })}
          {statCard('Neuhrazen\u00e9 faktury', unpaidCount, {
            bg: '#fef2f2',
            color: '#b91c1c',
            border: '#fecaca',
          })}
        </section>

        <section style={{ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {sectionCard(
            'Posledn\u00ed zak\u00e1zky',
            '/portal/jobs',
            jobs.slice(0, 5).map((item) => ({
              id: item.id,
              title: item.title,
              meta: `${item.customerStatus} \u2022 ${item.dateLabel}`,
            })),
            'Zat\u00edm tu nejsou \u017e\u00e1dn\u00e9 zak\u00e1zky.'
          )}
          {sectionCard(
            'Posledn\u00ed nab\u00eddky',
            '/portal/offers',
            offers.slice(0, 5).map((item) => ({
              id: item.id,
              title: `${item.quoteNumber} \u2022 ${item.title}`,
              meta: `${item.statusLabel} \u2022 ${item.totalPriceLabel}`,
            })),
            'Zat\u00edm tu nejsou \u017e\u00e1dn\u00e9 nab\u00eddky.'
          )}
          {sectionCard(
            'Posledn\u00ed faktury',
            '/portal/invoices',
            invoices.slice(0, 5).map((item) => ({
              id: item.id,
              title: item.invoiceNumber,
              meta: `${item.statusLabel} \u2022 ${item.totalWithVatLabel} \u2022 splatnost ${item.dueDateLabel}`,
            })),
            'Zat\u00edm tu nejsou \u017e\u00e1dn\u00e9 faktury.'
          )}
        </section>
      </div>
    </PortalShell>
  )
}
