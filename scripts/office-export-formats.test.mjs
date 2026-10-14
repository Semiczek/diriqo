/** Exact Diriqo migration regression. No network, production connection or installation.
 * The optional runtime test uses the reviewed existing PGlite 0.5.8 package;
 * set OFFICE_PGLITE_MODULE to its absolute dist/index.js path to enable it.
 * All database rows are synthetic and the in-memory instance is closed at the end.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const migrationPath = 'supabase/migrations/20261012170616_office_alternative_export_formats.sql';
const originalFormats = "('docx','xlsx','csv','txt','html','pdf','print')";
const expandedFormats = "('docx','xlsx','csv','txt','html','pdf','print','odt','ods','xls','tsv')";
const oldClause = `if coalesce(p_request->>'format','') not in ${originalFormats} then perform office_private.fail('UNSUPPORTED_FORMAT','Unsupported format.');end if;`;
const newClause = oldClause.replace(originalFormats, expandedFormats);
const source = file => readFile(new URL(file, root), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const documentContent = { schemaVersion: 1, kind: 'document', page: { marginMm: 20, header: '', footer: '' }, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic export audit fixture' }] }] } };

test('Diriqo export migration matches the installed normalized API and the shared public format contract', async () => {
  const migration = await source(migrationPath);
  const normalized = await source('supabase/migrations/20261011184909_diriqo_office_normalized.sql');
  const formats = await source('packages/diriqo-office/src/core/formats.ts');
  assert.equal(normalized.split(oldClause).length - 1, 1, 'The installed source must have exactly one known old export branch');
  assert.ok(migration.includes(`$old$${oldClause}$old$`));
  assert.ok(migration.includes(`$new$${newClause}$new$`));
  const publicFormats = [...formats.matchAll(/OFFICE_(?:DOCUMENT|SPREADSHEET)_EXPORT_FORMATS = \[([^\]]+)\]/g)]
    .flatMap(match => [...match[1].matchAll(/'([a-z]+)'/g)].map(item => item[1]));
  const sqlFormats = [...expandedFormats.matchAll(/'([a-z]+)'/g)].map(item => item[1]);
  assert.deepEqual([...publicFormats, 'print'].sort(), sqlFormats.sort());
  assert.equal(sqlFormats.includes('doc'), false, 'DOC remains import-only');
});

test('Diriqo export migration preserves company authorization, function privileges, file data and audit isolation in PostgreSQL', {
  skip: process.env.OFFICE_PGLITE_MODULE ? false : 'Set OFFICE_PGLITE_MODULE to the reviewed existing PGlite runtime; no database dependency is installed by this test',
}, async () => {
  const configured = process.env.OFFICE_PGLITE_MODULE;
  assert.ok(path.isAbsolute(configured));
  const moduleFile = await realpath(configured);
  assert.ok(moduleFile.split(path.sep).join('/').endsWith('/@electric-sql/pglite/dist/index.js'));
  assert.equal((await stat(moduleFile)).isFile(), true);
  const metadata = JSON.parse(await readFile(path.resolve(path.dirname(moduleFile), '..', 'package.json'), 'utf8'));
  assert.equal(metadata.name, '@electric-sql/pglite');
  assert.equal(metadata.version, '0.5.8');
  assert.equal(metadata.license, 'Apache-2.0');
  await readFile(path.resolve(path.dirname(moduleFile), '..', 'LICENSE'), 'utf8');
  const { PGlite } = await import(pathToFileURL(moduleFile).href);
  const db = new PGlite();
  const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const definition = () => value("SELECT pg_get_functiondef('public.office_request(uuid,jsonb,text)'::regprocedure)");
  const security = () => db.query("SELECT oid,proowner,proacl::text,prosecdef,proconfig FROM pg_proc WHERE oid='public.office_request(uuid,jsonb,text)'::regprocedure");
  const rpc = async (user, request, company = 1001) => {
    await db.query('SELECT office_test.login($1)', [user]);
    await db.exec('BEGIN; SET LOCAL ROLE authenticated;');
    try {
      const result = await value('SELECT public.office_request($1,$2)', [id(company), JSON.stringify(request)]);
      await db.exec('COMMIT;');
      return result;
    } catch (error) {
      await db.exec('ROLLBACK;');
      throw error;
    }
  };
  const rejects = (operation, code) => assert.rejects(operation, error => error.code === 'P0001' && JSON.parse(error.message).code === code);
  try {
    await db.waitReady;
    await db.exec("SET office_test.host='diriqo'; SET statement_timeout='20s';");
    await db.exec(await source('packages/diriqo-office/tests/database-fixture.sql'));
    for (const name of [
      '20261011140000_diriqo_office.sql',
      '20261011184909_diriqo_office_normalized.sql',
      '20261011185523_diriqo_office_receipt_commit.sql',
      '20261012091204_office_base_for_all_companies.sql',
    ]) await db.exec(await source('supabase/migrations/' + name));
    const file = (await rpc(3, { op: 'create', kind: 'document', title: 'Synthetic export test', content: documentContent, idempotencyKey: 'export-format-create' })).file;
    const exportRequest = format => ({ op: 'recordExport', id: file.id, format });
    await rejects(() => rpc(3, exportRequest('odt')), 'UNSUPPORTED_FORMAT');
    const before = await definition();
    const beforeSecurity = (await security()).rows;
    const migration = await source(migrationPath);
    await db.exec(migration);
    const after = await definition();
    assert.equal(after, before.replace(oldClause, newClause), 'Every function byte outside the one export allowlist remains unchanged');
    assert.deepEqual((await security()).rows, beforeSecurity, 'Function OID, owner, ACL, SECURITY DEFINER and search_path remain unchanged');
    await db.exec(migration);
    assert.equal(await definition(), after, 'A repeated migration is a no-op');
    assert.deepEqual((await security()).rows, beforeSecurity);

    for (const format of ['odt', 'ods', 'xls', 'tsv']) {
      assert.deepEqual(await rpc(3, exportRequest(format)), {});
      await rejects(() => rpc(5, exportRequest(format)), 'FORBIDDEN');
      await rejects(() => rpc(5, exportRequest(format), 1002), 'NOT_FOUND');
      await rejects(() => rpc(8, exportRequest(format)), 'FORBIDDEN'); // conflicting auth/profile binding
    }
    for (const format of ['doc', 'unknown', 'ODT', '']) await rejects(() => rpc(3, exportRequest(format)), 'UNSUPPORTED_FORMAT');
    const audit = await db.query("SELECT company_id,event->>'actorId' AS actor_id,event#>>'{details,format}' AS format FROM office_private.audit_events WHERE file_id=$1 AND event->>'operation'='recordExport' ORDER BY sequence", [file.id]);
    assert.deepEqual(audit.rows, ['odt', 'ods', 'xls', 'tsv'].map(format => ({ company_id: id(1001), actor_id: id(103), format })));
    assert.deepEqual((await rpc(3, { op: 'read', id: file.id })).file, file, 'Exports do not mutate the saved file');
    assert.equal((await rpc(3, { op: 'listVersions', id: file.id })).versionSummaries.length, 1);
    await db.exec(`UPDATE public.office_settings SET enabled=false WHERE company_id='${id(1001)}';`);
    await rejects(() => rpc(3, exportRequest('odt')), 'MODULE_DISABLED');
    await db.exec(`UPDATE public.office_settings SET enabled=true WHERE company_id='${id(1001)}';`);

    const drifted = after.replace(expandedFormats, expandedFormats.replace(')', ",'unexpected')"));
    await db.exec(drifted);
    await assert.rejects(() => db.exec(migration), error => error.code === 'P0001' && error.message === 'OFFICE_EXPORT_MIGRATION_UNEXPECTED_FUNCTION');
    await db.exec('ROLLBACK;');
    assert.equal(await definition(), drifted, 'A drifted function is left intact when migration aborts');
    assert.deepEqual((await security()).rows, beforeSecurity);
  } finally {
    await db.close();
  }
});