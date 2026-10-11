'use client'
import styles from './fleet.module.css'
export default function FleetError({ reset }: { reset: () => void }) { return <section className={styles.card}><h2>Vozový park se nepodařilo načíst</h2><p className={styles.muted}>Zkontrolujte přihlášení a přístup k aktivní firmě.</p><button onClick={reset} className={styles.primary}>Zkusit znovu</button></section> }
