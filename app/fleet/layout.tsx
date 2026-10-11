import type { ReactNode } from 'react'
import DashboardShell from '@/components/DashboardShell'

export default function FleetLayout({ children }: { children: ReactNode }) {
  return <DashboardShell activeItem="modules">{children}</DashboardShell>
}
