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

test('Diriqo Office pins its verified company and scopes navigation to the same tenant and role', async () => {
  for (const role of ['worker', 'manager', 'company_admin', 'super_admin']) {
    const calls = [];
    const page = await authored('app/office/page.tsx', {
      requireOfficeContext: async () => ({
        actor: { tenantId: A, actorId: 'profile-A', role: role === 'worker' ? 'reader' : 'owner' },
        active: { role, companyName: 'A', companyMemberships: [{ companyId: A, companyName: 'A' }] },
        supabase: { from: table => ({ select() { return this; }, eq: async (column, company) => { calls.push([table, company]); assert.equal(column, 'company_id'); return { data: [{ module_key: 'jobs', is_enabled: false }], error: null }; } }), rpc: async (name, args) => { calls.push([name, args.company]); return { data: ['inventory'], error: null }; } },
      }),
      COMPANY_MODULE_KEYS: ['jobs', 'calendar'],
      getRequestLocale: async () => 'cs', OfficeClient: 'OfficeClient', FloatingDiriqent: 'FloatingDiriqent',
    }, 'OfficePage');
    const nodes = flatten(await page());
    const editor = nodes.find(node => node.type === 'OfficeClient');
    assert.equal(editor.props.tenantId, A);
    assert.equal(editor.props.readOnly, role === 'worker');
    assert.deepEqual(calls, [['company_modules', A], ['module_navigation', A]]);
    assert.equal(editor.props.navigation.enabledModules.jobs, false);
    assert.equal(editor.props.navigation.enabledModules.calendar, true);
    assert.equal(editor.props.navigation.showCoreNavigation, ['company_admin', 'super_admin'].includes(role));
    assert.deepEqual(editor.props.navigation.availableProducts, ['inventory']);
    assert.equal(nodes.find(node => node.type === 'FloatingDiriqent').props.keepWorkspaceOpen, true,
      'Assistant links must preserve the open Office editor instead of replacing its draft');
  }
});

test('Office navigation remains closed on mobile, expands on demand, and Escape restores the opener', async () => {
  for (const mobile of [false, true]) {
    const values = [], refs = [], styles = new Proxy({}, { get: (_target, key) => key });
    let index = 0, refIndex = 0, restored = 0;
    const navigation = await authored('app/office/OfficeNavigation.tsx', {
      Image: 'Image', DashboardSidebar: 'Sidebar', styles,
      officeRailMessages: { cs: { expand: 'Expand', collapse: 'Collapse', skip: 'Skip' } },
      useState: initial => { const i = index++; if (!(i in values)) values[i] = initial; return [values[i], value => { values[i] = value; }]; },
      useRef: () => { const i = refIndex++; refs[i] ??= { current: { focus: () => restored++, contains: () => false } }; return refs[i]; },
      useSyncExternalStore: () => mobile,
    }, 'OfficeNavigation');
    const render = (disabled = false) => {
      index = refIndex = 0;
      return flatten(navigation({ navigation: { enabledModules: {}, availableProducts: [], showCoreNavigation: false, showModuleCatalog: false },
        companyName: 'Synthetic company', locale: 'cs', disabled }));
    };
    let nodes = render();
    let frame = nodes.find(node => node.props.className === 'railFrame');
    assert.equal(frame.props['data-expanded'], false);
    assert.equal(frame.props.inert, mobile);
    const sidebar = nodes.find(node => node.type === 'Sidebar');
    assert.equal(sidebar.props.documentNavigation, true, 'Native links preserve unsaved-change guards');
    assert.equal(sidebar.props.compact, true);
    assert.ok(nodes.some(node => node.props.src === '/diriqo-logo-icon.png'), 'Mobile branding uses the canonical Diriqo asset');
    const opener = nodes.find(node => node.props.className === (mobile ? 'mobileToggle' : 'railToggle'));
    opener.props.onClick();
    nodes = render();
    frame = nodes.find(node => node.props.className === 'railFrame');
    assert.equal(frame.props['data-expanded'], true);
    assert.equal(frame.props.inert, false);
    frame.props.onKeyDown({ key: 'Escape', preventDefault() {} });
    assert.equal(restored, 1);
    nodes = render(true);
    assert.equal(nodes.find(node => node.props.className === 'railFrame').props['data-expanded'], false);
    assert.equal(nodes.find(node => node.props.id === 'office-diriqo-navigation').props.inert, true,
      'Unavailable or changed company access disables the pinned navigation');
  }
});

for (const preview of ['pointer', 'keyboard']) {
  test(`Office rail click pins an already ${preview}-expanded menu until collapse or Escape`, async () => {
    const values = [], refs = [], styles = new Proxy({}, { get: (_target, key) => key });
    let index = 0, refIndex = 0, restored = 0;
    const navigation = await authored('app/office/OfficeNavigation.tsx', {
      Image: 'Image', DashboardSidebar: 'Sidebar', styles,
      officeRailMessages: { cs: { expand: 'Expand', collapse: 'Collapse', skip: 'Skip' } },
      useState: initial => { const i = index++; if (!(i in values)) values[i] = initial; return [values[i], value => { values[i] = value; }]; },
      useRef: () => { const i = refIndex++; refs[i] ??= { current: { focus: () => restored++, contains: () => false } }; return refs[i]; },
      useSyncExternalStore: () => false,
    }, 'OfficeNavigation');
    const render = () => {
      index = refIndex = 0;
      const nodes = flatten(navigation({ navigation: { enabledModules: {}, availableProducts: [], showCoreNavigation: false, showModuleCatalog: false },
        companyName: 'Synthetic company', locale: 'cs' }));
      return { frame: nodes.find(node => node.props.className === 'railFrame'),
        toggle: nodes.find(node => node.props.className === 'railToggle') };
    };
    const enterPreview = () => {
      const { frame } = render();
      if (preview === 'pointer') frame.props.onPointerEnter({ pointerType: 'mouse' });
      else frame.props.onFocusCapture({ target: {} });
    };
    const leavePreview = () => {
      const { frame } = render();
      frame.props.onPointerLeave();
      frame.props.onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null });
    };

    enterPreview();
    let state = render();
    assert.equal(state.frame.props['data-expanded'], true, 'Hover or keyboard focus previews the menu before the click');
    state.toggle.props.onClick();
    leavePreview();
    state = render();
    assert.equal(state.frame.props['data-expanded'], true, 'Click pins the preview open even after pointer and focus leave');
    assert.equal(state.toggle.props['aria-label'], 'Collapse');
    assert.equal(state.toggle.props['aria-expanded'], true);
    state.toggle.props.onClick();
    state = render();
    assert.equal(state.frame.props['data-expanded'], false, 'A second click explicitly closes the pinned menu');
    assert.equal(state.toggle.props['aria-label'], 'Expand');

    enterPreview();
    render().toggle.props.onClick();
    leavePreview();
    render().frame.props.onKeyDown({ key: 'Escape', preventDefault() {} });
    assert.equal(render().frame.props['data-expanded'], false, 'Escape closes a pinned menu');
    assert.equal(restored, 1, 'Escape restores focus to the opener');
  });
}
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


test('Office compact navigation preserves full document leaving guards and expands nested menus', async () => {
  let expanded = 0, prevented = 0;
  const sidebar = await authored('components/DashboardSidebar.tsx', {
    Link: 'Link', Image: 'Image', AppIcon: 'AppIcon', usePathname: () => '/office',
    useI18n: () => ({ locale: 'cs', dictionary: { navigation: {}, common: {} } }),
    useEffect: () => {}, useRef: () => ({ current: null }),
  }, 'DashboardSidebar');
  const nodes = flatten(sidebar({ officeEnabled: true, showCoreNavigation: true, availableProducts: ['inventory', 'pos'],
    compact: true, documentNavigation: true, onExpand: () => expanded++ }));
  assert.ok(nodes.filter(n => n.props.href).every(n => n.type === 'a'), 'Every Office exit must allow beforeunload');
  const stock = nodes.find(n => n.type === 'summary' && n.props['aria-label'] === 'Sklad');
  assert.ok(stock);
  stock.props.onClick({ preventDefault: () => prevented++ });
  assert.equal(expanded, 1);
  assert.equal(prevented, 1);
  assert.ok(nodes.some(n => n.props.href === '/inventory?tab=warehouses'));
  assert.ok(nodes.some(n => n.props.href === '/inventory?tab=documents&kind=transfer'));
  const absent = flatten(sidebar({ availableProducts: [], officeEnabled: true }));
  assert.equal(absent.some(n => String(n.props.href).startsWith('/inventory')), false, 'A hidden product must not expose navigation');
});

test('inventory sidebar keeps the selected warehouse for every subpage and OCR', async () => {
  const sidebar = await authored('components/DashboardSidebar.tsx', {
    Link: 'Link', Image: 'Image', AppIcon: 'AppIcon', usePathname: () => '/inventory',
    useI18n: () => ({ locale: 'cs', dictionary: { navigation: {}, common: {} } }),
    useEffect: () => {}, useRef: () => ({ current: null }),
  }, 'DashboardSidebar');
  for (const documentNavigation of [false, true]) {
    const nodes = flatten(sidebar({ availableProducts: ['inventory'], inventoryWarehouseId: A, documentNavigation }));
    const links = nodes.filter(node => node.props.href?.startsWith('/inventory?') || node.props.href?.startsWith('/diriqent/ocr?'));
    assert.equal(links.length, 8);
    for (const link of links) {
      const url = new URL(link.props.href, 'https://example.invalid');
      assert.equal(url.searchParams.get('warehouse'), A);
      assert.equal(link.type, documentNavigation ? 'a' : 'Link');
    }
    const transfer = links.find(node => new URL(node.props.href, 'https://example.invalid').searchParams.get('kind') === 'transfer');
    assert.ok(transfer, 'The transfer subtype must survive alongside the warehouse');
  }
});
