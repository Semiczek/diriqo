import Link from 'next/link'
import { fleetList } from '@/lib/fleet/server'
import { vehicleStates } from '@/lib/fleet/domain'
import styles from './fleet.module.css'

export default async function FleetPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const params = await searchParams
  const page = Math.min(100000, Math.max(1, Number.parseInt(params.page ?? '1') || 1))
  const { context, vehicles, count } = await fleetList(params.q ?? '', params.status ?? '', page)
  const href = (next: number) => `/fleet?${new URLSearchParams({ q: params.q ?? '', status: params.status ?? '', page: String(next) })}`
  return <main className={styles.page}>
    <header className={styles.header}><div><Link className={styles.back} href={['super_admin','company_admin'].includes(context.role??'')?'/billing/modules':'/moje-prace'}>← Zpět do Diriqa</Link><h1>Vozidla</h1><p>Váš vozový park, jízdy a provozní náklady na jednom místě.</p></div><div className={styles.actions}><a className={styles.secondary} href="/fleet/export?type=vehicles" download>Export CSV</a>{context.manager ? <Link className={styles.primary} href="/fleet/new">+ Přidat vozidlo</Link> : null}</div></header>
    <form className={`${styles.card} ${styles.filters}`}><label>Najít vozidlo<input name="q" defaultValue={params.q} placeholder="Název nebo registrační značka" maxLength={80} /></label><label>Stav<select name="status" defaultValue={params.status ?? ''}><option value="">Všechny stavy</option>{Object.entries(vehicleStates).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><button className={styles.secondary} type="submit">Zobrazit</button>{params.q || params.status ? <Link className={styles.back} href="/fleet">Zrušit filtr</Link> : null}</form>
    {vehicles.length ? <div className={styles.list}>{vehicles.map(vehicle => <Link href={`/fleet/${vehicle.id}`} key={vehicle.id} className={`${styles.card} ${styles.vehicle}`}><div><span className={styles.plate}>{vehicle.plate}</span><h2 style={{ margin: '8px 0 4px' }}>{vehicle.name}</h2><p className={styles.muted}>{vehicle.cost_method === 'mileage' ? `${vehicle.km_rate} Kč/km včetně provozu` : 'Skutečné náklady'} · Výchozí tachometr {vehicle.initial_odometer.toLocaleString('cs-CZ')} km</p></div><span className={styles.badge}>{vehicleStates[vehicle.status]} →</span></Link>)}</div> : <section className={`${styles.card} ${styles.empty}`}><h2>{params.q || params.status ? 'Žádné vozidlo neodpovídá výběru' : 'Vozový park je zatím prázdný'}</h2><p className={styles.muted}>{params.q || params.status ? 'Zkuste jiný název nebo zrušte filtr.' : context.manager ? 'Přidejte první auto. Pro nové záznamy potřebujete aktivní modul Vozidla.' : 'Zde se zobrazí vozidla, která vám správce přiřadí.'}</p></section>}
    <nav className={styles.pagination} aria-label="Stránkování vozidel"><span>{count} vozidel · Strana {page}</span><div className={styles.actions}>{page > 1 ? <Link className={styles.secondary} href={href(page - 1)}>← Předchozí</Link> : null}{page * 20 < count ? <Link className={styles.secondary} href={href(page + 1)}>Další →</Link> : null}</div></nav>
  </main>
}
