import type { CtaActionType } from './types'
export type PendingOfferResponse = {
  token: string; context: 'public' | 'portal'; actorId: string | null; versionId: string; operationId: string
  actionType: CtaActionType; customerName: string; customerEmail: string; customerPhone: string
  note: string; visitorId: string; website: string; openedAt: number
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function offerResponseKey(context: string, token: string, versionId: string, actorId: string | null = null) {
  return `diriqo:offer-response:v1:${context}:${actorId || 'anonymous'}:${token}:${versionId}`
}
export function restoreOfferResponse(raw: string | null, context: string, token: string, versionId: string, actorId: string | null = null): PendingOfferResponse | null {
  if (!raw) return null
  const value = JSON.parse(raw)
  if (!value || value.context !== context || value.token !== token || value.versionId !== versionId || value.actorId !== actorId
    || (context === 'portal' && (!actorId || !uuid.test(actorId)))
    || !uuid.test(value.operationId) || !uuid.test(value.versionId)
    || !['interested','contact_requested','revision_requested','not_interested'].includes(value.actionType)
    || !['customerName','customerEmail','customerPhone','note','visitorId','website'].every(key => typeof value[key] === 'string')
    || typeof value.openedAt !== 'number') throw new Error('Uložený požadavek nelze ověřit. Neodesílejte novou reakci, dokud se nepotvrdí původní výsledek.')
  return value
}
export function saveOfferResponse(storage: Pick<Storage, 'setItem' | 'getItem'>, value: PendingOfferResponse) {
  const key = offerResponseKey(value.context, value.token, value.versionId, value.actorId)
  const raw = JSON.stringify(value)
  storage.setItem(key, raw)
  if (storage.getItem(key) !== raw) throw new Error('Požadavek nelze bezpečně uložit pro případ výpadku. Povolte úložiště tohoto panelu.')
}
