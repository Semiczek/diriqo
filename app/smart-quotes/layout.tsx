import DashboardShell from '@/components/DashboardShell'
export default function SmartQuotesLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell activeItem="modules">{children}</DashboardShell>
}
