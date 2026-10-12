import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const requireHost = createRequire(new URL('integrations/diriqo/package.json', root));
const ts = requireHost('typescript');
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
async function authored(file, bindings, expression) {
  let source = await readFile(new URL('integrations/diriqo/' + file, root), 'utf8');
  source = source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
    .replace(/^export default /gm, '').replace(/^export /gm, '');
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React,
  } }).outputText;
  return vm.runInNewContext(js + '\n;(' + expression + ')', { Error, React, Map, ...bindings }, { filename: file });
}
const flatten = value => value && typeof value === 'object'
  ? [value, ...((value.children ?? []).flat(Infinity).flatMap(flatten))] : [];

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
