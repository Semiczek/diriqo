import DashboardShell from '@/components/DashboardShell'

export default function JobDetailLoading() {
  return (
    <DashboardShell activeItem="jobs">
      <div style={{ display: 'grid', gap: '16px' }}>
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            backgroundColor: '#fff',
            padding: '24px',
          }}
        >
          Loading job detail...
        </div>
      </div>
    </DashboardShell>
  )
}
