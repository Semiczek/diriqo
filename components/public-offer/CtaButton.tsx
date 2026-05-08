'use client'

import type { CSSProperties } from 'react'

export default function CtaButton({
  label,
  primary = false,
  danger = false,
  onClick,
}: {
  label: string
  primary?: boolean
  danger?: boolean
  onClick: () => void
}) {
  const style: CSSProperties = {
    padding: '14px 18px',
    borderRadius: '14px',
    fontWeight: 800,
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: primary ? '1px solid rgba(255,255,255,0.76)' : danger ? '1px solid #fecaca' : '1px solid #cbd5e1',
    background: primary
      ? 'linear-gradient(135deg, #ffffff 0%, #e0f2fe 100%)'
      : danger
        ? '#fef2f2'
        : '#ffffff',
    color: primary ? '#ffffff' : danger ? '#991b1b' : '#111827',
    cursor: 'pointer',
    minHeight: '48px',
    boxShadow: primary ? '0 16px 34px rgba(34, 211, 238, 0.18)' : undefined,
  }

  if (primary) {
    style.color = '#08111f'
  }

  return (
    <button type="button" onClick={onClick} style={style}>
      {label}
    </button>
  )
}
