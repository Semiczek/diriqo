// Synthetic, network-free application markup for a real browser print-CSS test.
// It models DocumentEditor's DOM, including Tiptap table wrappers and host siblings.
import {documentToHtml} from '../src/server/formats.ts';
const p=text=>({type:'paragraph',content:[{type:'text',text}]});
const h=(text,level=1)=>({type:'heading',attrs:{level},content:[{type:'text',text}]});
const cell=(text,header=false)=>({type:header?'tableHeader':'tableCell',content:[p(text)]});
const row=(...content)=>({type:'tableRow',content});
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export const hiddenMarkers=['HOST-NAV-MUST-NOT-PRINT','OFFICE-TOOLBAR-MUST-NOT-PRINT','PANEL-MUST-NOT-PRINT','COOKIE-MUST-NOT-PRINT'];

export function createPrintFixture(kind='long',marginMm=20){
  if(!['short','long'].includes(kind)||!Number.isFinite(marginMm)||marginMm<5||marginMm>50)throw new Error('Invalid synthetic print fixture');
  const longWord='NEPŘERUŠENÝ'.repeat(120);
  const tablePhrase='Žluťoučká položka – bezpečně zalomit.';
  const mustContain=['Tisk Diriqo Office','Příliš žluťoučký kůň úpěl ďábelské ódy.','Částka: 12 345 Kč; zůstatek 50 €.','KONEC OVĚŘOVACÍHO DOKUMENTU'];
  const content=[h(mustContain[0]),p(mustContain[1]),p(mustContain[2]),
    {type:'bulletList',content:['První bod – kontrola podkladů','Druhý bod – zkouška českých znaků'].map(t=>({type:'listItem',content:[p(t)]}))},
    {type:'orderedList',content:['Otevřít dokument','Zkontrolovat sazbu'].map(t=>({type:'listItem',content:[p(t)]}))}];
  if(kind==='long'){
    content.push({type:'pageBreak'},h('TABULKA ZA RUČNÍM ZLOMEM',2),
      {type:'table',content:[row(cell('Položka',true),cell('Popis',true),cell('Cena',true)),
        ...Array.from({length:36},(_,i)=>row(cell(`ŘÁDEK ${String(i+1).padStart(2,'0')}`),cell(`Český popis práce číslo ${i+1}.`),cell(`${i+1} 250 Kč`)))]},
      h('BUŇKA VYŠŠÍ NEŽ STRÁNKA',2),
      {type:'table',content:[row(cell(tablePhrase.repeat(80)+' KONEC DLOUHÉ BUŇKY'),cell('DRUHÝ SLOUPEC BEZ OŘEZU'))]},
      h('DLOUHÝ NEDĚLENÝ ŘÁDEK',2),p(longWord));
    mustContain.push('TABULKA ZA RUČNÍM ZLOMEM','KONEC DLOUHÉ BUŇKY','DRUHÝ SLOUPEC BEZ OŘEZU','DLOUHÝ NEDĚLENÝ ŘÁDEK');
  }
  content.push(p(mustContain[3]));
  return {content:{schemaVersion:1,kind:'document',page:{marginMm,header:'Syntetická firma • tiskový test',footer:'KONEC PATIČKY • syntetická data'},doc:{type:'doc',content}},expected:{kind,marginMm,mustContain,hiddenMarkers,longWord:kind==='long'?longWord:null,tablePhrase:kind==='long'?tablePhrase:null,tableRepeatCount:kind==='long'?80:0,tableRows:kind==='long'?36:0}};
}

export function createPrintHtml(document,css){
  if(typeof css!=='string'||/<\/style/i.test(css))throw new Error('Expected trusted stylesheet');
  // documentToHtml is the public serializer. These two wrappers reproduce editor-only DOM.
  const html=documentToHtml(document).replaceAll('<div style="break-after:page"></div>','<div data-office-page-break="" class="office-page-break"></div>')
    .replace(/<table>([\s\S]*?)<\/table>/g,(_,body)=>{
      const firstRow=body.match(/<tr>([\s\S]*?)<\/tr>/)?.[1]??'';
      const columns=(firstRow.match(/<t[dh]\s/g)??[]).length;
      return `<div class="tableWrapper" style="overflow:auto;width:1200px"><table style="min-width:1200px"><colgroup>${'<col style="width:400px">'.repeat(columns)}</colgroup>${body}</table></div>`;
    });
  return `<!doctype html><html lang="cs" class="h-full"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>Syntetický tisk Diriqo Office</title><style>html{height:100%}body{margin:0;min-height:100%;display:flex;flex-direction:column}#host-shell{height:100vh;overflow:hidden;display:flex;flex-direction:column}#host-nav{min-height:400px}#host-main{height:100vh;overflow:auto;transform:translateZ(0)}#cookie{position:fixed;bottom:0}</style><style>${css}</style><style>@media print{@page{size:A4;margin:${document.page.marginMm}mm}}</style></head><body><div id="host-shell"><nav id="host-nav">${hiddenMarkers[0]}</nav><main id="host-main"><div class="diriqo-office"><div class="office-topbar">${hiddenMarkers[1]}</div><div class="office-edit-workspace"><div class="office-panel">${hiddenMarkers[2]}</div><div class="office-document-editor"><div class="office-editor-toolbar">${hiddenMarkers[1]}</div><div class="office-paper-stage"><article class="office-paper" style="padding:${document.page.marginMm}mm"><div class="office-paper-header">${escape(document.page.header)}</div><div><div contenteditable="true" class="tiptap ProseMirror office-prose">${html}</div></div><div class="office-paper-footer">${escape(document.page.footer)}</div></article></div></div></div></div></main></div><div id="cookie">${hiddenMarkers[3]}</div></body></html>`;
}
