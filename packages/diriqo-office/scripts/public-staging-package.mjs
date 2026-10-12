/** Build an isolated deployment upload. No install, upload or Git write is performed. */
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {isDeploymentSource,assertDeploymentSourcePath,inspectDeploymentSource,assertRequiredDeploymentSources,createDeploymentBootstrap} from './public-staging-source-policy.mjs';
const host=process.argv[2];
if(!['hub','diriqo'].includes(host))throw Error('Host required');
const cwd=path.resolve('integrations',host);
const tracked=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd,encoding:'utf8',maxBuffer:4*1024*1024}).split('\0').filter(Boolean);
const sourceRoot=await realpath(cwd);
const files=[],manifest=[];
for(const file of [...new Set(tracked)].sort()){
 if(!isDeploymentSource(file))continue;
 assertDeploymentSourcePath(host,file);
 const absolute=path.join(cwd,file),stat=await lstat(absolute);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('Non-regular deploy source: '+file);
 const canonical=await realpath(absolute),relative=path.relative(sourceRoot,canonical);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Deployment source escapes checkout: '+file);
 for(let dir=path.dirname(absolute);dir!==cwd;dir=path.dirname(dir))if((await lstat(dir)).isSymbolicLink())throw Error('Symlink deploy source parent: '+file);
 const bytes=await readFile(absolute);
 inspectDeploymentSource(host,file,bytes);
 const sha256=createHash('sha256').update(bytes).digest('hex');
 files.push({file,sha256,data:bytes.toString('base64')});manifest.push({file,sha256,bytes:bytes.length});
}
assertRequiredDeploymentSources(host,files);
const packed=gzipSync(Buffer.from(JSON.stringify(files)),{level:9});
const packedHash=createHash('sha256').update(packed).digest('hex');
const bootstrap=createDeploymentBootstrap(packedHash);
const dir=path.resolve('.staging','deploy-'+host);await mkdir(dir,{recursive:true});
await writeFile(path.join(dir,'office-staging-source.json.gz'),packed);
await writeFile(path.join(dir,'office-staging-unpack.cjs'),bootstrap);
const upload=[];
for(const [file,bytes] of [['office-staging-source.json.gz',packed],['office-staging-unpack.cjs',Buffer.from(bootstrap)],['package.json',await readFile(path.join(cwd,'package.json'))],['package-lock.json',await readFile(path.join(cwd,'package-lock.json'))]]){
 upload.push({file,sha:createHash('sha1').update(bytes).digest('hex'),size:bytes.length,data:bytes.toString('base64')});
}
await writeFile(path.join(dir,'upload.json'),JSON.stringify(upload));
await writeFile(`reports/public-staging-${host}-source.json`,JSON.stringify({host,preparedAt:new Date().toISOString(),sourceBase:execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim(),dirty:true,sourceFiles:manifest,archiveSha256:packedHash,archiveBytes:packed.length,uploadFiles:upload.map(({data,...rest})=>rest),secretsIncluded:false},null,2)+'\n');
console.log(JSON.stringify({host,files:files.length,archiveBytes:packed.length,uploadJsonBytes:Buffer.byteLength(JSON.stringify(upload)),archiveSha256:packedHash}));
