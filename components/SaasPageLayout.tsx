import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'

export const pageShellStyle: CSSProperties = {
  display: 'grid',
  gap: '24px',
  maxWidth: '1280px',
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
  borderRadius: '14px',
  border: '1px solid var(--dq-border)',
  background:
    'var(--dq-surface)',
  boxShadow: 'none',
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
  borderRadius: '9px',
  backgroundColor: 'rgba(255,255,255,0.72)',
  border: '1px solid rgba(124, 58, 237, 0.2)',
  color: '#5b21b6',
  fontSize: '11px',
  fontWeight: 600,
}

export const heroTitleStyle: CSSProperties = {
  margin: 0,
  color: '#111827',
  fontSize: '32px',
  lineHeight: 1.08,
  fontWeight: 700,
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
  minHeight: '44px',
  padding: '11px 16px',
  borderRadius: '9px',
  border: 0,
  background: 'var(--dq-accent)',
  color: '#ffffff',
  textDecoration: 'none',
  fontSize: '13px',
  fontWeight: 600,
  boxShadow: '0 2px 3px rgba(109, 74, 255, 0.1)',
}

export const secondaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '44px',
  padding: '11px 16px',
  borderRadius: '9px',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  backgroundColor: 'rgba(255,255,255,0.82)',
  color: '#0f172a',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 600,
}

export const cardStyle: CSSProperties = {
  borderRadius: '14px',
  border: '1px solid var(--dq-border)',
  background: '#ffffff',
  boxShadow: 'var(--dq-shadow)',
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
  fontWeight: 600,
}

export const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 13px',
  borderRadius: '13px',
  border: '1px solid rgba(148, 163, 184, 0.42)',
  backgroundColor: '#ffffff',
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
  fontWeight: 600,
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
  fontWeight: 600,
}

export const metaValueStyle: CSSProperties = {
  color: '#0f172a',
  fontSize: '15px',
  fontWeight: 600,
}

export const emptyStateStyle: CSSProperties = {
  ...cardStyle,
  padding: '28px',
  textAlign: 'center',
  color: '#64748b',
}

export const errorStateStyle: CSSProperties = {
  padding: '18px',
  borderRadius: '14px',
  border: '1px solid #fecaca',
  backgroundColor: '#fff7f7',
  color: '#991b1b',
  fontWeight: 600,
}

export const sectionCardStyle: CSSProperties = {
  ...cardStyle,
  padding: '20px',
}

export function PrimaryAction({ href, children, dataTour }: { href: string; children: ReactNode; dataTour?: string }) {
  return (
    <Link href={href} data-tour={dataTour} className="dq-button" style={primaryButtonStyle}>
      {children}
    </Link>
  )
}

export function SecondaryAction({ href, children, dataTour }: { href: string; children: ReactNode; dataTour?: string }) {
  return (
    <Link href={href} data-tour={dataTour} className="dq-button-secondary" style={secondaryButtonStyle}>
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
        borderRadius: '9px',
        fontSize: '13px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </span>
  )
}
