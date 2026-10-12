import test from 'node:test';
import assert from 'node:assert/strict';
import {blankDocument,blankSpreadsheet,createTemplate,OFFICE_TEMPLATES,validateTemplateVariables} from '../src/core/templates.ts';
import {dictionaries} from '../src/client/locales.ts';
const variables={companyName:'Testovací firma A',customerName:'Zákazník A',jobName:'Zakázka 42',date:'2026-10-11',price:12500.25,currency:'CZK'};
test('six templates produce independent editable snapshots with typed company data',()=>{
 assert.equal(OFFICE_TEMPLATES.length,6);
 for(const template of OFFICE_TEMPLATES){
  const first=createTemplate(template.id,variables);const second=createTemplate(template.id,variables);
  assert.equal(first.kind,template.kind);assert.equal(first.schemaVersion,1);
  assert.match(JSON.stringify(first),/Testovací firma A/);
  assert.doesNotThrow(()=>JSON.parse(JSON.stringify(first)));
  if(first.kind==='document'){first.doc.content[0].content[0].text='changed';assert.notEqual(second.doc.content[0].content[0].text,'changed');}
  else {assert.notEqual(first.workbook.id,second.workbook.id);first.workbook.sheets['sheet-1'].cellData[0][0].v='changed';assert.notEqual(second.workbook.sheets['sheet-1'].cellData[0][0].v,'changed');}
 }
});
test('template data is literal text, never HTML or a formula',()=>{
 const result=createTemplate('quote',{...variables,customerName:'<img src=x onerror=alert(1)>',jobName:'=HYPERLINK("https://evil.test")'});
 assert.equal(result.kind,'document');const serialized=JSON.stringify(result.doc);
 assert.ok(serialized.includes('<img src=x onerror=alert(1)>'));assert.ok(!serialized.includes('"type":"image"'));
 const workbook=createTemplate('estimate',{...variables,jobName:'=WEBSERVICE("https://evil.test")'});
 assert.equal(workbook.workbook.sheets['sheet-1'].cellData[0][1].t,1);assert.equal(workbook.workbook.sheets['sheet-1'].cellData[0][1].f,undefined);
});
test('job estimate has independent formula cells and numeric inputs',()=>{
 const result=createTemplate('estimate',variables);const cells=result.workbook.sheets['sheet-1'].cellData;
 assert.equal(cells[6][1].v,0);assert.equal(cells[6][1].t,2);assert.equal(cells[6][3].f,'=B7*C7');assert.equal(cells[9][3].f,'=SUM(D7:D9)');
});
test('typed template values reject invalid dates, numeric strings and unsafe currencies',()=>{
 for(const invalid of [{date:'2026-02-30'},{date:'no-date'},{price:Infinity},{price:'100'},{currency:'CZK<script>'},{companyName:{x:1}}])assert.throws(()=>validateTemplateVariables({...variables,...invalid}));
 assert.throws(()=>createTemplate('not-a-template',variables));assert.equal(validateTemplateVariables({}).currency,'CZK');
});
test('blank models are independent and do not invent customer data',()=>{
 const a=blankDocument();const b=blankDocument();a.page.header='Only A';assert.equal(b.page.header,'');assert.deepEqual(b.doc.content,[{type:'paragraph',content:[]}]);
 const sheet=blankSpreadsheet();assert.equal(sheet.workbook.sheetOrder.length,1);assert.deepEqual(sheet.workbook.sheets['sheet-1'].cellData,{});
});
test('all seven UI locales contain every label',()=>{
 const keys=Object.keys(dictionaries.cs).sort();assert.equal(Object.keys(dictionaries).length,7);
 for(const [locale,messages] of Object.entries(dictionaries)){assert.deepEqual(Object.keys(messages).sort(),keys);for(const [key,value] of Object.entries(messages))assert.ok(typeof value==='string'&&value.trim(),locale+'.'+key);}
 assert.equal(dictionaries.tr.save,'Kaydet');assert.equal(dictionaries.sq.save,'Ruaj');assert.equal(dictionaries.pl.save,'Zapisz');
});
