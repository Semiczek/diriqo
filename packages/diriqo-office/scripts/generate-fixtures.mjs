import {mkdir,writeFile} from 'node:fs/promises';
import {createTemplate,OFFICE_TEMPLATES,blankSpreadsheet} from '../src/core/templates.ts';
import {exportOfficeFile} from '../src/server/formats.ts';
await mkdir('fixtures',{recursive:true});
const vars={companyName:'Ukázková firma Alfa (DEMO)',customerName:'Ukázkový zákazník (DEMO)',jobName:'Ukázková zakázka (DEMO)',date:'2026-10-11',price:12500,currency:'CZK'};
for(const item of OFFICE_TEMPLATES){const content=createTemplate(item.id,vars),artifact=exportOfficeFile(content,item.id,content.kind==='document'?'docx':'xlsx');await writeFile('fixtures/'+artifact.name,Buffer.from(artifact.base64,'base64'));await writeFile('fixtures/'+item.id+'.office.json',JSON.stringify(content,null,2));}
const wb=blankSpreadsheet();wb.workbook.name='Vzorce a více listů';const s=wb.workbook.sheets['sheet-1'];s.name='Výpočty';s.cellData={0:{0:{v:10,t:2},1:{v:20,t:2},2:{f:'=SUM(A1:B1)',t:2}},1:{0:{f:'=AVERAGE(A1:B1)',t:2},1:{f:'=IF(C1=30,"ANO","NE")',t:1}},2:{0:{f:'=ROUND(12.345,2)',t:2},1:{f:'=COUNTIF(A1:B1,">10")',t:2}},3:{0:{f:"='Sazby'!$A$1*A1",t:2}}};wb.workbook.sheetOrder.push('rates');wb.workbook.sheets.rates={...structuredClone(s),id:'rates',name:'Sazby',cellData:{0:{0:{v:250,t:2}}}};const artifact=exportOfficeFile(wb,'formula-demo','xlsx');await writeFile('fixtures/'+artifact.name,Buffer.from(artifact.base64,'base64'));await writeFile('fixtures/formula-demo.office.json',JSON.stringify(wb,null,2));
await writeFile('fixtures/safe-csv.csv','Kód;Popis;Cena\n00123;"Řádek s čárkou, uvnitř";125,50\n00124;"=HYPERLINK(""https://example.invalid"")";0\n');
console.log('Created six company templates, a multi-sheet formula workbook and a literal CSV fixture.');
