// Actual Office migrations and authenticated RPCs over an isolated existing PGlite runtime.
// Minimal Auth/host fixture; no hosted database, external provider or concurrency proof.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const configured = process.env.PGLITE_MODULE;
assert.ok(configured && path.isAbsolute(configured), 'PGLITE_MODULE must name an existing PGlite dist/index.js');
const moduleFile = await realpath(configured);
assert.ok(moduleFile.split(path.sep).join('/').endsWith('/@electric-sql/pglite/dist/index.js'));
const metadata = JSON.parse(await readFile(path.resolve(path.dirname(moduleFile), '..', 'package.json'), 'utf8'));
assert.equal(metadata.name, '@electric-sql/pglite');
assert.equal(metadata.version, '0.5.9');
assert.equal(metadata.license, 'Apache-2.0');
const { PGlite } = await import(pathToFileURL(moduleFile).href);
const db = new PGlite();
const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const publicApi = () => db.query("select oid,pg_get_functiondef(oid) as definition,proowner,proacl::text,prosecdef,proconfig from pg_proc where oid='public.office_request(uuid,jsonb,text)'::regprocedure");
try {
  await db.exec("set office_test.host='diriqo'; set statement_timeout='20s';");
  await db.exec(await read('packages/diriqo-office/tests/database-fixture.sql'));
  for (const name of ['20261011140000_diriqo_office.sql','20261011184909_diriqo_office_normalized.sql','20261011185523_diriqo_office_receipt_commit.sql','20261012091204_office_base_for_all_companies.sql','20261014033100_office_alternative_export_formats.sql']) {
    await db.exec(await read('supabase/migrations/' + name));
  }
  const before = (await publicApi()).rows;
  const migration = await read('supabase/migrations/20261019071710_office_cached_preview_guard.sql');
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await publicApi()).rows, before, 'Public RPC definition, owner and grants are unchanged, including repeat apply');
  const results = await db.exec(await read('tests/office-cached-preview.sql'));
  const report = results.find(result => result.rows[0]?.result)?.rows[0].result;
  assert.equal(report?.count, 34);
  const remaining = await db.query('select (select count(*)::integer from office_private.files) as files, (select count(*)::integer from office_private.receipts) as receipts, (select count(*)::integer from office_test.results) as assertions');
  assert.deepEqual(remaining.rows[0], { files:0, receipts:0, assertions:0 }, 'All test data rolled back');
  // Match the real host's identity columns only in this disposable local fixture.
  await db.exec('alter table auth.users add column email text, add column raw_user_meta_data jsonb; alter table public.profiles add column full_name text;');
  const hostedResults = await db.exec(await read('tests/office-cached-preview-hosted.sql'));
  const hosted = hostedResults.at(-1).rows[0].result;
  assert.equal(hosted.count, 16);
  assert.equal(hosted.cleanup_assertions, 14);
  assert.equal(hosted.fixtures, 'rolled_back');
  console.log(JSON.stringify({runtime:'PGlite ' + metadata.version,boundary:'actual Office SQL; synthetic Auth/host fixture; no hosted or multisession proof',migrationRepeat:'PASS',publicApiUnchanged:true,...report,cleanupAssertions:3,fixtures:'rolled_back',hostedRollbackScriptLocalValidation:hosted}, null, 2));
} catch (error) {
  console.error(JSON.stringify({message:error.message,code:error.code,where:error.where,detail:error.detail,position:error.position,internalPosition:error.internalPosition,internalQuery:error.internalQuery}));
  process.exitCode = 1;
} finally { await db.close(); }
