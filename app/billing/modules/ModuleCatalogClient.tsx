'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import styles from './modules.module.css'

const products = [
  { code: 'diriqo_core', title: 'Základ Diriqa', description: 'Zakázky, lidé a každodenní provoz firmy.', note: 'Jednoduché nabídky patří do základu.' },
  { code: 'inventory', title: 'Sklad', description: 'Příjmy, výdeje a přehled zásob.' },
  { code: 'invoicing', title: 'Fakturace', description: 'Faktury a jejich návaznost na práci firmy.' },
  { code: 'smart_quotes', title: 'Chytré nabídky', description: 'Rozšířené nabídky a práce s podklady.' },
  { code: 'fleet', title: 'Vozidla', description: 'Evidence vozidel a cest.' },
  { code: 'ai_assistant', title: 'Diriqent', description: 'Asistent pro práci s firemními podklady.', note: 'Dostupné AI funkce a rozpočet budou uvedené při spuštění.' },
  { code: 'pos', title: 'DiriPOS', description: 'Samostatná pokladna s vlastní licencí.', note: 'Podporovaná zařízení a terminály budou uvedené u dostupné nabídky.' },
] as const

type ProductCode = (typeof products)[number]['code']
type Offer = { id: string; product: ProductCode; offerKey: string; unitAmount: number; currency: string; billingInterval: 'month' | 'year' }
type Catalog = { enabled: boolean; offers: Offer[] }
type Purchase = { product: ProductCode; registerId: string | null; isPaidActive: boolean; paidUntil: string | null }
type Remote<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string }
type Props = { companyId: string; checkoutReturn: 'returned' | 'cancelled' | null }

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const knownProduct = (value: unknown): value is ProductCode => products.some((product) => product.code === value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const companyChanged = 'Aktivní firma se změnila. Obnovte celou stránku, než budete pokračovat.'

function price(offer: Offer): string {
  const formatter = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: offer.currency.toUpperCase() })
  const minorDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(offer.unitAmount / 10 ** minorDigits)
}

function parseCatalog(value: unknown, companyId: string): Catalog {
  if (!record(value) || value.companyId !== companyId) throw new Error(companyChanged)
  if (typeof value.enabled !== 'boolean' || !Array.isArray(value.offers)) throw new Error('Nabídku modulů se nepodařilo načíst.')
  const offers: Offer[] = []
  const ids = new Set<string>()
  for (const raw of value.offers) {
    if (!record(raw) || !nonempty(raw.id) || ids.has(raw.id) || !knownProduct(raw.product)
      || !nonempty(raw.offerKey) || !Number.isSafeInteger(raw.unitAmount) || (raw.unitAmount as number) <= 0
      || (raw.currency !== 'czk' && raw.currency !== 'eur')
      || (raw.billingInterval !== 'month' && raw.billingInterval !== 'year')) {
      throw new Error('Nabídku modulů se nepodařilo načíst.')
    }
    const offer = raw as Offer
    price(offer)
    offers.push(offer)
    ids.add(offer.id)
  }
  if (!value.enabled && offers.length !== 0) throw new Error('Nabídku modulů se nepodařilo ověřit.')
  return { enabled: value.enabled, offers }
}

function parsePurchases(value: unknown, companyId: string): Purchase[] {
  if (!record(value) || value.companyId !== companyId) throw new Error(companyChanged)
  if (!Array.isArray(value.products)) throw new Error('Stav nákupů se nepodařilo ověřit.')
  return value.products.map((raw) => {
    if (!record(raw) || !knownProduct(raw.product) || typeof raw.isPaidActive !== 'boolean'
      || (raw.registerId !== null && !nonempty(raw.registerId))
      || (raw.paidUntil !== null && (typeof raw.paidUntil !== 'string' || !Number.isFinite(Date.parse(raw.paidUntil))))) {
      throw new Error('Stav nákupů se nepodařilo ověřit.')
    }
    return { product: raw.product, registerId: raw.registerId, isPaidActive: raw.isPaidActive, paidUntil: raw.paidUntil } as Purchase
  })
}

function friendlyError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message === companyChanged ? companyChanged : fallback
}

async function fetchJson(url: string, signal: AbortSignal, init: RequestInit = {}, timeoutMs = 30_000) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(abort, timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const value: unknown = await response.json()
    return { response, value }
  } finally {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

export default function ModuleCatalogClient({ companyId, checkoutReturn }: Props) {
  const [catalog, setCatalog] = useState<Remote<Catalog>>({ status: 'loading' })
  const [purchases, setPurchases] = useState<Remote<Purchase[]> | { status: 'disabled' }>({ status: 'loading' })
  const [pendingOffer, setPendingOffer] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutUncertain, setCheckoutUncertain] = useState(false)
  const request = useRef<AbortController | null>(null)
  const checkoutRequest = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setCatalog({ status: 'loading' })
    setPurchases({ status: 'loading' })
    setCheckoutError(null)
    try {
      const { response, value } = await fetchJson('/api/billing/modules/catalog', controller.signal, { cache: 'no-store' })
      if (!response.ok) throw new Error('catalog_unavailable')
      const data = parseCatalog(value, companyId)
      if (controller.signal.aborted) return
      setCatalog({ status: 'ready', data })
      if (!data.enabled) {
        setPurchases({ status: 'disabled' })
        setCheckoutUncertain(false)
        return
      }
      try {
        const { response: statusResponse, value: statusValue } = await fetchJson('/api/billing/modules', controller.signal, { cache: 'no-store' })
        if (!statusResponse.ok) throw new Error('purchase_status_unavailable')
        const current = parsePurchases(statusValue, companyId)
        if (controller.signal.aborted) return
        setPurchases({ status: 'ready', data: current })
        setCheckoutUncertain(false)
      } catch (error) {
        if (controller.signal.aborted) return
        setPurchases({ status: 'error', message: friendlyError(error, 'Stav nákupů teď nelze ověřit. Neznamená to, že žádný modul nemáte zakoupený.') })
      }
    } catch (error) {
      if (controller.signal.aborted) return
      setCatalog({ status: 'error', message: friendlyError(error, 'Nabídku modulů teď nelze načíst. Zkuste to prosím znovu.') })
      setPurchases({ status: 'disabled' })
    }
  }, [companyId])

  useEffect(() => {
    void refresh()
    return () => {
      request.current?.abort()
      checkoutRequest.current?.abort()
    }
  }, [refresh])

  const loading = catalog.status === 'loading' || purchases.status === 'loading'
  const unknown = catalog.status === 'error' || purchases.status === 'error'
  const enabled = catalog.status === 'ready' && catalog.data.enabled
  const canPurchase = enabled && purchases.status === 'ready' && !loading && !pendingOffer && !checkoutUncertain

  async function checkout(offer: Offer) {
    if (!canPurchase || checkoutRequest.current || purchases.status !== 'ready'
      || purchases.data.some((entry) => entry.product === offer.product && entry.isPaidActive)) return
    const controller = new AbortController()
    checkoutRequest.current = controller
    setPendingOffer(offer.id)
    setCheckoutError(null)
    let serverMessage: string | null = null
    try {
      const { response, value: result } = await fetchJson('/api/billing/modules/checkout', controller.signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Diriqo-Company': companyId },
        body: JSON.stringify({ offerId: offer.id }),
      }, 60_000)
      if (!response.ok) {
        if (record(result) && result.code === 'company_changed') serverMessage = companyChanged
        else if (record(result) && typeof result.error === 'string' && result.error.trim().length > 0 && result.error.length <= 400) {
          serverMessage = result.error
        }
        throw new Error('checkout_unavailable')
      }
      if (!record(result) || !nonempty(result.url) || !nonempty(result.orderId)) throw new Error('checkout_unavailable')
      const destination = new URL(result.url)
      if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.stripe.com') throw new Error('checkout_unavailable')
      if (controller.signal.aborted) return
      window.location.assign(destination.href)
    } catch (error) {
      if (controller.signal.aborted) return
      setCheckoutError(serverMessage ?? friendlyError(error, 'Platbu se nepodařilo otevřít. Obnovte stav nákupů před dalším pokusem.'))
      setCheckoutUncertain(true)
      setPendingOffer(null)
      checkoutRequest.current = null
    }
  }

  return (
    <div className={styles.content}>
      {checkoutReturn ? (
        <section className={styles.notice} aria-label="Návrat z platby">
          <strong>{checkoutReturn === 'returned' ? 'Vítejte zpět z platební stránky' : 'Zpět na výběru modulů'}</strong>
          <p>{checkoutReturn === 'returned'
            ? 'Samotný návrat nepotvrzuje úhradu. Níže zobrazujeme stav ověřený na serveru; potvrzení platby může chvíli trvat.'
            : 'Tento návrat nemění vaše nákupy. Pokud si stavem platby nejste jistí, obnovte ho níže.'}</p>
        </section>
      ) : null}

      <section className={styles.summary} aria-label="Dostupnost modulů">
        <div aria-live="polite" aria-atomic="true">
          <strong>{loading ? 'Načítáme nabídku a stav nákupů…'
            : catalog.status === 'ready' && !catalog.data.enabled ? 'Nákup modulů zatím není spuštěný'
              : catalog.status === 'error' ? 'Nabídka je dočasně nedostupná'
                : 'Vyberte si, co vaše firma potřebuje'}</strong>
          <p>{catalog.status === 'ready' && !catalog.data.enabled
            ? 'Základ a doplňky připravujeme k samostatnému nákupu. Ceny se zobrazí u zveřejněných nabídek.'
            : 'Stávající předplatné najdete také v přehledu předplatného. Stav této stránky se ověřuje samostatně.'}</p>
        </div>
        <button type="button" className={styles.secondaryButton} onClick={() => void refresh()} disabled={loading || Boolean(pendingOffer)}>
          {loading ? 'Načítání…' : checkoutReturn ? 'Obnovit stav platby' : 'Obnovit nabídku a stav'}
        </button>
      </section>

      {catalog.status === 'error' || purchases.status === 'error' || checkoutError ? (
        <div className={styles.error} role="alert">
          {catalog.status === 'error' ? <p>{catalog.message}</p> : null}
          {purchases.status === 'error' ? <p>{purchases.message}</p> : null}
          {checkoutError ? <p>{checkoutError}</p> : null}
          {(catalog.status === 'error' && catalog.message === companyChanged)
            || (purchases.status === 'error' && purchases.message === companyChanged) || checkoutError === companyChanged ? (
              <button type="button" className={styles.secondaryButton} onClick={() => window.location.reload()}>Obnovit celou stránku</button>
            ) : null}
        </div>
      ) : null}

      <div className={styles.grid} aria-busy={loading}>
        {products.map((product, index) => {
          const offers = catalog.status === 'ready' && catalog.data.enabled ? catalog.data.offers.filter((offer) => offer.product === product.code) : []
          const active = purchases.status === 'ready' ? purchases.data.filter((entry) => entry.product === product.code && entry.isPaidActive) : []
          const hasActive = active.length > 0
          const paidUntil = active.length === 1 && active[0].paidUntil
            ? new Date(active[0].paidUntil).toLocaleDateString('cs-CZ') : null
          return (
            <section key={product.code} className={`${styles.card} ${product.code === 'diriqo_core' ? styles.coreCard : ''}`} aria-labelledby={`module-${product.code}`}>
              <div className={styles.cardTop}>
                <span className={styles.moduleNumber} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <span className={hasActive ? styles.activeBadge : styles.badge}>
                  {hasActive ? 'Aktivní licence' : unknown ? 'Stav neověřen'
                    : loading ? 'Ověřujeme…' : offers.length ? 'Nabídka' : 'Připravujeme'}
                </span>
              </div>
              <div>
                <p className={styles.cardEyebrow}>{product.code === 'diriqo_core' ? 'Základ' : 'Samostatný doplněk'}</p>
                <h2 id={`module-${product.code}`}>{product.title}</h2>
                <p className={styles.description}>{product.description}</p>
                {'note' in product ? <p className={styles.note}>{product.note}</p> : null}
              </div>
              {hasActive ? (
                <p className={styles.paidStatus}>
                  {product.code === 'pos' ? `Evidované aktivní licence pokladen: ${active.length}. ` : 'Evidujeme aktivní placené období. '}
                  {paidUntil ? `Uhrazeno do ${paidUntil}.` : ''}
                </p>
              ) : null}
              <div className={styles.offerList}>
                {offers.map((offer) => (
                  <div key={offer.id} className={styles.offer}>
                    <div>
                      <p className={styles.variant}>{offer.billingInterval === 'year' ? 'Roční předplatné' : 'Měsíční předplatné'}</p>
                      <p className={styles.price}>{price(offer)} <span>/ {offer.billingInterval === 'year' ? 'rok' : 'měsíc'}</span></p>
                    </div>
                    <button type="button" className={styles.primaryButton} disabled={!canPurchase || hasActive}
                      onClick={() => void checkout(offer)} aria-label={`Vybrat ${product.title}, ${price(offer)} za ${offer.billingInterval === 'year' ? 'rok' : 'měsíc'}`}>
                      {pendingOffer === offer.id ? 'Otevíráme platbu…' : hasActive ? 'Již zakoupeno' : 'Vybrat'}
                    </button>
                  </div>
                ))}
                {offers.length === 0 ? <p className={styles.preparing}>{catalog.status === 'error'
                  ? 'Nabídku teď nelze ověřit.' : loading ? 'Načítáme nabídku…' : 'Zveřejněnou nabídku zatím nemáme k dispozici.'}</p> : null}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
