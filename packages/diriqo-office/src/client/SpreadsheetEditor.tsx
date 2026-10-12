'use client';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Workbook,type WorkbookInstance} from '@fortune-sheet/react';
import {update as formatCell,type Sheet,type Hooks} from '@fortune-sheet/core';
import type {OfficeLocale,SpreadsheetContent} from '../core/types';
import {fromFortuneSheets,toFortuneSheets,isFortuneInputSafe,isOfficeFormulaSafe} from '../core/fortune-adapter';
import {getOfficeMessages} from './locales';
import {guardFortuneCalculation} from '../core/fortune-formula-guard';
const languageNote:Record<OfficeLocale,string>={
 cs:'Nabídky tabulkového enginu jsou zatím v angličtině. Vzorce používají anglické názvy a čárku mezi argumenty; čísla zadávejte s desetinnou tečkou. Číselné a měnové formáty nastavíte v nástrojové liště.',
 sk:'Ponuky tabuľkového enginu sú zatiaľ v angličtine. Vzorce používajú anglické názvy a čiarku medzi argumentmi; čísla zadávajte s desatinnou bodkou. Formáty nastavíte v paneli nástrojov.',
 en:'Spreadsheet menus currently use English. Formula names are English, arguments use commas, and numeric entry uses a decimal point. Choose number and currency formats in the toolbar.',
 de:'Die Tabellenmenüs sind derzeit auf Englisch. Formeln verwenden englische Namen und Kommas zwischen Argumenten; Zahlen mit Dezimalpunkt eingeben. Formate in der Werkzeugleiste wählen.',
 pl:'Menu arkusza jest obecnie w języku angielskim. Formuły mają angielskie nazwy i przecinki między argumentami; liczby wpisuj z kropką dziesiętną. Formaty wybierz na pasku narzędzi.',
 tr:'Hesap tablosu menüleri şimdilik İngilizcedir. Formül adları İngilizce, bağımsız değişken ayıracı virgül ve ondalık ayıracı noktadır. Biçimleri araç çubuğundan seçin.',
 sq:'Menutë e fletëllogaritjes janë për momentin në anglisht. Formulat kanë emra anglisht, argumentet ndahen me presje dhe numrat përdorin pikën dhjetore. Formatet zgjidhen në shiritin e mjeteve.',
};
const blockedNote:Record<OfficeLocale,string>={cs:'Externí odkazy, aktivní obsah nebo příliš velká oblast nejsou povoleny. Pro vložení samotného textu použijte Ctrl+Shift+V.',sk:'Externé odkazy, aktívny obsah alebo príliš veľká oblasť nie sú povolené. Samotný text vložíte pomocou Ctrl+Shift+V.',en:'External links, active content or an oversized range are not allowed. Use Ctrl+Shift+V to paste plain text.',de:'Externe Links, aktive Inhalte oder ein zu großer Bereich sind nicht erlaubt. Strg+Umschalt+V fügt reinen Text ein.',pl:'Zewnętrzne odnośniki, aktywna treść lub zbyt duży zakres są niedozwolone. Ctrl+Shift+V wkleja zwykły tekst.',tr:'Dış bağlantılara, etkin içeriğe veya çok büyük aralıklara izin verilmez. Düz metin için Ctrl+Shift+V kullanın.',sq:'Lidhjet e jashtme, përmbajtja aktive ose zona shumë e madhe nuk lejohen. Përdorni Ctrl+Shift+V për tekst të thjeshtë.'};
const finishNote:Record<OfficeLocale,string>={cs:'Úprava buňky ještě není potvrzena. Dokončete ji klávesou Enter, případně opravte nepovolený obsah. Dokument zůstává otevřený.',sk:'Úprava bunky ešte nie je potvrdená. Dokončite ju klávesom Enter alebo opravte nepovolený obsah. Dokument zostáva otvorený.',en:'The cell edit has not been committed. Press Enter or correct the blocked content. The document remains open.',de:'Die Zelländerung ist noch nicht bestätigt. Drücken Sie Enter oder korrigieren Sie unzulässige Inhalte. Das Dokument bleibt geöffnet.',pl:'Zmiana komórki nie została zatwierdzona. Naciśnij Enter lub popraw niedozwoloną treść. Dokument pozostaje otwarty.',tr:'Hücre düzenlemesi henüz onaylanmadı. Enter tuşuna basın veya engellenen içeriği düzeltin. Belge açık kalır.',sq:'Ndryshimi i qelizës nuk është konfirmuar. Shtypni Enter ose korrigjoni përmbajtjen e bllokuar. Dokumenti mbetet i hapur.'};
const toolbar=['undo','redo','format-painter','clear-format','|','currency-format','percentage-format','number-decrease','number-increase','format','|','font','font-size','|','bold','italic','strike-through','underline','font-color','background','border','merge-cell','|','horizontal-align','vertical-align','text-wrap','freeze','filter','quick-formula','search'];
const cycleNote:Record<OfficeLocale,string>={cs:'Cyklický odkaz: vzorec závisí sám na sobě. Změna nebyla použita.',sk:'Cyklický odkaz: vzorec závisí sám od seba. Zmena nebola použitá.',en:'Circular reference: the formula depends on itself. The edit was rejected.',de:'Zirkelbezug: Die Formel hängt von sich selbst ab. Die Änderung wurde abgelehnt.',pl:'Odwołanie cykliczne: formuła zależy od siebie. Zmiana została odrzucona.',tr:'Döngüsel başvuru: formül kendisine bağlı. Değişiklik reddedildi.',sq:'Referencë rrethore: formula varet nga vetja. Ndryshimi u refuzua.'};
const cellMenu=['copy','paste','|','insert-row','insert-column','delete-row','delete-column','delete-cell','hide-row','hide-column','set-row-height','set-column-width','clear','sort','orderAZ','orderZA','filter','cell-format'];
const activeMarkup=/(?:<script|<iframe|<object|<img|<svg|<link|<a\b|(?:href|src|on[a-z]+)\s*=|javascript:|url\s*\(|@import)/i;
function safePaste(text:string,html='',row=0,column=0){
 if(text.length>2_000_000||html.length>2_000_000||activeMarkup.test(html))return false;
 const lines=text.replace(/\r\n?/g,'\n').split('\n');if(lines.length>10000-row)return false;let count=0;
 for(const line of lines){const cells=line.split('\t');count+=cells.length;if(count>100000||cells.length>256-column||!cells.every(isOfficeFormulaSafe))return false;}
 if(html){
  const template=document.createElement('template');template.innerHTML=html;
  const rows=template.content.querySelectorAll('tr'),cells=template.content.querySelectorAll('td,th');
  if(rows.length>10000-row||cells.length>100000)return false;
  for(const cell of Array.from(cells)){if(!isOfficeFormulaSafe(cell.textContent??''))return false;const rs=Number(cell.getAttribute('rowspan')??1),cs=Number(cell.getAttribute('colspan')??1);if(!Number.isInteger(rs)||!Number.isInteger(cs)||rs<1||cs<1||rs>10000-row||cs>256-column)return false;}
  for(const tr of Array.from(rows)){let width=0;for(const td of Array.from(tr.children))width+=Number(td.getAttribute('colspan')??1);if(width>256-column)return false;}
 }
 return true;
}
type PendingCell={element:HTMLElement;sheetId?:string;row:number;column:number;text:string};
export type SpreadsheetEditorProps={content:SpreadsheetContent;onChange:(content:SpreadsheetContent)=>void;readOnly?:boolean;disabled?:boolean;locale?:OfficeLocale};
export function SpreadsheetEditor({content,onChange,readOnly=false,disabled=false,locale='cs'}:SpreadsheetEditorProps){
 const m=getOfficeMessages(locale);const workbook=useRef<WorkbookInstance>(null);const container=useRef<HTMLDivElement>(null);const latest=useRef(content);const callback=useRef(onChange);const readonlyRef=useRef(readOnly);const blockedRef=useRef(readOnly||disabled);const selection=useRef({sheetId:undefined as string|undefined,row:0,column:0});const pending=useRef<PendingCell|null>(null);const composing=useRef(false);const calculated=useRef(false);latest.current=content;callback.current=onChange;readonlyRef.current=readOnly;blockedRef.current=readOnly||disabled;
 const [notice,setNotice]=useState('');const [ready,setReady]=useState(false);
 const notifyPending=useCallback((value:boolean)=>{queueMicrotask(()=>document.dispatchEvent(new CustomEvent('diriqo-office-pending-cell',{detail:{pending:value}})));},[]);
 const clearPending=useCallback(()=>{if(pending.current){pending.current=null;notifyPending(false);}},[notifyPending]);
 // Only initialize once. Host remounts on open/restore/approval, never on ordinary save or busy-state changes.
 const initial=useMemo(()=>{try{const data=toFortuneSheets(content,formatCell);return {data,serialized:JSON.stringify(fromFortuneSheets(data,content)),error:''};}catch(e){return {data:[] as Sheet[],serialized:JSON.stringify(content),error:e instanceof Error?e.message:'Invalid workbook'};}},[]);
 const lastSnapshot=useRef(initial.serialized);
 const hooks=useMemo<Hooks>(()=>({
  beforeUpdateCell:(row,column,value)=>{
   const formula=typeof value==='string'&&value.startsWith('=')?value:typeof value==='object'&&value?value.f:undefined;
   const formulaError=typeof formula==='string'?guardFortuneCalculation({luckysheetfile:workbook.current?.getAllSheets(),currentSheetId:selection.current.sheetId??latest.current.workbook.activeSheetId??latest.current.workbook.sheetOrder[0]},formula,row,column):null;
   const ok=!blockedRef.current&&isFortuneInputSafe(value)&&!formulaError;
   if(!ok&&!blockedRef.current)queueMicrotask(()=>setNotice(formulaError==='#CYCLE!'?cycleNote[locale]:(formulaError?formulaError+' — ':'')+blockedNote[locale]));
   // Fortune discards a rejected edit and advances the selection; it is no longer pending.
   if(pending.current?.row===row&&pending.current.column===column)clearPending();
   return ok;
  },
  beforePaste:(ranges,text)=>{const range=ranges?.[0];const ok=!blockedRef.current&&safePaste(text,text.includes('<')?text:'',range?.row?.[0]??0,range?.column?.[0]??0);if(!ok&&!blockedRef.current)queueMicrotask(()=>setNotice(blockedNote[locale]));return ok;},
  beforeAddSheet:()=>!blockedRef.current&&(workbook.current?.getAllSheets().length??0)<32,
  beforeDeleteSheet:()=>!blockedRef.current&&(workbook.current?.getAllSheets().length??0)>1,
  beforeUpdateSheetName:()=>!blockedRef.current,
  afterSelectionChange:(sheetId,value)=>{selection.current={sheetId,row:value.row_focus??value.row[0],column:value.column_focus??value.column[0]};},
 }),[locale,clearPending]);
 const emit=useCallback((sheets:Sheet[])=>{
  if(!sheets.length)return;
  try{
   const next=fromFortuneSheets(sheets,latest.current);const serialized=JSON.stringify(next);setReady(true);
   const edit=pending.current;
   if(edit){
    const id=edit.sheetId??next.workbook.activeSheetId??next.workbook.sheetOrder[0];
    const cell=next.workbook.sheets[id]?.cellData?.[edit.row]?.[edit.column];
    const actual=typeof cell?.f==='string'?cell.f:String(cell?.v??'');
    if(actual===edit.text)clearPending();
   }
   if(!calculated.current&&workbook.current){
    calculated.current=true;
    const formulaSheets=sheets.filter(sheet=>(sheet.calcChain?.length??0)>0);
    if(formulaSheets.length)queueMicrotask(()=>{for(const sheet of formulaSheets)workbook.current?.calculateFormula(sheet.id);});
   }
   if(serialized===lastSnapshot.current||readonlyRef.current)return;
   // Disabled prevents new user actions; state committed before a save still must emit.
   lastSnapshot.current=serialized;callback.current(next);
  }catch(e){setNotice(e instanceof Error?e.message:blockedNote[locale]);}
 },[locale,clearPending]);
 const commit=useCallback(()=>{
  if(readonlyRef.current||composing.current)return;
  const active=document.activeElement;
  const element=active instanceof HTMLElement&&active.isContentEditable&&container.current?.contains(active)?active:pending.current?.element;
  if(!element?.isConnected||!container.current?.contains(element)||!element.isContentEditable)return;
  // Fortune 1.0.4 has no public endEdit API. Use the editor's regular Enter handler before host busy/inert state.
  element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
 },[]);
 useEffect(()=>{if(!readOnly&&workbook.current)emit(workbook.current.getAllSheets());},[readOnly,emit]);
 useEffect(()=>{
  const flush=(event:Event)=>{
   if(workbook.current)emit(workbook.current.getAllSheets());
   if(pending.current||composing.current){event.preventDefault();setNotice(finishNote[locale]);}
  };
  const commitEvent=(event:Event)=>{commit();if(composing.current)event.preventDefault();};
  const pointer=(event:Event)=>{const target=event.target as globalThis.Node|null;if(target&&container.current&&!container.current.contains(target))commit();};
  const unload=(event:BeforeUnloadEvent)=>{if(pending.current||composing.current){event.preventDefault();event.returnValue='';}};
  document.addEventListener('pointerdown',pointer,true);document.addEventListener('diriqo-office-commit',commitEvent);document.addEventListener('diriqo-office-flush',flush);window.addEventListener('beforeunload',unload);
  return()=>{document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('diriqo-office-commit',commitEvent);document.removeEventListener('diriqo-office-flush',flush);window.removeEventListener('beforeunload',unload);};
 },[emit,commit,locale]);
 const trackInput=(event:React.FormEvent<HTMLDivElement>)=>{
  if(blockedRef.current)return;const target=event.target as HTMLElement;const element=target.closest?.('[contenteditable="true"]') as HTMLElement|null;
  if(!element||!container.current?.contains(element))return;
  const range=workbook.current?.getSelection()?.[0];const current=selection.current;
  pending.current={element,sheetId:current.sheetId,row:range?.row?.[0]??current.row,column:range?.column?.[0]??current.column,text:element.innerText.replace(/\u00a0/g,' ').replace(/\r\n?/g,'\n')};
  notifyPending(true);
 };
 if(initial.error||!initial.data.length)return <div className="office-alert" role="alert">{initial.error||blockedNote[locale]}</div>;
 return <section className="office-spreadsheet-editor">
  <div className="office-sheet-info" style={{padding:'10px 24px',fontSize:12,color:'#61708a',background:'#f5f8fd'}}>{languageNote[locale]}</div>
  {notice&&<div className="office-alert" role="alert">{notice}<button onClick={()=>setNotice('')}>{m.close}</button></div>}
  <div ref={container} className="office-fortune-container" aria-label={m.spreadsheet} style={{height:'min(78vh,900px)',minHeight:480,width:'100%',position:'relative',background:'#fff'}} onInputCapture={trackInput} onCompositionStartCapture={()=>{composing.current=true;notifyPending(true);}} onCompositionEndCapture={()=>{composing.current=false;}} onDropCapture={event=>{event.preventDefault();event.stopPropagation();setNotice(blockedNote[locale]);}} onPasteCapture={event=>{const text=event.clipboardData.getData('text/plain');const html=event.clipboardData.getData('text/html');if(blockedRef.current||!safePaste(text,html,selection.current.row,selection.current.column)){event.preventDefault();event.stopPropagation();if(!blockedRef.current)setNotice(blockedNote[locale]);}}}>
   <Workbook ref={workbook} data={initial.data} onChange={emit} lang="en" allowEdit={!readOnly&&!disabled} showToolbar={!readOnly} showFormulaBar showSheetTabs toolbarItems={toolbar} cellContextMenu={readOnly||disabled?['copy']:cellMenu} headerContextMenu={readOnly||disabled?['copy']:cellMenu} sheetTabContextMenu={readOnly||disabled?[]:['delete','copy','rename','color','hide','|','move']} hooks={hooks} generateSheetId={()=>crypto.randomUUID()} forceCalculation currency="Kč"/>
  </div>
  {!ready&&<div className="office-loading" style={{padding:12}}>{m.loading}</div>}
 </section>;
}
export default SpreadsheetEditor;
