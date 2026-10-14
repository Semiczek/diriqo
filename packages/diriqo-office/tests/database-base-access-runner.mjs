/** Actual local PostgreSQL tests for the host base-Office migrations.
 * Only an existing, explicitly approved PGlite 0.5.8 module is accepted.
 * No installation, network, persistent database, or remote credentials.
 * Fixture auth/entitlement contracts do not prove Supabase JWTs or billing.
 */
import {readFile, realpath, stat, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A host wrapper fixes this to its own host; the root runner tests both checkouts.
const selectedHost = process.env.OFFICE_BASE_TEST_HOST;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const document = text => ({schemaVersion: 1, kind: 'document', page: {marginMm: 20, header: '', footer: ''},
  doc: {type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text}]}]}});
const hostMigrations = {
  hub: ['20261011140000_diriqo_office.sql', '20261011184841_diriqo_office_normalized.sql',
    '20261011185515_diriqo_office_receipt_commit.sql', '20261012091200_office_base_for_all_companies.sql'],
  diriqo: ['20261011140000_diriqo_office.sql', '20261011184909_diriqo_office_normalized.sql',
    '20261011185523_diriqo_office_receipt_commit.sql', '20261012091204_office_base_for_all_companies.sql'],
};
const report = {checkedAt: new Date().toISOString(), engine: 'PostgreSQL via existing PGlite 0.5.8',
  scope: 'Exact four host migrations in fresh in-memory fixtures; authenticated transactions through COMMIT',
  hosts: [], sourceSha256: {}, limitations: [
    'Fixture Auth and paid-capability contracts, not real Supabase JWT or billing verification.',
    'Sequential transactions prove rollback and optimistic conflicts, not multisession lock/race behavior.',
    'No remote database, deployment, browser, physical POS, or production proof.',
  ]};

async function source(file) {
  const body = await readFile(path.join(root, file), 'utf8');
  report.sourceSha256[file] = sha256(body);
  return body;
}

try {
  if (process.argv.length !== 2) throw Error('No CLI database or network arguments are accepted');
  if (selectedHost && !['hub', 'diriqo'].includes(selectedHost)) throw Error('Invalid local host fixture');
  const requested = process.env.OFFICE_PGLITE_MODULE;
  if (!requested || !path.isAbsolute(requested)) throw Error('Set OFFICE_PGLITE_MODULE to an approved existing absolute local module path');
  const modulePath = await realpath(requested);
  if (!modulePath.split(path.sep).join('/').endsWith('/@electric-sql/pglite/dist/index.js') || !(await stat(modulePath)).isFile()) {
    throw Error('Expected installed @electric-sql/pglite/dist/index.js');
  }
  const packagePath = path.resolve(path.dirname(modulePath), '..');
  const metadata = JSON.parse(await readFile(path.join(packagePath, 'package.json'), 'utf8'));
  assert.equal(metadata.name, '@electric-sql/pglite');
  assert.equal(metadata.version, '0.5.8');
  assert.equal(metadata.license, 'Apache-2.0');
  assert.ok((await readFile(path.join(packagePath, 'LICENSE'), 'utf8')).includes('Apache License'));
  report.runtime = {name: metadata.name, version: metadata.version, license: metadata.license};
  report.sourceSha256[path.relative(root, fileURLToPath(import.meta.url)).split(path.sep).join('/')] = sha256(await readFile(fileURLToPath(import.meta.url)));
  const {PGlite} = await import(pathToFileURL(modulePath).href);
  const fixture = await source(selectedHost ? 'scripts/fixtures/office-database.sql' : 'tests/database-fixture.sql');

  for (const host of selectedHost ? [selectedHost] : ['hub', 'diriqo']) {
    const db = new PGlite();
    const result = {host, status: 'RUNNING', migrationOrder: hostMigrations[host], labels: []};
    report.hosts.push(result);
    let phase = 'fixture';
    const check = (label, ok) => {assert.ok(ok, label); result.labels.push(label);};
    const equal = (label, actual, expected) => {assert.deepEqual(actual, expected, label); result.labels.push(label);};
    const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0];
    const value = async (sql, args = []) => Object.values(await scalar(sql, args))[0];

    async function authenticated(user, action, ai = false, commit = true) {
      try {
        await db.exec('BEGIN; SET LOCAL ROLE authenticated;');
        await db.query('SELECT office_test.login($1, $2)', [user, ai]);
        assert.equal(await value('SELECT current_user'), 'authenticated');
        const response = await action();
        assert.equal(await value('SELECT current_user'), 'authenticated', 'Caller role must remain authenticated through COMMIT');
        await db.exec(commit ? 'COMMIT;' : 'ROLLBACK;');
        return response;
      } catch (error) {await db.exec('ROLLBACK;'); throw error;}
    }
    const rpc = (user, tenant, request, ai = false) => authenticated(user,
      () => value('SELECT public.office_request($1::uuid,$2::jsonb)', [id(tenant), JSON.stringify(request)]), ai);
    async function rejected(label, action, code, sqlstate = 'P0001') {
      await assert.rejects(action, error => error.code === sqlstate && (code === null ||
        (sqlstate === 'P0001' && JSON.parse(error.message).code === code)), label);
      result.labels.push(label);
    }
    async function snapshot() {
      return {
        settings: (await db.query('SELECT * FROM public.office_settings ORDER BY company_id')).rows,
        audit: (await db.query('SELECT * FROM office_private.settings_events ORDER BY id')).rows,
        default: await value("SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.office_settings'::regclass AND a.attname='enabled'"),
        trigger: (await db.query("SELECT tgname,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid='public.companies'::regclass AND NOT tgisinternal ORDER BY tgname")).rows,
        hook: await value("SELECT pg_get_functiondef('public.office_host_write_allowed(uuid)'::regprocedure)"),
        enableFunction: await value("SELECT to_regprocedure('office_private.enable_office_for_new_company()')::text"),
      };
    }

    try {
      await db.waitReady;
      await db.exec("SET statement_timeout='20s'; SET lock_timeout='2s';");
      result.postgresVersion = await value('SELECT version()');
      await db.query("SELECT set_config('office_test.host',$1,false)", [host]);
      await db.exec(fixture);
      const migrationFiles = hostMigrations[host].map(file => `${selectedHost ? '' : `integrations/${host}/`}supabase/migrations/${file}`);
      const migrations = [];
      for (const file of migrationFiles) migrations.push(await source(file));
      for (let i = 0; i < 3; i++) {phase = migrationFiles[i]; await db.exec(migrations[i]);}
      const migration = migrations[3];
      assert.match(migration, /commit;\s*$/i, 'Base migration must be an explicit transaction');

      phase = 'seed missing A, disabled B and enabled C';
      await db.exec(`
        INSERT INTO public.companies VALUES(office_test.id(1003),'Tenant C existing enabled');
        INSERT INTO public.office_settings(company_id,enabled,updated_at,updated_by) VALUES
          (office_test.id(1002),false,'2024-02-03T04:05:06Z',office_test.id(5)),
          (office_test.id(1003),true,'2024-05-06T07:08:09Z',office_test.id(2));
        UPDATE private.office_test_capabilities SET allowed=false;
      `);
      const before = await snapshot();
      const paidBefore = await value("SELECT pg_get_functiondef('public.get_company_capability_access(uuid,text)'::regprocedure)");
      check('A has no pre-existing Office settings row', !before.settings.some(row => row.company_id === id(1001)));
      equal('pre-migration settings default is false', before.default, 'false');

      phase = 'migration transaction rollback';
      await assert.rejects(db.exec(migration.replace(/commit;\s*$/i, 'select 1/0; commit;')), error => error.code === '22012');
      await db.exec('ROLLBACK; RESET ROLE;');
      equal('failed migration atomically restores rows, metadata, audit, default, trigger and write hook', await snapshot(), before);

      phase = 'apply exact fourth host migration';
      await db.exec(migration);
      const after = await snapshot();
      equal('missing existing company A is backfilled enabled', after.settings.find(row => row.company_id === id(1001)).enabled, true);
      equal('backfill is not attributed to an invented user', after.settings.find(row => row.company_id === id(1001)).updated_by, null);
      equal('explicit false B retains all settings metadata', after.settings.find(row => row.company_id === id(1002)), before.settings.find(row => row.company_id === id(1002)));
      equal('explicit true C retains all settings metadata', after.settings.find(row => row.company_id === id(1003)), before.settings.find(row => row.company_id === id(1003)));
      equal('backfill creates exactly one audit event', after.audit.length, before.audit.length + 1);
      equal('existing B and C audit events remain byte-for-byte equivalent', after.audit.filter(row => row.company_id !== id(1001)), before.audit);
      equal('new settings default is true', after.default, 'true');
      equal('exactly one onboarding trigger exists', after.trigger.length, 1);
      equal('the global paid-capability evaluator is unchanged', await value("SELECT pg_get_functiondef('public.get_company_capability_access(uuid,text)'::regprocedure)"), paidBefore);

      phase = 'migration replay';
      await db.exec(migration);
      equal('migration replay preserves settings, metadata, audit and function definitions', await snapshot(), after);
      const triggerFunction = await scalar("SELECT prosecdef,proconfig FROM pg_proc WHERE oid='office_private.enable_office_for_new_company()'::regprocedure");
      check('onboarding uses SECURITY DEFINER with only pg_catalog search_path', triggerFunction.prosecdef && JSON.stringify(triggerFunction.proconfig) === JSON.stringify(['search_path=pg_catalog']));
      const grants = (await db.query("SELECT r,has_schema_privilege(r,'office_private','USAGE') AS schema_access,has_function_privilege(r,'office_private.enable_office_for_new_company()','EXECUTE') AS trigger_access,has_function_privilege(r,'public.office_host_write_allowed(uuid)','EXECUTE') AS hook_access,has_table_privilege(r,'public.office_settings','INSERT,UPDATE,DELETE') AS writes FROM unnest(ARRAY['anon','authenticated','service_role']) r")).rows;
      check('client roles gain no private schema, trigger, hook or direct settings writes', grants.every(row => !row.schema_access && !row.trigger_access && !row.hook_access && !row.writes));
      if (host === 'diriqo') {
        const hook = await scalar("SELECT prosecdef,proconfig FROM pg_proc WHERE oid='public.office_host_write_allowed(uuid)'::regprocedure");
        check('new Diriqo Office-only hook has fixed pg_catalog search_path', hook.prosecdef && JSON.stringify(hook.proconfig) === JSON.stringify(['search_path=pg_catalog']));
        await db.query('SELECT office_test.login($1)', [4]);
        equal('Diriqo hook rejects a valid reader', await value('SELECT public.office_host_write_allowed($1::uuid)', [id(1001)]), false);
        await db.query('SELECT office_test.login($1)', [2]);
        await rejected('Diriqo hook independently rejects a foreign company', () => value('SELECT public.office_host_write_allowed($1::uuid)', [id(1002)]), 'FORBIDDEN');
        await db.query('SELECT office_test.login($1)', [null]);
      }

      phase = 'future company and transaction rollback';
      // This grant models only an already-authorized host onboarding transaction.
      // It is restricted to this disposable fixture, never an application migration.
      await db.exec('GRANT INSERT ON public.companies TO authenticated;');
      await authenticated(1, () => db.query('INSERT INTO public.companies VALUES($1,$2)', [id(1004), 'Tenant D new']));
      const future = await scalar('SELECT * FROM public.office_settings WHERE company_id=$1', [id(1004)]);
      check('future company receives enabled settings in its creating transaction', future.enabled === true && future.updated_by === id(1));
      equal('future company has exactly one actor-attributed audit event', (await db.query('SELECT enabled,actor_auth_id FROM office_private.settings_events WHERE company_id=$1', [id(1004)])).rows, [{enabled: true, actor_auth_id: id(1)}]);
      await authenticated(1, () => db.query('INSERT INTO public.companies VALUES($1,$2)', [id(1005), 'Tenant E rolled back']), false, false);
      equal('rolled-back company leaves no company, settings or audit row', await scalar('SELECT (SELECT count(*)::integer FROM public.companies WHERE id=$1) AS companies,(SELECT count(*)::integer FROM public.office_settings WHERE company_id=$1) AS settings,(SELECT count(*)::integer FROM office_private.settings_events WHERE company_id=$1) AS audit', [id(1005)]), {companies: 0, settings: 0, audit: 0});
      await db.query('UPDATE public.companies SET name=$1 WHERE id=$2', ['Tenant B renamed', id(1002)]);
      equal('ordinary company update does not re-enable explicitly disabled Office', await value('SELECT enabled FROM public.office_settings WHERE company_id=$1', [id(1002)]), false);
      await db.exec('CREATE TABLE public.office_wrong_trigger_context(id uuid); CREATE TRIGGER office_wrong_context AFTER INSERT ON public.office_wrong_trigger_context FOR EACH ROW EXECUTE FUNCTION office_private.enable_office_for_new_company();');
      await assert.rejects(db.query('INSERT INTO public.office_wrong_trigger_context VALUES($1)', [id(1006)]), error => error.code === 'P0001' && error.message === 'OFFICE_INVALID_TRIGGER_CONTEXT');
      result.labels.push('onboarding trigger actively rejects attachment to another table');
      equal('invalid trigger context cannot create settings', await value('SELECT count(*)::integer FROM public.office_settings WHERE company_id=$1', [id(1006)]), 0);

      phase = 'RLS and direct access';
      equal('A user can SELECT only A settings through RLS', await authenticated(2, () => db.query('SELECT company_id FROM public.office_settings ORDER BY company_id').then(result => result.rows)), [{company_id: id(1001)}]);
      equal('B user sees only its disabled B settings', await authenticated(5, () => db.query('SELECT company_id,enabled FROM public.office_settings ORDER BY company_id').then(result => result.rows)), [{company_id: id(1002), enabled: false}]);
      equal('nonmember settings SELECT has no visible rows', await authenticated(6, () => value('SELECT count(*)::integer FROM public.office_settings')), 0);
      for (const [label, sql] of [
        ['direct settings insert', 'INSERT INTO public.office_settings(company_id) VALUES($1)'],
        ['direct settings update', 'UPDATE public.office_settings SET enabled=true WHERE company_id=$1'],
        ['direct settings delete', 'DELETE FROM public.office_settings WHERE company_id=$1'],
        ['direct private trigger invocation', 'SELECT office_private.enable_office_for_new_company() WHERE $1::uuid IS NOT NULL'],
        ['direct host write-hook invocation', 'SELECT public.office_host_write_allowed($1)'],
        ['direct private file read', 'SELECT * FROM office_private.files WHERE company_id=$1'],
      ]) await rejected(label + ' is forbidden even to a company administrator', () => authenticated(2, () => db.query(sql, [id(1001)])), null, '42501');
      await rejected('ordinary administrator cannot override explicit disable through settings RPC', () => authenticated(5, () => value('SELECT public.office_set_enabled($1,true)', [id(1002)])), 'FORBIDDEN');
      await rejected('explicitly disabled B blocks its own valid member', () => rpc(5, 1002, {op: 'listFiles'}), 'MODULE_DISABLED');
      await rejected('foreign B request is rejected before leaking disabled state', () => rpc(2, 1002, {op: 'listFiles'}), 'FORBIDDEN');
      await rejected('inactive membership remains forbidden', () => rpc(7, 1001, {op: 'listFiles'}), 'FORBIDDEN');
      await rejected('unknown membership role remains forbidden', () => rpc(10, 1001, {op: 'listFiles'}), 'FORBIDDEN');
      await rejected('no membership remains forbidden', () => rpc(6, 1001, {op: 'listFiles'}), 'FORBIDDEN');
      await rejected('missing authentication remains rejected', () => rpc(null, 1001, {op: 'listFiles'}), 'UNAUTHENTICATED');
      if (host === 'diriqo') await rejected('Diriqo conflicting auth/profile identity remains forbidden', () => rpc(8, 1001, {op: 'listFiles'}), 'FORBIDDEN');
      await db.exec('BEGIN; SET LOCAL ROLE anon;');
      await assert.rejects(db.query('SELECT public.office_request($1,$2)', [id(1001), JSON.stringify({op: 'listFiles'})]), error => error.code === '42501');
      await db.exec('ROLLBACK;');result.labels.push('anonymous role cannot execute Office RPC');

      phase = 'Office writes with denied paid capability';
      equal('paid upload evaluator still returns denied', await authenticated(3, () => value("SELECT public.get_company_capability_access($1,'core.files.upload')", [id(1001)])), {allowed: false});
      const create = {op: 'create', kind: 'document', title: 'Base Office document', content: document('Original'), idempotencyKey: 'base-office-create'};
      const created = await rpc(3, 1001, create);
      check('editor creates and COMMITs Office document despite denied paid evaluator', created.file.tenantId === id(1001) && created.file.revision === 1);
      equal('exact create replay returns same file and revision', await rpc(3, 1001, create), created);
      const permissions = await rpc(3, 1001, {op: 'permissions', id: created.file.id});
      check('editor permissions remain writable without paid entitlement', permissions.permissions.role === 'editor' && permissions.permissions.canWrite === true);
      const readerPermissions = await rpc(4, 1001, {op: 'permissions', id: created.file.id});
      check('reader permissions remain read-only', readerPermissions.permissions.role === 'reader' && readerPermissions.permissions.canWrite === false);
      equal('reader can read same-company document', (await rpc(4, 1001, {op: 'read', id: created.file.id})).file.id, created.file.id);
      await rejected('reader cannot create after default enable', () => rpc(4, 1001, {...create, idempotencyKey: 'base-reader-create'}), 'FORBIDDEN');
      await rejected('foreign account cannot read A document', () => rpc(5, 1001, {op: 'read', id: created.file.id}), 'FORBIDDEN');
      await rejected('signed AI cannot bypass human approval to save', () => rpc(3, 1001, {op: 'save', id: created.file.id, expectedRevision: 1, content: document('AI bypass'), idempotencyKey: 'base-ai-save'}, true), 'HUMAN_APPROVAL_REQUIRED');
      const save = {op: 'save', id: created.file.id, expectedRevision: 1, content: document('Updated'), idempotencyKey: 'base-office-save'};
      const saved = await rpc(3, 1001, save);
      equal('editor save creates revision two', saved.file.revision, 2);
      equal('committed save replay is idempotent', await rpc(3, 1001, save), saved);
      await rejected('stale writer cannot overwrite newer revision', () => rpc(2, 1001, {...save, idempotencyKey: 'base-stale-save'}), 'CONFLICT');
      await rejected('reader cannot save', () => rpc(4, 1001, {...save, expectedRevision: 2, idempotencyKey: 'base-reader-save'}), 'FORBIDDEN');
      await rejected('cross-company job assignment remains blocked', () => rpc(3, 1001, {op: 'link', id: created.file.id, expectedRevision: 2, type: 'job', entityId: id(2002), idempotencyKey: 'base-foreign-link'}), 'NOT_FOUND');

      phase = 'enabled second tenant and independent receipts';
      // Existing settings RPC is used; no new authorization path is introduced.
      // Hub's configure role is tenant-bound, so this fixture adds its existing super-admin role in B.
      if (host === 'hub') await db.query("INSERT INTO public.company_members VALUES($1,$2,$3,'super_admin',true)", [id(901), id(1002), id(101)]);
      await authenticated(1, () => value('SELECT public.office_set_enabled($1,true)', [id(1002)]));
      const second = await rpc(5, 1002, create);
      check('same operation key in enabled B creates an independent tenant file', second.file.id !== created.file.id && second.file.tenantId === id(1002));
      await rejected('A member using own company cannot resolve B file ID', () => rpc(2, 1001, {op: 'read', id: second.file.id}), 'NOT_FOUND');
      equal('A list contains only A file', (await rpc(2, 1001, {op: 'listFiles'})).files.map(file => file.id), [created.file.id]);
      equal('B list contains only B file', (await rpc(5, 1002, {op: 'listFiles'})).files.map(file => file.id), [second.file.id]);

      phase = 'module disable and repeat migration';
      await authenticated(1, () => value('SELECT public.office_set_enabled($1,false)', [id(1001)]));
      const disabled = await snapshot();
      await db.exec(migration);
      equal('replay never overrides a later administrator disable or metadata', await snapshot(), disabled);
      for (const request of [
        {op: 'read', id: created.file.id},
        {op: 'listVersions', id: created.file.id},
        {op: 'recordExport', id: created.file.id, format: 'pdf'},
        {op: 'original', id: created.file.id},
        {...save, expectedRevision: 2, idempotencyKey: 'base-disabled-save'},
        {op: 'restore', id: created.file.id, expectedRevision: 2, revision: 1, idempotencyKey: 'base-disabled-restore'},
        create,
      ]) await rejected(`disabled Office rejects ${request.op}${request === create ? ' receipt replay' : ''}`, () => rpc(3, 1001, request), 'MODULE_DISABLED');
      await authenticated(1, () => value('SELECT public.office_set_enabled($1,true)', [id(1001)]));
      const restored = await rpc(3, 1001, {op: 'restore', id: created.file.id, expectedRevision: 2, revision: 1, idempotencyKey: 'base-office-restore'});
      check('authorized re-enable restores version without losing tenant or version history', restored.file.revision === 3 && restored.file.tenantId === id(1001) && restored.file.content.doc.content[0].content[0].text === 'Original');
      equal('three retained A versions after restore', (await rpc(3, 1001, {op: 'listVersions', id: created.file.id})).versionSummaries.length, 3);
      equal('paid evaluator remains denied after all Office operations', await authenticated(3, () => value("SELECT public.get_company_capability_access($1,'core.files.upload')", [id(1001)])), {allowed: false});
      equal('no incomplete receipts committed', await value('SELECT count(*)::integer FROM office_private.receipts WHERE response IS NULL'), 0);
      result.status = 'PASS';
      result.assertions = result.labels.length;
      console.log(JSON.stringify({host, status: result.status, assertions: result.assertions}));
    } catch (error) {
      result.status = 'FAIL'; result.phase = phase;
      result.error = {message: String(error.message).slice(0, 2000), code: error.code ?? null};
      console.error(JSON.stringify({host, status: result.status, phase, error: result.error}));
      process.exitCode = 1;
    } finally {
      try {await db.exec('ROLLBACK; RESET ROLE;');} catch {}
      await db.close();
    }
    if (process.exitCode) break;
  }
} catch (error) {
  report.error = {message: String(error.message).slice(0, 2000), code: error.code ?? null};
  console.error(JSON.stringify(report.error)); process.exitCode = 1;
}
report.status = process.exitCode ? 'FAIL' : 'PASS';
report.assertions = report.hosts.reduce((total, host) => total + (host.assertions ?? 0), 0);
await mkdir(path.join(root, 'reports'), {recursive: true});
await writeFile(path.join(root, 'reports/database-base-access-validation.json'), JSON.stringify(report, null, 2) + '\n');
