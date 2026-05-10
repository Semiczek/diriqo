'use client'

import { useFormStatus } from 'react-dom'

import { useI18n } from '@/components/I18nProvider'

export default function SubmitButton() {
  const { pending } = useFormStatus()
  const { dictionary } = useI18n()

  return (
    <button type="submit" disabled={pending} style={{ ...buttonStyle, opacity: pending ? 0.72 : 1 }}>
      {pending ? dictionary.auth.companyOnboardingSaving : dictionary.auth.companyOnboardingSubmit}
    </button>
  )
}

const buttonStyle = {
  minHeight: 46,
  borderRadius: 8,
  border: 'none',
  background: '#111827',
  color: '#ffffff',
  fontSize: 15,
  fontWeight: 900,
  cursor: 'pointer',
} as const
