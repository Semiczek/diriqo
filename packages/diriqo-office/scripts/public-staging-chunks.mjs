/** Split an already audited immutable archive for transport through the upload API.
 * Reassembly validates size and SHA256 before the existing unpacker runs.
 * No network, dependencies, application changes or credentials.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const host=process.argv[2];assert.ok(['hub','diriqo'].includes(host)&&process.argv.length===3);
const dir=`.staging/deploy-${host}`;
const manifest=JSON.parse(await readFile(`reports/public-staging-${host}-source.json`,'utf8'));
const files=JSON.parse(await readFile(`${dir}/upload.json`,'utf8'));
const archive=Buffer.from(files.find(x=>x.file==='office-staging-source.json.gz').data,'base64');
const digest=(b,alg='sha256')=>createHash(alg).update(b).digest('hex');
assert.equal(digest(archive),manifest.archiveSha256);assert.equal(archive.length,manifest.archiveBytes);
const parts=[];
for(let offset=0;offset<archive.length;offset+=128*1024){
 const bytes=archive.subarray(offset,offset+128*1024);
 parts.push({file:`office-staging-source.part-${String(parts.length).padStart(3,'0')}`,sha:digest(bytes,'sha1'),size:bytes.length,data:bytes.toString('base64')});
}
assert.equal(digest(Buffer.concat(parts.map(x=>Buffer.from(x.data,'base64')))),manifest.archiveSha256);
function joinArchive(names,expectedSize,expectedHash){
 const fs=require('node:fs'),crypto=require('node:crypto');
 const bytes=Buffer.concat(names.map(name=>fs.readFileSync(name)));
 if(bytes.length!==expectedSize||crypto.createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw Error('Deployment transport digest mismatch');
 const name='office-staging-source.json.gz';
 if(fs.existsSync(name)&&fs.lstatSync(name).isSymbolicLink())throw Error('Unsafe archive destination');
 fs.writeFileSync(name,bytes);
}
const original=Buffer.from(files.find(x=>x.file==='office-staging-unpack.cjs').data,'base64');
const bootstrap=Buffer.concat([Buffer.from(`(${joinArchive.toString()})(${JSON.stringify(parts.map(x=>x.file))},${archive.length},${JSON.stringify(manifest.archiveSha256)});\n`),original]);
const upload=[...parts,{file:'office-staging-unpack.cjs',sha:digest(bootstrap,'sha1'),size:bootstrap.length,data:bootstrap.toString('base64')},...files.filter(x=>['package.json','package-lock.json'].includes(x.file))];
await writeFile(`${dir}/upload-chunked.json`,JSON.stringify(upload));
await writeFile(`reports/public-staging-${host}-transport.json`,JSON.stringify({host,checkedAt:new Date().toISOString(),archiveSha256:manifest.archiveSha256,archiveBytes:archive.length,originalBootstrapSha256:digest(original),bootstrapSha256:digest(bootstrap),reassembledHashVerified:true,uploadFiles:upload.map(({data,...x})=>x)},null,2)+'\n');
console.log(JSON.stringify({host,parts:parts.length,files:upload.length,archiveSha256:manifest.archiveSha256}));

