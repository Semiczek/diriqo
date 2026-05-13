'use client'

import { useMemo, useState } from 'react'

type Props = {
  token: string
  inviteLink: string
}

export default function InviteBridgeClient({ token, inviteLink }: Props) {
  const [copied, setCopied] = useState(false)
  const mobileDeepLink = useMemo(() => `diriqo://invite/${encodeURIComponent(token)}`, [token])

  return (
    <div style={actionWrapStyle}>
      <a href={mobileDeepLink} style={primaryButtonStyle}>
        Open mobile app
      </a>
      <a href={inviteLink} style={secondaryButtonStyle}>
        Open web worker app
      </a>
      <button
        type="button"
        style={secondaryButtonStyle}
        onClick={async () => {
          await navigator.clipboard.writeText(inviteLink)
          setCopied(true)
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}

const actionWrapStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 18,
} as const

const primaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 44,
  borderRadius: 999,
  border: 0,
  background: '#111827',
  color: '#ffffff',
  padding: '10px 16px',
  fontWeight: 850,
  textDecoration: 'none',
  cursor: 'pointer',
} as const

const secondaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 44,
  borderRadius: 999,
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#0f172a',
  padding: '10px 16px',
  fontWeight: 850,
  textDecoration: 'none',
  cursor: 'pointer',
} as const
