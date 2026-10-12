/** Original bounded ODF text subset. No document resources are fetched or executed.
 * Public format: https://docs.oasis-open.org/office/OpenDocument/v1.3/OpenDocument-v1.3-part3-schema.html
 * Package: https://docs.oasis-open.org/office/OpenDocument/v1.3/OpenDocument-v1.3-part2-packages.html
 */
import {zipSync,strToU8} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
import type {DocumentContent} from '../core/types.ts';

export const ODT_MIME='application/vnd.oasis.opendocument.text';
const LIMIT={xml:12*1024*1024,depth:64,nodes:100000,text:4*1024*1024,cells:10000,rows:1000,repeat:1000,styles:4096};
const NS:Record<string,string>={office:'urn:oasis:names:tc:opendocument:xmlns:office:1.0',text:'urn:oasis:names:tc:opendocument:xmlns:text:1.0',style:'urn:oasis:names:tc:opendocument:xmlns:style:1.0',table:'urn:oasis:names:tc:opendocument:xmlns:table:1.0',fo:'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',xlink:'http://www.w3.org/1999/xlink',manifest:'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',draw:'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',script:'urn:oasis:names:tc:opendocument:xmlns:script:1.0',form:'urn:oasis:names:tc:opendocument:xmlns:form:1.0'};
type X={name:string;attrs:Record<string,string>;children:Array<X|string>};
type Mark={type:string;attrs?:Record<string,unknown>};
type Node={type:string;text?:string;attrs?:Record<string,unknown>;marks?:Mark[];content?:Node[]};
const fail=(message:string):never=>{throw Error('OFFICE_FORMAT: '+message);};
const escapeXml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const safeLink=(value:string|undefined)=>value&&/^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(value)?value:null;
const elements=(items:Array<X|string>|undefined,name?:string):X[]=>(items??[]).filter((item):item is X=>typeof item!=='string'&&(!name||item.name===name));
const child=(item:X|undefined,name:string)=>elements(item?.children,name)[0];
function all(items:Array<X|string>,name:string):X[]{return elements(items).flatMap(item=>[...(item.name===name?[item]:[]),...all(item.children,name)]);}
function integer(value:string|undefined,fallback=1,max=LIMIT.repeat):number{if(value===undefined)return fallback;if(!/^[1-9]\d{0,9}$/.test(value))fail('Invalid ODT repeat/span count');const n=Number(value);if(n>max)fail('ODT repetition limit exceeded');return n;}

// Count depth before the recursive XML parser sees the document. Quotes, comments
// and CDATA cannot disguise nested elements; DTD/entity declarations are refused.
function boundedXml(data:Uint8Array|undefined):X[]{
 if(!data)return [];if(data.byteLength>LIMIT.xml)fail('ODT XML size limit exceeded');
 let source:string;try{source=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{fail('ODT requires valid UTF-8 XML');}
 if(/<!DOCTYPE|<!ENTITY/i.test(source!)||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source!))fail('Active or invalid ODT XML');
 let depth=0,count=0,p=0;
 while((p=source!.indexOf('<',p))>=0){
  let end=-1;
  if(source!.startsWith('<!--',p)){end=source!.indexOf('-->',p+4);if(end<0)fail('Malformed ODT XML');p=end+3;continue;}
  if(source!.startsWith('<![CDATA[',p)){end=source!.indexOf(']]>',p+9);if(end<0)fail('Malformed ODT XML');p=end+3;continue;}
  if(source!.startsWith('<?',p)){end=source!.indexOf('?>',p+2);if(end<0)fail('Malformed ODT XML');if(!/^<\?xml\s/i.test(source!.slice(p,end)))fail('ODT processing instructions are disabled');p=end+2;continue;}
  let quote='';for(let i=p+1;i<source!.length;i++){const c=source![i];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>'){end=i;break;}}
  if(end<0)fail('Malformed ODT XML');const token=source!.slice(p,end+1);
  if(token.startsWith('</'))depth--;else{if(++count>LIMIT.nodes)fail('ODT XML node limit exceeded');if(!/\/\s*>$/.test(token))depth++;}
  if(depth<0||depth>LIMIT.depth)fail('ODT XML depth limit exceeded');p=end+1;
 }
 if(depth!==0)fail('Malformed ODT XML');
 let parsed:any[];try{parsed=new XMLParser({preserveOrder:true,ignoreAttributes:false,attributeNamePrefix:'',parseTagValue:false,parseAttributeValue:false,trimValues:false,processEntities:true,htmlEntities:true}).parse(source!,true);}catch{fail('Malformed ODT XML');}
 function normalize(items:any[],inherited:Record<string,string>):Array<X|string>{return items.flatMap<X|string>((item:any)=>{
  if(item['#text']!==undefined)return [String(item['#text'])];
  return Object.keys(item).filter(name=>name!==':@'&&!name.startsWith('?')&&!name.startsWith('#')).map(name=>{
   const attrs=item[':@']??{},scope={...inherited};for(const [key,value]of Object.entries(attrs))if(key==='xmlns')scope['']=String(value);else if(key.startsWith('xmlns:'))scope[key.slice(6)]=String(value);
   const canonical=(key:string,attribute=false)=>{const parts=key.split(':'),prefix=parts.length>1?parts[0]:'',local=parts.at(-1)!;const uri=(!attribute||prefix)?scope[prefix]:undefined;const known=Object.keys(NS).find(p=>NS[p]===uri);return known?known+':'+local:uri?'unknown:'+local:key;};
   return {name:canonical(name),attrs:Object.fromEntries(Object.entries(attrs).filter(([key])=>!key.startsWith('xmlns')).map(([key,value])=>[canonical(key,true),String(value)])),children:normalize(item[name]??[],scope)};
  });
 });}
 return elements(normalize(parsed!,{}));
}

function inspect(items:X[]):void{
 for(const item of items){
  if(/^(script:|form:)|^office:(?:script|forms|event-listeners)$|^draw:(?:object|object-ole|plugin|applet)$|dde/i.test(item.name)||item.name==='manifest:encryption-data'||item.name==='office:scripts'&&item.children.some(child=>typeof child!=='string'||child.trim()))fail('ODT macros, forms, embedded active objects and encrypted files are disabled');
  for(const [name,value]of Object.entries(item.attrs)){
   if(name.startsWith('script:'))fail('ODT event handlers are disabled');
   if(name==='xlink:href'&&item.name!=='text:a'&&(/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(value)||value.split('/').includes('..')))fail('ODT external resources are disabled');
  }
  inspect(elements(item.children));
 }
}

export function importOdt(zip:Record<string,Uint8Array>):{content:DocumentContent;warnings:string[]}{
 if(!zip.mimetype||new TextDecoder().decode(zip.mimetype)!==ODT_MIME||!zip['content.xml']||!zip['META-INF/manifest.xml'])fail('File is not an ODT package');
 const parts=new Map<string,X[]>();
 for(const [name,data]of Object.entries(zip)){
  if(/^(?:Basic|Scripts)\//i.test(name))fail('ODT macros are disabled');
  if(/\.xml$/i.test(name)){const parsed=boundedXml(data);inspect(parsed);parts.set(name,parsed);}
 }
 const main=parts.get('content.xml')!,stylesPart=parts.get('styles.xml')??[],manifest=parts.get('META-INF/manifest.xml')!;
 if(!all(manifest,'manifest:file-entry').some(item=>item.attrs['manifest:full-path']==='/'&&item.attrs['manifest:media-type']===ODT_MIME))fail('Invalid ODT manifest');
 const body=child(all(main,'office:body')[0],'office:text');if(!body)fail('Missing ODT text body');
 const warnings=new Set(['ODT subset: text, headings, lists, basic styles and tables. Advanced layout, images, fields, comments and tracked changes are not preserved; the original file is retained.']);
 const warn=(message:string)=>warnings.add(message);
 const styleNodes=[...all(stylesPart,'style:style'),...all(main,'style:style')];if(styleNodes.length>LIMIT.styles)fail('ODT style limit exceeded');
 const styles=new Map(styleNodes.map(item=>[item.attrs['style:name'],item]));
 const listStyles=new Map([...all(stylesPart,'text:list-style'),...all(main,'text:list-style')].map(item=>[item.attrs['style:name'],item]));
 function properties(name:string|undefined,seen=new Set<string>()):Record<string,string>{if(!name)return {};if(seen.has(name)||seen.size>=16)fail('Cyclic or excessive ODT style inheritance');const style=styles.get(name);if(!style)return {};seen.add(name);return {...properties(style.attrs['style:parent-style-name'],seen),...child(style,'style:text-properties')?.attrs,...child(style,'style:paragraph-properties')?.attrs};}
 function marksFor(name:string|undefined,inherited:Mark[]):Mark[]{
  const attrs=properties(name),out=inherited.map(mark=>({...mark,...(mark.attrs?{attrs:{...mark.attrs}}:{})}));
  for(const [key,type,test]of [['fo:font-weight','bold',/^(bold|[6-9]00)$/],['fo:font-style','italic',/^italic$/],['style:text-underline-style','underline',/^(?!none$).+/],['style:text-line-through-style','strike',/^(?!none$).+/]] as const){if(attrs[key]!==undefined){const at=out.findIndex(mark=>mark.type===type);if(at>=0)out.splice(at,1);if(test.test(attrs[key]))out.push({type});}}
  const textStyle:Record<string,unknown>={};if(/^#[\da-f]{6}$/i.test(attrs['fo:color']??''))textStyle.color=attrs['fo:color'];if(/^(?:[1-9]\d?|1[0-3]\d|14[0-4])(?:\.\d+)?(?:pt|px)$/.test(attrs['fo:font-size']??''))textStyle.fontSize=attrs['fo:font-size'];
  const font=attrs['fo:font-family']?.replace(/^['"]|['"]$/g,'');if(font&&/^[\p{L}\p{N} ,_-]{1,100}$/u.test(font))textStyle.fontFamily=font;
  if(Object.keys(textStyle).length){const previous=out.find(mark=>mark.type==='textStyle');if(previous)previous.attrs={...previous.attrs,...textStyle};else out.push({type:'textStyle',attrs:textStyle});}return out;
 }
 let outputNodes=0,textCount=0,cellCount=0,rowCount=0;
 function made(node:Node):Node{if(++outputNodes>LIMIT.nodes)fail('ODT document node limit exceeded');if(node.text&&(textCount+=node.text.length)>LIMIT.text)fail('ODT text expansion limit exceeded');return node;}
 const text=(value:string,marks:Mark[])=>value?[made({type:'text',text:value,...(marks.length?{marks}: {})})]:[];
 function inline(items:Array<X|string>,marks:Mark[]=[]):Node[]{return items.flatMap(item=>{
  if(typeof item==='string')return text(item.replace(/[\r\n\t ]+/g,' '),marks);
  if(item.name==='text:s')return text(' '.repeat(integer(item.attrs['text:c'])),marks);
  if(item.name==='text:tab')return text('\t',marks);if(item.name==='text:line-break')return [made({type:'hardBreak'})];
  if(['office:annotation','text:note','text:tracked-changes'].includes(item.name)){warn('ODT comments, notes or tracked changes were omitted.');return [];}
  if(item.name.startsWith('draw:')){warn('ODT drawings and images were omitted.');return [];}
  let next=marksFor(item.attrs['text:style-name'],marks);
  if(item.name==='text:a'){const href=safeLink(item.attrs['xlink:href']);if(href)next=[...next,{type:'link',attrs:{href,target:'_blank',rel:'noopener noreferrer'}}];else warn('Unsafe or relative ODT hyperlinks were removed.');}
  if(!['text:span','text:a'].includes(item.name))warn('ODT fields and unsupported inline elements were imported as displayed text.');
  return inline(item.children,next);
 });}
 function blocks(items:Array<X|string>,listDepth=1):Node[]{return elements(items).flatMap(item=>{
  if(item.name==='text:p'||item.name==='text:h'){
   const props=properties(item.attrs['text:style-name']);const attrs:Record<string,unknown>={};if(item.name==='text:h')attrs.level=Math.min(6,integer(item.attrs['text:outline-level'],1,10));
   if(['left','center','right','justify','start','end'].includes(props['fo:text-align']))attrs.textAlign=props['fo:text-align']==='start'?'left':props['fo:text-align']==='end'?'right':props['fo:text-align'];
   return [...(props['fo:break-before']==='page'?[made({type:'pageBreak'})]:[]),made({type:item.name==='text:h'?'heading':'paragraph',attrs,content:inline(item.children,marksFor(item.attrs['text:style-name'],[]))})];
  }
  if(item.name==='text:list'){
   const list=listStyles.get(item.attrs['text:style-name']);const level=elements(list?.children).find(node=>Number(node.attrs['text:level']??1)===listDepth)??elements(list?.children)[0];
   const ordered=level?.name==='text:list-level-style-number',entries=elements(item.children,'text:list-item');const start=entries[0]?.attrs['text:start-value'];
   if(item.attrs['text:continue-numbering']||item.attrs['text:continue-list'])warn('ODT continued list numbering was reset.');
   return [made({type:ordered?'orderedList':'bulletList',...(ordered&&start?{attrs:{start:integer(start,1,1000000)}}:{}),content:entries.map(entry=>{const converted=blocks(entry.children,listDepth+1);return made({type:'listItem',content:converted.length?converted:[made({type:'paragraph'})]});})})];
  }
  if(item.name==='table:table'){
   const rows:Node[]=[];const rowElements=(list:Array<X|string>):X[]=>elements(list).flatMap(node=>node.name==='table:table-row'?[node]:['table:table-header-rows','table:table-rows','table:table-row-group'].includes(node.name)?rowElements(node.children):[]);
   for(const row of rowElements(item.children))for(let r=0;r<integer(row.attrs['table:number-rows-repeated']);r++){
    if(++rowCount>LIMIT.rows)fail('ODT table row limit exceeded');const cells:Node[]=[];
    for(const cell of elements(row.children).filter(node=>['table:table-cell','table:covered-table-cell'].includes(node.name)))for(let c=0;c<integer(cell.attrs['table:number-columns-repeated']);c++){
     if(++cellCount>LIMIT.cells)fail('ODT table cell limit exceeded');if(cell.attrs['table:number-columns-spanned']||cell.attrs['table:number-rows-spanned'])warn('ODT merged table cells were imported as ordinary cells.');if(cell.attrs['table:formula'])warn('ODT text-table formulas were imported as displayed values without calculation.');
     const contents=blocks(cell.children);cells.push(made({type:'tableCell',attrs:{colspan:1,rowspan:1,colwidth:null},content:contents.length?contents:[made({type:'paragraph'})]}));
    }
    if(cells.length)rows.push(made({type:'tableRow',content:cells}));
   }
   return rows.length?[made({type:'table',content:rows})]:[];
  }
  if(['text:tracked-changes','office:annotation','text:note'].includes(item.name)){warn('ODT comments, notes or tracked changes were omitted.');return [];}
  if(item.name.startsWith('draw:')){warn('ODT drawings and images were omitted.');return [];}
  if(item.name!=='text:section')warn('Unsupported ODT block structure was simplified.');return blocks(item.children,listDepth);
 });}
 const converted=blocks(body.children),page={marginMm:20,header:'',footer:''};
 const masters=all(stylesPart,'style:master-page');if(masters.length>1)warn('Only the first ODT master page header and footer were imported.');
 for(const key of ['header','footer'] as const){const section=child(masters[0],'style:'+key);if(section){const value=all(section.children,'text:p').map(p=>inline(p.children).map(n=>n.text??(n.type==='hardBreak'?'\n':'')).join('')).join('\n');if(value.length>10000)fail('ODT header/footer limit exceeded');page[key]=value;}}
 const layoutName=masters[0]?.attrs['style:page-layout-name'],layout=all(stylesPart,'style:page-layout').find(item=>item.attrs['style:name']===layoutName)??all(stylesPart,'style:page-layout')[0];
 const props=child(layout,'style:page-layout-properties')?.attrs,margin=/^(\d+(?:\.\d+)?)(mm|cm|in|pt)$/.exec(props?.['fo:margin']??props?.['fo:margin-left']??'');
 if(margin){const mm=Number(margin[1])*({mm:1,cm:10,in:25.4,pt:25.4/72}[margin[2]]??1);if(mm>=5&&mm<=50)page.marginMm=Math.round(mm*100)/100;}if(props&&['fo:margin-right','fo:margin-top','fo:margin-bottom'].some(key=>props[key]&&props[key]!==props['fo:margin-left']))warn('ODT asymmetric page margins were simplified to a uniform margin.');
 return {content:{schemaVersion:1,kind:'document',doc:{type:'doc',content:converted.length?converted:[{type:'paragraph'}]},page},warnings:[...warnings]};
}

export function exportOdt(document:DocumentContent):{bytes:Uint8Array;warnings:string[]}{
 const warnings=new Set(['ODT export supports basic text, headings, lists, tables and simple page settings. Advanced objects and exact pagination are not preserved.']);
 const styles:string[]=[],styleNames=new Map<string,string>();let nodes=0,chars=0,cells=0,tables=0;
 const style=(family:string,properties:string,paragraph='')=>{const key=family+'|'+properties+'|'+paragraph;if(styleNames.has(key))return styleNames.get(key)!;if(styles.length>=LIMIT.styles)fail('ODT style limit exceeded');const name='S'+(styles.length+1);styleNames.set(key,name);styles.push(`<style:style style:name="${name}" style:family="${family}">${properties?`<style:text-properties ${properties}/>`:''}${paragraph?`<style:paragraph-properties ${paragraph}/>`:''}</style:style>`);return name;};
 const plain=(value:string)=>value.split(/( +|\t|\r\n|\r|\n)/).map(part=>/^ +$/.test(part)?Array.from({length:Math.ceil(part.length/LIMIT.repeat)},(_,i)=>`<text:s text:c="${Math.min(LIMIT.repeat,part.length-i*LIMIT.repeat)}"/>`).join(''):part==='\t'?'<text:tab/>':/^[\r\n]+$/.test(part)?'<text:line-break/>':escapeXml(part)).join('');
 function render(n:any,depth=0):string{
  if(++nodes>LIMIT.nodes||depth>LIMIT.depth)fail('ODT export document limit exceeded');
  const children=()=>Array.isArray(n.content)?n.content.map((child:any)=>render(child,depth+1)).join(''):'';
  if(n.type==='text'){
   const value=String(n.text??'');if((chars+=value.length)>LIMIT.text)fail('ODT text limit exceeded');let output=plain(value);const attrs:string[]=[];let href:string|null=null;
   for(const mark of n.marks??[]){const property=({bold:'fo:font-weight="bold"',italic:'fo:font-style="italic"',underline:'style:text-underline-style="solid"',strike:'style:text-line-through-style="solid"'} as Record<string,string>)[mark.type];if(property)attrs.push(property);else if(mark.type==='link'){href=safeLink(mark.attrs?.href);if(!href)warnings.add('Unsafe ODT hyperlink omitted.');}else if(mark.type==='textStyle'){const a=mark.attrs??{};if(/^#[\da-f]{6}$/i.test(a.color??''))attrs.push(`fo:color="${a.color}"`);if(/^(?:[1-9]\d?|1[0-3]\d|14[0-4])(?:\.\d+)?(?:pt|px)$/.test(a.fontSize??''))attrs.push(`fo:font-size="${a.fontSize}"`);if(typeof a.fontFamily==='string'&&/^[\p{L}\p{N} ,_-]{1,100}$/u.test(a.fontFamily))attrs.push(`fo:font-family="${escapeXml(a.fontFamily)}"`);}else warnings.add('Unsupported ODT text formatting was omitted.');}
   if(attrs.length)output=`<text:span text:style-name="${style('text',Object.values(Object.fromEntries(attrs.map(attr=>[attr.split('=')[0],attr]))).join(' '))}">${output}</text:span>`;if(href)output=`<text:a xlink:type="simple" xlink:href="${escapeXml(href)}">${output}</text:a>`;return output;
  }
  if(n.type==='doc'||n.type==='listItem')return children();if(n.type==='hardBreak')return '<text:line-break/>';
  if(n.type==='paragraph'||n.type==='heading'){const tag=n.type==='heading'?'text:h':'text:p',align=['left','center','right','justify'].includes(n.attrs?.textAlign)?n.attrs.textAlign:null;const name=align?style('paragraph','',`fo:text-align="${align}"`):null;return `<${tag}${n.type==='heading'?` text:outline-level="${Math.min(6,Math.max(1,Number(n.attrs?.level)||1))}"`:''}${name?` text:style-name="${name}"`:''}>${children()}</${tag}>`;}
  if(n.type==='bulletList'||n.type==='orderedList'){const start=Number(n.attrs?.start);return `<text:list text:style-name="${n.type==='orderedList'?'Numbered':'Bullets'}">${(n.content??[]).map((item:any,index:number)=>`<text:list-item${index===0&&n.type==='orderedList'&&Number.isSafeInteger(start)&&start>1&&start<=1000000?` text:start-value="${start}"`:''}>${render(item,depth+1)||'<text:p/>'}</text:list-item>`).join('')}</text:list>`;}
  if(n.type==='table')return `<table:table table:name="Table${++tables}">${children()}</table:table>`;if(n.type==='tableRow')return `<table:table-row>${children()}</table:table-row>`;
  if(n.type==='tableCell'||n.type==='tableHeader'){if(++cells>LIMIT.cells)fail('ODT table cell limit exceeded');if((n.attrs?.colspan??1)>1||(n.attrs?.rowspan??1)>1)warnings.add('Merged table cells were exported as ordinary cells.');return `<table:table-cell office:value-type="string">${children()||'<text:p/>'}</table:table-cell>`;}
  if(n.type==='pageBreak')return `<text:p text:style-name="${style('paragraph','','fo:break-before="page"')}"/>`;
  warnings.add('Unsupported ODT blocks, images or objects were omitted or simplified.');return n.type==='codeBlock'?`<text:p>${children()}</text:p>`:children();
 }
 const body=render(document.doc),namespace=Object.entries(NS).filter(([key])=>key!=='manifest').map(([key,uri])=>`xmlns:${key}="${uri}"`).join(' '),declaration='<?xml version="1.0" encoding="UTF-8"?>';
 const listStyle=(name:string,numbered:boolean)=>`<text:list-style style:name="${name}">${Array.from({length:10},(_,i)=>numbered?`<text:list-level-style-number text:level="${i+1}" style:num-format="1"/>`:`<text:list-level-style-bullet text:level="${i+1}" text:bullet-char="•"/>`).join('')}</text:list-style>`;
 const content=declaration+`<office:document-content ${namespace} office:version="1.3"><office:automatic-styles>${styles.join('')}${listStyle('Numbered',true)}${listStyle('Bullets',false)}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
 const margin=Math.min(50,Math.max(5,Number(document.page?.marginMm)||20));const pageText=(value:unknown)=>{const text=String(value??'');if(text.length>10000)fail('ODT header/footer limit exceeded');return plain(text);};
 const stylesXml=declaration+`<office:document-styles ${namespace} office:version="1.3"><office:styles/><office:automatic-styles><style:page-layout style:name="Page"><style:page-layout-properties fo:page-width="210mm" fo:page-height="297mm" fo:margin="${margin}mm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="Page"><style:header><text:p>${pageText(document.page?.header)}</text:p></style:header><style:footer><text:p>${pageText(document.page?.footer)}</text:p></style:footer></style:master-page></office:master-styles></office:document-styles>`;
 const manifest=declaration+`<manifest:manifest xmlns:manifest="${NS.manifest}" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${ODT_MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
 // Insertion order, level:0 and no extra fields satisfy ODF package section 3.3.
 const bytes=zipSync({mimetype:[strToU8(ODT_MIME),{level:0}], 'content.xml':strToU8(content),'styles.xml':strToU8(stylesXml),'META-INF/manifest.xml':strToU8(manifest)},{level:6});
 return {bytes,warnings:[...warnings]};
}
