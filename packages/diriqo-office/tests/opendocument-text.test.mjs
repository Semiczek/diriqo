import test from 'node:test';
import assert from 'node:assert/strict';
import {strToU8,unzipSync,zipSync} from 'fflate';
import {importOdt,exportOdt,ODT_MIME} from '../src/server/opendocument-text.ts';
import {readSafeZip,inspectOdfXml,FORMAT_LIMITS} from '../src/server/container-safety.ts';
import {importOfficeFile} from '../src/server/formats.ts';
import {validateContent} from '../src/core/validation.ts';
import {createHash} from 'node:crypto';

const namespaces={office:'urn:oasis:names:tc:opendocument:xmlns:office:1.0',text:'urn:oasis:names:tc:opendocument:xmlns:text:1.0',style:'urn:oasis:names:tc:opendocument:xmlns:style:1.0',table:'urn:oasis:names:tc:opendocument:xmlns:table:1.0',fo:'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',draw:'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',xlink:'http://www.w3.org/1999/xlink',script:'urn:oasis:names:tc:opendocument:xmlns:script:1.0',manifest:'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0'};
const ns=Object.entries(namespaces).map(([name,value])=>`xmlns:${name}="${value}"`).join(' ');
const manifest=`<manifest:manifest xmlns:manifest="${namespaces.manifest}"><manifest:file-entry manifest:full-path="/" manifest:media-type="${ODT_MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
function fixture(body,{automatic='',styles='',parts={}}={}){return {mimetype:strToU8(ODT_MIME),'META-INF/manifest.xml':strToU8(manifest),'content.xml':strToU8(`<office:document-content ${ns} office:version="1.3"><office:automatic-styles>${automatic}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`),...(styles?{'styles.xml':strToU8(`<office:document-styles ${ns} office:version="1.3">${styles}</office:document-styles>`)}:{}),...parts};}
const flat=node=>[node,...(node.content??[]).flatMap(flat)];
const text=node=>node.type==='text'?node.text:node.type==='hardBreak'?'\n':(node.content??[]).map(text).join('');
const paragraph=value=>({type:'paragraph',content:[{type:'text',text:value}]});
const pack=parts=>{const {mimetype,...rest}=parts;return zipSync({mimetype:[mimetype,{level:0}],...rest});};
const metaNs='urn:oasis:names:tc:opendocument:xmlns:meta:1.0';
const formNs='urn:oasis:names:tc:opendocument:xmlns:form:1.0';
const metadataXml=body=>`<office:document-meta ${ns} xmlns:meta="${metaNs}"><office:meta>${body}</office:meta></office:document-meta>`;

test('ODT imports an ordinary writer document with an empty forms container, including namespace aliases',async()=>{
 for(const forms of [
  `<office:forms xmlns:form="${formNs}" form:automatic-focus="false" form:apply-design-mode="false"/>`,
  `<o:forms xmlns:o="${namespaces.office}" xmlns:f="${formNs}" f:automatic-focus="false" f:apply-design-mode="false"> \n<!-- no controls --> </o:forms>`,
 ]){
  const bytes=pack(fixture(`${forms}<text:h text:outline-level="1">Nabídka</text:h><text:p>Běžný dokument</text:p>`));
  const before=Buffer.from(bytes),result=await importOfficeFile('writer.odt',bytes);
  assert.equal(text(result.content.doc),'NabídkaBěžný dokument');assert.equal(result.content.doc.content[0].type,'heading');
  validateContent(result.content);assert.deepEqual(Buffer.from(bytes),before);assert.equal(result.original.sha256,createHash('sha256').update(before).digest('hex'));
 }
});

test('ODT empty forms exception never permits controls, text, handlers or a substituted namespace',async()=>{
 const forms=[
  `<office:forms xmlns:form="${formNs}"><form:form/></office:forms>`,
  '<office:forms>active</office:forms>',
  '<office:forms><office:scripts/></office:forms>',
  '<office:forms script:macro-name="payload"/>',
  `<office:forms xmlns:form="urn:untrusted" form:automatic-focus="false"/>`,
  '<office:forms xmlns:office="urn:untrusted"/>',
  '<forms/>',
 ];
 for(const body of forms)await assert.rejects(()=>importOfficeFile('writer.odt',pack(fixture(body+'<text:p>Content</text:p>'))),/OFFICE_FORMAT:.*(?:not accepted|disabled)/,body);
});

test('ODT ignores only historical template metadata, warns, retains original and performs no fetch',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',()=>{throw Error('Import must not fetch templates');});
 for(const link of ['file:///templates/letter.ott','http://127.0.0.1/private.ott','../templates/letter.ott']){
  const meta=metadataXml(`<m:template xmlns:m="${metaNs}" xmlns:l="${namespaces.xlink}" l:href="${link}" l:type="simple" l:actuate="onRequest" l:title="Letter" m:date="2026-10-13T12:00:00"/>`);
  const bytes=pack(fixture('<text:p>Original content</text:p>',{parts:{'meta.xml':strToU8(meta)}})),before=Buffer.from(bytes);
  const result=await importOfficeFile('template-based.odt',bytes);
  assert.equal(text(result.content.doc),'Original content');assert.match(result.warnings.join(' '),/template provenance metadata was omitted.*not loaded/);
  assert.ok(!JSON.stringify(result.content).includes(link));validateContent(result.content);assert.deepEqual(Buffer.from(bytes),before);assert.equal(result.original.sha256,createHash('sha256').update(before).digest('hex'));
 }
 assert.equal(fetch.mock.callCount(),0);
});

test('ODT template metadata exception is restricted to its exact part, namespace, path and inert element',async()=>{
 const template='<meta:template xlink:href="http://127.0.0.1/private"/>';
 const base=metadataXml(template);
 const cases=[
  ['styles.xml',base],['nested/meta.xml',base],['META.XML',base],
  ['meta.xml',base.replace(metaNs,'urn:untrusted')],
  ['meta.xml',base.replace(`xmlns:meta="${metaNs}"`,'')],
  ['meta.xml',base.replace(namespaces.office,'urn:untrusted')],
  ['meta.xml',metadataXml('<text:p>'+template+'</text:p>')],
  ['meta.xml',metadataXml('<meta:template xlink:href="http://127.0.0.1/private"><text:p>Content</text:p></meta:template>')],
  ['meta.xml',metadataXml('<meta:template xlink:href="http://127.0.0.1/private" script:macro-name="payload"/>')],
  ['meta.xml',metadataXml('<meta:template xmlns:fake="urn:untrusted" fake:href="http://127.0.0.1/private"/>')],
  ['meta.xml',metadataXml('<draw:image xlink:href="http://127.0.0.1/private"/>')],
 ];
 for(const [part,xml] of cases)await assert.rejects(()=>importOfficeFile('rejected.odt',pack(fixture('<text:p>Content</text:p>',{parts:{[part]:strToU8(xml)}}))),/OFFICE_FORMAT:.*(?:disabled|not accepted)/,part+': '+xml);
 const inline=fixture(template+'<text:p>Content</text:p>');inline['content.xml']=strToU8(Buffer.from(inline['content.xml']).toString().replace('office:version="1.3"',`xmlns:meta="${metaNs}" office:version="1.3"`));
 await assert.rejects(()=>importOfficeFile('rejected.odt',pack(inline)),/external resources are disabled/);
});

test('ODT imports headings, inherited inline styles, explicit whitespace, links and ordered lists',()=>{
 const result=importOdt(fixture('<text:h text:outline-level="2">Nabídka</text:h><text:p text:style-name="Centered"><text:span text:style-name="Emphasis">Příliš</text:span><text:s text:c="2"/>žluťoučký<text:tab/>kůň<text:line-break/><text:a xlink:href="https://jspd.cz">JSPD</text:a></text:p><text:list text:style-name="Numbers"><text:list-item text:start-value="3"><text:p>První</text:p></text:list-item><text:list-item><text:p>Druhý</text:p></text:list-item></text:list>',{automatic:'<style:style style:name="Strong" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="Emphasis" style:family="text" style:parent-style-name="Strong"><style:text-properties fo:font-style="italic" fo:color="#123456"/></style:style><style:style style:name="Centered" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style><text:list-style style:name="Numbers"><text:list-level-style-number text:level="1" style:num-format="1"/></text:list-style>'}));
 const blocks=result.content.doc.content;assert.equal(blocks[0].type,'heading');assert.equal(blocks[0].attrs.level,2);assert.equal(blocks[1].attrs.textAlign,'center');
 assert.equal(text(blocks[1]),'Příliš  žluťoučký\tkůň\nJSPD');assert.deepEqual(blocks[1].content[0].marks.map(mark=>mark.type),['bold','italic','textStyle']);
 assert.equal(blocks[1].content.at(-1).marks[0].attrs.href,'https://jspd.cz');assert.equal(blocks[2].type,'orderedList');assert.equal(blocks[2].attrs.start,3);assert.equal(blocks[2].content.length,2);assert.match(result.warnings.join(' '),/original file is retained/);
});

test('ODT repeats table rows and cells within bounded limits and preserves simple page metadata',()=>{
 const result=importOdt(fixture('<table:table><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"><text:p>100 Kč</text:p></table:table-cell></table:table-row></table:table>',{styles:'<office:automatic-styles><style:page-layout style:name="P"><style:page-layout-properties fo:margin="2.5cm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="P"><style:header><text:p>JSPD<text:s/>Holding</text:p></style:header><style:footer><text:p>Strana</text:p></style:footer></style:master-page></office:master-styles>'}));
 const table=result.content.doc.content[0];assert.equal(table.type,'table');assert.equal(table.content.length,2);assert.equal(table.content[0].content.length,2);assert.equal(text(table.content[1].content[1]),'100 Kč');
 assert.deepEqual(result.content.page,{marginMm:25,header:'JSPD Holding',footer:'Strana'});
});

test('ODT namespace aliases are resolved by URI rather than hardcoded prefix names',()=>{
 const zip=fixture('');zip['content.xml']=strToU8(`<o:document-content xmlns:o="${namespaces.office}" xmlns:t="${namespaces.text}"><o:body><o:text><t:p>Alias works</t:p></o:text></o:body></o:document-content>`);
 assert.equal(text(importOdt(zip).content.doc),'Alias works');
});

test('ODT numeric character references decode once in text and external resource attributes',()=>{
 assert.equal(text(importOdt(fixture('<text:p>&#x17E; &#104; &amp;#104;</text:p>')).content.doc),'ž h &#104;');
 assert.throws(()=>importOdt(fixture('<draw:frame><draw:image xlink:href="&#104;ttp://127.0.0.1/secret"/></draw:frame>')),/external resources are disabled/);
});

test('ODT output is a genuine package with first stored mimetype, manifest and independent XML streams',()=>{
 const source={schemaVersion:1,kind:'document',doc:{type:'doc',content:[paragraph('Dobrý den, světe!')]},page:{marginMm:20,header:'JSPD Holding',footer:'Office'}};
 const output=exportOdt(source),bytes=Buffer.from(output.bytes),zip=unzipSync(output.bytes);
 assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.equal(bytes.readUInt16LE(8),0);assert.equal(bytes.readUInt16LE(28),0);assert.equal(bytes.subarray(30,38).toString(),'mimetype');assert.equal(bytes.subarray(38,38+ODT_MIME.length).toString(),ODT_MIME);
 assert.deepEqual(Object.keys(zip),['mimetype','content.xml','styles.xml','META-INF/manifest.xml']);
 const manifestXml=Buffer.from(zip['META-INF/manifest.xml']).toString();assert.match(manifestXml,/manifest:full-path="\/"/);assert.match(manifestXml,/manifest:full-path="content.xml"/);assert.doesNotMatch(manifestXml,/manifest:full-path="mimetype"/);
 const again=importOdt(zip);assert.equal(text(again.content.doc),'Dobrý den, světe!');assert.deepEqual(again.content.page,source.page);
});

test('ODT export/import preserves basic marks, nested lists, table values, links and significant whitespace',()=>{
 const source={schemaVersion:1,kind:'document',page:{marginMm:18,header:'Firm & Co',footer:'2026'},doc:{type:'doc',content:[
  {type:'heading',attrs:{level:1,textAlign:'center'},content:[{type:'text',text:'Heading',marks:[{type:'bold'},{type:'italic'},{type:'underline'},{type:'strike'},{type:'textStyle',attrs:{fontSize:'14pt',fontFamily:'Arial',color:'#123abc'}},{type:'link',attrs:{href:'https://jspd.cz/path?a=1&b=2'}}]}]},
  paragraph('  Leading  spaces\ttab\nnew line'+' '.repeat(1500)),
  {type:'orderedList',attrs:{start:4},content:[{type:'listItem',content:[paragraph('Number'),{type:'bulletList',content:[{type:'listItem',content:[paragraph('Nested')]}]}]}]},
  {type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[paragraph('Cell A')]},{type:'tableCell',content:[paragraph('Cell B')]}]}]},
 ]}};
 const result=importOdt(unzipSync(exportOdt(source).bytes));assert.equal(text(result.content.doc),text(source.doc));
 const heading=result.content.doc.content[0];assert.equal(heading.attrs.level,1);assert.equal(heading.attrs.textAlign,'center');assert.ok(heading.content[0].marks.some(mark=>mark.type==='link'&&mark.attrs.href.includes('&b=2')));
 for(const kind of ['bold','italic','underline','strike','textStyle'])assert.ok(heading.content[0].marks.some(mark=>mark.type===kind),kind);
 const list=result.content.doc.content[2];assert.equal(list.type,'orderedList');assert.equal(list.attrs.start,4);assert.equal(list.content[0].content[1].type,'bulletList');assert.equal(flat(result.content.doc).filter(node=>node.type==='tableCell').length,2);
});

test('ODT unsupported drawings, notes, merged cells and fields produce warnings without hidden content',()=>{
 const result=importOdt(fixture('<text:p>Visible<office:annotation><text:p>COMMENT</text:p></office:annotation><draw:frame><draw:image xlink:href="Pictures/a.png"/></draw:frame><text:page-number>1</text:page-number></text:p><text:tracked-changes><text:changed-region><text:deletion><text:p>DELETED</text:p></text:deletion></text:changed-region></text:tracked-changes><table:table><table:table-row><table:table-cell table:number-columns-spanned="2"><text:p>Merged</text:p></table:table-cell><table:covered-table-cell/></table:table-row></table:table>'));
 assert.doesNotMatch(text(result.content.doc),/COMMENT|DELETED/);assert.match(text(result.content.doc),/Visible1Merged/);for(const word of ['drawings','comments','fields','merged'])assert.match(result.warnings.join(' '),new RegExp(word,'i'));
});

test('ODT blocks active content, external resources, encrypted manifests and XML entity declarations',()=>{
 const attacks=['<office:script>payload</office:script>','<script:event-listener script:macro-name="vnd.sun.star.script:payload"/>','<draw:object xlink:href="Object 1"/>','<draw:plugin xlink:href="https://evil.invalid/x"/>','<draw:image xlink:href="http://127.0.0.1/metadata"/>','<draw:image xlink:href="../other.xml"/>','<text:dde-connection/>'];
 for(const body of attacks)assert.throws(()=>importOdt(fixture(body)),/OFFICE_FORMAT:.*(?:disabled|active)/i,body);
 const encrypted=fixture('<text:p>x</text:p>');encrypted['META-INF/manifest.xml']=strToU8(manifest.replace('</manifest:manifest>','<manifest:encryption-data/></manifest:manifest>'));assert.throws(()=>importOdt(encrypted),/encrypted files are disabled/);
 const entity=fixture('<text:p>&attack;</text:p>');entity['content.xml']=strToU8('<!DOCTYPE x [<!ENTITY attack SYSTEM "file:///secret">]>'+Buffer.from(entity['content.xml']).toString());assert.throws(()=>importOdt(entity),/Active or invalid ODT XML/);
 assert.throws(()=>importOdt(fixture('<text:p>x</text:p>',{parts:{'Basic/Standard.xml':strToU8('<module/>')}})),/macros are disabled/);
 assert.throws(()=>importOdt(fixture('<text:p>x</text:p>',{parts:{'settings.xml':strToU8('<?xml-stylesheet href="http://localhost/secret"?><settings/>')}})),/processing instructions are disabled/);
});

test('unsafe hyperlinks are stripped while the visible text survives',()=>{
 const result=importOdt(fixture('<text:p><text:a xlink:href="javascript:alert(1)">Keep text</text:a><text:a xlink:href="file:///secret">local</text:a></text:p>'));
 assert.equal(text(result.content.doc),'Keep textlocal');assert.equal(flat(result.content.doc).some(node=>node.marks?.some(mark=>mark.type==='link')),false);assert.match(result.warnings.join(' '),/hyperlinks were removed/);
});

test('ODT rejects deep XML, excessive repeats, style cycles and malformed structures before expansion',()=>{
 assert.throws(()=>importOdt(fixture('<text:section>'.repeat(70)+'<text:p>x</text:p>'+'</text:section>'.repeat(70))),/depth limit/);
 for(const value of ['1001','9999999999','-1','0','NaN'])assert.throws(()=>importOdt(fixture(`<text:p><text:s text:c="${value}"/></text:p>`)),/repeat|repetition/i);
 assert.throws(()=>importOdt(fixture('<table:table><table:table-row table:number-rows-repeated="1000"><table:table-cell table:number-columns-repeated="1000"><text:p>x</text:p></table:table-cell></table:table-row></table:table>')),/cell limit/);
 assert.throws(()=>importOdt(fixture('<text:p text:style-name="A">x</text:p>',{automatic:'<style:style style:name="A" style:parent-style-name="B"/><style:style style:name="B" style:parent-style-name="A"/>'})),/style inheritance/);
 assert.throws(()=>importOdt(fixture('<text:p>wrong</text:h>')),/Malformed ODT XML/);
});

test('ODT text and sheet packages cannot be mistaken for each other',()=>{
 const zip=fixture('<text:p>x</text:p>');zip.mimetype=strToU8('application/vnd.oasis.opendocument.spreadsheet');assert.throws(()=>importOdt(zip),/not an ODT/);
 const noManifest=fixture('<text:p>x</text:p>');delete noManifest['META-INF/manifest.xml'];assert.throws(()=>importOdt(noManifest),/not an ODT/);
 const wrongBody=fixture('');wrongBody['content.xml']=strToU8(`<office:document-content ${ns}><office:body><office:spreadsheet/></office:body></office:document-content>`);assert.throws(()=>importOdt(wrongBody),/Missing ODT text body/);
});

test('shared ODF container guard accepts genuine exports and rejects compressed or misplaced mimetype entries',()=>{
 const source={schemaVersion:1,kind:'document',page:{marginMm:20,header:'',footer:''},doc:{type:'doc',content:[paragraph('Container check')]}};
 const output=exportOdt(source);assert.equal(text(importOdt(readSafeZip(output.bytes,'odf')).content.doc),'Container check');
 const parts=fixture('<text:p>Good body</text:p>');assert.throws(()=>readSafeZip(zipSync(parts,{level:6}),'odf'),/mimetype must be first, uncompressed/);
 const {mimetype,...rest}=parts;assert.throws(()=>readSafeZip(zipSync({...rest,mimetype:[mimetype,{level:0}]},{level:0}),'odf'),/mimetype must be first/);
 assert.throws(()=>readSafeZip(output.bytes),/Not an OOXML/);
 const inconsistent=Buffer.from(output.bytes);inconsistent.writeUInt32LE(inconsistent.readUInt32LE(22)+1,22);assert.throws(()=>readSafeZip(inconsistent,'odf'),/local size or CRC/);
});

test('shared ODF depth scanning honors attribute quotes, CDATA and comments before parsing',()=>{
 const valid='<root><!-- <hidden><hidden> --><entry label="a > b"/><entry label=" />"/><![CDATA[<script>literal text</script>]]></root>';
 assert.equal(inspectOdfXml(strToU8(valid)),valid);
 assert.throws(()=>inspectOdfXml(strToU8('<n label="x > y">'.repeat(97)+'</n>'.repeat(97))),/nesting limit/);
 assert.throws(()=>inspectOdfXml(new Uint8Array(FORMAT_LIMITS.entryBytes+1)),/size limit/);
});

test('shared ODF guard rejects aliased active elements, encoded external resources and stylesheet instructions',()=>{
 const malicious=[
  `<root xmlns:x="${namespaces.script}"><x:event-listener/></root>`,
  `<root xmlns:d="${namespaces.draw}" xmlns:l="${namespaces.xlink}"><d:image l:href="&#104;ttp://127.0.0.1/private"/></root>`,
  `<root xmlns:d="${namespaces.draw}" xmlns:l="${namespaces.xlink}"><d:image l:href="../outside"/></root>`,
  '<?xml-stylesheet href="https://evil.invalid/style.xsl"?><root/>',
  '<root><forms/></root>',
 ];
 for(const xml of malicious)assert.throws(()=>inspectOdfXml(strToU8(xml)),/OFFICE_FORMAT:.*(?:not accepted|disabled)/,xml);
 const normal=`<root xmlns:t="${namespaces.text}" xmlns:l="${namespaces.xlink}"><t:a l:href="https://jspd.cz">Visible link</t:a></root>`;assert.equal(inspectOdfXml(strToU8(normal)),normal);
});
