import 'server-only'
import { readCompleteEconomicsRows, type CountedEconomicsPage } from './economics-pages'

/** Preserve an unavailable source as null, including when a later page fails. */
export async function readCompleteFinancialResult<T extends { id: string }>(
  read: (offset: number) => PromiseLike<CountedEconomicsPage<T>>,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  try {
    return { data: await readCompleteEconomicsRows(read), error: null }
  } catch {
    return {
      data: null,
      error: { message: 'Úplnost finančních podkladů nelze ověřit. Součet není k dispozici; obnovte přehled.' },
    }
  }
}
