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
  source = source.replace(/^import ['"]server-only['"]\r?\n/gm, '')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
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

async function officeContextFixture(overrides = {}) {
  const options = {
    active: { companyId: A, profileId: 'profile-A', role: 'company_admin' },
    user: { id: 'auth-A' }, authError: null,
    identity: { id: 'profile-A', auth_user_id: 'auth-A', user_id: 'auth-A' }, identityError: null,
    settings: { enabled: true }, settingsError: null, ...overrides,
  };
  const filters = [], tables = [], roleChecks = [];
  let authChecks = 0;
  const client = {
    auth: { getUser: async () => { authChecks++; return { data: { user: options.user }, error: options.authError }; } },
    from(table) {
      tables.push(table);
      assert.ok(['profiles', 'office_settings'].includes(table));
      return {
        select() { return this; },
        eq(column, value) { filters.push([table, column, value]); return this; },
        maybeSingle: async () => table === 'profiles'
          ? { data: options.identity, error: options.identityError }
          : { data: options.settings, error: options.settingsError },
      };
    },
    rpc: async () => { throw new Error('Office must not request a purchased capability'); },
  };
  const context = await authored('lib/office/context.ts', {
    getActiveCompanyContext: async selectionOptions => { roleChecks.push(selectionOptions.allowedRoles); return options.active; },
    createSupabaseServerClient: async () => client,
    requirePaidCompanyCapability: async () => { throw new Error('Office must not depend on a paid add-on'); },
  }, 'requireOfficeContext');
  return { context, filters, tables, roleChecks, authChecks: () => authChecks, client };
}

test('Office base access uses the authenticated company and role without a purchased capability', async () => {
  for (const companyId of [A, B]) {
    for (const [hostRole, officeRole] of [['super_admin', 'owner'], ['company_admin', 'owner'], ['manager', 'editor'], ['worker', 'reader']]) {
      const fixture = await officeContextFixture({ active: { companyId, profileId: 'profile-A', role: hostRole } });
      const read = await fixture.context();
      assert.equal(read.supabase, fixture.client);
      assert.equal(read.actor.tenantId, companyId);
      assert.equal(read.actor.actorId, 'profile-A');
      assert.equal(read.actor.role, officeRole);
      if (officeRole === 'reader') await assert.rejects(fixture.context(true), /OFFICE_FORBIDDEN/);
      else assert.equal((await fixture.context(true)).actor.tenantId, companyId);
      assert.equal(fixture.authChecks(), 2, 'Each read/write revalidates the user');
      assert.ok(fixture.filters.some(([table, column, value]) => table === 'profiles' && column === 'id' && value === 'profile-A'));
      assert.ok(fixture.filters.some(([table, column, value]) => table === 'profiles' && column === 'auth_user_id' && value === 'auth-A'));
      assert.ok(fixture.filters.some(([table, column, value]) => table === 'office_settings' && column === 'company_id' && value === companyId));
      assert.ok(fixture.filters.filter(([table]) => table === 'office_settings').every(([, column, value]) => column === 'company_id' && value === companyId));
      assert.deepEqual(JSON.parse(JSON.stringify(fixture.roleChecks)), Array(2).fill(['super_admin', 'company_admin', 'manager', 'worker']));
    }
  }
});

test('Office base access still rejects missing membership, unauthenticated or conflicting identities and disabled companies', async () => {
  const cases = [
    [{ active: null }, 'OFFICE_FORBIDDEN'],
    [{ user: null }, 'OFFICE_UNAUTHENTICATED'],
    [{ authError: { message: 'expired' } }, 'OFFICE_UNAUTHENTICATED'],
    [{ identity: null }, 'OFFICE_IDENTITY_MISMATCH'],
    [{ identityError: { message: 'not available' } }, 'OFFICE_IDENTITY_MISMATCH'],
    [{ identity: { id: 'profile-A', auth_user_id: 'auth-B', user_id: 'auth-B' } }, 'OFFICE_IDENTITY_MISMATCH'],
    [{ identity: { id: 'profile-A', auth_user_id: 'auth-A', user_id: 'auth-B' } }, 'OFFICE_IDENTITY_MISMATCH'],
    [{ active: { companyId: A, profileId: 'profile-A', role: 'customer' } }, 'OFFICE_FORBIDDEN'],
    [{ settings: { enabled: false } }, 'OFFICE_DISABLED'],
    [{ settings: null }, 'OFFICE_DISABLED'],
    [{ settingsError: { code: '42P01' } }, 'OFFICE_DISABLED'],
  ];
  for (const [overrides, error] of cases) for (const write of [false, true]) {
    const fixture = await officeContextFixture(overrides);
    await assert.rejects(fixture.context(write), new RegExp(error));
    if (['OFFICE_FORBIDDEN', 'OFFICE_UNAUTHENTICATED', 'OFFICE_IDENTITY_MISMATCH'].includes(error)) {
      assert.equal(fixture.tables.includes('office_settings'), false, 'Invalid identity cannot inspect company Office settings');
    }
  }
});

test('Office base entitlement does not bypass the existing paid gates of other company operations', async () => {
  const requirePaid = await authored('lib/platform/module-operation-access.ts', { readModuleBillingMode: () => false }, 'requirePaidCompanyCapability');
  for (const capability of ['core.files.upload', 'inventory.receipt.post']) {
    const calls = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: 'auth-A' } }, error: null }) },
      rpc: async (name, args) => {
        calls.push([name, args]);
        return { data: { company_id: A, capability, enforced: true, allowed: false, reason: 'module_required', livemode: false }, error: null };
      },
    };
    await assert.rejects(requirePaid({ companyId: A, supabase: client }, capability), /aktivní placený modul/);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['get_company_capability_access', { target_company_id: A, target_capability: capability }]]);
  }
});

test('Diriqo Office visibility does not grant, hide or alter POS/product/core navigation', async () => {
  const sidebar = await authored('components/DashboardSidebar.tsx', {
    Link: 'Link', Image: 'Image', AppIcon: 'AppIcon', usePathname: () => '/pos',
    useI18n: () => ({ locale: 'cs', dictionary: { navigation: {}, common: {} } }),
    useEffect: () => {}, useRef: () => ({ current: null }),
  }, 'DashboardSidebar');
  const onNavigate = () => {};
  for (const showCoreNavigation of [false, true]) for (const pos of [false, true]) {
    const props = { showCoreNavigation, onNavigate, availableProducts: pos ? ['pos', 'inventory'] : ['inventory'] };
    const links = officeEnabled => flatten(sidebar({ ...props, officeEnabled })).filter(node => node.props.href).map(node => ({
      type: node.type, href: node.props.href, className: node.props.className, current: node.props['aria-current'], onClick: node.props.onClick,
    }));
    const disabled = links(false), enabled = links(true);
    assert.deepEqual(enabled.filter(item => item.href !== '/office'), disabled);
    assert.equal(enabled.filter(item => item.href === '/office').length, 1);
    assert.equal(enabled.find(item => item.href === '/office').type, 'a', 'Office must start a new document, without retaining host/Office styles');
    assert.equal(enabled.find(item => item.href === '/office').onClick, onNavigate, 'The existing menu close callback is preserved');
    assert.equal(disabled.some(item => item.href === '/office'), false);
    assert.equal(enabled.some(item => item.href === '/pos'), pos);
    assert.equal(enabled.some(item => item.href === '/jobs'), showCoreNavigation);
    assert.equal(enabled.some(item => item.href === '/settings/company'), showCoreNavigation);
    if (pos) {
      assert.equal(enabled.find(item => item.href === '/pos').current, 'page');
      assert.equal(enabled.find(item => item.href === '/pos').type, 'Link', 'POS retains its existing navigation');
    }
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
    if (link) assert.equal(link.type, 'a', 'Office configuration starts a new document');
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
  const tree = flatten(await page());
  const links = tree.filter(node => node.props.href === '/');
  assert.equal(links.length, 1);
  assert.equal(links[0].type, 'a', 'Full navigation clears DashboardShell module cache after a toggle');
  assert.equal(tree.find(node => node.props.href === '/office').type, 'a', 'Opening the editor cannot inherit the settings document styles');
});

test('Diriqo Office exits through a native link while keeping the server-verified company in the editor', async () => {
  const page = await authored('app/office/page.tsx', {
    requireOfficeContext: async () => ({ actor: { tenantId: A, actorId: 'profile-A', role: 'reader' }, active: { companyName: 'A', companyMemberships: [{ companyId: A, companyName: 'A' }] } }),
    getRequestLocale: async () => 'cs', OfficeClient: 'OfficeClient',
  }, 'OfficePage');
  const nodes = flatten(await page());
  assert.equal(nodes.find(node => node.props.href === '/').type, 'a', 'Leaving Office releases its global CSS and print rules');
  const editor = nodes.find(node => node.type === 'OfficeClient');
  assert.equal(editor.props.tenantId, A);
  assert.equal(editor.props.readOnly, true);
});

test('global cookie banner and preferences leave Office natively without changing POS navigation', async () => {
  for (const pathname of ['/office', '/office/settings', '/pos', '/office-other']) {
    for (const preferencesOpen of [false, true]) {
      let state = 0;
      const values = [true, null, preferencesOpen, false, false];
      const manager = await authored('components/CookieConsentManager.tsx', {
        Link: 'Link', Analytics: 'Analytics', usePathname: () => pathname,
        useI18n: () => ({ locale: 'cs' }), useMemo: fn => fn(), useEffect: () => {},
        useState: () => [values[state++], () => {}],
      }, 'CookieConsentManager');
      const links = flatten(manager()).filter(node => node.props.href?.startsWith('/legal?'));
      assert.equal(links.length, preferencesOpen ? 4 : 2);
      for (const link of links) {
        assert.equal(link.type, pathname === '/office' || pathname.startsWith('/office/') ? 'a' : 'Link');
      }
    }
  }
});
