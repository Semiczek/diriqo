import {readFile,writeFile,readdir,mkdir,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {zipSync,strToU8} from 'fflate';

const folders=['src','types','scripts','tests','docs','database','fixtures','licenses','reports','.github','demo'];
const fixedFiles=['.gitignore','package.json','package-lock.json','tsconfig.json','README.md','LICENSE_AUDIT.md','THIRD_PARTY_LICENSES.md','ASSET_LICENSES.md','sbom.cdx.json','release/diriqo-office-0.1.0.tgz','release/SHA256SUMS','output/pdf/native-print',
 ...['hub','diriqo'].flatMap(host=>['.pdf','-http.json','-validation.json','-page-1.png'].map(suffix=>'output/pdf/public-'+host+'-restored'+suffix))];
const sensitiveField=/^(?:password|passwd|access_?token|refresh_?token|id_?token|authorization|cookie|set-cookie|client_?secret|service_?role_?key|api_?key|private_?key|credentials)$/i;
const secretPatterns=[
 ['jwt',/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/],
 ['secret-api-key',/\b(?:sb_secret_|sbp_|sk_live_|sk_test_)[A-Za-z0-9_-]{16,}\b/],
 ['private-key',/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
 ['url-credentials',/\b(?:postgres(?:ql)?|https?):\/\/[^\s\/@:]+:[^\s\/@]+@/],
 ['bearer-token',/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/i]
];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Fail closed before copying any sensitive path into a source ZIP or nested tarball. */
export function assertPublicReleasePath(file){
 const name=String(file).replaceAll('\\','/');
 const parts=name.split('/');
 if(!name||name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.includes('\0')||parts.some(p=>!p||p==='.'||p==='..'))throw Error('Invalid release path');
 if(parts.some(p=>/^(?:\.staging|\.cache|\.git|\.aws|\.ssh|node_modules)$/i.test(p)||/^\.env(?:\.|$)/i.test(p)||/(?:^|[._-])(?:credentials?|secrets?|passwords?|tokens?)(?:[._-]|$)/i.test(p)||/\.(?:pem|key|pfx|p12)$/i.test(p))||/(^|\/)demo\/data(\/|$)/i.test(name))throw Error('Private path rejected from release: '+name);
 return name;
}

/** Never include matching values in errors. Images need a separate human review. */
export function assertNoReportSecrets(file,bytes,{report=false}={}){
 const text=Buffer.from(bytes).toString('utf8');
 for(const [kind,pattern] of secretPatterns)if(pattern.test(text))throw Error('Release content rejected: '+file+' ('+kind+')');
 if(report&&file.endsWith('.json')){
  let value;try{value=JSON.parse(text);}catch{throw Error('Invalid release JSON report: '+file);}
  const inspect=current=>{
   if(!current||typeof current!=='object')return;
   for(const [key,item]of Object.entries(current)){
    if(sensitiveField.test(key)&&typeof item==='string'&&item.trim())throw Error('Sensitive field rejected from report: '+file);
    if(item&&typeof item==='object')inspect(item);
   }
  };inspect(value);
 }
}

export function auditOfficeTarball(bytes){
 const tar=gunzipSync(bytes,{maxOutputLength:128*1024*1024});
 const seen=new Set();let count=0;
 for(let pos=0;pos+512<=tar.length;){
  const h=tar.subarray(pos,pos+512);if(h.every(b=>b===0))break;
  const field=(a,b)=>h.subarray(a,b).toString('utf8').replace(/\0.*$/s,'');
  const prefix=field(345,500);const name=assertPublicReleasePath((prefix?prefix+'/':'')+field(0,100));
  if(!name.startsWith('package/')||seen.has(name)||++count>10000)throw Error('Invalid nested package path');
  seen.add(name);
  const sizeField=field(124,136).trim();if(!/^[0-7]+$/.test(sizeField))throw Error('Invalid nested package size');
  const size=parseInt(sizeField,8),type=h[156];
  if(!Number.isSafeInteger(size)||size<0||pos+512+size>tar.length||![0,48].includes(type))throw Error('Unsupported nested package entry');
  const checksum=parseInt(field(148,156).trim(),8);
  const sum=h.reduce((total,b,i)=>total+(i>=148&&i<156?32:b),0);
  if(checksum!==sum)throw Error('Invalid nested package checksum');
  if(/\.(?:json|md|txt|log|sql|html)$/i.test(name))assertNoReportSecrets(name,tar.subarray(pos+512,pos+512+size));
  pos+=512+Math.ceil(size/512)*512;
 }
 if(!seen.has('package/package.json'))throw Error('Nested package manifest missing');
 return count;
}

export function deliveryManifest(validation,hosts,reportNames){
 if(!validation||typeof validation!=='object'||!Array.isArray(validation.notExecuted))throw Error('Validation summary must declare remaining checks');
 const staging=validation.staging??{status:'NOT_RECORDED'};
 if(typeof staging.status!=='string'||!staging.status)throw Error('Validation staging status missing');
 return {
  package:'@diriqo/office',version:'0.1.0',hosts,
  delivery:'Source and isolated integration patches. Environment results are reported separately; this manifest is not production approval.',
  validationReport:'reports/validation.json',
  validationCheckedAt:validation.checkedAt??validation.date??null,
  localValidation:{automatedTests:validation.automatedTests??null,postgres:validation.postgres??null,sharedBuild:validation.sharedBuild??null,hubProductionBuild:validation.hubProductionBuild??null,diriqoProductionBuild:validation.diriqoProductionBuild??null},
  stagingStatus:staging.status,staging,
  stagingEvidenceReports:reportNames.filter(name=>/^(?:staging-|public-staging-)/.test(name)).sort().map(name=>'reports/'+name),
  requiredBeforeProduction:[...validation.notExecuted],
  moduleDefault:validation.moduleDefault??'not recorded',
  productionReadiness:'Not certified by this delivery. Review validation.json, remaining checks, limitations and the host enablement procedure.'
 };
}

async function main(){
 const root=resolve('.'),entries={};
 const validationBytes=await readFile('reports/validation.json');
 assertNoReportSecrets('reports/validation.json',validationBytes,{report:true});
 const validation=JSON.parse(validationBytes.toString('utf8'));
 async function add(file){
  const name=assertPublicReleasePath(file),absolute=resolve(root,name),within=relative(root,absolute);
  if(!within||within.startsWith('..'+sep)||within==='..'||resolve(root,within)!==absolute)throw Error('Outside source package');
  const stat=await lstat(absolute);if(stat.isSymbolicLink())throw Error('Symlink not allowed in delivery');
  if(stat.isDirectory()){
   for(const child of await readdir(absolute)){if(name==='demo'&&child==='data')continue;await add(name+'/'+child);}
  }else if(stat.isFile()){
   const bytes=await readFile(absolute);
   if((name.startsWith('reports/')||name.startsWith('output/pdf/'))&&/\.(?:json|log|md|txt|csv|sql|html)$/i.test(name))assertNoReportSecrets(name,bytes,{report:true});
   if(name.endsWith('.tgz'))auditOfficeTarball(bytes);
   entries[name]=new Uint8Array(bytes);
  }else throw Error('Special file not allowed in delivery');
 }
 for(const folder of folders)await add(folder);
 for(const file of fixedFiles)await add(file);
 const hosts={},patches={};
 for(const host of ['hub','diriqo']){
  const cwd=resolve('integrations',host);
  // Inspect both modified and new paths before even marking intent-to-add.
  const run=args=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:30*1024*1024});
  const paths=new Set([...run(['ls-files','-m','-o','--exclude-standard','-z']).split('\0'),...run(['diff','--name-only','-z','HEAD','--']).split('\0')].filter(Boolean));
  for(const file of paths)assertPublicReleasePath(file);
  const base=run(['rev-parse','HEAD']).trim();
  // Only isolated delivery clones are indexed, never the original user checkouts.
  execFileSync('git',['add','-N','--','.'],{cwd});
  const patch=execFileSync('git',['diff','--binary','--no-ext-diff','--'],{cwd,maxBuffer:30*1024*1024});
  assertNoReportSecrets(host+'-office.patch',patch);
  // Binary patch content cannot be scanned as text; validate the exact nested archive.
  auditOfficeTarball(await readFile(resolve(cwd,'vendor/diriqo-office-0.1.0.tgz')));
  patches[host]=patch;
  hosts[host]={base,patch:host+'-office.patch',patchSha256:hash(patch)};
 }
 const manifest=deliveryManifest(validation,hosts,await readdir('reports'));
 const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
 assertNoReportSecrets('release/DELIVERY.json',manifestBytes,{report:true});
 entries['release/DELIVERY.json']=manifestBytes;
 for(const [host,patch]of Object.entries(patches))entries['release/'+host+'-office.patch']=patch;
 entries['DELIVERY-README.txt']=strToU8('Diriqo Office 0.1.0\nRead README.md, docs/ENABLEMENT.md, docs/LIMITATIONS.md and docs/TESTING.md.\nHost patches apply only against exact commits in release/DELIVERY.json.\nNever blindly apply against a dirty original checkout. Review in an isolated branch.\nSee reports/validation.json for completed and outstanding checks; this archive is not production approval.\n');
 // All path/content/archive guards run before writing release artifacts.
 const bytes=zipSync(entries,{level:6}),target='release/diriqo-office-source-and-integrations.zip';
 await mkdir('release',{recursive:true});
 for(const [host,patch]of Object.entries(patches))await writeFile('release/'+host+'-office.patch',patch);
 await writeFile('release/DELIVERY.json',manifestBytes);
 await writeFile(target,bytes);
 console.log(JSON.stringify({path:target,files:Object.keys(entries).length,bytes:bytes.length,sha256:hash(bytes),hosts,stagingStatus:manifest.stagingStatus,remainingChecks:manifest.requiredBeforeProduction.length},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
