import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { transform } from 'esbuild';

const root = new URL('../../', import.meta.url);
const A = { tenantId: 'tenant-a', actorId: 'profile-a', readOnly: false };
const B = { tenantId: 'tenant-b', actorId: 'profile-a', readOnly: false };
async function authored(file, bindings, expression) {
  let source = await readFile(new URL(file, root), 'utf8');
  source = source.replace(/^import ['"][^'"]+['"]\r?\n/gm, '')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
    .replace(/^export default /gm, '').replace(/^export /gm, '');
  const code = file.endsWith('.tsx')
    ? (await transform(source, { loader: 'tsx', jsxFactory: 'jsx', jsxFragment: 'Fragment' })).code
    : stripTypeScriptTypes(source);
  return vm.runInNewContext(code + '\n;(' + expression + ')', { Error, ...bindings }, { filename: file });
}
async function helpers(host, bindings = {}) {
  return authored('integrations/' + host + '/lib/office/client-context.ts', bindings,
    '({createOfficeContextGuard,fetchOfficeContext,notifyOfficeContextChanged,switchOfficeCompany,sameOfficeContext,OFFICE_CONTEXT_EVENT,OFFICE_CONTEXT_STORAGE_KEY})');
}
const tick = () => new Promise(resolve => setImmediate(resolve));
for (const host of ['hub', 'diriqo']) {
  test(host + ': latest verified context wins; stale probes never reopen an invalidated panel', async () => {
    const { createOfficeContextGuard } = await helpers(host), states = [];
    const guard = createOfficeContextGuard(A, state => states.push(state));
    let oldResolve;
    const oldProbe = guard.check(() => new Promise(resolve => { oldResolve = resolve; }));
    guard.pause();
    assert.throws(() => guard.assertReady(), /OFFICE_CONTEXT_UNAVAILABLE/);
    await guard.check(async () => ({ ok: true, context: B }));
    oldResolve({ ok: true, context: A }); await oldProbe;
    assert.equal(guard.state, 'changed');
    assert.throws(() => guard.assertReady(), /OFFICE_TENANT_CHANGED/);
    await guard.check(async () => ({ ok: true, context: A }), true);
    assert.doesNotThrow(() => guard.assertReady());
    assert.equal(states.at(-1), 'ready');
  });

  test(host + ': identity, role, missing access and failed probes pause even when tenant is unchanged', async () => {
    const { createOfficeContextGuard } = await helpers(host);
    for (const context of [{ ...A, actorId: 'other' }, { ...A, readOnly: true }]) {
      const guard = createOfficeContextGuard(A, () => {});
      await guard.check(async () => ({ ok: true, context }));
      assert.equal(guard.state, 'changed');
    }
    const guard = createOfficeContextGuard(A, () => {});
    await guard.check(async () => ({ ok: false }));
    assert.equal(guard.state, 'unavailable');
    await guard.check(async () => { throw Error('network'); });
    assert.throws(() => guard.assertReady(), /OFFICE_CONTEXT_UNAVAILABLE/);
    await guard.check(async () => ({ ok: true, context: A }));
    assert.equal(guard.observeFailure(Error('OFFICE_CONFLICT')), false);
    assert.equal(guard.state, 'ready');
    assert.equal(guard.observeFailure(Error('OFFICE_TENANT_CHANGED')), true);
    assert.equal(guard.state, 'changed');
    let resolve;
    const pending = guard.check(() => new Promise(done => { resolve = done; }));
    guard.cancelPending(); resolve({ ok: true, context: A }); await pending;
    assert.equal(guard.state, 'changed');
  });

  test(host + ': replies are bound to uninterrupted verified context, including a rapid return to A', async () => {
    const {createOfficeContextGuard}=await helpers(host);
    const guard=createOfficeContextGuard(A,()=>{}),ticket=guard.beginOperation();
    await guard.check(async()=>({ok:true,context:A}));
    assert.doesNotThrow(()=>guard.assertOperationCurrent(ticket),'An ordinary same-context poll is not a context change');
    await guard.check(async()=>({ok:true,context:B}));
    assert.throws(()=>guard.assertOperationCurrent(ticket),/OFFICE_TENANT_CHANGED/);
    await guard.check(async()=>({ok:true,context:A}));
    assert.throws(()=>guard.assertOperationCurrent(ticket),/OFFICE_CONTEXT_UNAVAILABLE/,'Returning to A cannot revive an earlier response');
    const fresh=guard.beginOperation();assert.doesNotThrow(()=>guard.assertOperationCurrent(fresh));
    guard.cancelPending();assert.throws(()=>guard.assertOperationCurrent(fresh),/OFFICE_CONTEXT_UNAVAILABLE/);
  });

  test(host + ': context fetch refuses redirects, HTML, malformed data and denial without navigating', async () => {
    const calls = [];
    let reply = { ok: true, redirected: false, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: true, context: A }) };
    const { fetchOfficeContext } = await helpers(host, {
      AbortController, setTimeout, clearTimeout,
      fetch: async (url, options) => { calls.push({ url, options }); return reply; },
    });
    assert.equal((await fetchOfficeContext()).context.tenantId, A.tenantId);
    assert.equal(calls[0].url, '/api/office/context');
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.cache, 'no-store');
    assert.equal(calls[0].options.credentials, 'same-origin');
    const good = reply;
    for (const change of [
      { ok: false }, { redirected: true },
      { headers: new Headers({ 'content-type': 'text/html' }) },
      { json: async () => ({ ok: true, context: { ...A, readOnly: 'false' } }) },
      { json: async () => ({ ok: false }) },
    ]) {
      reply = { ...good, ...change };
      assert.equal((await fetchOfficeContext()).ok, false);
    }
  });

  test(host + ': company switch notifications contain no authority or document data and tolerate blocked storage', async () => {
    const values = [], events = [];
    const window = {
      localStorage: { setItem: (key, value) => values.push({ key, value }) },
      dispatchEvent: event => events.push(event.type),
    };
    const helper = await helpers(host, { window, Event });
    helper.notifyOfficeContextChanged();
    assert.equal(values[0].key, helper.OFFICE_CONTEXT_STORAGE_KEY);
    assert.equal(events[0], helper.OFFICE_CONTEXT_EVENT);
    assert.match(values[0].value, /^\d+:0\.\d+$/);
    window.localStorage.setItem = () => { throw Error('blocked'); };
    assert.doesNotThrow(() => helper.notifyOfficeContextChanged());
    assert.equal(events.length, 2);
  });

  test(host + ': probe exposes only guarded context, never selects a company, and denies on auth/module failure', async () => {
    let denied = false, count = 0;
    const GET = await authored('integrations/' + host + '/app/api/office/context/route.ts', {
      NextResponse: { json: (body, options) => ({ body, ...options }) },
      requireOfficeContext: async (...args) => {
        assert.equal(args.length, 0); count++;
        if (denied) throw Error('secret detail');
        return { actor: { ...A, role: 'reader' }, supabase: {}, active: { private: 'not exposed' } };
      },
    }, 'GET');
    const response = await GET();
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
    assert.equal(response.body.context.readOnly, true);
    assert.deepEqual(Object.keys(response.body.context).sort(), ['actorId', 'readOnly', 'tenantId']);
    denied = true;
    const failure = await GET();
    assert.equal(failure.status, 403);
    assert.equal(JSON.stringify(failure.body), '{"ok":false}');
    assert.equal(count, 2);
  });

  test(host + ': company switch uses only the existing host endpoint, rejects stale/forged targets and does not navigate', async () => {
    const calls = [], events = [];
    let response = { ok: true, redirected: false, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ companyId: B.tenantId }) };
    const helper = await helpers(host, {
      Event, window: { localStorage: { setItem() {} }, dispatchEvent: event => events.push(event.type) },
      fetch: async (path, options) => { calls.push({ path, options }); return response; },
    });
    const companies = [A, B].map(context => ({ companyId: context.tenantId, companyName: context.tenantId }));
    await assert.rejects(helper.switchOfficeCompany('forged', companies), /OFFICE_FORBIDDEN/);
    assert.equal(calls.length, 0);
    await helper.switchOfficeCompany(B.tenantId, companies);
    assert.equal(calls[0].path, host === 'hub' ? '/api/active-company/switch' : '/api/office/company');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.redirect, 'manual');
    assert.deepEqual(JSON.parse(calls[0].options.body), { companyId: B.tenantId, returnTo: '/office' });
    assert.deepEqual(events, [helper.OFFICE_CONTEXT_EVENT]);
    const good = response;
    for (const failure of [
      { ok: false }, { redirected: true }, { json: async () => ({ companyId: A.tenantId }) },
      { headers: new Headers({ 'content-type': 'text/html' }) },
    ]) {
      response = { ...good, ...failure };
      await assert.rejects(helper.switchOfficeCompany(B.tenantId, companies), /OFFICE_COMPANY_SWITCH_FAILED/);
    }
    assert.equal(events.length, 1);
  });

  test(host + ': transport identifies a platform 413 before trying to read HTML/JSON', async () => {
    const helper = await authored('integrations/' + host + '/app/office/OfficeClient.tsx', { dynamic: () => 'Workspace' }, 'fileResponse');
    await assert.rejects(helper(new Response('Payload too large', { status: 413 })), /OFFICE_HOST_LIMIT/);
  });

  test(host + ': real server actions reject old tenant before service read/write/template work', async () => {
    let calls = 0; const writes = [];
    const mod = await authored('integrations/' + host + '/app/office/actions.ts', {
      SupabaseOfficeService: class { async request() { calls++; return {}; } },
      requireOfficeContext: async write => { writes.push(write); return { actor: B, active: {}, supabase: { from() { throw Error('Must not query stale template link'); } } }; },
    }, '({officeAction,officeTemplateVariables})');
    for (const op of ['list', 'read', 'create', 'save', 'restore', 'approve', 'remove']) {
      assert.equal((await mod.officeAction(A.tenantId, { op })).error, 'OFFICE_TENANT_CHANGED');
    }
    await assert.rejects(mod.officeTemplateVariables(A.tenantId, { type: 'job', id: 'id' }), /OFFICE_TENANT_CHANGED/);
    assert.equal(calls, 0); assert.equal(writes[0], false); assert.equal(writes[2], true);
  });

  test(host + ': actual client pins the editor/draft through new props and blocks every transport until original context returns', async () => {
    const base = await helpers(host);
    const limits = await authored('integrations/' + host + '/lib/office/http-limits.ts', { TextEncoder, File }, '({assertOfficeHostPayload,assertOfficeHostUpload})');
    const events = new Map(), docEvents = new Map(), states = [], memos = [], effects = [];
    let stateIndex = 0, memoIndex = 0, effectIndex = 0, pendingEffects = [], probeContext = A, actionGate = null;
    const actions = [], requests = [], companySwitches = [];
    const equal = (a, b) => a?.length === b?.length && a.every((value, index) => value === b[index]);
    const bindings = {
      ...base,
      ...limits,
      fetchOfficeContext: async () => ({ ok: true, context: probeContext }),
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
      },
      useMemo(create, deps) {
        const index = memoIndex++;
        if (!memos[index] || !equal(memos[index].deps, deps)) memos[index] = { deps, value: create() };
        return memos[index].value;
      },
      useEffect(effect, deps) {
        const index = effectIndex++;
        if (!effects[index] || !equal(effects[index].deps, deps)) {
          const prior = effects[index];
          effects[index] = { deps };
          pendingEffects.push(() => { prior?.cleanup?.(); effects[index].cleanup = effect(); });
        }
      },
      dynamic: () => 'Workspace',
      jsx: (type, props, ...children) => ({ type, props: props ?? {}, children }), Fragment: 'Fragment',
      officeContextMessages: { cs: { checking: 'checking', changed: 'changed', unavailable: 'unavailable', recovery: 'recovery', verify: 'verify', open: 'open' } },
      officeShellMessages: { cs: { company: 'company', switchCompany: 'switch', logout: 'logout', switchHint: 'hint', logoutHint: 'hint', switchFailed: 'failed' } },
      window: {
        addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name),
        setInterval: () => 1, clearInterval() {},
      },
      document: { visibilityState: 'visible', addEventListener: (name, cb) => docEvents.set(name, cb), removeEventListener: name => docEvents.delete(name) },
      officeAction: async (tenant, request) => { actions.push({ tenant, request }); if(actionGate)await actionGate;return { ok: true, result: {} }; },
      officeTemplateVariables: async tenant => { actions.push({ tenant, template: true }); return {}; },
      switchOfficeCompany: async (companyId, companies) => {
        companySwitches.push({ companyId, companies });
        probeContext = companyId === B.tenantId ? B : A;
        events.get(base.OFFICE_CONTEXT_EVENT)();
      },
      fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, redirected: false, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) }; },
    };
    const Component = await authored('integrations/' + host + '/app/office/OfficeClient.tsx', bindings, 'OfficeClient');
    const render = props => {
      stateIndex = memoIndex = effectIndex = 0;
      const tree = Component(props), queued = pendingEffects; pendingEffects = [];
      queued.forEach(run => run());
      return tree;
    };
    const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children ?? []).flatMap(nodes)];
    const initial = { ...A, companyName: 'Company A', companies: [A, B].map(context => ({ companyId: context.tenantId, companyName: context.tenantId })) };
    const first = nodes(render(initial)).find(node => node.type === 'Workspace'), transport = first.props.transport;
    await tick();
    await transport.request({ op: 'list' });
    assert.equal(actions[0].tenant, A.tenantId);

    let releaseLate;actionGate=new Promise(resolve=>{releaseLate=resolve;});
    const lateResponse=transport.request({op:'listFiles'}).then(value=>({value}),error=>({error}));
    await tick();

    probeContext = B;
    events.get(base.OFFICE_CONTEXT_EVENT)();
    await assert.rejects(transport.request({ op: 'save' }), /OFFICE_CONTEXT_UNAVAILABLE/);
    await tick();
    actionGate=null;releaseLate();
    const late=(await lateResponse).error;
    assert.match(late?.message??'',/OFFICE_TENANT_CHANGED/,'An already started response is discarded after a tenant change');
    assert.equal(late.userMessage,'changed','The UI receives a localized explanation instead of a technical code');
    const changed = nodes(render({ ...B, readOnly: true }));
    const workspace = changed.find(node => node.type === 'Workspace');
    assert.equal(workspace.props.key, first.props.key);
    assert.equal(workspace.props.key, A.tenantId);
    assert.equal(workspace.props.readOnly, false);
    assert.equal(workspace.props.transport, transport);
    assert.equal(changed.find(node => node.props['data-office-context'])?.props['data-office-context'], 'changed');
    const before = actions.length + requests.length;
    for (const operation of [
      () => transport.request({ op: 'save' }), () => transport.templateVariables(),
      () => transport.importFile({}), () => transport.exportFile('file', 'docx'),
    ]) await assert.rejects(operation(), /OFFICE_TENANT_CHANGED/);
    assert.equal(actions.length + requests.length, before);
    const link = changed.find(node => node.type === 'a' && node.props.href === '/office');
    assert.equal(link.props.target, '_blank');
    assert.equal(link.props.href, '/office');

    probeContext = A;
    events.get('focus')(); await tick();
    await transport.request({ op: 'save' });
    await transport.templateVariables();
    await transport.importFile({ get: () => new File(['test'], 'test.txt') });
    await transport.exportFile('file', 'docx');
    assert.equal(actions.at(-1).tenant, A.tenantId);
    assert.equal(requests.at(-1).options.headers['X-Office-Tenant'], A.tenantId);
    assert.equal(requests.at(-2).options.headers['X-Office-Tenant'], A.tenantId);
    const beforeLimit = actions.length + requests.length;
    await assert.rejects(transport.request({ op: 'save', content: 'x'.repeat(3800000) }), /OFFICE_HOST_LIMIT/);
    await assert.rejects(transport.importFile({ get: () => new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'big.txt') }), /OFFICE_HOST_LIMIT/);
    assert.equal(actions.length + requests.length, beforeLimit);

    // The switch inside this panel keeps the same editor and opens no navigation.
    nodes(render(initial)).find(node => node.type === 'select').props.onChange({ target: { value: B.tenantId } });
    nodes(render(initial)).find(node => node.type === 'button' && node.children.includes('switch')).props.onClick();
    await tick();
    assert.equal(companySwitches.length, 1);
    assert.equal(companySwitches[0].companyId, B.tenantId);
    assert.equal(companySwitches[0].companies.length, 2);
    const afterOwnSwitch = nodes(render(initial));
    assert.equal(afterOwnSwitch.find(node => node.type === 'Workspace').props.transport, transport);
    assert.equal(afterOwnSwitch.find(node => node.type === 'Workspace').props.key, A.tenantId);
    assert.equal(afterOwnSwitch.find(node => node.props['data-office-context']).props['data-office-context'], 'changed');
    const logout = afterOwnSwitch.find(node => node.type === 'a' && node.props.href === '/logout');
    assert.equal(logout.props.target, '_blank');
    effects.forEach(effect => effect.cleanup?.());
  });
}
