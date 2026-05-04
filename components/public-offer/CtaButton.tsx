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
    fontWeight: 700,
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: primary ? 'none' : danger ? '1px solid #fecaca' : '1px solid #cbd5e1',
    backgroundColor: primary ? '#111827' : danger ? '#fef2f2' : '#ffffff',
    color: primary ? '#ffffff' : danger ? '#991b1b' : '#111827',
    cursor: 'pointer',
    minHeight: '48px',
  }

  return (
    <button type="button" onClick={onClick} style={style}>
      {label}
    </button>
  )
}
