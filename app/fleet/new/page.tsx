import Link from 'next/link'
import { fleetContext, fleetOptions } from '@/lib/fleet/server'
import { VehicleForm } from '../fields'
import styles from '../fleet.module.css'

export default async function NewVehiclePage() {
  const context = await fleetContext()
  if (!context.manager) return <p role="alert">Vozidla spravuje správce firmy.</p>
  const { drivers } = await fleetOptions(context)
  return <main className={`${styles.page} ${styles.compact}`}><header className={styles.header}><div><Link href="/fleet" className={styles.back}>← Vozidla</Link><h1>Nové vozidlo</h1><p>Vyplňte základní údaje. Jízdy a doklady přidáte potom.</p></div></header><section className={styles.card}><VehicleForm companyId={context.companyId} drivers={drivers} /></section></main>
}
