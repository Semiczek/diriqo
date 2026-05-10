import Link from 'next/link'

import type { FirstRunChecklist as FirstRunChecklistData } from '@/lib/onboarding'

type FirstRunChecklistLabels = {
  eyebrow: string
  title: string
  progressPrefix: string
  progressSuffix: string
  items: Record<FirstRunChecklistData['items'][number]['key'], string>
}

type Props = {
  checklist: FirstRunChecklistData
  labels: FirstRunChecklistLabels
}

export default function FirstRunChecklist({ checklist, labels }: Props) {
  if (checklist.completed >= checklist.total) return null

  return (
    <section style={panelStyle}>
      <div>
        <div style={eyebrowStyle}>{labels.eyebrow}</div>
        <h2 style={titleStyle}>{labels.title}</h2>
        <p style={textStyle}>
          {labels.progressPrefix} {checklist.completed}/{checklist.total}. {labels.progressSuffix}
        </p>
      </div>
      <div style={itemsStyle}>
        {checklist.items.map((item) => (
          <Link key={item.key} href={item.href} style={item.done ? doneItemStyle : itemStyle}>
            <span style={item.done ? doneMarkStyle : markStyle}>{item.done ? '✓' : '•'}</span>
            <span>{labels.items[item.key] ?? item.label}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

const panelStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 0.9fr) minmax(280px, 1.1fr)',
  gap: '18px',
  borderRadius: '20px',
  border: '1px solid rgba(37, 99, 235, 0.16)',
  background: '#ffffff',
  boxShadow: '0 14px 34px rgba(15, 23, 42, 0.07)',
  padding: '20px',
} as const

const eyebrowStyle = {
  fontSize: '12px',
  fontWeight: 900,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#2563eb',
} as const

const titleStyle = {
  margin: '7px 0',
  fontSize: '24px',
  lineHeight: 1.15,
  color: '#0f172a',
} as const

const textStyle = {
  margin: 0,
  color: '#64748b',
  fontSize: '14px',
  lineHeight: 1.6,
  fontWeight: 650,
} as const

const itemsStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: '10px',
} as const

const itemStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '9px',
  minHeight: '42px',
  borderRadius: '12px',
  border: '1px solid #dbeafe',
  background: '#eff6ff',
  color: '#1e3a8a',
  textDecoration: 'none',
  padding: '9px 11px',
  fontSize: '14px',
  fontWeight: 850,
} as const

const doneItemStyle = {
  ...itemStyle,
  borderColor: '#dcfce7',
  background: '#f0fdf4',
  color: '#166534',
} as const

const markStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '20px',
  height: '20px',
  borderRadius: '999px',
  background: '#dbeafe',
  color: '#1d4ed8',
  flex: '0 0 auto',
} as const

const doneMarkStyle = {
  ...markStyle,
  background: '#bbf7d0',
  color: '#166534',
} as const
