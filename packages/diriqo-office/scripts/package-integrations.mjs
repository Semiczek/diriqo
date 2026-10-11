import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
// Run from the shared Office repository after license:check, tests and build.
const manifest=JSON.parse(await readFile('package.json','utf8'));
execFileSync(process.execPath,['scripts/licenses.mjs','--check'],{stdio:'inherit'});
await mkdir('release',{recursive:true});
// npm pack has no lifecycle scripts; package.files determines the distributable boundary.
const npmCli=process.env.npm_execpath||resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
execFileSync(process.execPath,[npmCli,'pack','--ignore-scripts','--silent','--pack-destination','release'],{stdio:'inherit'});
const name=`diriqo-office-${manifest.version}.tgz`,bytes=await readFile('release/'+name);
const integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
const sha256=createHash('sha256').update(bytes).digest('hex');
const core=await readFile('database/office-core.sql','utf8');
for(const host of ['hub','diriqo']){
 const root=resolve('integrations',host);await mkdir(root+'/vendor',{recursive:true});
 const baseManifest=JSON.parse(execFileSync('git',['show','HEAD:package.json'],{cwd:root,encoding:'utf8'}));
 const baseLock=JSON.parse(execFileSync('git',['show','HEAD:package-lock.json'],{cwd:root,encoding:'utf8'}));
 const declaration=Object.fromEntries(['dependencies','devDependencies','peerDependencies','optionalDependencies','overrides'].map(k=>[k,{...baseManifest[k]}]));
 const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 await writeFile(root+'/vendor/office-dependency-baseline.json',JSON.stringify({scope:'Existing host dependencies are unchanged, not newly licensed by Office audit.',declarationHash:hash(declaration),lockPackagesHash:hash(baseLock.packages)},null,2)+'\n');
 await mkdir(root+'/scripts',{recursive:true});await copyFile('scripts/check-host-office.mjs',root+'/scripts/check-office-package.mjs');
 await copyFile('release/'+name,root+'/vendor/'+name);
 const p=JSON.parse(await readFile(root+'/package.json','utf8'));p.dependencies['@diriqo/office']='file:vendor/'+name;await writeFile(root+'/package.json',JSON.stringify(p,null,2)+'\n');
 const lock=JSON.parse(await readFile(root+'/package-lock.json','utf8'));if(lock.lockfileVersion!==3)throw Error('Expected host lockfile v3');
 lock.packages[''].dependencies['@diriqo/office']=p.dependencies['@diriqo/office'];
 lock.packages['node_modules/@diriqo/office']={version:manifest.version,resolved:'file:vendor/'+name,integrity,license:'UNLICENSED',peerDependencies:manifest.peerDependencies};
 await writeFile(root+'/package-lock.json',JSON.stringify(lock,null,2)+'\n');
 const sql=core+'\n'+await readFile('database/office-'+host+'-adapter.sql','utf8');
 await mkdir(root+'/supabase/migrations',{recursive:true});await writeFile(root+'/supabase/migrations/20261011140000_diriqo_office.sql',sql);
 await writeFile(root+'/vendor/office-integrity.json',JSON.stringify({name:manifest.name,version:manifest.version,archive:name,sha256,integrity,licenseEvidence:JSON.parse(await readFile('licenses/evidence.json','utf8')).lockSha256},null,2)+'\n');
}
await writeFile('release/SHA256SUMS',`${sha256}  ${name}\n`);
console.log('Identical reviewed Office archive attached to both isolated host checkouts:',sha256);
