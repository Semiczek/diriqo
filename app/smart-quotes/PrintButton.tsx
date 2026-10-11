'use client'
import styles from './quotes.module.css'
export default function PrintButton() { return <button className={`${styles.secondary} ${styles.noPrint}`} onClick={()=>window.print()}>Tisk / uložit PDF</button> }
