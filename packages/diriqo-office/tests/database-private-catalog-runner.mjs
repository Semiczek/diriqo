/** Local PostgreSQL catalog evidence only; no network/install/persistent database. */
import {readFile,realpath,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const report={schemaVersion:1,checkedAt:new Date().toISOString(),scope:'Fresh local PGlite 0.5.8 PostgreSQL catalogs after exact Office migrations; not remote Supabase',productionTouched:false,networkUsed:false,hosts:[]};
try{
 assert.equal(process.argv.length,2,'No target arguments accepted');
 const entry=await realpath(process.env.OFFICE_PGLITE_MODULE||'');
 assert.ok(entry.split(sep).join('/').endsWith('/@electric-sql/pglite/dist/index.js'));
 const pkg=resolve(dirname(entry),'..'),meta=JSON.parse(await readFile(resolve(pkg,'package.json'),'utf8'));
 assert.equal(meta.name,'@electric-sql/pglite');assert.equal(meta.version,'0.5.8');assert.equal(meta.license,'Apache-2.0');await readFile(resolve(pkg,'LICENSE'),'utf8');
 const {PGlite}=await import(pathToFileURL(entry).href);
 const names=['tests/database-fixture.sql','database/office-core.sql','database/office-hub-adapter.sql','database/office-diriqo-adapter.sql','database/office-normalized.sql','database/office-normalized-receipt-commit.sql'];
 const source=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(resolve(root,name),'utf8')])));
 report.sourceSha256=Object.fromEntries(Object.entries(source).map(([name,text])=>[name,createHash('sha256').update(text).digest('hex')]));
 for(const host of ['hub','diriqo']){
  const db=new PGlite(),checks=[];const result={host,status:'RUNNING',checks};report.hosts.push(result);
  const check=(label,ok)=>{assert.ok(ok,label);checks.push(label);};
  try{
   await db.waitReady;await db.query("SELECT set_config('office_test.host',$1,false)",[host]);
   for(const name of ['tests/database-fixture.sql','database/office-core.sql',`database/office-${host}-adapter.sql`,'database/office-normalized.sql','database/office-normalized-receipt-commit.sql'])await db.exec(source[name]);
   result.tables=(await db.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,a.attnotnull AS company_not_null,
    format_type(a.atttypid,a.atttypmod) AS company_type
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='company_id' AND NOT a.attisdropped
    WHERE n.nspname='office_private' AND c.relkind='r' ORDER BY c.relname`)).rows;
   check('all eleven private tables have NOT NULL UUID company_id and enabled RLS',result.tables.length===11&&result.tables.every(t=>t.rls&&t.company_not_null&&t.company_type==='uuid'));
   result.foreignKeys=(await db.query(`SELECT rel.relname AS table_name,c.conname AS name,target_ns.nspname AS target_schema,target.relname AS target_table,c.convalidated AS validated,
    ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) AS source_columns,
    ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord) AS target_columns,
    pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
    JOIN pg_class target ON target.oid=c.confrelid JOIN pg_namespace target_ns ON target_ns.oid=target.relnamespace
    WHERE c.contype='f' AND ns.nspname='office_private' ORDER BY rel.relname,c.conname`)).rows;
   check('all private foreign keys are validated',result.foreignKeys.length>0&&result.foreignKeys.every(f=>f.validated));
   const bound=new Set();let progress=true;
   while(progress){progress=false;for(const f of result.foreignKeys){
    const position=f.source_columns.indexOf('company_id');if(position<0)continue;
    const direct=f.target_schema==='public'&&f.target_table==='companies'&&f.target_columns[position]==='id';
    const indirect=f.target_schema==='office_private'&&bound.has(f.target_table)&&f.target_columns[position]==='company_id';
    if((direct||indirect)&&!bound.has(f.table_name)){bound.add(f.table_name);progress=true;}
   }}
   check('each private table has a validated tenant FK path to public.companies(id)',result.tables.every(t=>bound.has(t.name)));
   const internal=result.foreignKeys.filter(f=>f.target_schema==='office_private');
   check('every private-to-private FK includes matching company_id',internal.length>0&&internal.every(f=>{const i=f.source_columns.indexOf('company_id');return i>=0&&f.target_columns[i]==='company_id';}));
   result.clientPrivileges=(await db.query(`SELECT role,
    has_schema_privilege(role,'office_private','USAGE,CREATE') AS schema_access,
    EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='office_private'::regnamespace AND c.relkind='r' AND has_table_privilege(role,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS any_table_access,
    EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='office_private'::regnamespace AND c.relkind='S' AND has_sequence_privilege(role,c.oid,'USAGE,SELECT,UPDATE')) AS any_sequence_access,
    EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='office_private'::regnamespace AND has_function_privilege(role,p.oid,'EXECUTE')) AS any_function_access
    FROM unnest(ARRAY['anon','authenticated','service_role']) AS role ORDER BY role`)).rows;
   check('anon/authenticated/service_role have no private schema/table/sequence/function privileges',result.clientPrivileges.every(r=>!r.schema_access&&!r.any_table_access&&!r.any_sequence_access&&!r.any_function_access));
   result.status='PASS';result.assertions=checks.length;console.log(JSON.stringify({host,status:'PASS',assertions:checks.length,tables:result.tables.length,foreignKeys:result.foreignKeys.length}));
  }catch(error){result.status='FAIL';result.error=String(error.message).slice(0,1500);process.exitCode=1;console.error(JSON.stringify({host,error:result.error}));}
  finally{await db.close();}
  if(process.exitCode)break;
 }
}catch(error){report.error=String(error.message).slice(0,1500);process.exitCode=1;console.error(report.error);}
report.status=process.exitCode?'FAIL':'PASS';
await mkdir(resolve(root,'reports'),{recursive:true});await writeFile(resolve(root,'reports/office-private-catalog.json'),JSON.stringify(report,null,2)+'\n');
