import {readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const flags=process.argv.slice(2);
assert(flags.length<=1&&flags.every(flag=>['--write','--runtime'].includes(flag)),'Usage: check-source-provenance.mjs [--write|--runtime]');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const excluded=new Set(['node_modules','dist','.cache','.npm-cache','SOURCE_MANIFEST.json']);
const files=[];
async function visit(directory){
 for(const name of (await readdir(directory)).sort()){
  if(directory===root&&excluded.has(name))continue;
  const file=resolve(directory,name),path=relative(root,file).replaceAll('\\','/'),stat=await lstat(file);
  assert(!stat.isSymbolicLink(),'Unexpected source symlink: '+path);
  assert(!path.split('/').some(part=>/^\.env(?:\.|$)|^(?:\.git|\.staging|\.aws|reports|output|release|node_modules)$/.test(part)),'Private/generated source path: '+path);
  if(stat.isDirectory())await visit(file);
  else{assert(stat.isFile(),'Unexpected source file type: '+path);const bytes=await readFile(file);files.push({path,bytes:bytes.length,sha256:hash(bytes)});}
 }
}
await visit(root);files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const archive=resolve(root,'../../vendor/diriqo-office-0.1.0.tgz'),archiveBytes=await readFile(archive);
const manifest={schemaVersion:1,repository:'https://github.com/Semiczek/diriqo',sourceDirectory:'packages/diriqo-office',ownership:'One canonical source; both hosts consume the identical reviewed vendor runtime.',sourceSha256:hash(JSON.stringify(files)),runtime:{name:'@diriqo/office',version:'0.1.0',archive:'vendor/diriqo-office-0.1.0.tgz',sha256:hash(archiveBytes)},files};
const manifestPath=resolve(root,'SOURCE_MANIFEST.json');
if(flags.includes('--write')){
 await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 console.log('WROTE source manifest: '+files.length+' files, '+manifest.sourceSha256);process.exit(0);
}
assert.deepEqual(JSON.parse(await readFile(manifestPath,'utf8')),manifest,'Canonical source or runtime differs from the reviewed manifest');
const sourceProvenance=JSON.parse(await readFile(resolve(root,'../../vendor/office-source.json'),'utf8'));
assert.deepEqual(sourceProvenance,{schemaVersion:1,sourceRepository:manifest.repository,sourceBranch:'codex/office-menu-release',sourceDirectory:manifest.sourceDirectory,sourceContentSha256:manifest.sourceSha256,runtimeArchiveSha256:manifest.runtime.sha256},'Host source provenance differs from the canonical source snapshot');
if(flags.includes('--runtime')){
 const tar=gunzipSync(archiveBytes,{maxOutputLength:128*1024*1024});let compared=0;
 for(let offset=0;offset+512<=tar.length;){
  const header=tar.subarray(offset,offset+512);if(header.every(byte=>byte===0))break;
  const field=(a,b)=>header.subarray(a,b).toString().replace(/\0.*$/s,'');
  const prefix=field(345,500),name=(prefix?prefix+'/':'')+field(0,100),size=parseInt(field(124,136).trim(),8);
  assert(Number.isSafeInteger(size)&&size>=0&&offset+512+size<=tar.length,'Invalid runtime tar entry');
  if(name.startsWith('package/dist/')&&name!=='package/dist/build-meta.json'){
   const path=name.slice('package/'.length);assert(!path.split('/').includes('..'),'Unsafe runtime path');
   assert.equal(hash(await readFile(resolve(root,path))),hash(tar.subarray(offset+512,offset+512+size)),'Rebuilt runtime mismatch: '+path);compared++;
  }
  offset+=512+Math.ceil(size/512)*512;
 }
 assert(compared>=10,'Incomplete runtime comparison');
 console.log('PASS: '+compared+' rebuilt runtime files match the immutable vendor archive.');
}
console.log('PASS: '+files.length+' canonical source files, source SHA-256 '+manifest.sourceSha256+', runtime SHA-256 '+manifest.runtime.sha256);
