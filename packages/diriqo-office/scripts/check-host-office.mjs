import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const hash=(x,algorithm='sha256')=>createHash(algorithm).update(x).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const metadata=await json('vendor/office-integrity.json'),baseline=await json('vendor/office-dependency-baseline.json');
const bytes=await readFile('vendor/'+metadata.archive);
if(hash(bytes)!==metadata.sha256)throw Error('Office archive changed: rebuild and review shared license evidence first.');
const sourceProvenance=await json('vendor/office-source.json');
if(sourceProvenance.schemaVersion!==1||sourceProvenance.sourceRepository!=='https://github.com/Semiczek/diriqo'||sourceProvenance.sourceBranch!=='codex/office-menu-release'||sourceProvenance.sourceDirectory!=='packages/diriqo-office'||!/^[a-f0-9]{64}$/.test(sourceProvenance.sourceContentSha256??'')||sourceProvenance.runtimeArchiveSha256!==metadata.sha256)throw Error('Office canonical source provenance is missing or inconsistent');
const manifest=await json('package.json'),lock=await json('package-lock.json');
const office=lock.packages['node_modules/@diriqo/office'];
if(office?.integrity!==metadata.integrity||office?.resolved!=='file:vendor/'+metadata.archive||manifest.dependencies?.['@diriqo/office']!==office.resolved)throw Error('Office declaration/lock/archive mismatch');
const actual={...lock.packages};delete actual['node_modules/@diriqo/office'];
actual['']={...actual[''],dependencies:{...actual[''].dependencies}};delete actual[''].dependencies['@diriqo/office'];
const declaration=Object.fromEntries(['dependencies','devDependencies','peerDependencies','optionalDependencies','overrides'].map(k=>[k,{...manifest[k]}]));delete declaration.dependencies['@diriqo/office'];
if(hash(JSON.stringify(declaration))!==baseline.declarationHash)throw Error('New or changed host dependency requires a separate license audit before installation.');
if(hash(JSON.stringify(actual))!==baseline.lockPackagesHash)throw Error('New or changed host transitive/build dependency requires a separate license audit before installation.');
const tar=gunzipSync(bytes,{maxOutputLength:100*1024*1024}),entries=new Map();
for(let pos=0;pos+512<=tar.length;){const header=tar.subarray(pos,pos+512);if(header.every(b=>b===0))break;const name=header.subarray(0,100).toString().replace(/\0.*$/s,'');const size=parseInt(header.subarray(124,136).toString().replace(/\0.*$/s,'').trim(),8);if(!Number.isSafeInteger(size)||size<0||pos+512+size>tar.length)throw Error('Invalid archive');if(entries.has(name))throw Error('Duplicate archive path');entries.set(name,tar.subarray(pos+512,pos+512+size));pos+=512+Math.ceil(size/512)*512;}
const unpackJson=p=>JSON.parse(entries.get('package/'+p)?.toString()??'null');
const evidence=unpackJson('licenses/evidence.json');if(!evidence||evidence.lockSha256!==metadata.licenseEvidence)throw Error('Missing reviewed license evidence');
// Hashes prove integrity; this independent policy also rejects a newly rehashed
// archive containing unknown, copyleft or commercial dependency licenses.
const permittedIds=new Set(['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC','0BSD','CC0-1.0','OFL-1.1']);
const forbiddenName=/(?:^@univerjs-pro\/|^@tiptap-pro\/|^@tiptap\/pro-|handsontable|onlyoffice|^jspreadsheet$)/i;
function selectPermitted(expression){
 if(typeof expression!=='string'||!expression.trim())throw Error('Missing dependency license');
 const tokens=expression.match(/\(|\)|AND\b|OR\b|[A-Za-z0-9.+-]+/g)||[];
 if(tokens.join('')!==expression.replace(/\s/g,''))throw Error('Unknown dependency license expression');
 let i=0;
 function atom(){const token=tokens[i++];if(token==='('){const value=or();if(tokens[i++]!==')')throw Error('Invalid dependency license group');return value;}if(!token||['AND','OR',')'].includes(token))throw Error('Invalid dependency license token');return permittedIds.has(token)?[token]:null;}
 function and(){let value=atom();while(tokens[i]==='AND'){i++;const other=atom();value=value&&other?[...value,...other]:null;}return value;}
 function or(){let value=and();while(tokens[i]==='OR'){i++;const other=and();value=value||other;}return value;}
 const selected=or();if(i!==tokens.length||!selected)throw Error('Disallowed dependency license');return [...new Set(selected)].sort();
}
const licenseList=value=>{if(!Array.isArray(value)||value.some(id=>!permittedIds.has(id)))throw Error('Unknown or disallowed dependency license identifier');return [...new Set(value)].sort();};
const sameList=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
if(!Array.isArray(evidence.packages)||!evidence.packages.length)throw Error('Missing dependency license inventory');
const locations=new Set();
for(const p of evidence.packages){
 if(typeof p.name!=='string'||forbiddenName.test(p.name)||typeof p.location!=='string'||!p.location.startsWith('node_modules/')||locations.has(p.location))throw Error('Forbidden or invalid dependency identity');
 locations.add(p.location);
 if(!sameList(selectPermitted(p.declaredLicense),licenseList(p.selectedLicenses)))throw Error('Dependency license selection mismatch');
 licenseList(p.supplementalLicenses??[]);
 if(!Array.isArray(p.files)||!p.files.length)throw Error('Missing dependency license notices');
}
for(const p of evidence.packages)for(const f of p.files)if(hash(entries.get('package/'+f.path)??'')!==f.sha256)throw Error('Missing license notice: '+f.path);
for(const [f,h]of Object.entries(evidence.generatedHashes))if(hash(entries.get('package/'+f)??'')!==h)throw Error('Modified license report: '+f);
const assetEvidenceBytes=entries.get('package/licenses/assets/evidence.json');
if(!assetEvidenceBytes||!evidence.assetEvidenceSha256||hash(assetEvidenceBytes)!==evidence.assetEvidenceSha256)throw Error('Missing or modified reviewed asset evidence');
const assets=JSON.parse(assetEvidenceBytes.toString());
if(assets.schemaVersion!==1||!Array.isArray(assets.assets)||!assets.assets.length)throw Error('Missing reviewed font assets');
const sbom=unpackJson('sbom.cdx.json');
if(!sbom||sbom.bomFormat!=='CycloneDX'||!Array.isArray(sbom.components)||sbom.components.length!==evidence.packages.length+assets.assets.length||!evidence.generatedHashes['sbom.cdx.json'])throw Error('Missing or inconsistent dependency SBOM');
const byRef=new Map();
for(const component of sbom.components){
 if(typeof component['bom-ref']!=='string'||byRef.has(component['bom-ref'])||!Array.isArray(component.licenses)||!component.licenses.length)throw Error('Invalid SBOM dependency');
 const ids=licenseList(component.licenses.map(item=>item?.license?.id));
 byRef.set(component['bom-ref'],{component,ids});
}
for(const p of evidence.packages){const item=byRef.get(p.location);if(!item||item.component.name!==p.name||item.component.version!==p.version||!sameList(item.ids,licenseList([...p.selectedLicenses,...(p.supplementalLicenses??[])])))throw Error('SBOM dependency license mismatch');}
const assetPath=value=>typeof value==='string'&&/^licenses\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
for(const asset of assets.assets){
 if(asset.license!=='OFL-1.1'||asset.modified!==false||asset.sourceVerifiedByteForByte!==true||!assetPath(asset.path)||!assetPath(asset.licensePath))throw Error('Unreviewed font asset');
 const component=byRef.get(asset.path);if(!component||!sameList(component.ids,[asset.license]))throw Error('SBOM font license mismatch');
 for(const [path,expected]of [[asset.path,asset.sha256],[asset.licensePath,asset.licenseSha256]]){
  const content=entries.get('package/'+path);
  if(!content||!content.length||!/^[a-f0-9]{64}$/.test(expected??'')||hash(content)!==expected)throw Error('Missing or modified font/license asset: '+path);
 }
}
const pkg=unpackJson('package.json');if(!pkg||Object.keys(pkg.dependencies??{}).length||pkg.name!=='@diriqo/office')throw Error('Unexpected runtime dependencies');
for(const p of ['dist/client.js','dist/server.js','dist/import-worker.js','dist/client.css','sbom.cdx.json'])if(!entries.has('package/'+p))throw Error('Incomplete Office package: '+p);
console.log('PASS: Office package, notices, reviewed font/OFL assets, SBOM and unchanged host dependency baseline.');
