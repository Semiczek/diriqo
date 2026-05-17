import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'

export const pageShellStyle: CSSProperties = {
  display: 'grid',
  gap: '12px',
  maxWidth: '1120px',
  color: '#111827',
}

export const heroCardStyle: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: '14px',
  flexWrap: 'wrap',
  padding: '18px 20px',
  borderRadius: '20px',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background:
    'linear-gradient(135deg, rgba(250,245,255,0.96) 0%, rgba(239,246,255,0.94) 48%, rgba(236,254,255,0.9) 100%)',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.065)',
}

export const heroContentStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  minWidth: 0,
  flex: '1 1 420px',
}

export const eyebrowStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  marginBottom: '8px',
  padding: '4px 9px',
  borderRadius: '999px',
  backgroundColor: 'rgba(255,255,255,0.72)',
  border: '1px solid rgba(124, 58, 237, 0.2)',
  color: '#5b21b6',
  fontSize: '11px',
  fontWeight: 900,
}

export const heroTitleStyle: CSSProperties = {
  margin: 0,
  color: '#111827',
  fontSize: '32px',
  lineHeight: 1.08,
  fontWeight: 900,
}

export const heroTextStyle: CSSProperties = {
  margin: '7px 0 0',
  color: '#475569',
  fontSize: '14px',
  lineHeight: 1.45,
  maxWidth: '680px',
}

export const actionRowStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  alignItems: 'center',
}

export const primaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '36px',
  padding: '8px 12px',
  borderRadius: '999px',
  border: 0,
  background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
  color: '#ffffff',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 850,
  boxShadow: '0 10px 22px rgba(37, 99, 235, 0.16)',
}

export const secondaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '36px',
  padding: '8px 12px',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  backgroundColor: 'rgba(255,255,255,0.82)',
  color: '#0f172a',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 820,
}

export const cardStyle: CSSProperties = {
  borderRadius: '22px',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255,255,255,0.9)',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
}

export const filterCardStyle: CSSProperties = {
  ...cardStyle,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: '12px',
  padding: '18px',
  alignItems: 'end',
}

export const fieldLabelStyle: CSSProperties = {
  display: 'grid',
  gap: '7px',
  color: '#334155',
  fontSize: '13px',
  fontWeight: 820,
}

export const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 13px',
  borderRadius: '13px',
  border: '1px solid rgba(148, 163, 184, 0.42)',
  backgroundColor: 'rgba(255,255,255,0.9)',
  color: '#0f172a',
  fontSize: '14px',
  fontWeight: 650,
}

export const resourceCardStyle: CSSProperties = {
  ...cardStyle,
  display: 'block',
  padding: '18px',
  color: '#111827',
  textDecoration: 'none',
}

export const cardTitleStyle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: '21px',
  lineHeight: 1.2,
  fontWeight: 880,
}

export const mutedTextStyle: CSSProperties = {
  color: '#64748b',
  fontSize: '14px',
  lineHeight: 1.45,
}

export const metaGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: '10px',
  marginTop: '14px',
}

export const metaItemStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: '14px',
  backgroundColor: '#f8fafc',
  border: '1px solid rgba(226, 232, 240, 0.9)',
}

export const metaLabelStyle: CSSProperties = {
  display: 'block',
  marginBottom: '3px',
  color: '#64748b',
  fontSize: '12px',
  fontWeight: 800,
}

export const metaValueStyle: CSSProperties = {
  color: '#0f172a',
  fontSize: '15px',
  fontWeight: 850,
}

export const emptyStateStyle: CSSProperties = {
  ...cardStyle,
  padding: '28px',
  textAlign: 'center',
  color: '#64748b',
}

export const errorStateStyle: CSSProperties = {
  padding: '18px',
  borderRadius: '18px',
  border: '1px solid #fecaca',
  backgroundColor: '#fff7f7',
  color: '#991b1b',
  fontWeight: 750,
}

export const sectionCardStyle: CSSProperties = {
  ...cardStyle,
  padding: '20px',
}

export function PrimaryAction({ href, children, dataTour }: { href: string; children: ReactNode; dataTour?: string }) {
  return (
    <Link href={href} data-tour={dataTour} style={primaryButtonStyle}>
      {children}
    </Link>
  )
}

export function SecondaryAction({ href, children, dataTour }: { href: string; children: ReactNode; dataTour?: string }) {
  return (
    <Link href={href} data-tour={dataTour} style={secondaryButtonStyle}>
      {children}
    </Link>
  )
}

type StatusTone = 'blue' | 'green' | 'orange' | 'gray' | 'purple' | 'red'

export function StatusPill({
  children,
  tone = 'blue',
  style,
}: {
  children: ReactNode
  tone?: StatusTone
  style?: CSSProperties
}) {
  const tones: Record<StatusTone, CSSProperties> = {
    blue: { backgroundColor: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe' },
    green: { backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' },
    orange: { backgroundColor: '#ffedd5', color: '#9a3412', border: '1px solid #fdba74' },
    gray: { backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' },
    purple: { backgroundColor: '#ede9fe', color: '#5b21b6', border: '1px solid #ddd6fe' },
    red: { backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' },
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        width: 'fit-content',
        padding: '7px 10px',
        borderRadius: '999px',
        fontSize: '13px',
        fontWeight: 850,
        whiteSpace: 'nowrap',
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </span>
  )
}
