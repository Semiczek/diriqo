'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { lineTotal, money, moneyInput, payableTotal, quantityInput, validateEnvelope, type PaymentMethod, type PosCommand } from '@/lib/pos/domain'
import type { Bootstrap, CommandResult, History, Item, Receipt, Shift, Workspace } from '@/lib/pos/types'
import styles from './pos.module.css'

type Intent = ReturnType<typeof validateEnvelope>
type Tab = 'sale' | 'catalog' | 'history' | 'shifts' | 'settings'
type CartLine = { item: Item; amount: string }
type Catalog = { items: Item[]; has_more: boolean }
const dateTime = (value: string) => new Date(value).toLocaleString('cs-CZ')
const field = (form: FormData, key: string) => String(form.get(key) ?? '')

export default function PosClient({ companyId }: { companyId: string }) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  const [registerId, setRegisterId] = useState('')
  const [browserId, setBrowserId] = useState('')
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [catalog, setCatalog] = useState<Catalog>({ items: [], has_more: false })
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [tab, setTab] = useState<Tab>('sale')
  const [cart, setCart] = useState<CartLine[]>([])
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [tendered, setTendered] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [pending, setPending] = useState<Intent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastDocument, setLastDocument] = useState<{ id: string; kind: 'sale' | 'return' } | null>(null)
  const [editing, setEditing] = useState<Item | null>(null)
  const [history, setHistory] = useState<History | null>(null)
  const [historyCursors, setHistoryCursors] = useState<number[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateUntil, setDateUntil] = useState('')
  const [shifts, setShifts] = useState<{ rows: Shift[]; has_more: boolean } | null>(null)
  const [shiftOffset, setShiftOffset] = useState(0)
  const [cash, setCash] = useState<{ rows: { id: string; created_at: string; amount_minor: number; reason: string }[]; has_more: boolean } | null>(null)
  const [cashOffset, setCashOffset] = useState(0)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const busyRef = useRef(false)
  const requestVersion = useRef(0)
  const storageKey = useCallback((id: string) => `diriqo-pos-pending:${companyId}:${id}`, [companyId])

  const get = useCallback(async <T,>(mode: string, id: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> => {
    const query = new URLSearchParams({ company: companyId, mode, ...params })
    if (id) query.set('register', id)
    const response = await fetch(`/pos/api?${query}`, { cache: 'no-store', signal })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? 'Data se nepodařilo načíst.')
    if (result.companyId !== companyId) throw new Error('Firma se změnila. Obnovte stránku.')
    return result.data as T
  }, [companyId])

  const reload = useCallback(async (id = registerId) => {
    const version = ++requestVersion.current
    const [nextBootstrap, nextWorkspace, nextCatalog] = await Promise.all([
      get<Bootstrap>('bootstrap', ''), id ? get<Workspace>('workspace', id, { browser_id: browserId }) : Promise.resolve(null),
      id ? get<Catalog>('catalog', id, { search, offset: String(offset), include_archived: String(includeArchived && tab === 'catalog') }) : Promise.resolve(null),
    ])
    if (requestVersion.current !== version) return
    setBootstrap(nextBootstrap)
    setWorkspace(nextWorkspace)
    if (nextCatalog) setCatalog({ ...nextCatalog, items: nextCatalog.items.slice(0, 50) })
  }, [get, registerId, browserId, search, offset, includeArchived, tab])

  useEffect(() => {
    const controller = new AbortController()
    get<Bootstrap>('bootstrap', '', {}, controller.signal).then(data => {
      let browser = localStorage.getItem('diriqo-pos-browser')
      if (!browser) { browser = crypto.randomUUID(); localStorage.setItem('diriqo-pos-browser', browser) }
      setBrowserId(browser)
      setBootstrap(data)
      setRegisterId(data.registers[0]?.id ?? '')
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Pokladnu se nepodařilo načíst.') })
    return () => controller.abort()
  }, [get])

  useEffect(() => {
    if (!registerId || !browserId) return
    const controller = new AbortController()
    get<Workspace>('workspace', registerId, { browser_id: browserId }, controller.signal).then(data => {
      if (controller.signal.aborted) return
      setWorkspace(data)
      const stored = localStorage.getItem(storageKey(registerId))
      if (stored) {
        const intent = validateEnvelope(JSON.parse(stored))
        if (intent.companyId !== companyId || intent.registerId !== registerId) throw new Error('Uložený požadavek nepatří k této pokladně.')
        setPending(intent)
      } else setPending(null)
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Stav pokladny se nepodařilo načíst.') })
    return () => controller.abort()
  }, [browserId, companyId, get, registerId, storageKey])

  useEffect(() => {
    if (!registerId) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      get<Catalog>('catalog', registerId, { search, offset: String(offset), include_archived: String(includeArchived && tab === 'catalog') }, controller.signal)
        .then(data => { if (!controller.signal.aborted) setCatalog({ ...data, items: data.items.slice(0, 50) }) })
        .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Katalog se nepodařilo načíst.') })
    }, 180)
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [get, includeArchived, offset, registerId, search, tab])

  const range = useCallback(() => {
    const params: Record<string, string> = {}
    if (dateFrom) params.from = new Date(`${dateFrom}T00:00:00`).toISOString()
    if (dateUntil) { const end = new Date(`${dateUntil}T00:00:00`); end.setDate(end.getDate() + 1); params.until = end.toISOString() }
    return params
  }, [dateFrom, dateUntil])
  useEffect(() => {
    if (!registerId || tab !== 'history') return
    const controller = new AbortController()
    const params = range()
    if (historyCursors.length) params.before = String(historyCursors[historyCursors.length - 1])
    get<History>('history', registerId, params, controller.signal).then(data => {
      if (!controller.signal.aborted) setHistory({ ...data, rows: data.rows.slice(0, 50) })
    }).catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [get, historyCursors, range, registerId, tab, notice])
  useEffect(() => {
    if (!registerId || tab !== 'shifts') return
    const controller = new AbortController()
    get<{ rows: Shift[]; has_more: boolean }>('shifts', registerId, { offset: String(shiftOffset) }, controller.signal).then(data => {
      if (!controller.signal.aborted) setShifts({ ...data, rows: data.rows.slice(0, 50) })
    }).catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [get, registerId, shiftOffset, tab, notice])
  useEffect(() => {
    if (!registerId || tab !== 'shifts') return
    const controller = new AbortController()
    get<NonNullable<typeof cash>>('cash', registerId, { offset: String(cashOffset) }, controller.signal).then(data => {
      if (!controller.signal.aborted) setCash({ ...data, rows: data.rows.slice(0, 50) })
    }).catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [cashOffset, get, registerId, tab, notice])

  async function execute(intent: Intent) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 30_000)
    try {
      if (!navigator.locks) throw new Error('Tento prohlížeč nepodporuje bezpečný provoz pokladny ve více záložkách. Použijte aktuální prohlížeč.')
      await navigator.locks.request(`diriqo-pos:${companyId}:${intent.registerId}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('V jiné záložce této pokladny se právě ukládá operace. Vyčkejte na její výsledek a obnovte stav.')
        const stored = localStorage.getItem(storageKey(intent.registerId))
        if (stored) {
          const previous = validateEnvelope(JSON.parse(stored))
          if (previous.eventId !== intent.eventId) {
            setPending(previous)
            throw new Error('Jiná záložka zanechala nepotvrzenou operaci. Nejprve ověřte její původní výsledek tlačítkem níže.')
          }
        }
        // Persist the exact intent before transport. A lost response only retries this ID/payload.
        localStorage.setItem(storageKey(intent.registerId), JSON.stringify(intent))
        setPending(intent)
        const response = await fetch('/pos/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(intent), signal: controller.signal })
        const result = await response.json()
        if (!response.ok) {
          if ([400, 403, 409].includes(response.status)) { localStorage.removeItem(storageKey(intent.registerId)); setPending(null) }
          throw new Error(result.error ?? 'Výsledek operace není jistý. Zopakujte původní požadavek.')
        }
        if (result.companyId !== companyId) throw new Error('Firma se změnila. Neopakujte platbu; ověřte původní doklad.')
        const data = result.data as CommandResult
        localStorage.removeItem(storageKey(intent.registerId)); setPending(null)
        if (intent.command === 'sale') { setCart([]); setTendered(''); setPaymentNote('') }
        if (data.sale_id || data.return_id) setLastDocument({ id: data.return_id ?? data.sale_id!, kind: data.return_id ? 'return' : 'sale' })
        setReceipt(null)
        setNotice(data.document_no ? `${data.replayed ? 'Dohledán původní doklad' : 'Uloženo'}: ${data.document_no}.${data.change_minor ? ` Vrátit zákazníkovi ${money(data.change_minor)}.` : ''}${data.refund_minor !== undefined ? ` Vratka ${money(data.refund_minor)}.` : ''}`
          : data.difference_minor !== undefined ? `Směna uzavřena. Rozdíl hotovosti: ${money(data.difference_minor)}.` : 'Změna byla uložena.')
        if (intent.command === 'register_save' && !registerId) setRegisterId(intent.registerId)
        await reload(intent.registerId)
        if (intent.command === 'catalog_save') setEditing(null)
      })
    } catch (err) { setError(err instanceof Error ? err.message : 'Operace se nezdařila. Ověřte připojení a původní výsledek.') }
    finally { window.clearTimeout(timeout); busyRef.current = false; setBusy(false) }
  }
  function command(op: PosCommand, payload: Record<string, unknown>, id = registerId) {
    if (pending || busyRef.current) return
    void execute({ companyId, registerId: id, eventId: crypto.randomUUID(), command: op, payload })
  }
  function submit(event: FormEvent<HTMLFormElement>, build: (data: FormData) => void) {
    event.preventDefault(); setError('')
    try { build(new FormData(event.currentTarget)) } catch (err) { setError(err instanceof Error ? err.message : 'Zkontrolujte hodnoty.') }
  }
  function selectRegister(id: string) {
    if (pending || busy) return
    requestVersion.current++; setRegisterId(id); setWorkspace(null); setCart([]); setEditing(null); setReceipt(null); setLastDocument(null); setHistory(null); setHistoryCursors([]); setOffset(0); setSearch('')
  }
  function add(item: Item) {
    if (pending || busy) return
    setCart(lines => {
      const current = lines.find(line => line.item.id === item.id)
      if (!current) return [...lines, { item, amount: '1' }]
      return lines.map(line => line.item.id === item.id ? { ...line, amount: String((quantityInput(line.amount) + 1000) / 1000) } : line)
    })
  }
  let total = 0
  let invalidCart = false
  try { for (const line of cart) total += lineTotal(line.item.sale_price_minor, quantityInput(line.amount)) } catch { invalidCart = true }
  const payable = payableTotal(total, method)
  const blocked = busy || Boolean(pending)
  const currentShift = workspace?.shift
  const sessionReady = Boolean(currentShift?.this_browser)
  function receiptHref(id: string, kind: 'sale' | 'return') {
    return `/pos/receipt/${id}?${new URLSearchParams({ company: companyId, register: registerId, kind })}`
  }
  async function openReturn(id: string) {
    try { setReceipt(await get<Receipt>('receipt', registerId, { id, kind: 'sale' })); setError('') } catch (err) { setError(err instanceof Error ? err.message : 'Doklad nelze načíst.') }
  }
  async function exportHistory() {
    try {
      const response = await fetch(`/pos/api?${new URLSearchParams({ company: companyId, register: registerId, mode: 'export', ...range() })}`, { cache: 'no-store' })
      if (!response.ok) throw new Error((await response.json()).error)
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a')
      link.href = url; link.download = 'diripos-doklady.csv'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) { setError(err instanceof Error ? err.message : 'Export se nepodařil.') }
  }

  return <>
    <p className={styles.notice}>Hotovost a ručně evidovaná externí platba. Pokladna neovládá terminál, USB tiskárnu ani zásuvku. K vystavení prodeje je nutné připojení.</p>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.success} role="status">{notice} {lastDocument ? <Link target="_blank" rel="noopener" href={receiptHref(lastDocument.id, lastDocument.kind)}>Otevřít doklad / tisk kopie</Link> : null}</div> : null}
    {pending ? <section className={styles.warning} aria-label="Nevyřízený požadavek"><strong>Uložený požadavek čeká na potvrzení.</strong><p>Nevytvářejte znovu stejný prodej. Opakováním dohledáme výsledek stejné operace; již uložená operace se neprovede podruhé.</p><button disabled={busy} onClick={() => void execute(pending)}>{busy ? 'Ověřujeme…' : 'Ověřit / zopakovat původní požadavek'}</button></section> : null}
    {!bootstrap ? <p role="status">Načítáme pokladny…</p> : <>
      <section className={styles.toolbar}>
        <label>Pokladna<select value={registerId} onChange={event => selectRegister(event.target.value)} disabled={blocked}>{!registerId ? <option value="">Vyberte pokladnu</option> : null}{bootstrap.registers.map(register => <option key={register.id} value={register.id}>{register.name}</option>)}</select></label>
        <button type="button" disabled={busy} onClick={() => void reload().catch(err => setError(err.message))}>Obnovit stav</button>
        {workspace ? <span>{workspace.register.warehouse_id ? 'Skladová evidence zapnutá' : 'Prodej bez skladové evidence'}</span> : null}
      </section>
      {bootstrap.available_licences.length > 0 && bootstrap.can_manage ? <section className={styles.panel}><h2>Založit pokladnu z licence</h2><form onSubmit={event => submit(event, form => command('register_save', { name: field(form, 'name'), warehouse_id: null }, field(form, 'licence')))}><fieldset disabled={blocked}><div className={styles.formGrid}><label>Licence pokladny<select name="licence">{bootstrap.available_licences.map(id => <option key={id} value={id}>{id}</option>)}</select></label><label>Název<input name="name" required maxLength={100} placeholder="Hlavní pokladna" /></label></div><button type="submit">Založit pokladnu</button></fieldset></form></section> : null}
      {!bootstrap.registers.length && !bootstrap.available_licences.length ? <section className={styles.panel}><h2>Pokladna zatím není dostupná</h2><p>Je potřeba licence konkrétní pokladny a přístup obsluhy. Jádro Diriqa ani sklad nejsou podmínkou.</p>{bootstrap.can_manage ? <Link href="/billing/modules">Základ a moduly</Link> : <p>Požádejte správce firmy o přiřazení k pokladně.</p>}</section> : null}
      {registerId ? <nav className={styles.tabs} aria-label="Části pokladny">{([['sale', 'Prodej'], ['catalog', 'Katalog'], ['history', 'Doklady a vratky'], ['shifts', 'Směny'], ['settings', 'Nastavení']] as const).filter(([key]) => key !== 'settings' || bootstrap.can_manage).map(([key, title]) => <button type="button" key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => { setTab(key); setReceipt(null) }}>{title}</button>)}</nav> : null}

      {workspace && (tab === 'sale' || tab === 'catalog') ? <div className={tab === 'sale' ? styles.saleGrid : styles.stack}>
        <section className={styles.panel}><h2>{tab === 'sale' ? 'Vyberte položky' : 'Sdílený katalog'}</h2><div className={styles.toolbar}><label>Hledat název nebo kód<input type="search" value={search} onChange={event => { setSearch(event.target.value); setOffset(0) }} placeholder="Název nebo SKU" /></label>{tab === 'catalog' && workspace.can_manage ? <label className={styles.check}><input type="checkbox" checked={includeArchived} onChange={event => { setIncludeArchived(event.target.checked); setOffset(0) }} />Včetně archivovaných</label> : null}</div>
          <div className={styles.products}>{catalog.items.map(item => <button type="button" key={item.id} className={styles.product} disabled={tab === 'sale' ? blocked || item.archived || !workspace.can_sell : !workspace.can_catalog} onClick={() => tab === 'sale' ? add(item) : setEditing(item)}><strong>{item.name}</strong><span>{item.sku || 'Bez kódu'} · {item.unit}{item.archived ? ' · archivováno' : ''}</span><b>{money(item.sale_price_minor)}</b></button>)}</div>
          {!catalog.items.length ? <p>Žádné položky v tomto výběru.{workspace.can_catalog ? ' Přidejte položku v části Katalog.' : ''}</p> : null}
          <div className={styles.toolbar}><button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Předchozí</button><span>Položky {offset + 1}–{offset + catalog.items.length}</span><button disabled={!catalog.has_more} onClick={() => setOffset(value => value + 50)}>Další</button></div>
        </section>
        {tab === 'catalog' && workspace.can_catalog ? <section className={styles.panel}><h2>{editing ? `Upravit: ${editing.name}` : 'Nová položka'}</h2><p>Cena zahrnuje zvolenou DPH. Katalog je společný se skladem; samotný prodejní katalog skladovou licenci nevyžaduje.</p><form key={editing?.id ?? 'new'} onSubmit={event => submit(event, form => command('catalog_save', {
          id: editing?.id ?? null, version: editing?.version ?? null, name: field(form, 'name'), sku: field(form, 'sku'), unit: field(form, 'unit'), kind: field(form, 'kind'), price_minor: moneyInput(field(form, 'price')), tax_rate: Number(field(form, 'tax')), archived: form.has('archived'),
        }))}><fieldset disabled={blocked}><div className={styles.formGrid}><label>Název<input name="name" defaultValue={editing?.name} required maxLength={160} /></label><label>Kód SKU<input name="sku" defaultValue={editing?.sku} maxLength={80} /></label><label>Cena v Kč<input name="price" inputMode="decimal" defaultValue={editing ? String(editing.sale_price_minor / 100) : ''} required /></label><label>DPH<select name="tax" defaultValue={editing?.tax_rate ?? 21}><option value="0">0 % / bez DPH</option><option value="12">12 %</option><option value="21">21 %</option></select></label><label>Jednotka<input name="unit" defaultValue={editing?.unit ?? 'ks'} required maxLength={20} /></label><label>Typ<select name="kind" defaultValue={editing?.kind ?? 'nonstock'}><option value="nonstock">Neskladová položka</option><option value="stock">Skladová položka</option><option value="service">Služba</option></select></label><label className={styles.check}><input type="checkbox" name="archived" defaultChecked={editing?.archived} />Archivovat položku</label></div><button type="submit">{editing ? 'Uložit změny' : 'Přidat položku'}</button>{editing ? <button type="button" onClick={() => setEditing(null)}>Zrušit úpravu</button> : null}</fieldset></form></section> : null}
        {tab === 'sale' ? <section className={styles.panel}><h2>Košík</h2>{!workspace.can_sell ? <p className={styles.warning}>Nové prodeje nyní nemají platnou licenci. Historie a povolené vypořádání zůstávají dostupné.</p> : null}
          {!currentShift ? <p className={styles.warning}>Nejprve otevřete směnu v části Směny.</p> : !sessionReady ? <p className={styles.warning}>Směna je otevřená v jiném prohlížeči. Tady lze číst historii.</p> : <p>Otevřená směna · evidovaná hotovost {money(currentShift.expected_minor)}</p>}
          {cart.map(line => <div className={styles.cartLine} key={line.item.id}><div><strong>{line.item.name}</strong><small>{money(line.item.sale_price_minor)} / {line.item.unit}</small></div><label>Množství<input aria-label={`Množství: ${line.item.name}`} inputMode="decimal" value={line.amount} disabled={blocked} onChange={event => setCart(lines => lines.map(entry => entry.item.id === line.item.id ? { ...entry, amount: event.target.value } : entry))} /></label><button aria-label={`Odebrat ${line.item.name}`} disabled={blocked} onClick={() => setCart(lines => lines.filter(entry => entry.item.id !== line.item.id))}>×</button></div>)}
          {!cart.length ? <p>Košík je prázdný.</p> : null}<p className={styles.total}>{money(payable)}</p>{method === 'cash' && payable !== total ? <p>Zaokrouhlení hotovosti: {money(payable - total)}</p> : null}
          <form onSubmit={event => submit(event, () => command('sale', { shift_id: currentShift?.id, browser_id: browserId, payment_method: method, payment_note: paymentNote, tendered_minor: method === 'cash' ? moneyInput(tendered) : payable, lines: cart.map(line => ({ item_id: line.item.id, version: line.item.version, quantity: quantityInput(line.amount) / 1000 })) }))}><fieldset disabled={blocked || !workspace.can_sell || !sessionReady || !cart.length || invalidCart}><label>Způsob úhrady<select value={method} onChange={event => setMethod(event.target.value as PaymentMethod)}><option value="cash">Hotovost</option><option value="external">Externě přijatá platba — ruční evidence</option></select></label>{method === 'cash' ? <label>Přijato od zákazníka v Kč<input inputMode="decimal" value={tendered} onChange={event => setTendered(event.target.value)} required placeholder={String(payable / 100)} /></label> : <><p>Tato volba žádné peníze nestrhne. Potvrďte ji až po ověření platby mimo DiriPOS.</p><label>Reference platby<input maxLength={200} value={paymentNote} onChange={event => setPaymentNote(event.target.value)} /></label></>}<button className={styles.primary} type="submit">{busy ? 'Ukládáme…' : method === 'cash' ? 'Přijmout hotovost a uložit prodej' : 'Potvrdit externí úhradu a uložit prodej'}</button></fieldset></form>
        </section> : null}
      </div> : null}

      {workspace && tab === 'history' ? <section className={styles.panel}><h2>Doklady a vratky</h2><div className={styles.toolbar}><label>Od<input type="date" value={dateFrom} onChange={event => { setDateFrom(event.target.value); setHistoryCursors([]) }} /></label><label>Do včetně<input type="date" value={dateUntil} onChange={event => { setDateUntil(event.target.value); setHistoryCursors([]) }} /></label><button onClick={() => void exportHistory()}>Export CSV celého výběru</button></div><p>Součty zahrnují celý výběr, vratky jsou odečtené. Export má limit 10 000 dokladů; větší výběr je potřeba rozdělit podle data.</p>{history ? <><p><strong>{history.totals.count} dokladů · přijato po vratkách {money(history.totals.paid_minor)}</strong></p><div className={styles.tableWrap}><table><thead><tr><th>Doklad</th><th>Datum</th><th>Platba</th><th>Uhrazeno / vráceno</th><th>Akce</th></tr></thead><tbody>{history.rows.map(row => <tr key={`${row.kind}:${row.id}`}><td>{row.document_no}</td><td>{dateTime(row.created_at)}</td><td>{row.payment_method === 'cash' ? 'Hotovost' : 'Externí evidence'}</td><td>{money(row.paid_minor)}</td><td><Link target="_blank" rel="noopener" href={receiptHref(row.id, row.kind)}>Kopie dokladu</Link>{row.kind === 'sale' && workspace.can_refund ? <button disabled={blocked} onClick={() => void openReturn(row.id)}>Vratka</button> : null}</td></tr>)}</tbody></table></div><div className={styles.toolbar}><button disabled={!historyCursors.length} onClick={() => setHistoryCursors(cursors => cursors.slice(0, -1))}>Předchozí</button><button disabled={!history.has_more} onClick={() => setHistoryCursors(cursors => [...cursors, history.rows[history.rows.length - 1].sequence_no])}>Další</button></div></> : <p>Načítáme doklady…</p>}
        {receipt ? <form className={styles.returnForm} onSubmit={event => submit(event, form => {
          const lines = receipt.lines.map(line => ({ line_id: line.id, quantity: quantityInput(field(form, line.id) || '0') / 1000 })).filter(line => line.quantity > 0)
          if (!lines.length) throw new Error('Vyberte alespoň jednu položku a množství.')
          command('return', { sale_id: receipt.document.id, shift_id: currentShift?.id, browser_id: browserId, reason: field(form, 'reason'), lines })
        })}><h3>Vratka k {receipt.document.document_no}</h3><p>Vrácení se eviduje původním způsobem platby. Externí peníze musíte vrátit mimo DiriPOS; tato operace žádný terminál neovládá.</p>{!sessionReady ? <p className={styles.warning}>Pro vratku otevřete směnu v tomto prohlížeči.</p> : null}<fieldset disabled={blocked || !sessionReady}>{receipt.lines.map(line => <label key={line.id}>{line.name} · zbývá {Number(line.quantity) - Number(line.returned_quantity ?? 0)} {line.unit}<input name={line.id} inputMode="decimal" defaultValue="0" /></label>)}<label>Důvod vratky<input name="reason" required maxLength={500} /></label><button type="submit">Potvrdit částečnou / úplnou vratku</button><button type="button" onClick={() => setReceipt(null)}>Zrušit</button></fieldset></form> : null}
      </section> : null}

      {workspace && tab === 'shifts' ? <section className={styles.panel}><h2>Směny a hotovost</h2>{!currentShift ? <form onSubmit={event => submit(event, form => command('shift_open', { browser_id: browserId, opening_minor: moneyInput(field(form, 'opening')) }))}><fieldset disabled={blocked}><label>Počáteční hotovost v Kč<input name="opening" inputMode="decimal" defaultValue="0" required /></label><button type="submit">Otevřít směnu v tomto prohlížeči</button></fieldset></form> : <><p>Směna od {dateTime(currentShift.opened_at)} · evidovaná hotovost <strong>{money(currentShift.expected_minor)}</strong></p>{!sessionReady ? <p>Směna je otevřena v jiném prohlížeči. Oprávněný správce ji může zde uzavřít.</p> : null}{workspace.can_refund && sessionReady ? <form onSubmit={event => submit(event, form => command('cash_move', { shift_id: currentShift.id, browser_id: browserId, amount_minor: moneyInput(field(form, 'amount')) * (field(form, 'direction') === 'out' ? -1 : 1), reason: field(form, 'reason') }))}><h3>Vklad nebo výběr</h3><fieldset disabled={blocked}><div className={styles.formGrid}><label>Směr<select name="direction"><option value="in">Vklad</option><option value="out">Výběr</option></select></label><label>Částka Kč<input name="amount" inputMode="decimal" required /></label><label>Důvod<input name="reason" required maxLength={500} /></label></div><button type="submit">Zapsat pohyb hotovosti</button></fieldset></form> : null}{currentShift.can_close ? <form onSubmit={event => submit(event, form => command('shift_close', { shift_id: currentShift.id, counted_minor: moneyInput(field(form, 'counted')), note: field(form, 'note') }))}><h3>Uzávěrka směny</h3><fieldset disabled={blocked}><label>Skutečně spočítaná hotovost Kč<input name="counted" inputMode="decimal" required /></label><label>Poznámka k rozdílu<input name="note" maxLength={500} /></label><button type="submit">Uzavřít směnu</button></fieldset></form> : null}</>}
        <h3>Historie směn</h3>{shifts ? <><div className={styles.tableWrap}><table><thead><tr><th>Otevřeno</th><th>Uzavřeno</th><th>Počátek</th><th>Očekáváno</th><th>Skutečnost</th><th>Rozdíl</th></tr></thead><tbody>{shifts.rows.map(shift => <tr key={shift.id}><td>{dateTime(shift.opened_at)}</td><td>{shift.closed_at ? dateTime(shift.closed_at) : 'Otevřená'}</td><td>{money(shift.opening_minor)}</td><td>{shift.expected_minor == null ? '—' : money(shift.expected_minor)}</td><td>{shift.counted_minor == null ? '—' : money(shift.counted_minor)}</td><td>{shift.difference_minor == null ? '—' : money(shift.difference_minor)}</td></tr>)}</tbody></table></div><div className={styles.toolbar}><button disabled={!shiftOffset} onClick={() => setShiftOffset(value => Math.max(0, value - 50))}>Předchozí</button><button disabled={!shifts.has_more} onClick={() => setShiftOffset(value => value + 50)}>Další</button></div></> : null}
      </section> : null}

      {workspace && tab === 'shifts' && cash ? <section className={styles.panel}><h2>Vklady a výběry hotovosti</h2><p>Tyto pohyby nejsou tržba.</p><div className={styles.tableWrap}><table><thead><tr><th>Datum</th><th>Důvod</th><th>Částka</th></tr></thead><tbody>{cash.rows.map(row => <tr key={row.id}><td>{dateTime(row.created_at)}</td><td>{row.reason}</td><td>{money(row.amount_minor)}</td></tr>)}</tbody></table></div><div className={styles.toolbar}><button disabled={!cashOffset} onClick={() => setCashOffset(value => Math.max(0, value - 50))}>Předchozí</button><button disabled={!cash.has_more} onClick={() => setCashOffset(value => value + 50)}>Další</button></div></section> : null}

      {workspace && tab === 'settings' && workspace.can_manage ? <section className={styles.panel}><h2>Nastavení pokladny</h2><p>Pro změnu názvu nebo skladového režimu nejprve uzavřete směnu. Připojení skladu vede pouze nové prodeje; před připojením ověřte skutečné zůstatky ve skladu.</p><form key={workspace.register.version} onSubmit={event => submit(event, form => command('register_save', { version: workspace.register.version, name: field(form, 'name'), warehouse_id: field(form, 'warehouse') || null, confirm_without_inventory: form.has('confirm') }))}><fieldset disabled={blocked || Boolean(currentShift)}><label>Název<input name="name" defaultValue={workspace.register.name} required maxLength={100} /></label><label>Sklad<select name="warehouse" defaultValue={workspace.register.warehouse_id ?? ''}><option value="">Bez skladové evidence</option>{workspace.warehouses?.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><label className={styles.check}><input type="checkbox" name="confirm" />Při odpojení potvrzuji prodej bez dalšího vedení zásob.</label><button type="submit">Uložit nastavení</button></fieldset></form>
        <h3>Obsluhy pokladny</h3><p>Správci a manažeři mají správu pokladny. Pracovník potřebuje přiřazení níže. Vedoucí obsluha může navíc provádět vratky, vklady a výběry.</p>{workspace.operators?.length ? workspace.operators.map(operator => <form key={operator.profile_id} className={styles.operator} onSubmit={event => submit(event, form => command('operator_save', { profile_id: operator.profile_id, role: field(form, 'role'), active: form.has('active') }))}><fieldset disabled={blocked}><strong>{operator.name || 'Pracovník'}</strong><select aria-label={`Role ${operator.name}`} name="role" defaultValue={operator.role ?? 'cashier'}><option value="cashier">Pokladní</option><option value="supervisor">Vedoucí obsluha</option></select><label className={styles.check}><input name="active" type="checkbox" defaultChecked={operator.active} />Povolit přístup</label><button type="submit">Uložit obsluhu</button></fieldset></form>) : <p>Ve firmě zatím nejsou další pracovníci k přiřazení.</p>}
      </section> : null}
    </>}
  </>
}
