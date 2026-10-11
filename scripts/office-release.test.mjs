// Runs on the host CI Node 20 using the already reviewed TypeScript dev dependency.
// Auth/database ports are synthetic; this is not live tenant or hardware evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const ts = createRequire(new URL('package.json', root))('typescript');
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
async function authored(file, bindings, expression) {
  let source = await readFile(new URL(file, root), 'utf8');
  source = source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
    .replace(/^export default /gm, '')
    .replace(/^export /gm, '');
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React,
  } }).outputText;
  return vm.runInNewContext(js.replace(/\bexport\s*\{\s*\};?/g, '') + '\n;(' + expression + ')', {
    Error, Map, Set, TextEncoder, File, URL, process: { env: {} },
    React: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) }, ...bindings,
  }, { filename: file });
}
const flatten = value => value && typeof value === 'object'
  ? [value, ...((value.children ?? []).flat(Infinity).flatMap(flatten))] : [];

test('Diriqo Office visibility does not grant, hide or alter POS/product/core navigation', async () => {
  const sidebar = await authored('components/DashboardSidebar.tsx', {
    Link: 'Link', Image: 'Image', AppIcon: 'AppIcon', usePathname: () => '/pos',
    useI18n: () => ({ locale: 'cs', dictionary: { navigation: {}, common: {} } }),
    useEffect: () => {}, useRef: () => ({ current: null }),
  }, 'DashboardSidebar');
  for (const showCoreNavigation of [false, true]) for (const pos of [false, true]) {
    const props = { showCoreNavigation, availableProducts: pos ? ['pos', 'inventory'] : ['inventory'] };
    const links = officeEnabled => flatten(sidebar({ ...props, officeEnabled })).filter(node => node.props.href).map(node => ({
      href: node.props.href, className: node.props.className, current: node.props['aria-current'],
    }));
    const disabled = links(false), enabled = links(true);
    assert.deepEqual(enabled.filter(item => item.href !== '/office'), disabled);
    assert.equal(enabled.filter(item => item.href === '/office').length, 1);
    assert.equal(disabled.some(item => item.href === '/office'), false);
    assert.equal(enabled.some(item => item.href === '/pos'), pos);
    assert.equal(enabled.some(item => item.href === '/jobs'), showCoreNavigation);
    assert.equal(enabled.some(item => item.href === '/settings/company'), showCoreNavigation);
    if (pos) assert.equal(enabled.find(item => item.href === '/pos').current, 'page');
  }
});

test('Diriqo dashboard drops modules and POS products arriving from another company', async () => {
  for (const moduleCompany of [A, B, undefined]) {
    const context = await authored('components/DashboardShell.tsx', {
      fetch: async url => ({ ok: true, json: async () => url === '/api/active-company'
        ? { companyId: A, officeEnabled: true }
        : { companyId: moduleCompany, availableProducts: ['pos'], modules: { invoices: true } } }),
    }, 'loadDashboardContext');
    const result = await context();
    assert.equal(result.activeCompany.companyId, A);
    assert.equal(result.activeCompany.officeEnabled, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.availableProducts)), moduleCompany === A ? ['pos'] : []);
    assert.deepEqual(JSON.parse(JSON.stringify(result.modules)), moduleCompany === A ? { invoices: true } : null);
  }
});

test('Diriqo action envelope is four MiB and still admits the bounded Office payload', async () => {
  const config = await authored('next.config.ts', {}, 'nextConfig');
  assert.equal(config.experimental.serverActions.bodySizeLimit, '4mb');
  const budget = await authored('lib/office/http-limits.ts', {}, '({OFFICE_HOST_REQUEST_BYTES,assertOfficeHostPayload})');
  const request = { op: 'save', title: 'a'.repeat(budget.OFFICE_HOST_REQUEST_BYTES - 256) };
  const framed = { expectedTenantId: A, request };
  assert.doesNotThrow(() => budget.assertOfficeHostPayload(framed));
  // React's action JSON argument array plus conservative multipart framing margin.
  assert.ok(Buffer.byteLength(JSON.stringify([A, request])) + 65536 < 4 * 1024 * 1024);
  request.title += 'a'.repeat(256);
  assert.throws(() => budget.assertOfficeHostPayload(framed), /OFFICE_HOST_LIMIT/);
});

test('Diriqo normal company settings expose Office configuration only to the platform admin', async () => {
  for (const platformAdmin of [false, true]) {
    const filters = [], adminClients = [];
    const client = { from(table) {
      return { select() { return this; }, eq(column, value) { filters.push([table, column, value]); return this; },
        order() { return this; }, maybeSingle() { return Promise.resolve({ data: { id: A } }); },
        then(done) { return Promise.resolve({ data: [] }).then(done); } };
    } };
    const page = await authored('app/settings/company/page.tsx', {
      requireHubAccess: async () => ({ companyId: A, companyName: 'Company A', role: 'company_admin' }),
      createSupabaseServerClient: async () => client,
      hasPlatformAdminAccess: async actual => { adminClients.push(actual); return platformAdmin; },
      getCompanyBillingSettings: async () => ({}), getCompanyPayrollSettings: async () => ({}),
      getCompanySettings: async () => ({}), getCompanySubscription: async () => ({}),
      DashboardShell: 'DashboardShell', CompanySettingsClient: 'CompanySettingsClient',
    }, 'CompanySettingsPage');
    const nodes = flatten(await page());
    const link = nodes.find(node => node.props.href === '/office/settings');
    assert.equal(Boolean(link), platformAdmin);
    assert.deepEqual(adminClients, [client], 'Platform authority uses the signed-in client');
    assert.ok(filters.every(([, column, value]) => !['company_id', 'id'].includes(column) || value === A));
  }
});

test('Diriqo Office settings recheck platform authority and active company before each toggle', async () => {
  for (const { currentCompany = A, formCompany = A, platformAdmin = true, enabled = 'on', fail = false } of [
    {}, { enabled: null }, { formCompany: B }, { currentCompany: B }, { platformAdmin: false }, { currentCompany: null }, { fail: true },
  ]) {
    const calls = [], refreshed = [];
    const client = { rpc: async (name, args) => { calls.push([name, args]); return { error: fail ? {} : null }; } };
    const update = await authored('app/office/settings/page.tsx', {
      getActiveCompanyContext: async () => currentCompany ? { companyId: currentCompany } : null,
      createSupabaseServerClient: async () => client, hasPlatformAdminAccess: async actual => actual === client && platformAdmin,
      revalidatePath: path => refreshed.push(path), Link: 'Link',
    }, 'update');
    const form = new FormData(); form.set('companyId', formCompany); if (enabled) form.set('enabled', enabled);
    if (!currentCompany || !platformAdmin) await assert.rejects(update(form), /OFFICE_FORBIDDEN/);
    else if (formCompany !== currentCompany) await assert.rejects(update(form), /OFFICE_TENANT_CHANGED/);
    else if (fail) await assert.rejects(update(form), /OFFICE_SETTINGS_FAILED/);
    else await update(form);
    const authorized = currentCompany && platformAdmin && formCompany === currentCompany;
    assert.equal(calls.length, authorized ? 1 : 0);
    if (authorized) assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['office_set_enabled', { p_company_id: currentCompany, p_enabled: enabled === 'on' }]]);
    assert.deepEqual(refreshed, authorized && !fail ? ['/office/settings'] : []);
  }
});

test('Diriqo settings return through a full navigation so the company menu reads the new flag', async () => {
  const page = await authored('app/office/settings/page.tsx', {
    getActiveCompanyContext: async () => ({ companyId: A, companyName: 'Company A' }),
    hasPlatformAdminAccess: async () => true, revalidatePath: () => {}, Link: 'Link',
    createSupabaseServerClient: async () => ({ from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { enabled: true } }) }) }),
  }, 'OfficeSettings');
  const links = flatten(await page()).filter(node => node.props.href === '/');
  assert.equal(links.length, 1);
  assert.equal(links[0].type, 'a', 'Full navigation clears DashboardShell module cache after a toggle');
});
