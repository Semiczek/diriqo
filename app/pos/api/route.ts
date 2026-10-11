import { csvCell, validateEnvelope } from '@/lib/pos/domain'
import { databaseError, PosError, posContext, readPos } from '@/lib/pos/server'
import type { History } from '@/lib/pos/types'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
function failure(error: unknown) {
  return Response.json({ error: error instanceof PosError ? error.message : 'Výsledek operace se nepodařilo ověřit. Zopakujte původní požadavek; nevytvářejte nový prodej.' }, { status: error instanceof PosError ? error.status : 503, headers })
}
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams
    const company = query.get('company') ?? ''
    const mode = query.get('mode') ?? 'bootstrap'
    if (!['bootstrap', 'workspace', 'catalog', 'receipt', 'history', 'shifts', 'cash', 'export'].includes(mode)) throw new PosError('Neplatné zobrazení.', 400)
    const params: Record<string, string> = {}
    for (const key of ['browser_id', 'search', 'offset', 'include_archived', 'id', 'kind', 'before', 'from', 'until']) {
      if (query.has(key)) params[key] = query.get(key)!
    }
    const data = await readPos(company, query.get('register'), mode, params)
    if (mode === 'export') {
      const history = data as History
      if (history.has_more) throw new PosError('Výběr přesahuje 10 000 dokladů. Zkraťte období; nebyl exportován neúplný soubor.', 400)
      const rows = [['Doklad', 'Typ', 'Vytvořeno', 'Platba', 'Cena Kč', 'Uhrazeno / vráceno Kč'],
        ...history.rows.map(row => [row.document_no, row.kind === 'sale' ? 'Prodej' : 'Vratka', row.created_at, row.payment_method === 'cash' ? 'Hotovost' : 'Externě evidovaná', row.total_minor / 100, row.paid_minor / 100])]
      return new Response('\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n'), {
        headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="diripos-doklady.csv"' },
      })
    }
    return Response.json({ companyId: company, data }, { headers })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new PosError('Neplatný původ požadavku.', 403)
    const text = await request.text()
    if (text.length > 100_000) throw new PosError('Požadavek je příliš velký.', 400)
    let input: ReturnType<typeof validateEnvelope>
    try { input = validateEnvelope(JSON.parse(text)) }
    catch { throw new PosError('Požadavek nemá platný formát.', 400) }
    const { supabase } = await posContext(input.companyId)
    const { data, error } = await supabase.rpc('pos_command', {
      company_id: input.companyId, register_id: input.registerId, event_id: input.eventId, command: input.command, payload: input.payload,
    })
    if (error) databaseError(error)
    return Response.json({ companyId: input.companyId, data }, { headers })
  } catch (error) { return failure(error) }
}
