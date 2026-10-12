import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPrintFixture,createPrintHtml,hiddenMarkers} from '../scripts/native-print-fixture.mjs';

test('print fixture uses actual CSS and hostile host dimensions without network assets or scripts',()=>{
 const css=readFileSync(new URL('../src/client/office.css',import.meta.url),'utf8');
 const fixture=createPrintFixture('long',20),html=createPrintHtml(fixture.content,css);
 assert.ok(html.includes(css));assert.match(html,/default-src 'none'/);assert.doesNotMatch(html,/<script|<link|(?:src|href)="https?:/i);
 for(const marker of hiddenMarkers)assert.ok(html.includes(marker));
 assert.match(html,/height:100vh;overflow:hidden;display:flex/);
 assert.match(html,/tableWrapper/);assert.match(html,/min-width:1200px/);
 assert.equal((html.match(/data-office-page-break/g)??[]).length,1);
 assert.equal((html.match(/<col style=/g)??[]).length,5);
 assert.equal((html.match(/ŘÁDEK \d{2}/g)??[]).length,36);
 assert.equal((html.match(/Žluťoučká položka – bezpečně zalomit\./g)??[]).length,80);
});

test('print fixture validates margins and safely serializes text',()=>{
 for(const margin of [NaN,Infinity,0,51])assert.throws(()=>createPrintFixture('short',margin));
 assert.throws(()=>createPrintFixture('unknown',20));
 const fixture=createPrintFixture('short',50);
 fixture.content.page.header='<script>alert(1)</script>';
 fixture.content.doc.content[0].content[0].text='<img onerror=alert(1)>';
 const html=createPrintHtml(fixture.content,'@media print{}');
 assert.doesNotMatch(html,/<script|<img/i);assert.match(html,/&lt;script&gt;/);assert.match(html,/margin:50mm/);
 assert.throws(()=>createPrintHtml(fixture.content,'</style><script>'));
});
