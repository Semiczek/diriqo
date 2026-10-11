/** Optional local SQL syntax/privilege evidence using an existing, reviewed PGlite.
 * No network, installation or remote staging connection. See docs/TESTING.md. */
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const requested=process.env.OFFICE_PGLITE_MODULE;
assert.ok(requested&&path.isAbsolute(requested),'Provide an already-reviewed absolute OFFICE_PGLITE_MODULE path');
const moduleFile=await realpath(requested);
assert.ok(moduleFile.split(path.sep).join('/').endsWith('/@electric-sql/pglite/dist/index.js'));
const metadata=JSON.parse(await readFile(path.resolve(path.dirname(moduleFile),'..','package.json'),'utf8'));
assert.equal(metadata.name,'@electric-sql/pglite');assert.equal(metadata.version,'0.5.8');assert.equal(metadata.license,'Apache-2.0');
const {PGlite}=await import(pathToFileURL(moduleFile).href);
const sql=await readFile('scripts/staging-preflight.sql','utf8');
const report={checkedAt:new Date().toISOString(),scope:'Existing local PGlite 0.5.8; read-only preflight SQL over fresh minimal host fixture. NOT Supabase staging evidence.',sqlSha256:createHash('sha256').update(sql).digest('hex'),hosts:[]};
for(const host of ['hub','diriqo']){
 const db=new PGlite();
 try{
  await db.waitReady;await db.query("SELECT set_config('office_test.host',$1,false)",[host]);
  const fixture=await readFile('tests/database-fixture.sql','utf8');
  // Known boundary of our own authored fixture, not a generic SQL splitter.
  const seedStart=fixture.indexOf('insert into auth.users select office_test.id(n)');assert.ok(seedStart>0);
  await db.exec(fixture.slice(0,seedStart));
  await db.exec(await readFile('database/office-core.sql','utf8'));
  if(host==='diriqo')await db.exec(await readFile('database/office-diriqo-adapter.sql','utf8'));
  await db.exec('BEGIN READ ONLY;');const results=await db.exec(sql);await db.exec('ROLLBACK;');
  const counts=results.at(-1).rows;assert.equal(counts.length,4);assert.ok(counts.every(row=>Number(row.row_count)===0));
  const grants=results.flatMap(result=>result.rows).filter(row=>row.schema_name==='office_private'&&row.database_role==='authenticated'&&Object.hasOwn(row,'can_insert'));
  assert.equal(grants.length,2);assert.ok(grants.every(row=>!row.schema_usage&&!row.can_select&&!row.can_insert&&!row.can_update&&!row.can_delete));
  await db.exec(fixture.slice(seedStart));
  await db.exec('BEGIN READ ONLY;');const seeded=await db.exec(sql);await db.exec('ROLLBACK;');
  assert.ok(seeded.at(-1).rows.every(row=>Number(row.row_count)>0),'preflight must reveal nonempty baseline');
  report.hosts.push({host,status:'PASS',queries:results.length,emptyBaselineTables:counts.length,nonemptyBaselineDetected:true,privateAuthenticatedTablesDenied:grants.length});
 }finally{await db.close();}
}
await writeFile('reports/staging-preflight-local.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
