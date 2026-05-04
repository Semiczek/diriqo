import Link from 'next/link'

import PortalShell from '@/components/portal/PortalShell'
import { requirePortalUserContext } from '@/lib/customer-portal/auth'

export default async function PortalInquiriesDisabledPage() {
  const portalUser = await requirePortalUserContext()

  return (
    <PortalShell title="Poptávky" customerName={portalUser.customerName}>
      <section
        style={{
          borderRadius: '18px',
          border: '1px solid #e5e7eb',
          backgroundColor: '#ffffff',
          padding: '24px',
          display: 'grid',
          gap: '14px',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '28px' }}>Poptávky jsou vypnuté</h2>
        <p style={{ margin: 0, color: '#4b5563', lineHeight: 1.7 }}>
          Modul pro zákaznické poptávky bude součástí placeného add-onu pro landing stránky
          a formuláře. V aktuální verzi zákaznický portál ukazuje zakázky, nabídky a faktury.
        </p>
        <Link href="/portal" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 700 }}>
          Zpět na portál
        </Link>
      </section>
    </PortalShell>
  )
}
