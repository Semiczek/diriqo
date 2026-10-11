import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import { getInventoryData } from '@/lib/inventory/data'
import InventoryClient from './InventoryClient'
import styles from './inventory.module.css'
export default async function InventoryPage({searchParams}:{searchParams:Promise<{tab?:string;q?:string;page?:string}>}){
 const query=await searchParams
 const tab=['stock','documents','orders','suppliers','movements','reservations','valuation'].includes(query.tab??'')?query.tab!:'stock'
 const page=Math.max(1,Math.min(10000,Math.floor(Number(query.page)||1)));const q=(query.q??'').slice(0,100)
 let data;let error=false
 try{data=await getInventoryData(tab,q,page)}catch{error=true}
 return <DashboardShell activeItem="modules"><main className={styles.page}>
 <header className={styles.header}><div><p className={styles.eyebrow}>Přehled zásob a nákupu</p><h1>Sklad</h1><p>Od objednávky po výdej. Každý pohyb má svou historii.</p></div>{data?<Link href="/diriqent/ocr?domain=inventory">Přečíst podklad ↗</Link>:null}</header>
 {error?<section className={styles.card} role="alert"><h2>Sklad se nepodařilo načíst</h2><p>Ověřte oprávnění k aktivní firmě a zkuste stránku obnovit.</p><Link href="/inventory">Zkusit znovu</Link></section>:!data?<section className={styles.card}><h2>Zapněte si Sklad</h2><p>Pro práci se zásobami potřebujete licenci skladu. O zpřístupnění požádejte správce firmy.</p></section>:<InventoryClient data={data}/>}
 </main></DashboardShell>
}
