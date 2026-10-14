import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
test('license CI refuses changed, unknown and disallowed dependency records before install',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'office-license-check-'));
 try{
  await mkdir(join(folder,'scripts'));await mkdir(join(folder,'src/server'),{recursive:true});
  await cp(resolve('licenses'),join(folder,'licenses'),{recursive:true});
  for(const name of ['scripts/licenses.mjs','scripts/check-office-assets.mjs','package.json','package-lock.json','src/server/pdf-font-data.ts','THIRD_PARTY_LICENSES.md','LICENSE_AUDIT.md','sbom.cdx.json'])await copyFile(resolve(name),join(folder,name));
  const run=()=>spawnSync(process.execPath,['scripts/licenses.mjs','--check'],{cwd:folder,encoding:'utf8'});
  const baseline=run();assert.equal(baseline.error,undefined);assert.equal(baseline.status,0,baseline.stderr);assert.match(baseline.stdout,/PASS: .* exact packages/);
  const original=JSON.parse(await readFile(join(folder,'package-lock.json'),'utf8'));
  for(const license of ['AGPL-3.0-only',undefined,'MIT']){
   const lock=structuredClone(original);lock.packages['node_modules/unreviewed-editor']={version:'1.0.0',resolved:'https://registry.npmjs.org/unreviewed-editor/-/unreviewed-editor-1.0.0.tgz',integrity:'sha512-test',...(license?{license}:{})};
   await writeFile(join(folder,'package-lock.json'),JSON.stringify(lock));
   const result=run();assert.equal(result.error,undefined);assert.notEqual(result.status,0,'Unreviewed '+license+' must fail before installation');
   assert.match(result.stderr,license==='MIT'?/Declarations or lock changed; preflight required BEFORE installation/:license?/Disallowed license: AGPL-3.0-only/:/Missing license/);
  }
  const reviewed=original.packages['node_modules/xlsx'];
  assert.equal(reviewed.version,'0.20.3');assert.equal(reviewed.license,'Apache-2.0');
  assert.equal(reviewed.resolved,'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz');
  for(const change of [
   {version:'0.20.4'},
   {name:'unreviewed-editor'},
   {resolved:'https://cdn.sheetjs.com/xlsx-0.20.4/xlsx-0.20.4.tgz'},
   {resolved:reviewed.resolved+'?unreviewed=1'},
   {resolved:'https://cdn.example.test/xlsx-0.20.3.tgz'},
   {integrity:'sha512-unreviewed'},
   {license:'MIT'},
  ]){
   const lock=structuredClone(original);Object.assign(lock.packages['node_modules/xlsx'],change);
   await writeFile(join(folder,'package-lock.json'),JSON.stringify(lock));
   const result=run();assert.equal(result.error,undefined);assert.notEqual(result.status,0);
   assert.match(result.stderr,/Unreviewed resolution/,'Exact SheetJS exception must fail closed: '+JSON.stringify(change));
  }
  await copyFile(resolve('package-lock.json'),join(folder,'package-lock.json'));
  const evidencePath=join(folder,'licenses/evidence.json'),evidence=JSON.parse(await readFile(evidencePath,'utf8'));
  const sheet=evidence.packages.find(item=>item.name==='xlsx');
  assert.equal(sheet.tarballSha256,'8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8');
  assert.ok(sheet.files.some(file=>/LICENSE/.test(file.archivePath)));
  sheet.tarballSha256='0'.repeat(64);await writeFile(evidencePath,JSON.stringify(evidence));
  const changedEvidence=run();assert.notEqual(changedEvidence.status,0);assert.match(changedEvidence.stderr,/Pinned SheetJS archive evidence changed/);
 }finally{if(!folder.startsWith(join(tmpdir(),'office-license-check-')))throw Error('Unsafe cleanup target');await rm(folder,{recursive:true,force:true});}
});
