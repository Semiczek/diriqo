import { ReactNode } from 'react'

import { requireHubAccess } from '@/lib/require-hub-access'

type DashboardLayoutProps = {
  children: ReactNode
}

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  await requireHubAccess()

  return <>{children}</>
}
