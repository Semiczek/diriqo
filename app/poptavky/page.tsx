import Link from 'next/link'

import DashboardShell from '@/components/DashboardShell'

export default function LeadsAddonDisabledPage() {
  return (
    <DashboardShell activeItem="dashboard">
      <section
        style={{
          display: 'grid',
          gap: '18px',
          maxWidth: '760px',
        }}
      >
        <div>
          <p
            style={{
              margin: '0 0 8px',
              color: '#64748b',
              fontSize: '13px',
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Diriqo add-on
          </p>
          <h1
            style={{
              margin: 0,
              color: '#0f172a',
              fontSize: '32px',
              lineHeight: 1.15,
            }}
          >
            Poptávky jsou zatím vypnuté
          </h1>
        </div>

        <div
          data-tour="leads-addon-panel"
          style={{
            border: '1px solid rgba(148, 163, 184, 0.28)',
            borderRadius: '18px',
            background: '#ffffff',
            boxShadow: '0 18px 45px rgba(15, 23, 42, 0.08)',
            padding: '24px',
          }}
        >
          <p
            style={{
              margin: 0,
              color: '#475569',
              fontSize: '16px',
              lineHeight: 1.7,
            }}
          >
            Modul pro landing stránky a formuláře bude samostatná příplatková výbava.
            V základní verzi zůstává schovaný, aby dashboard a databáze řešily
            jen hlavní provoz: zakázky, zákazníky, pracovníky, kalendář, nabídky a fakturaci.
          </p>

          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '22px',
              minHeight: '42px',
              padding: '0 16px',
              borderRadius: '10px',
              background: '#111827',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 800,
              textDecoration: 'none',
            }}
          >
            Zpět na dashboard
          </Link>
        </div>
      </section>
    </DashboardShell>
  )
}
