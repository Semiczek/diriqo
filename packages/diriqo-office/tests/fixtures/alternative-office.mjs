// Synthetic test documents authored here; no customer data or third-party assets.
import {blankDocument,blankSpreadsheet} from '../../src/core/templates.ts';
import {exportOfficeFile} from '../../src/server/formats.ts';
import {docFixture} from './legacy-office.mjs';

export const sampleText='Žluťoučký kůň – oddělení firmy';
export function alternativeOfficeFixtures() {
 const document=blankDocument();
 document.doc.content=[{type:'heading',attrs:{level:2},content:[{type:'text',text:sampleText}]},{type:'paragraph',content:[{type:'text',text:'Původní dokument.'}]}];
 document.page.header='Ukázková firma';
 const spreadsheet=blankSpreadsheet();
 spreadsheet.workbook.id='integration-format-book';
 spreadsheet.workbook.sheets['sheet-1'].cellData={0:{0:{v:sampleText,t:1},1:{v:12,t:2},2:{v:3,t:2},3:{v:15,t:2,f:'=SUM(B1:C1)'}},1:{0:{v:'00123',t:1}}};
 const bytes=(content,format)=>Buffer.from(exportOfficeFile(content,'Import',format).base64,'base64');
 return [
  {name:'Původní dokument.DOC',bytes:docFixture([{text:sampleText+'\rPůvodní dokument.\r'}]),kind:'document',mime:'application/msword',exportFormat:'odt'},
  {name:'Původní dokument.odt',bytes:bytes(document,'odt'),kind:'document',mime:'application/vnd.oasis.opendocument.text',exportFormat:'odt'},
  {name:'Původní sešit.ods',bytes:bytes(spreadsheet,'ods'),kind:'spreadsheet',mime:'application/vnd.oasis.opendocument.spreadsheet',exportFormat:'ods'},
  {name:'Původní sešit.xls',bytes:bytes(spreadsheet,'xls'),kind:'spreadsheet',mime:'application/vnd.ms-excel',exportFormat:'xls'},
  {name:'Původní sešit.tsv',bytes:Buffer.from(`${sampleText}\t12\t3\t15\r\n00123\t=1+1`),kind:'spreadsheet',mime:'text/tab-separated-values;charset=utf-8',exportFormat:'tsv'},
 ];
}
