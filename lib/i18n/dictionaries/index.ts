import 'server-only'

import { DEFAULT_LOCALE, type Locale } from '../config'
import { csDictionary } from './cs'
import { deDictionary } from './de'
import { enDictionary } from './en'
import type { TranslationDictionary } from './types'

const dictionaries: Record<Locale, TranslationDictionary> = {
  cs: csDictionary,
  en: enDictionary,
  de: deDictionary,
}

export type { TranslationDictionary } from './types'

export async function getDictionary(locale: Locale): Promise<TranslationDictionary> {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE]
}
