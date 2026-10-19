'use client';
import React,{useMemo,useState} from 'react';
import type {OfficeLocale,SpreadsheetContent} from '../core/types';
import {spreadsheetPreviewMessages} from '../core/spreadsheet-execution';
const PAGE_ROWS=100;
const columnLabel=(column:number)=>{let value='';for(let n=column+1;n>0;n=Math.floor((n-1)/26))value=String.fromCharCode(65+(n-1)%26)+value;return value;};
/** Intentionally independent of Fortune. Mounting a preview cannot execute formulas. */
export function SpreadsheetReadonlyPreview({content,locale='cs'}:{content:SpreadsheetContent;locale?:OfficeLocale}){
 const m=spreadsheetPreviewMessages[locale]??spreadsheetPreviewMessages.cs;
 const [sheetId,setSheetId]=useState(content.workbook.sheetOrder[0] as string),[page,setPage]=useState(0),[selected,setSelected]=useState({row:0,column:0});
 const sheet=content.workbook.sheets[sheetId],rows=sheet.cellData??{};
 const extent=useMemo(()=>{let row=1,column=1;for(const[r,cells]of Object.entries(rows)){row=Math.max(row,Number(r)+1);for(const c of Object.keys(cells as object))column=Math.max(column,Number(c)+1);}return {rows:row,columns:column};},[sheet]);
 const start=page*PAGE_ROWS,end=Math.min(extent.rows,start+PAGE_ROWS),value=rows[selected.row]?.[selected.column];
 return <section className="office-cached-preview" aria-label={m.title}>
  <div className="office-notice office-preview-note" role="status"><strong>{m.title}</strong><p>{m.description}</p></div>
  <div className="office-preview-sheet-tabs" role="tablist" aria-label={locale==='cs'?'Listy sešitu':'Workbook sheets'}>{content.workbook.sheetOrder.map((id:string)=><button key={id} role="tab" aria-selected={id===sheetId} onClick={()=>{setSheetId(id);setPage(0);setSelected({row:0,column:0});}}>{content.workbook.sheets[id].name}</button>)}</div>
  <div className="office-preview-formula"><span>{columnLabel(selected.column)}{selected.row+1}</span><label>{m.formula}<input readOnly value={String(value?.f??value?.v??'')} /></label></div>
  <div className="office-preview-grid" role="tabpanel" aria-label={sheet.name} tabIndex={0}><table><thead><tr><th aria-label={m.rows}></th>{Array.from({length:extent.columns},(_,column)=><th key={column} scope="col">{columnLabel(column)}</th>)}</tr></thead><tbody>{Array.from({length:end-start},(_,offset)=>{const row=start+offset;return <tr key={row}><th scope="row">{row+1}</th>{Array.from({length:extent.columns},(_,column)=>{const cell=rows[row]?.[column],style=typeof cell?.s==='object'?cell.s:content.workbook.styles?.[cell?.s];const color=(value:unknown)=>typeof value==='string'&&/^#[\da-f]{3,8}$/i.test(value)?value:undefined;return <td key={column}><button type="button" className={selected.row===row&&selected.column===column?'is-selected':''} style={{fontWeight:style?.bl===1?600:undefined,fontStyle:style?.it===1?'italic':undefined,color:color(style?.cl?.rgb),backgroundColor:color(style?.bg?.rgb)}} title={cell?.f??undefined} onClick={()=>setSelected({row,column})}>{String(cell?.v??'')}</button></td>;})}</tr>;})}</tbody></table></div>
  <div className="office-preview-pagination"><span>{m.rows} {start+1}–{end} / {extent.rows}</span><button disabled={page===0} onClick={()=>setPage(page-1)}>{m.previous}</button><button disabled={end>=extent.rows} onClick={()=>setPage(page+1)}>{m.next}</button></div>
 </section>;
}