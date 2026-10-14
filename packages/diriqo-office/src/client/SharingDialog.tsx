'use client';
import React,{useEffect,useId,useRef,useState} from 'react';
import type {OfficeFile,OfficeLocale,OfficeSharingState,OfficeSharingUpdate,OfficeTransport} from '../core/types';
import {getOfficeMessages} from './locales';

export function SharingDialog({file,transport,locale,onClose,onUpdated}:{file:Pick<OfficeFile,'id'|'title'>;transport:OfficeTransport;locale:OfficeLocale;onClose:()=>void;onUpdated?:()=>void}){
 const m=getOfficeMessages(locale),heading=useId(),description=useId();
 const dialog=useRef<HTMLDialogElement>(null),closeButton=useRef<HTMLButtonElement>(null);
 const generation=useRef(0),writing=useRef(false),alive=useRef(true);
 const pending=useRef<OfficeSharingUpdate|null>(null);
 const context=useRef({fileId:file.id,transport});context.current={fileId:file.id,transport};
 const [state,setState]=useState<OfficeSharingState|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(false),[saved,setSaved]=useState(false);
 const [query,setQuery]=useState(''),[selected,setSelected]=useState(''),[role,setRole]=useState<'reader'|'editor'>('reader');
 useEffect(()=>{alive.current=true;const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();closeButton.current?.focus();return()=>{alive.current=false;generation.current++;dialog.current?.close();if(previous?.isConnected)previous.focus();};},[]);
 async function load(){
  if(writing.current||!transport.sharingRead)return;
  const ticket=++generation.current;setLoading(true);setError(false);setSaved(false);
  try{const result=await transport.sharingRead(file.id,query);if(!alive.current||ticket!==generation.current)return;if(result.fileId!==file.id)throw Error('OFFICE_INVALID_RESPONSE');setState(result);setSelected('');pending.current=null;}
  catch{if(alive.current&&ticket===generation.current){setState(null);setError(true);}}
  finally{if(alive.current&&ticket===generation.current)setLoading(false);}
 }
 useEffect(()=>{pending.current=null;setState(null);setSelected('');setSaved(false);if(writing.current){setLoading(false);setError(true);}else void load();return()=>{generation.current++;};},[file.id,transport]);
 async function update(memberId:string,nextRole:'reader'|'editor'|null){
  if(writing.current||!state?.canManage||!transport.sharingUpdate||context.current.fileId!==file.id||context.current.transport!==transport)return;
  writing.current=true;setBusy(true);setError(false);setSaved(false);++generation.current;
  // Keep the exact operation after a lost reply. Explicit refresh discards it.
  const request=pending.current??{fileId:file.id,expectedRevision:state.revision,memberId,role:nextRole,idempotencyKey:crypto.randomUUID()};pending.current=request;
  try{const result=await transport.sharingUpdate(request);if(!alive.current||context.current.fileId!==file.id||context.current.transport!==transport)return;if(result.fileId!==file.id)throw Error('OFFICE_INVALID_RESPONSE');setState(result);setSelected('');pending.current=null;setSaved(true);onUpdated?.();}
  catch{if(alive.current&&context.current.fileId===file.id&&context.current.transport===transport)setError(true);}
  finally{writing.current=false;if(alive.current)setBusy(false);}
 }
 const close=()=>{if(!writing.current)onClose();};
 return <dialog ref={dialog} className="office-modal office-sharing-dialog" aria-labelledby={heading} aria-describedby={description} aria-busy={loading||busy} onCancel={event=>{event.preventDefault();close();}}>
  <div className="office-panel-heading"><div><h2 id={heading}>{m.share}</h2><p>{file.title}</p></div><button ref={closeButton} type="button" disabled={busy} onClick={close} aria-label={m.close}>×</button></div>
  <p id={description}>{state?.visibility==='company'?m.sharingCompany:m.sharingRestricted}</p>
  {error&&<div className="office-alert" role="alert"><span>{m.sharingFailed}</span><button type="button" disabled={busy||loading} onClick={()=>void load()}>{m.refresh}</button>{pending.current&&<button type="button" disabled={busy||loading} onClick={()=>void update(pending.current!.memberId,pending.current!.role)}>{m.retry}</button>}</div>}
  {saved&&<p role="status" className="office-sharing-saved">{m.sharingSaved}</p>}
  {loading?<p role="status">{m.loading}</p>:state&&<>
   <p className="office-sharing-owner"><strong>{m.author}</strong><span>{state.owner.name||m.unknownAuthor}</span></p>
   {!!state.automaticReaders?.length&&<details className="office-sharing-automatic"><summary>{m.automaticReaders} ({state.automaticReaders.length})</summary><ul>{state.automaticReaders.map(person=><li key={person.id}>{person.name||m.unknownAuthor}</li>)}</ul></details>}
   <h3>{m.sharedWith}</h3>
   {state.members.length?<ul className="office-sharing-members">{state.members.map(person=><li key={person.id}><span>{person.name||m.unknownAuthor}</span><small>{person.role==='editor'?m.shareEdit:m.shareRead}</small>{state.canManage&&<button type="button" disabled={busy||!!pending.current} onClick={()=>void update(person.id,null)} aria-label={`${m.revokeShare}: ${person.name}`}>{m.revokeShare}</button>}</li>)}</ul>:<p className="office-sharing-muted">{m.noShares}</p>}
   {state.canManage?<>
    <form className="office-sharing-search" onSubmit={event=>{event.preventDefault();void load();}}><label>{m.searchColleagues}<input type="search" value={query} maxLength={100} disabled={busy||!!pending.current} onChange={event=>setQuery(event.target.value)}/></label><button type="submit" disabled={busy||!!pending.current}>{m.find}</button></form>
    <form onSubmit={event=>{event.preventDefault();if(selected)void update(selected,role);}}>
     <label>{m.colleague}<select required value={selected} disabled={busy||!!pending.current} onChange={event=>setSelected(event.target.value)}><option value="">{m.chooseColleague}</option>{state.colleagues.filter(person=>person.id!==state.owner.id).map(person=><option key={person.id} value={person.id}>{person.name||m.unknownAuthor}</option>)}</select></label>
     <label>{m.accessLevel}<select value={role} disabled={busy||!!pending.current} onChange={event=>setRole(event.target.value as 'reader'|'editor')}><option value="reader">{m.shareRead}</option><option value="editor">{m.shareEdit}</option></select></label>
     <div className="office-modal-actions"><button type="submit" className="office-primary" disabled={!selected||busy||!!pending.current}>{busy?m.working:m.share}</button></div>
    </form>
   </>:<p className="office-sharing-muted">{m.sharingOwnerOnly}</p>}
  </>}
 </dialog>;
}
