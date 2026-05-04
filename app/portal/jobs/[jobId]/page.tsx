import Link from 'next/link'
import { notFound } from 'next/navigation'

import PortalShell from '@/components/portal/PortalShell'
import { requirePortalUserContext } from '@/lib/customer-portal/auth'
import { getPortalJobDetail } from '@/lib/customer-portal/data'

type JobDetailPageProps = {
  params: Promise<{
    jobId: string
  }>
}

function photoSection(title: string, items: Array<{ id: string; fileName: string; previewUrl: string | null; imageUrl: string | null; takenAtLabel: string }>) {
  return (
    <section
      style={{
        borderRadius: '18px',
        border: '1px solid #e5e7eb',
        backgroundColor: '#ffffff',
        padding: '22px',
      }}
    >
      <h2 style={{ margin: '0 0 16px 0', fontSize: '22px' }}>{title}</h2>
      {items.length === 0 ? (
        <p style={{ margin: 0, color: '#6b7280' }}>Zatím zde nejsou žádné fotografie.</p>
      ) : (
        <div style={{ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {items.map((photo) => (
            <a
              key={photo.id}
              href={photo.imageUrl || '#'}
              target="_blank"
              rel="noreferrer"
              style={{
                textDecoration: 'none',
                color: '#111827',
                borderRadius: '14px',
                overflow: 'hidden',
                border: '1px solid #e5e7eb',
                backgroundColor: '#f9fafb',
              }}
            >
              <div
                style={{
                  height: '180px',
                  backgroundColor: '#e5e7eb',
                  backgroundImage: photo.previewUrl ? `url("${photo.previewUrl}")` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
              <div style={{ padding: '12px 14px' }}>
                <div style={{ fontWeight: 700 }}>{photo.fileName}</div>
                <div style={{ color: '#6b7280', marginTop: '6px' }}>{photo.takenAtLabel}</div>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  )
}

export default async function PortalJobDetailPage({ params }: JobDetailPageProps) {
  const portalUser = await requirePortalUserContext()
  const { jobId } = await params
  const job = await getPortalJobDetail(portalUser.customerId, jobId)

  if (!job) {
    notFound()
  }

  return (
    <PortalShell title="Detail zakázky" customerName={portalUser.customerName}>
      <div style={{ display: 'grid', gap: '20px' }}>
        <Link href="/portal/jobs" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 700 }}>
          ← Zpět na zakázky
        </Link>

        <section
          style={{
            borderRadius: '18px',
            border: '1px solid #e5e7eb',
            backgroundColor: '#ffffff',
            padding: '24px',
          }}
        >
          <div style={{ display: 'grid', gap: '14px' }}>
            <div
              style={{
                width: 'fit-content',
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

            <h2 style={{ margin: 0, fontSize: '30px' }}>{job.title}</h2>
            <div style={{ color: '#374151' }}>{job.location || 'Místo bude doplněno'}</div>
            <div style={{ color: '#6b7280' }}>Termín plnění: {job.periodLabel}</div>
            <div style={{ color: '#374151', fontWeight: 700 }}>Cena práce: {job.workPriceLabel}</div>
            <div style={{ color: '#374151', lineHeight: 1.7 }}>
              {job.customerSummary || 'Shrnutí pro zákaznický portál bude doplněno.'}
            </div>
          </div>
        </section>

        {photoSection('Fotky před', job.photosBefore)}
        {photoSection('Fotky po', job.photosAfter)}
      </div>
    </PortalShell>
  )
}
