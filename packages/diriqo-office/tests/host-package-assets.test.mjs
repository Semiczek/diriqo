import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import vm from 'node:vm';

// Execute the exact generated host CI checker. Only its filesystem boundary is fake.
const source=(await readFile(new URL('../scripts/check-host-office.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value));
function tar(files){
 const parts=[];
 for(const [name,content]of files){const header=Buffer.alloc(512);header.write('package/'+name,0);header.write(content.length.toString(8).padStart(11,'0')+'\0',124);parts.push(header,content,Buffer.alloc((512-content.length%512)%512));}
 return gzipSync(Buffer.concat([...parts,Buffer.alloc(1024)]));
}
function fixture(mutate=()=>{}){
 const font=Buffer.from('reviewed immutable font'),license=Buffer.from('reviewed full OFL and copyright');
 const assets={schemaVersion:1,assets:[{path:'licenses/assets/font.ttf',sha256:hash(font),license:'OFL-1.1',licensePath:'licenses/assets/OFL.txt',licenseSha256:hash(license),modified:false,sourceVerifiedByteForByte:true}]};
 const notice=Buffer.from('Reviewed MIT license notice'),dependency={name:'reviewed-package',version:'1.0.0',location:'node_modules/reviewed-package',declaredLicense:'MIT',selectedLicenses:['MIT'],supplementalLicenses:[],files:[{path:'licenses/texts/reviewed-package/LICENSE',sha256:hash(notice)}]};
 const sbom={bomFormat:'CycloneDX',components:[{name:dependency.name,version:dependency.version,'bom-ref':dependency.location,licenses:[{license:{id:'MIT'}}]},{name:'Font','bom-ref':'licenses/assets/font.ttf',licenses:[{license:{id:'OFL-1.1'}}]}]};
 const assetBytes=json(assets),sbomBytes=json(sbom),evidence={lockSha256:'reviewed-lock',packages:[dependency],generatedHashes:{'sbom.cdx.json':hash(sbomBytes)},assetEvidenceSha256:hash(assetBytes)};
 const files=new Map([['package.json',json({name:'@diriqo/office'})],['licenses/evidence.json',json(evidence)],['licenses/assets/evidence.json',assetBytes],['licenses/assets/font.ttf',font],['licenses/assets/OFL.txt',license],['licenses/texts/reviewed-package/LICENSE',notice],['sbom.cdx.json',sbomBytes]]);
 for(const path of ['dist/client.js','dist/server.js','dist/import-worker.js','dist/client.css'])files.set(path,Buffer.from('present'));
 mutate(files,evidence,assets);
 const bytes=tar(files),archive='diriqo-office.tgz',integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
 const basePackages={'':{dependencies:{}}},declaration=Object.fromEntries(['dependencies','devDependencies','peerDependencies','optionalDependencies','overrides'].map(key=>[key,{}]));
 const disk=new Map([
  ['vendor/'+archive,bytes],
  ['vendor/office-source.json',json({schemaVersion:1,sourceRepository:'https://github.com/Semiczek/diriqo',sourceBranch:'codex/office-menu-release',sourceDirectory:'packages/diriqo-office',sourceContentSha256:'a'.repeat(64),runtimeArchiveSha256:hash(bytes)})],
  ['vendor/office-integrity.json',json({archive,sha256:hash(bytes),integrity,licenseEvidence:'reviewed-lock'})],
  ['vendor/office-dependency-baseline.json',json({declarationHash:hash(JSON.stringify(declaration)),lockPackagesHash:hash(JSON.stringify(basePackages))})],
  ['package.json',json({dependencies:{'@diriqo/office':'file:vendor/'+archive}})],
  ['package-lock.json',json({packages:{'':{dependencies:{'@diriqo/office':'file:vendor/'+archive}},'node_modules/@diriqo/office':{resolved:'file:vendor/'+archive,integrity}}})]
 ]);
 return {async readFile(path,encoding){assert.ok(disk.has(path),'Unexpected read '+path);return encoding?disk.get(path).toString():disk.get(path);}};
}
async function check(mutate){const fs=fixture(mutate);return vm.runInNewContext('(async()=>{'+source+'})()', {...fs,createHash,gunzipSync,console:{log(){}}});}

test('host package check verifies reviewed font and full OFL bytes',async()=>{await check();});
test('host package check rejects changed or omitted font and OFL despite a matching outer archive hash',async()=>{
 for(const path of ['licenses/assets/font.ttf','licenses/assets/OFL.txt']){
  await assert.rejects(check(files=>files.set(path,Buffer.from('changed'))),/font\/license asset/);
  await assert.rejects(check(files=>files.delete(path)),/font\/license asset/);
 }
});
test('host package check binds asset evidence to the reviewed main evidence',async()=>{
 await assert.rejects(check(files=>files.delete('licenses/assets/evidence.json')),/asset evidence/);
 await assert.rejects(check((files,_evidence,assets)=>{assets.assets[0].sha256='f'.repeat(64);files.set('licenses/assets/evidence.json',json(assets));}),/asset evidence/);
});
test('host package check rejects empty or unsafe asset descriptors',async()=>{
 for(const alter of [assets=>{assets.assets=[];},assets=>{assets.assets[0].path='licenses/assets/../font.ttf';},assets=>{assets.assets[0].modified=true;},assets=>{assets.assets[0].license='UNKNOWN';}]){
  await assert.rejects(check((files,evidence,assets)=>{alter(assets);const bytes=json(assets);files.set('licenses/assets/evidence.json',bytes);evidence.assetEvidenceSha256=hash(bytes);files.set('licenses/evidence.json',json(evidence));}),/font asset|SBOM/);
 }
});

test('host policy rejects forbidden, unknown and missing licenses even when every artifact hash is recomputed',async()=>{
 for(const declaredLicense of ['AGPL-3.0-only','MIT AND GPL-3.0-only','LicenseRef-Unknown',undefined]){
  await assert.rejects(check((files,evidence)=>{evidence.packages[0].declaredLicense=declaredLicense;files.set('licenses/evidence.json',json(evidence));}),/dependency license/);
 }
 await assert.rejects(check((files,evidence)=>{evidence.packages[0].selectedLicenses=['UNKNOWN'];files.set('licenses/evidence.json',json(evidence));}),/dependency license/);
 await assert.rejects(check((files,evidence)=>{evidence.packages[0].supplementalLicenses=['GPL-2.0-only'];files.set('licenses/evidence.json',json(evidence));}),/dependency license/);
 await assert.rejects(check((files,evidence)=>{evidence.packages[0].name='@univerjs-pro/sheets';files.set('licenses/evidence.json',json(evidence));}),/Forbidden.*dependency/);
});

test('host policy rejects rehashed forbidden SBOM and a SBOM that disagrees with reviewed evidence',async()=>{
 for(const id of ['GPL-3.0-only','UNKNOWN','Apache-2.0']){
  await assert.rejects(check((files,evidence)=>{const sbom=JSON.parse(files.get('sbom.cdx.json'));sbom.components[0].licenses=[{license:{id}}];const bytes=json(sbom);files.set('sbom.cdx.json',bytes);evidence.generatedHashes['sbom.cdx.json']=hash(bytes);files.set('licenses/evidence.json',json(evidence));}),/license/);
 }
});
