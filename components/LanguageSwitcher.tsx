'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { LOCALES, type Locale } from '@/lib/i18n/config'
import { useI18n } from './I18nProvider'

const LANGUAGE_LABELS: Record<Locale, string> = {
  cs: 'Čeština',
  en: 'English',
  de: 'Deutsch',
}

export default function LanguageSwitcher({
  variant = 'light',
  compact = false,
}: {
  variant?: 'light' | 'dark'
  compact?: boolean
}) {
  const router = useRouter()
  const { locale, dictionary } = useI18n()
  const [isSaving, setIsSaving] = useState(false)
  const isDark = variant === 'dark'

  async function handleChange(nextLocale: Locale) {
    if (nextLocale === locale) return

    setIsSaving(true)

    try {
      await fetch('/api/locale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ locale: nextLocale }),
      })

      router.refresh()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <label
      style={{
        display: 'grid',
        gap: compact ? '3px' : '6px',
        fontSize: compact ? '12px' : '13px',
        fontWeight: 600,
        color: isDark ? 'rgba(255,255,255,0.82)' : '#6b7280',
      }}
    >
      <span>{dictionary.common.language}</span>
      <select
        value={locale}
        disabled={isSaving}
        onChange={(event) => handleChange(event.target.value as Locale)}
        style={{
          minWidth: compact ? '118px' : '132px',
          borderRadius: compact ? '9px' : '10px',
          border: isDark ? '1px solid rgba(255,255,255,0.18)' : '1px solid #d1d5db',
          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#ffffff',
          color: isDark ? '#ffffff' : '#111827',
          padding: compact ? '7px 10px' : '10px 12px',
          fontSize: compact ? '13px' : '14px',
          fontWeight: 600,
          cursor: isSaving ? 'wait' : 'pointer',
        }}
      >
        {LOCALES.map((supportedLocale) => (
          <option key={supportedLocale} value={supportedLocale}>
            {LANGUAGE_LABELS[supportedLocale]}
          </option>
        ))}
      </select>
    </label>
  )
}
