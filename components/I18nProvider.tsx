'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { Locale } from '@/lib/i18n/config'
import type { TranslationDictionary } from '@/lib/i18n/dictionaries/types'

type I18nContextValue = {
  locale: Locale
  dictionary: TranslationDictionary
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale
  dictionary: TranslationDictionary
  children: ReactNode
}) {
  return (
    <I18nContext.Provider value={{ locale, dictionary }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)

  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }

  return context
}
