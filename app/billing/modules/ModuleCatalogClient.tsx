'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

import styles from './modules.module.css'

const products = [
  { code: 'diriqo_core', title: 'Základ Diriqa', description: 'Vše pro každodenní práci firmy na jednom místě.', note: 'Zakázky · zákazníci · tým · kalendář · jednoduché nabídky', href: '/jobs', action: 'Otevřít zakázky' },
  { code: 'invoicing', title: 'Fakturace', description: 'Od dokončené zakázky k vystavené faktuře v Kč.', note: 'Pokročilé funkce včetně OCR připravujeme.', href: '/invoices', action: 'Otevřít fakturaci' },
  { code: 'inventory', title: 'Sklad', description: 'Příjmy, výdeje a přehled zásob.', development: 'Skladové obrazovky ještě nejsou dostupné.' },
  { code: 'smart_quotes', title: 'Chytré nabídky', description: 'Rozšířené nabídky a práce s podklady.', development: 'Rozšířené šablony a OCR ještě připravujeme. Jednoduché nabídky už jsou součástí základu.' },
  { code: 'fleet', title: 'Vozidla', description: 'Evidence vozidel a cest.', development: 'Evidence vozidel a jízd ještě není dostupná.' },
  { code: 'ai_assistant', title: 'Diriqent', description: 'Asistent pro práci s firemními podklady.', development: 'Asistenta ještě připravujeme. Testovací licence nespouští placené AI služby.' },
  { code: 'pos', title: 'DiriPOS', description: 'Samostatná pokladna s vlastní licencí.', development: 'Pokladní aplikace a připojení zařízení ještě nejsou dostupné. Testovací licence není připojená pokladna.' },
] as const

type ProductCode = (typeof products)[number]['code']
type Offer = { id: string; product: ProductCode; offerKey: string; unitAmount: number; currency: string; billingInterval: 'month' | 'year' }
type Catalog = { enabled: boolean; offers: Offer[] }
type Purchase = { product: ProductCode; registerId: string | null; isPaidActive: boolean; paidUntil: string | null; isTestActive: boolean; testUntil: string | null; legacyAccess: boolean }
type Remote<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string }
type Props = { companyId: string; checkoutReturn: 'returned' | 'cancelled' | null }

const modulePaths: Record<ProductCode, string> = {
  diriqo_core: 'M4 7h16v13H4z M8 7V4h8v3 M4 12h16 M10 12v3h4v-3',
  invoicing: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3z M9 8h6 M9 12h6',
  inventory: 'm3 7 9-4 9 4v10l-9 4-9-4V7z m0 0 9 4 9-4 M12 11v10 M7.5 5l9 4',
  smart_quotes: 'M5 3h10l4 4v14H5V3z M15 3v5h4 M8 12h8 M8 16h5',
  fleet: 'm4 10 2-6h12l2 6 M3 10h18v8H3z M6 18v2 M18 18v2 M6 14h2 M16 14h2',
  ai_assistant: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z',
  pos: 'M5 3h14v12H5z M8 7h8 M9 15v3 M15 15v3 M4 18h16v3H4z',
}

function ModuleIcon({ product }: { product: ProductCode }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={modulePaths[product]} /></svg>
}

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
      || typeof raw.isTestActive !== 'boolean' || typeof raw.legacyAccess !== 'boolean'
      || (raw.registerId !== null && !nonempty(raw.registerId))
      || (raw.paidUntil !== null && (typeof raw.paidUntil !== 'string' || !Number.isFinite(Date.parse(raw.paidUntil))))) {
      throw new Error('Stav nákupů se nepodařilo ověřit.')
    }
    if (raw.testUntil !== null && (typeof raw.testUntil !== 'string' || !Number.isFinite(Date.parse(raw.testUntil)))) {
      throw new Error('Stav testovacího přístupu se nepodařilo ověřit.')
    }
    return { product: raw.product, registerId: raw.registerId, isPaidActive: raw.isPaidActive, paidUntil: raw.paidUntil,
      isTestActive: raw.isTestActive, testUntil: raw.testUntil, legacyAccess: raw.legacyAccess } as Purchase
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
  const [purchases, setPurchases] = useState<Remote<Purchase[]>>({ status: 'loading' })
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
    const loadCatalog = async () => {
      try {
        const { response, value } = await fetchJson('/api/billing/modules/catalog', controller.signal, { cache: 'no-store' })
        if (!response.ok) throw new Error('catalog_unavailable')
        const data = parseCatalog(value, companyId)
        if (controller.signal.aborted) return
        setCatalog({ status: 'ready', data })
      } catch (error) {
        if (controller.signal.aborted) return
        setCatalog({ status: 'error', message: friendlyError(error, 'Nabídku modulů teď nelze načíst. Zkuste to prosím znovu.') })
      }
    }
    const loadAccess = async () => {
      try {
        const { response: statusResponse, value: statusValue } = await fetchJson('/api/billing/modules', controller.signal, { cache: 'no-store' })
        if (!statusResponse.ok) throw new Error('purchase_status_unavailable')
        const current = parsePurchases(statusValue, companyId)
        if (controller.signal.aborted) return
        setPurchases({ status: 'ready', data: current })
        setCheckoutUncertain(false)
      } catch (error) {
        if (controller.signal.aborted) return
        setPurchases({ status: 'error', message: friendlyError(error, 'Stav licencí teď nelze ověřit. Vaše licence tím nejsou zrušené. Zkuste stav obnovit.') })
      }
    }
    // Purchase availability and existing access are independent. Turning sales off must
    // never hide paid or test licences, and catalog outages must not erase access status.
    await Promise.all([loadCatalog(), loadAccess()])
  }, [companyId])

  useEffect(() => {
    void refresh()
    return () => {
      request.current?.abort()
      checkoutRequest.current?.abort()
    }
  }, [refresh])

  const loading = catalog.status === 'loading' || purchases.status === 'loading'
  const enabled = catalog.status === 'ready' && catalog.data.enabled
  const canPurchase = enabled && purchases.status === 'ready' && !loading && !pendingOffer && !checkoutUncertain
  const testCount = purchases.status === 'ready'
    ? new Set(purchases.data.filter((entry) => entry.isTestActive).map((entry) => entry.product)).size : 0

  async function checkout(offer: Offer) {
    if (!canPurchase || checkoutRequest.current || purchases.status !== 'ready'
      || purchases.data.some((entry) => entry.product === offer.product && (entry.isPaidActive || entry.isTestActive))) return
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
          <strong>{loading ? 'Ověřujeme dostupnost modulů…'
            : testCount > 0 ? `Testovací přístup: ${testCount} ze ${products.length} modulů`
            : catalog.status === 'ready' && !catalog.data.enabled ? 'Nákup modulů zatím není spuštěný'
              : catalog.status === 'error' ? 'Nabídka je dočasně nedostupná'
                : 'Vyberte si, co vaše firma potřebuje'}</strong>
          <p>{testCount > 0 ? 'Zdarma, bez automatické platby. Připravované funkce budou dostupné později.'
            : 'Začněte základem. Další funkce si přidáte podle potřeby.'}</p>
          {testCount > 0 && catalog.status === 'ready' && !catalog.data.enabled ? <p className={styles.salesNote}>Nákupy zatím nejsou spuštěné.</p> : null}
        </div>
        <button type="button" className={styles.secondaryButton} onClick={() => void refresh()} disabled={loading || Boolean(pendingOffer)}>
          {loading ? 'Načítání…' : checkoutReturn ? 'Obnovit stav platby' : 'Obnovit stav'}
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
          const current = purchases.status === 'ready' ? purchases.data.filter((entry) => entry.product === product.code) : []
          const active = current.filter((entry) => entry.isPaidActive)
          const test = current.filter((entry) => entry.isTestActive)
          const legacy = current.some((entry) => entry.legacyAccess)
          const hasActive = active.length > 0 || test.length > 0
          const canOpen = 'href' in product && (hasActive || legacy)
          const paidUntil = active.length === 1 && active[0].paidUntil
            ? new Date(active[0].paidUntil).toLocaleDateString('cs-CZ') : null
          const testUntil = test.length === 1 && test[0].testUntil
            ? new Date(test[0].testUntil).toLocaleDateString('cs-CZ') : null
          return (
            <Fragment key={product.code}>
            {index === 0 || index === 2 ? (
              <div className={styles.sectionHeading}>
                <h2>{index === 0 ? 'Pro každodenní práci' : 'Další možnosti Diriqa'}</h2>
                <p>{index === 0 ? 'Otevřete dostupnou část a začněte pracovat.' : 'Připravujeme. Aktivní licence sama o sobě tyto funkce nezpřístupňuje.'}</p>
              </div>
            ) : null}
            <section className={`${styles.card} ${index < 2 ? styles.availableCard : ''} ${product.code === 'diriqo_core' ? styles.coreCard : ''}`} aria-labelledby={`module-${product.code}`}>
              <div className={styles.cardTop}>
                <span className={styles.moduleIcon}><ModuleIcon product={product.code} /></span>
                <span className={styles.category}>{product.code === 'diriqo_core' ? 'Základ' : 'development' in product ? 'Připravujeme' : 'Doplněk'}</span>
              </div>
              <div>
                <h3 id={`module-${product.code}`}>{product.title}</h3>
                <p className={styles.description}>{product.description}</p>
                {'note' in product ? <p className={styles.note}>{product.note}</p> : null}
              </div>
              {'development' in product ? (
                <details className={styles.development}>
                  <summary>O připravovaném modulu</summary>
                  <p>{product.development}</p>
                </details>
              ) : null}
              <div className={styles.licence}>
                <span className={active.length ? styles.activeBadge : test.length ? styles.testBadge : legacy ? styles.activeBadge : styles.badge}>
                  {purchases.status === 'loading' ? 'Ověřujeme…' : purchases.status === 'error' ? 'Stav neověřen'
                    : active.length ? 'Placená licence' : test.length ? 'Testovací licence' : legacy ? 'Stávající přístup' : 'Bez aktivní licence'}
                </span>
              {active.length > 0 ? (
                <p className={styles.paidStatus}>
                  {product.code === 'pos' ? `Aktivní licence pokladen: ${active.length}. ` : ''}
                  {paidUntil ? `Uhrazeno do ${paidUntil}.` : ''}
                </p>
              ) : null}
              {test.length > 0 ? <p className={styles.testStatus}>Zdarma{testUntil ? ` do ${testUntil}` : ''}</p> : null}
              {legacy && !hasActive ? <p className={styles.note}>V rámci dosavadního přístupu firmy.</p> : null}
              </div>
              <div className={styles.offerList}>
                {canOpen && 'href' in product ? <Link href={product.href} className={styles.primaryButton}>{product.action}<span aria-hidden="true">↗</span></Link> : null}
                {offers.map((offer) => (
                  <div key={offer.id} className={styles.offer}>
                    <div>
                      <p className={styles.variant}>{offer.billingInterval === 'year' ? 'Roční předplatné' : 'Měsíční předplatné'}</p>
                      <p className={styles.price}>{price(offer)} <span>/ {offer.billingInterval === 'year' ? 'rok' : 'měsíc'}</span></p>
                    </div>
                    <button type="button" className={styles.primaryButton} disabled={!canPurchase || hasActive}
                      onClick={() => void checkout(offer)} aria-label={`Vybrat ${product.title}, ${price(offer)} za ${offer.billingInterval === 'year' ? 'rok' : 'měsíc'}`}>
                      {pendingOffer === offer.id ? 'Otevíráme platbu…' : active.length ? 'Již zakoupeno' : test.length ? 'Testovací přístup aktivní' : 'Vybrat'}
                    </button>
                  </div>
                ))}
                {offers.length === 0 && !hasActive && !legacy ? <p className={styles.preparing}>{catalog.status === 'error'
                  ? 'Nabídku teď nelze ověřit.' : loading ? 'Načítáme nabídku…' : 'Nákup zatím není dostupný.'}</p> : null}
              </div>
            </section>
            </Fragment>
          )
        })}
      </div>
      <nav className={styles.quickLinks} aria-label="První kroky a nastavení modulů">
        <Link href="/?onboarding=open">Průvodce nastavením</Link>
        <span aria-hidden="true">·</span>
        <Link href="/settings/company">Nastavení firmy</Link>
        <span aria-hidden="true">·</span>
        <Link href="/billing">Dosavadní tarif</Link>
      </nav>
    </div>
  )
}
