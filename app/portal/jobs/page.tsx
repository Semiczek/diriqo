import Link from 'next/link'

import PortalShell from '@/components/portal/PortalShell'
import { requirePortalUserContext } from '@/lib/customer-portal/auth'
import { getPortalJobs } from '@/lib/customer-portal/data'

type JobsPageProps = {
  searchParams?: Promise<{
    month?: string
    status?: string
  }>
}

export default async function PortalJobsPage({ searchParams }: JobsPageProps) {
  const portalUser = await requirePortalUserContext()
  const params = searchParams ? await searchParams : undefined
  const selectedMonth = params?.month?.trim() || 'all'
  const selectedStatus = params?.status?.trim() || 'all'
  const jobs = await getPortalJobs(portalUser.customerId, portalUser.companyId ?? '')

  const monthOptions = Array.from(
    new Set(
      jobs
        .map((job) => job.monthValue)
        .filter((value): value is string => Boolean(value))
    )
  ).sort((left, right) => right.localeCompare(left))

  const filteredJobs = jobs.filter((job) => {
    const matchesMonth = selectedMonth === 'all' || job.monthValue === selectedMonth
    const matchesStatus = selectedStatus === 'all' || job.customerStatus === selectedStatus
    return matchesMonth && matchesStatus
  })

  return (
    <PortalShell title="Zakázky" customerName={portalUser.customerName}>
      <div style={{ display: 'grid', gap: '20px' }}>
        <section
          style={{
            borderRadius: '18px',
            border: '1px solid #e5e7eb',
            backgroundColor: '#ffffff',
            padding: '20px',
          }}
        >
          <form method="get" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>Měsíc</span>
              <select
                name="month"
                defaultValue={selectedMonth}
                style={{ minWidth: '180px', height: '42px', borderRadius: '12px', border: '1px solid #d1d5db', padding: '0 12px' }}
              >
                <option value="all">Všechny měsíce</option>
                {monthOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>Stav</span>
              <select
                name="status"
                defaultValue={selectedStatus}
                style={{ minWidth: '180px', height: '42px', borderRadius: '12px', border: '1px solid #d1d5db', padding: '0 12px' }}
              >
                <option value="all">Všechny stavy</option>
                <option value="Objednáno">Objednáno</option>
                <option value="Probíhá">Probíhá</option>
                <option value="Hotovo">Hotovo</option>
              </select>
            </label>

            <button
              type="submit"
              style={{
                height: '42px',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: '#111827',
                color: '#ffffff',
                padding: '0 16px',
                fontWeight: 700,
              }}
            >
              Filtrovat
            </button>
          </form>
        </section>

        <section style={{ display: 'grid', gap: '14px' }}>
          {filteredJobs.length === 0 ? (
            <div
              style={{
                borderRadius: '18px',
                border: '1px solid #e5e7eb',
                backgroundColor: '#ffffff',
                padding: '22px',
                color: '#6b7280',
              }}
            >
              Pro zadaný filtr nebyly nalezeny žádné zakázky.
            </div>
          ) : (
            filteredJobs.map((job) => (
              <article
                key={job.id}
                style={{
                  borderRadius: '18px',
                  border: '1px solid #e5e7eb',
                  backgroundColor: '#ffffff',
                  padding: '20px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'grid', gap: '10px' }}>
                    <div style={{ fontSize: '24px', fontWeight: 800 }}>{job.title}</div>
                    <div style={{ color: '#4b5563' }}>{job.location || 'Místo bude doplněno'}</div>
                    <div style={{ color: '#6b7280' }}>Termín plnění: {job.dateLabel}</div>
                    <div style={{ color: '#374151', fontWeight: 700 }}>Cena práce: {job.workPriceLabel}</div>
                    {job.customerSummary ? <div style={{ color: '#374151', lineHeight: 1.6 }}>{job.customerSummary}</div> : null}
                  </div>

                  <div style={{ display: 'grid', gap: '10px', justifyItems: 'end' }}>
                    <div
                      style={{
                        borderRadius: '999px',
                        padding: '8px 12px',
                        border: '1px solid #d1d5db',
                        backgroundColor:
                          job.customerStatus === 'Hotovo'
                            ? '#f0fdf4'
                            : job.customerStatus === 'Probíhá'
                            ? '#fffbeb'
                            : '#eff6ff',
                        color:
                          job.customerStatus === 'Hotovo'
                            ? '#166534'
                            : job.customerStatus === 'Probíhá'
                            ? '#b45309'
                            : '#1d4ed8',
                        fontWeight: 700,
                      }}
                    >
                      {job.customerStatus}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '14px' }}>Poslední záznam: {job.updatedAtLabel}</div>
                    <Link
                      href={`/portal/jobs/${job.id}`}
                      style={{
                        textDecoration: 'none',
                        borderRadius: '12px',
                        backgroundColor: '#111827',
                        color: '#ffffff',
                        padding: '10px 14px',
                        fontWeight: 700,
                      }}
                    >
                      Detail
                    </Link>
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </PortalShell>
  )
}
