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
 }finally{if(!folder.startsWith(join(tmpdir(),'office-license-check-')))throw Error('Unsafe cleanup target');await rm(folder,{recursive:true,force:true});}
});
