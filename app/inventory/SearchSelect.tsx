'use client'
import { useEffect, useId, useState } from 'react'
import s from './inventory.module.css'

type Option={id:string;name:string}
export default function SearchSelect({companyId,kind,name,label,required=true,placeholder='Vyberte…',initialOption}:{companyId:string;kind:'items'|'suppliers'|'jobs'|'warehouses';name:string;label:string;required?:boolean;placeholder?:string;initialOption?:Option}){
 const id=useId();const [search,setSearch]=useState('');const [page,setPage]=useState(1);const [reload,setReload]=useState(0)
 const [result,setResult]=useState<{options:Option[];total:number}|null>(null);const [selected,setSelected]=useState<Option|null>(initialOption??null)
 const [loading,setLoading]=useState(true);const [error,setError]=useState<string|null>(null)
 useEffect(()=>{
  const controller=new AbortController()
  const timer=setTimeout(async()=>{
   try{
    const query=new URLSearchParams({company:companyId,kind,q:search,page:String(page)})
    const response=await fetch(`/inventory/lookup?${query}`,{signal:controller.signal,cache:'no-store'})
    const body=await response.json()
    if(controller.signal.aborted)return
    if(!response.ok)throw new Error(body.error||'Výběr se nepodařilo načíst.')
    if(body.companyId!==companyId)throw new Error('Aktivní firma se změnila. Obnovte stránku.')
    setResult({options:body.options,total:body.total});setError(null);setLoading(false)
   }catch(error){if(!controller.signal.aborted){setError(error instanceof Error?error.message:'Výběr se nepodařilo načíst.');setLoading(false)}}
  },200)
  return()=>{clearTimeout(timer);controller.abort()}
 },[companyId,kind,search,page,reload])
 const options=result?.options??[]
 return <div className={s.lookup}>
  <label htmlFor={`${id}-search`}>{label}</label>
  <input id={`${id}-search`} type="search" placeholder="Hledat v celé firmě…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setLoading(true)}}/>
  <select name={name} aria-label={`Vybrat: ${label}`} aria-describedby={`${id}-status`} required={required} value={selected?.id??''} onChange={e=>setSelected(options.find(o=>o.id===e.target.value)??(selected?.id===e.target.value?selected:null))}>
   <option value="">{placeholder}</option>
   {selected&&!options.some(o=>o.id===selected.id)?<option value={selected.id}>{selected.name}</option>:null}
   {options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
  </select>
  <small id={`${id}-status`} role={error?'alert':'status'}>{error??(loading?'Načítám výběr…':result?.total?`Výběr ${(page-1)*25+1}–${Math.min(page*25,result.total)} z ${result.total}. Vyhledáním jej zúžíte.`:'Žádný výsledek. Upravte hledání nebo založte nový záznam.')}</small>
  {error?<button type="button" className={s.secondary} onClick={()=>{setLoading(true);setReload(reload+1)}}>Zkusit znovu</button>:null}
  {!error&&result&&result.total>25?<div className={s.lookupPages}><button type="button" className={s.secondary} disabled={loading||page===1} onClick={()=>{setPage(page-1);setLoading(true)}} aria-label={`Předchozí výběr: ${label}`}>←</button><span>{page} / {Math.ceil(result.total/25)}</span><button type="button" className={s.secondary} disabled={loading||page*25>=result.total} onClick={()=>{setPage(page+1);setLoading(true)}} aria-label={`Další výběr: ${label}`}>→</button></div>:null}
 </div>
}
