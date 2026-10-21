// Offline PostgreSQL only: real customer DDL and the exact forward migration.
// Both schema variants are disposable; no credentials or hosted connection is used.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
assert.ok(process.env.PGLITE_MODULE && path.isAbsolute(process.env.PGLITE_MODULE),'Set existing absolute PGLITE_MODULE')
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const sql=name=>readFile(path.join(root,name),'utf8')
const bootstrap=await sql('supabase/bootstrap-diriqo-schema.sql')
const customerDdl=bootstrap.match(/create table if not exists public\.customers \([\s\S]*?\n\);/)?.[0]
assert.ok(customerDdl,'Canonical customer schema must exist')
const migration=await sql('supabase/migrations/20261021071033_add_customer_ares_checked_at.sql')
const assertions=await sql('supabase/tests/customer-ares-timestamp.sql')
const passed=[]
for (const existingColumn of [false,true]) {
 const db=new PGlite()
 try {
  await db.exec('create table public.companies(id uuid primary key,name text);')
  const ddl=existingColumn ? customerDdl : customerDdl.replace(/^[ \t]*ares_last_checked_at timestamptz null,\r?\n/m,'')
  assert.equal(ddl.includes('ares_last_checked_at'),existingColumn)
  await db.exec(ddl)
  await db.exec(`with company as (
    insert into public.companies values(gen_random_uuid(),'Synthetic migration company') returning id
  ) insert into public.customers(company_id,name,email,phone,note,billing_name,billing_street,billing_city,billing_postal_code,billing_country,company_number,vat_number)
  select id,'Preserve complete billing','billing@example.invalid',null,'Original note','Original billing','Original street','Original city','10000','CZ','12345678',null from company;
  insert into public.customers(company_id,name) select id,'Preserve null billing' from public.companies;`)
  if (existingColumn) {
   await db.exec("update public.customers set ares_last_checked_at='2025-03-04T10:15:00Z' where name='Preserve complete billing';")
  }
  await db.exec('create temporary table customer_before as select id,to_jsonb(c) as row_data from public.customers c;')
  for (let application=1;application<=2;application++) {
   await db.exec('begin;'+migration+'commit;')
   await db.exec(assertions)
   passed.push({variant:existingColumn?'existing_timestamp':'missing_column',application,assertions:4})
  }
 } finally {await db.close()}
}
console.log(JSON.stringify({runtime:'PGlite',migrationApplications:passed.length,assertions:passed.length*4,passed,fixtures:'disposable_databases_closed'},null,2))
