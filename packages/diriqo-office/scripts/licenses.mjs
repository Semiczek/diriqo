import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {checkOfficeAssets} from './check-office-assets.mjs';
const assets=await checkOfficeAssets();
const assetEvidenceBytes=await fs.readFile('licenses/assets/evidence.json');
const root = process.cwd();
const allow = new Set(['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC','0BSD','CC0-1.0','OFL-1.1']);
const blocked = /(?:^@univerjs-pro\/|^@tiptap-pro\/|^@tiptap\/pro-|handsontable|onlyoffice|^jspreadsheet$)/i;
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const json = async p => JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
const lockBytes = await fs.readFile('package-lock.json');
const lock = JSON.parse(lockBytes);
const manifest = await json('package.json');
const declaration = Object.fromEntries(['name','version','dependencies','devDependencies','peerDependencies','optionalDependencies','overrides'].map(k=>[k,manifest[k]??null]));
const declarationHash = sha(JSON.stringify(declaration));
if(lock.lockfileVersion!==3) throw Error('Requires lockfileVersion 3');
const packages = Object.entries(lock.packages).filter(([k])=>k).map(([location,item])=>({...item,location,name:item.name||location.split('node_modules/').at(-1)}));
function permitted(expression){
 if(typeof expression!=='string'||!expression.trim())throw Error('Missing license');
 const tokens=expression.match(/\(|\)|AND\b|OR\b|[A-Za-z0-9.+-]+/g)||[];
 if(tokens.join('')!==expression.replace(/\s/g,''))throw Error('Unknown SPDX syntax: '+expression);
 let i=0;
 function atom(){let t=tokens[i++];if(t==='('){const v=or();if(tokens[i++]!==')')throw Error('Invalid SPDX group');return v;}if(!t||['AND','OR',')'].includes(t))throw Error('Invalid SPDX token');return allow.has(t)?[t]:null;}
 function and(){let v=atom();while(tokens[i]==='AND'){i++;const other=atom();v=v&&other?[...v,...other]:null;}return v;}
 function or(){let v=and();while(tokens[i]==='OR'){i++;const other=and();v=v||other;}return v;}
 const selected=or();if(i!==tokens.length||!selected)throw Error('Disallowed license: '+expression);return [...new Set(selected)];
}
const jstatIntegrity='sha512-rPBkJbK2TnA8pzs93QcDDPlKcrtZWuuCo2dVR0TFLOJSxhqfWOVCSp8aV3/oSbn+4uY4yw1URtLpHQedtmXfug==';
// SheetJS CE releases after the npm registry version are published by SheetJS
// itself. This is an exact reviewed artifact exception, never a CDN wildcard.
const sheetJsArtifact={name:'xlsx',version:'0.20.3',resolved:'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz',license:'Apache-2.0',sha256:'8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8',integrity:'sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA=='};
function pinnedSheetJs(item){return ['name','version','resolved','license','integrity'].every(key=>item[key]===sheetJsArtifact[key]);}
function effectiveLicense(item){
 if(!item.license&&item.name==='jstat'&&item.version==='1.9.6'&&item.integrity===jstatIntegrity)return 'MIT';
 return item.license;
}
function policy(item){
 if(blocked.test(item.name))throw Error('Forbidden package '+item.name);
 if(item.link||(!/^https:\/\/registry\.npmjs\.org\//.test(item.resolved||'')&&!pinnedSheetJs(item)))throw Error('Unreviewed resolution');
 if(!/^sha(?:256|384|512)-/.test(item.integrity||''))throw Error('Missing strong integrity');
 return permitted(effectiveLicense(item));
}
function tar(bytes){
 const out=[];let offset=0,count=0,longName=null,pax={};
 const str=b=>b.toString('utf8').replace(/\0.*$/s,'');
 while(offset+512<=bytes.length){
  const h=bytes.subarray(offset,offset+512);if(h.every(b=>b===0))break;
  if(++count>50000)throw Error('Tar entry limit');
  const stored=parseInt(str(h.subarray(148,156)).trim(),8);
  const actual=h.reduce((s,b,i)=>s+(i>=148&&i<156?32:b),0);
  if(stored!==actual)throw Error('Tar checksum mismatch');
  const size=parseInt(str(h.subarray(124,136)).trim(),8)||0;
  if(!Number.isSafeInteger(size)||size<0||offset+512+size>bytes.length)throw Error('Invalid tar length');
  const content=bytes.subarray(offset+512,offset+512+size),type=String.fromCharCode(h[156]);
  let name=str(h.subarray(0,100));const prefix=str(h.subarray(345,500));if(prefix)name=prefix+'/'+name;
  offset+=512+Math.ceil(size/512)*512;
  if(type==='L'){longName=str(content).trim();continue;}
  if(type==='x'||type==='g'){for(const line of content.toString('utf8').split('\n')){const m=line.match(/^\d+ ([^=]+)=(.*)$/);if(m)pax[m[1]]=m[2];}continue;}
  name=pax.path||longName||name;longName=null;pax={};
  if(name.includes('\\')||name.startsWith('/')||name.split('/').includes('..'))throw Error('Unsafe tar name');
  if(type==='0'||type==='\0')out.push({name,content});
 }
 return out;
}
async function download(url,max=100*1024*1024){
 const res=await fetch(url,{signal:AbortSignal.timeout(90000),redirect:'error'});
 if(!res.ok)throw Error('HTTP '+res.status+': '+url);
 if(Number(res.headers.get('content-length'))>max)throw Error('Download too large');
 const chunks=[];let size=0;for await(const chunk of res.body){size+=chunk.length;if(size>max)throw Error('Download too large');chunks.push(chunk);}return Buffer.concat(chunks);
}
function matches(text,license){
 const patterns={
 MIT:/Permission is hereby granted, free of charge[\s\S]*permission notice shall be included/i,
 'Apache-2.0':/Apache License[\s\S]*Version 2\.0[\s\S]*TERMS AND CONDITIONS/i,
 'BSD-2-Clause':/Redistribution and use in source and binary forms[\s\S]*THIS (?:SOFTWARE )?IS PROVIDED/i,
 'BSD-3-Clause':/Redistribution and use in source and binary forms[\s\S]*(?:Neither the name|name of the copyright holder|names of its contributors)[\s\S]*THIS (?:SOFTWARE )?IS PROVIDED/i,
 ISC:/Permission to use, copy, modify, and(?:\/or)? distribute[\s\S]*THE SOFTWARE IS PROVIDED/i,
 '0BSD':/Permission to use, copy, modify, and(?:\/or)? distribute[\s\S]*THE SOFTWARE IS PROVIDED/i,
 'CC0-1.0':/CC0 1\.0 Universal[\s\S]*(?:Affirmer|public domain)/i,
 'OFL-1.1':/SIL OPEN FONT LICENSE[\s\S]*Version 1\.1/i,
 };return patterns[license]?.test(text.replace(/\s+/g,' '))||false;
}

const upstreamEvidence = [
 {applies:i=>i.name==='bessel'&&i.version==='1.0.2',files:[['Apache2-full-text','https://www.apache.org/licenses/LICENSE-2.0.txt','cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30','Apache-2.0']]},
 { applies: i=>/^@esbuild\//.test(i.name)&&i.version==='0.28.2'||i.name==='esbuild'&&i.version==='0.28.2', files: [
 ['esbuild-MIT','https://raw.githubusercontent.com/evanw/esbuild/609683d892977362a0f99026cb74b96263d728a9/LICENSE.md','b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681','MIT'],
 ['xxhash-MIT','https://raw.githubusercontent.com/evanw/esbuild/609683d892977362a0f99026cb74b96263d728a9/internal/xxhash/LICENSE.txt','f566a9f97bacdaf00d9f21dd991e81dc11201c4e016c86b470799429a1c9a79c','MIT'],
 ['golang-x-sys-BSD3','https://raw.githubusercontent.com/golang/sys/c0bba94af5f8/LICENSE','2d36597f7117c38b006835ae7f537487207d8ec407aa9d9980794b2030cbc067','BSD-3-Clause'],
 ['Go-runtime-BSD3','https://raw.githubusercontent.com/golang/go/go1.26.5/LICENSE','911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad','BSD-3-Clause'],
 ['Go-vendor-x-crypto-BSD3','https://raw.githubusercontent.com/golang/go/go1.26.5/src/vendor/golang.org/x/crypto/LICENSE','911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad','BSD-3-Clause'],
 ['Go-vendor-x-net-BSD3','https://raw.githubusercontent.com/golang/go/go1.26.5/src/vendor/golang.org/x/net/LICENSE','911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad','BSD-3-Clause'],
 ['Go-vendor-x-text-BSD3','https://raw.githubusercontent.com/golang/go/go1.26.5/src/vendor/golang.org/x/text/LICENSE','911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad','BSD-3-Clause'],
 ]},
 { applies: i=>i.name==='@nodable/entities'&&i.version==='3.1.0', files:[
 ['nodable-MIT','https://raw.githubusercontent.com/nodable/val-parsers/ac48e7ea591da372be023a481875c747535812b3/LICENSE','750cb3fb6362804957ef52caaf9b5c824015be44d494637330d7cd8834d31d40','MIT']
 ]},
 { applies: i=>/^@fortune-sheet\/(?:core|react)$/.test(i.name)&&i.version==='1.0.4', files:[
 ['FortuneSheet-MIT','https://raw.githubusercontent.com/ruilisi/fortune-sheet/94346608877db4747406707a177c4b8f3bacdbf9/LICENSE','5fec1b755e7753254cb63ca9400ef0159ebf6bcf05357b72f3e42e0c462a29f9','MIT']
 ]},
];
const upstreamCache = new Map();
async function supplement(item){
 const notices=[];
 for(const group of upstreamEvidence)if(group.applies(item))for(const [name,url,hash,license] of group.files){
  if(!upstreamCache.has(url))upstreamCache.set(url,download(url,1024*1024));
  const content=await upstreamCache.get(url);
  if(sha(content)!==hash||!matches(content.toString('utf8'),license))throw Error('Pinned upstream evidence changed: '+url);
  notices.push({name:'upstream/'+name+'.txt',content,sourceUrl:url,supplementalLicense:license});
 }
 return notices;
}
function isNotice(file){
 const name=path.posix.basename(file.name);
 if(/\.(?:[cm]?js|tsx?|json|map)$/i.test(name))return false;
 return /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i.test(name)||/third[-_]?party.*(?:notice|licen[cs]e)/i.test(name);
}
function assertNoticePolicy(notices){
 const forbidden=/GNU\s+(?:Affero\s+|Lesser\s+|Library\s+)?General\s+Public\s+License|(?:^|\W)(?:AGPL|GPL|LGPL|MPL)-\d|Mozilla Public License|Blue\s*Oak\s+Model\s+License|UNICODE,?\s+INC\.?\s+LICENSE\s+AGREEMENT|Unicode License (?:V3|v3)|W3C (?:Software|License|Community Final Specification)|Creative Commons Attribution|CC-BY(?:-SA)?-\d|zlib License|\(MIT AND Zlib\)|This is free and unencumbered software released into the public domain/i;
 for(const file of notices)if(forbidden.test(file.content.toString('utf8')))throw Error('Embedded notice outside allowlist: '+file.name);
}

const author=a=>typeof a==='string'?a:a?.name||'';
const fingerprint=i=>sha(JSON.stringify({location:i.location,name:i.name,version:i.version,resolved:i.resolved,integrity:i.integrity,license:i.license,dependencies:i.dependencies||{},optionalDependencies:i.optionalDependencies||{},peerDependencies:i.peerDependencies||{}}));
const failures=[];
for(const item of packages){try{policy(item);}catch(e){failures.push(item.name+'@'+item.version+': '+e.message);}}
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
let reviewedRecords=null;
if(process.argv.includes('--check')||process.argv.includes('--refresh-reports')){
 const evidence=await json('licenses/evidence.json');
 if(!process.argv.includes('--refresh-reports')&&evidence.assetEvidenceSha256!==sha(assetEvidenceBytes))throw Error('Asset evidence changed; reviewed report refresh required');
 if(evidence.policyVersion!==1||evidence.lockSha256!==sha(lockBytes)||evidence.declarationSha256!==declarationHash)throw Error('Declarations or lock changed; preflight required BEFORE installation');
 if(evidence.packages.length!==packages.length)throw Error('Evidence count differs');
 const expectedNotices=new Set(evidence.packages.flatMap(p=>p.files.map(f=>f.path)));
 async function checkExtras(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=dir+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Unexpected notice symlink');if(entry.isDirectory())await checkExtras(file);else if(!expectedNotices.has(file))throw Error('Unreviewed extra notice: '+file);}}
 await checkExtras('licenses/texts');
 for(const item of packages){
  const entry=evidence.packages.find(r=>r.location===item.location);
  if(!entry||entry.fingerprint!==fingerprint(item))throw Error('Unreviewed dependency '+item.location);
  if(pinnedSheetJs(item)&&entry.tarballSha256!==sheetJsArtifact.sha256)throw Error('Pinned SheetJS archive evidence changed');
  if(!entry.files.length)throw Error('No notice: '+item.name);
  const contents=[];
  for(const file of entry.files){if(!file.path.startsWith('licenses/texts/')||file.path.split('/').includes('..'))throw Error('Unsafe evidence path');const bytes=await fs.readFile(path.join(root,file.path));if(sha(bytes)!==file.sha256)throw Error('Modified evidence: '+file.path);contents.push(bytes.toString('utf8'));}
  assertNoticePolicy(entry.files.map((f,i)=>({name:f.path,content:Buffer.from(contents[i])})));for(const selected of policy(item))if(!contents.some(s=>matches(s,selected)))throw Error('Missing '+selected+' text: '+item.name);
 }
 for(const [file,hash]of Object.entries(evidence.generatedHashes))if(sha(await fs.readFile(file))!==hash)throw Error('Modified generated file: '+file);
 console.log('PASS: '+packages.length+' exact packages, '+assets.length+' reviewed font asset, evidence and allowlist verified.');
 if(!process.argv.includes('--refresh-reports'))process.exit(0);
 reviewedRecords=evidence.packages;
}
if(!process.argv.includes('--verify-tarballs')&&!reviewedRecords)throw Error('Use --verify-tarballs before npm ci or --check in CI');
await fs.mkdir('licenses/texts',{recursive:true});
const records=reviewedRecords||[];let next=0,completed=0;
async function inspect(item){
 const selected=policy(item),tgz=await download(item.resolved);
 if(pinnedSheetJs(item)&&sha(tgz)!==sheetJsArtifact.sha256)throw Error('Pinned SheetJS archive SHA-256 changed');
 const sri=item.integrity.split(/\s+/).find(s=>/^(sha512|sha384|sha256)-/.test(s)),dash=sri.indexOf('-');
 if(crypto.createHash(sri.slice(0,dash)).update(tgz).digest('base64')!==sri.slice(dash+1))throw Error('SRI mismatch');
 const entries=tar(zlib.gunzipSync(tgz,{maxOutputLength:300*1024*1024}));
 const pkg=entries.filter(f=>/^[^/]+\/package\.json$/.test(f.name)).find(f=>{try{const p=JSON.parse(f.content);return p.name===item.name&&p.version===item.version;}catch{return false;}});if(!pkg)throw Error('No matching root package manifest');
 const metadata=JSON.parse(pkg.content);
 if(metadata.name!==item.name||metadata.version!==item.version)throw Error('Artifact identity mismatch');
 const license=typeof metadata.license==='object'?metadata.license.type:metadata.license||(metadata.licenses?.length===1?metadata.licenses[0]?.type:undefined);
 if(!license||license!==effectiveLicense(item))throw Error('Artifact/lock license mismatch: '+license+'/'+effectiveLicense(item));
 let notices=entries.filter(isNotice);
 for(const file of entries)if(/(?:^|\/)readme(?:\.[a-z]+)?$/i.test(file.name)&&selected.some(id=>matches(file.content.toString('utf8'),id)))notices.push(file);
 const inline=[];
 for(const file of entries)if(/\.(?:[cm]?js|css)$/.test(file.name)){
  const source=file.content.toString('utf8');
  for(const match of source.matchAll(/\/\*[\s\S]*?\*\//g))if(/copyright|@license|SPDX-License-Identifier/i.test(match[0]))inline.push(file.name+'\n'+match[0]);
 }
 if(inline.length)notices.push({name:'inline/INLINE-NOTICES.txt',content:Buffer.from([...new Set(inline)].join('\n\n'))});
 notices.push(...await supplement(item));
 if(!notices.length)throw Error('No license notices or reviewed pinned upstream evidence');
 assertNoticePolicy(notices);
 for(const id of selected)if(!notices.some(f=>matches(f.content.toString('utf8'),id)))throw Error('Published notices do not substantiate '+id);
 const slug=item.name.replace(/[^a-zA-Z0-9.-]/g,'_')+'@'+item.version,files=[];
 for(const [i,file]of notices.entries()){
  const relative='licenses/texts/'+slug+'/'+i+'-'+path.posix.basename(file.name).replace(/[^a-zA-Z0-9._-]/g,'_');
  await fs.mkdir(path.dirname(relative),{recursive:true});await fs.writeFile(relative,file.content);
  files.push({path:relative,archivePath:file.name,sha256:sha(file.content),...(file.sourceUrl?{sourceUrl:file.sourceUrl,supplementalLicense:file.supplementalLicense}:{})});
 }
 return {name:item.name,version:item.version,location:item.location,fingerprint:fingerprint(item),declaredLicense:effectiveLicense(item),lockLicense:item.license||null,selectedLicenses:selected,supplementalLicenses:[...new Set(notices.map(f=>f.supplementalLicense).filter(Boolean))],author:author(metadata.author)||(metadata.contributors||[]).map(author).filter(Boolean).join(', ')||'See preserved copyright notices',repository:typeof metadata.repository==='string'?metadata.repository:metadata.repository?.url||metadata.homepage||'',resolved:item.resolved,integrity:item.integrity,tarballSha256:sha(tgz),files};
}
if(!reviewedRecords)await Promise.all(Array.from({length:8},async()=>{while(next<packages.length){const item=packages[next++];try{records.push(await inspect(item));}catch(e){failures.push(item.name+'@'+item.version+': '+e.message);}completed++;if(completed%25===0)console.log('Inspected '+completed+'/'+packages.length);}}));
if(failures.length){await fs.writeFile('licenses/preflight-failures.json',JSON.stringify(failures,null,2)+'\n');console.error(failures.join('\n'));console.error('BLOCKED: not approved for installation.');process.exit(1);}
records.sort((a,b)=>a.location.localeCompare(b.location));
const esc=v=>String(v).replace(/[|\r\n]/g,' ');
const third='# Third-party licenses\n\nExact npm artifact audit BEFORE installation; all runtime, transitive, development and optional platform packages included. Preserve this file and licenses/texts with distributed bundles. Copyright text is authoritative; authors below are metadata.\n\n| Package | Version | Author | Declared license | Selected | Source and notices |\n| --- | --- | --- | --- | --- | --- |\n'+records.map(r=>'| '+esc(r.name)+' | '+r.version+' | '+esc(r.author)+' | '+esc(r.declaredLicense)+' | '+r.selectedLicenses.join(' AND ')+' | [package artifact]('+r.resolved+') / '+r.files.map((f,i)=>'[notice '+(i+1)+']('+f.path+')').join(', ')+' |').join('\n')+'\n';
const audit='# License audit\n\nPASS for exact shared Diriqo Office lockfile SHA-256 '+sha(lockBytes)+'. '+records.length+' packages inspected. This is technical license evidence checking, not legal advice or legal immunity.\n\nEvery artifact SRI, identity, declared license and preserved LICENSE/COPYING/NOTICE was checked. Third-party notice files and inline copyright blocks were also preserved and screened for known excluded terms. Pinned official upstream evidence is used only for exact reviewed packages that omit full license text in npm artifacts; content hashes and source URLs are retained. jstat1.9.6 uses its exact archived legacy licenses array and MIT LICENSE because npm omits the modern license field. esbuild0.28.2 platform binaries contain Go1.26.5; Go runtime/vendor BSD and xxhash MIT notices are included. Allowed identifiers: '+[...allow].join(', ')+'. OR selects an allowed branch; AND requires every branch. Unknown or missing evidence fails closed.\n\nScope: the new Office package only, including transitive and build dependencies; existing host application dependencies are outside this audit. No package installed by this script.\n\nCI --check fails for changed dependency declarations, lockfile, resolution, integrity, evidence or generated reports. Regenerate preflight before installation, then review the evidence diff. Text markers are a conservative consistency check, not legal interpretation of bundled third-party notices.\n\nAssets: one unmodified Geist Regular 1.800 font is bundled for server PDF export under SIL OFL 1.1. Exact font and full OFL bytes, hashes, pinned upstream URLs and copyright are retained in licenses/assets/evidence.json and ASSET_LICENSES.md. CI validates those bytes and embedded server data. UI continues to use system fonts; dependency controls/icons retain their notices. Customer uploads remain customer content.\n\nExcluded: Univer was rejected because ot-text-unicode4.0.0 has contradictory ISC metadata and an incomplete MIT grant in README; older versions tested had the same discrepancy. TypeScript5.9.3 was not added because its embedded ThirdPartyNoticeText includes Unicode, W3C and CC-BY material outside this strict allowlist. Existing host compiler may be used separately without adding it to this package. ExcelJS, Mammoth and docx were assessed but their resolved dependency trees introduced license identifiers outside the requested strict allowlist (including Unlicense, Zlib or BlueOak). Their permissive top-level license alone was insufficient. PDF candidates pdf-lib1.17.1 plus fontkit1.1.1 and jsPDF4.2.1 were rejected at their pako1/2 dependency paths: MIT AND Zlib requires the excluded Zlib license. PDFKit0.20.2 was considered but its full graph was not approved; its older pako0.2.9 has MIT metadata and LICENSE, so it is not represented as a proven Zlib blocker. These candidates were not installed; a passing full-graph audit is not claimed. See licenses/pdf-candidates.json. The bounded PDF serializer is original project code using the public PDF/OpenType specifications. Office uses original bounded OOXML/OpenDocument text adapters and legacy DOC text recovery based on public format specifications, with explicit fidelity limits; DOC export is not offered. SheetJS Community Edition 0.20.3 (Apache-2.0) supports the spreadsheet conversion adapters. It has no npm runtime dependencies and is pinned to the exact official cdn.sheetjs.com artifact, SHA-256 8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8 and its independently derived SHA-512 integrity. The archive SHA-256 is checked before archive parsing, and its LICENSE files and inline copyright notices are preserved. No general CDN resolution or SheetJS Pro component is approved.\n\nNo paid editor SDK is allowed; runtime telemetry/network behavior requires browser validation separately. Ship THIRD_PARTY_LICENSES.md, LICENSE_AUDIT.md, licenses/ and sbom.cdx.json together.\n';
const components=records.map(r=>({type:'library',name:r.name,version:r.version,'bom-ref':r.location,purl:'pkg:npm/'+r.name.replace('@','%40')+'@'+r.version,licenses:[...new Set([...r.selectedLicenses,...r.supplementalLicenses])].map(id=>({license:{id}})),hashes:[{alg:'SHA-256',content:r.tarballSha256}],externalReferences:[{type:'distribution',url:r.resolved}],properties:[{name:'diriqo:declared-license',value:r.declaredLicense},{name:'diriqo:integrity',value:r.integrity}]}));
function resolve(location,name){let cursor=location;while(true){const p=cursor+'/node_modules/'+name;if(lock.packages[p])return p;const end=cursor.lastIndexOf('/node_modules/');if(end>=0)cursor=cursor.slice(0,end);else break;}const top='node_modules/'+name;return lock.packages[top]?top:null;}
components.push(...assets.map(a=>({type:'file',name:a.name,version:a.version,'bom-ref':a.path,licenses:[{license:{id:a.license}}],hashes:[{alg:'SHA-256',content:a.sha256}],externalReferences:[{type:'distribution',url:a.source},{type:'license',url:a.licenseSource}],properties:[{name:'diriqo:license-path',value:a.licensePath},{name:'diriqo:unmodified',value:'true'}]})));
const dependencies=packages.map(i=>({ref:i.location,dependsOn:[...new Set(Object.keys({...i.dependencies,...i.optionalDependencies,...i.peerDependencies}).map(n=>resolve(i.location,n)).filter(Boolean))].sort()}));
const sbom={bomFormat:'CycloneDX',specVersion:'1.5',version:1,metadata:{component:{type:'application',name:manifest.name,version:manifest.version,'bom-ref':'office'}},components,dependencies:[{ref:'office',dependsOn:Object.keys({...manifest.dependencies,...manifest.devDependencies,...manifest.peerDependencies}).map(n=>'node_modules/'+n).concat(assets.map(a=>a.path)).sort()},...dependencies]};
const outputs={'THIRD_PARTY_LICENSES.md':third+'\n## Bundled font\n\nGeist Regular 1.800 — Copyright 2024 The Geist Project Authors — SIL OFL 1.1. [Preserved full OFL](licenses/assets/Geist-OFL.txt); [exact asset provenance and hashes](licenses/assets/evidence.json). The font is embedded unmodified in PDF output.\n','LICENSE_AUDIT.md':audit,'sbom.cdx.json':JSON.stringify(sbom,null,2)+'\n'};
for(const [file,value]of Object.entries(outputs))await fs.writeFile(file,value);
await fs.writeFile('licenses/evidence.json',JSON.stringify({policyVersion:1,assetEvidenceSha256:sha(assetEvidenceBytes),lockSha256:sha(lockBytes),declarationSha256:declarationHash,generatedHashes:Object.fromEntries(Object.entries(outputs).map(([f,v])=>[f,sha(v)])),packages:records},null,2)+'\n');
console.log('PASS: '+records.length+(reviewedRecords?' prior artifact audits revalidated offline':' artifacts inspected')+'; '+assets.length+' reviewed font; reports and SBOM written. Run --check before npm ci.');
