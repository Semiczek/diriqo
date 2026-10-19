import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import { uuidPattern, inventoryDocumentKinds } from '@/lib/inventory/domain'
import { getInventoryData } from '@/lib/inventory/data'
import InventoryClient from './InventoryClient'
import styles from './inventory.module.css'
export default async function InventoryPage({searchParams}:{searchParams:Promise<{tab?:string;q?:string;page?:string;warehouse?:string;kind?:string;action?:string;document?:string}>}){
 const query=await searchParams
 const tab=['stock','documents','orders','suppliers','movements','reservations','valuation','warehouses'].includes(query.tab??'')?query.tab!:'stock'
 const page=Math.max(1,Math.min(10000,Math.floor(Number(query.page)||1)));const q=(query.q??'').slice(0,100)
 let data;let error=false
 try{data=await getInventoryData(tab,q,page,query.warehouse??'',inventoryDocumentKinds.includes(query.kind as never)?query.kind:'',inventoryDocumentKinds.includes(query.action as never)?query.action:'',uuidPattern.test(query.document??'')?query.document:'')}catch{error=true}
 return <DashboardShell activeItem="inventory" inventoryWarehouseId={data?.warehouseId}><main className={styles.page}>
 <header className={styles.header}><div><p className={styles.eyebrow}>Skladová pracovní plocha</p><h1>Sklad</h1><p>Vyberte sklad a pracujte s příjmy, výdeji i zásobami na zakázkách.</p></div>{data?<Link href={`/diriqent/ocr?domain=inventory${data.warehouseId?`&warehouse=${data.warehouseId}`:''}`}>Načíst dodací list (OCR) ↗</Link>:null}</header>
 {error?<section className={styles.card} role="alert"><h2>Sklad se nepodařilo načíst</h2><p>Ověřte oprávnění k aktivní firmě a zkuste stránku obnovit.</p><Link href="/inventory">Zkusit znovu</Link></section>:!data?<section className={styles.card}><h2>Zapněte si Sklad</h2><p>Pro práci se zásobami potřebujete licenci skladu. O zpřístupnění požádejte správce firmy.</p></section>:<InventoryClient key={`${data.companyId}:${data.tab}:${data.warehouseId}:${data.documentKind}:${data.initialAction}:${data.initialDocument}`} data={data}/>}
 </main></DashboardShell>
}
