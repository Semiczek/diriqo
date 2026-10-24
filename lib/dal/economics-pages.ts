import 'server-only'

export const ECONOMICS_PAGE_SIZE = 500
const MAX_ECONOMICS_ROWS = 100_000
export type CountedEconomicsPage<T> = { data: T[] | null; error: unknown; count: number | null }

/** Detect API truncation, duplicate pages and a changing row count instead of publishing a partial total. */
export async function readCompleteEconomicsRows<T extends { id: string }>(
  read: (offset: number) => PromiseLike<CountedEconomicsPage<T>>,
): Promise<T[]> {
  const rows: T[] = [], seen = new Set<string>()
  let expected: number | undefined
  do {
    const page = await read(rows.length)
    if (page.error) throw page.error
    if (page.count === null || !Number.isSafeInteger(page.count) || page.count < 0 || page.count > MAX_ECONOMICS_ROWS
      || (expected !== undefined && expected !== page.count) || !Array.isArray(page.data)) {
      throw new Error('Úplnost ekonomických podkladů nelze ověřit. Obnovte přehled.')
    }
    expected = page.count
    if (page.data.length !== Math.min(ECONOMICS_PAGE_SIZE, expected - rows.length)) {
      throw new Error('Ekonomické podklady jsou neúplné. Součet není k dispozici.')
    }
    for (const row of page.data) {
      if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id)) throw new Error('Ekonomické podklady se během načítání změnily. Obnovte přehled.')
      seen.add(row.id); rows.push(row)
    }
  } while (rows.length < expected)
  return rows
}
