import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicHostTarget, assertHostSessionTarget } from '../scripts/staging-public-target.mjs';
import { createHubHostSession } from '../scripts/staging-hub-host-session.mjs';
import { createDiriqoHostSession } from '../scripts/staging-diriqo-host-session.mjs';

const refs = { hub: 'amuhcvnvubsrvsfclqtg', diriqo: 'pkjzoplczxqqmmstnqgy' };
const origins = { hub: 'https://office-staging-hub-unittest.vercel.app', diriqo: 'https://office-staging-diriqo-unittest.vercel.app' };
// These URLs and credentials are inert test data; all network is replaced locally.
function fixture(now = Date.now()) {
  const verifiedAt = new Date(now).toISOString();
  return {
    now,
    stage: { schemaVersion: 1, hosts: {
      hub: { projectRef: refs.hub, parentRef: 'yrxfozthravgbbcqklzy', organizationId: 'ljkxtwounsysoalxgsvw', branchId: '11111111-1111-4111-8111-111111111111', name: 'office-staging-unit-test', verifiedAt },
      diriqo: { projectRef: refs.diriqo, parentRef: 'wfcpfraxiuhuglnuaxqj', organizationId: 'uxtwbwyxadetdybttoug', branchId: '22222222-2222-4222-8222-222222222222', name: 'office-staging-unit-test', verifiedAt },
    } },
    public: { schemaVersion: 1, teamId: 'team_T3CmcoBW7Z2p1EeDWreh7ZyV', expiresAt: new Date(now + 3600000).toISOString(), budgetUsd: 1, hourlyPerBranchUsd: 0.01344, hosts: {
      hub: { projectId: 'prj_TWypfvehBvtM51pUQXBaF4KUJU7w', projectName: 'office-staging-hub', projectRef: refs.hub, origin: origins.hub, deploymentId: 'dpl_UnitTestHub', state: 'READY', verifiedAt },
      diriqo: { projectId: 'prj_bIzIYwBQAMhxZbJEmMSl8TISSOnW', projectName: 'office-staging-diriqo', projectRef: refs.diriqo, origin: origins.diriqo, deploymentId: 'dpl_UnitTestDiriqo', state: 'READY', verifiedAt },
    } },
  };
}
const validate = (f, host = 'hub') => validatePublicHostTarget(f.public, f.stage, host, { now: f.now });
const unsafe = fn => assert.throws(fn, error => ['UNSAFE_PUBLIC_STAGING_TARGET', 'UNSAFE_STAGING_TARGET'].includes(error.code));
function sessionOptions(host, publicTarget) {
  return { baseOrigin: origins[host], expectedProjectRef: refs[host], publicTarget,
    supabaseUrl: 'https://' + refs[host] + '.supabase.co', publicKey: 'sb_publishable_unittest_public_only_key' };
}
const create = (host, options) => host === 'hub' ? createHubHostSession(options) : createDiriqoHostSession(options);

test('public target requires READY metadata and returns a detached frozen capability tied to both manifests', () => {
  const f = fixture();
  for (const host of ['hub', 'diriqo']) {
    const target = validate(f, host);
    assert.ok(Object.isFrozen(target)); assert.equal(target.origin, origins[host]);
    assert.equal(target.projectRef, refs[host]); assert.equal(target.state, 'READY');
    assert.equal(assertHostSessionTarget({ host, ...sessionOptions(host, target) }).origin, origins[host]);
    const copy = { ...target };
    unsafe(() => assertHostSessionTarget({ host, ...sessionOptions(host, copy) }));
    f.public.hosts[host].origin = 'https://evil.example';
    assert.equal(target.origin, origins[host]);
  }
});

test('project, branch, production refs and wrong team are denied even with a plausible Vercel origin', () => {
  for (const host of ['hub', 'diriqo']) {
    for (const change of [
      { projectId: 'prj_other' }, { projectName: 'production' }, { state: 'BUILDING' },
      { deploymentId: '' }, { deploymentId: 'not-a-deployment' }, { projectRef: 'abcdefghijklmnopqrst' },
      { projectRef: 'yrxfozthravgbbcqklzy' }, { projectRef: 'wfcpfraxiuhuglnuaxqj' },
    ]) {
      const f = fixture(); Object.assign(f.public.hosts[host], change); unsafe(() => validate(f, host));
    }
    const mismatched = fixture(); mismatched.stage.hosts[host].projectRef = 'abcdefghijklmnopqrst'; unsafe(() => validate(mismatched, host));
  }
  const wrongTeam = fixture(); wrongTeam.public.teamId = 'team_other'; unsafe(() => validate(wrongTeam));
});

test('only bare HTTPS deployment origins under the correct project prefix are permitted', () => {
  for (const origin of [
    'https://diriqo.vercel.app', 'https://office-staging-hub.vercel.app', origins.diriqo,
    'https://office-staging-hub-unittest.vercel.app.evil.example',
    'https://office-staging-hub-unittest.evil.example', 'https://user:pass@office-staging-hub-unittest.vercel.app',
    origins.hub + '/', origins.hub + '/office', origins.hub + '?x=1', origins.hub + '#x',
    origins.hub.replace('https:', 'http:'), origins.hub + ':443', 'https://127.0.0.1',
    'https://OFFICE-STAGING-HUB-unittest.vercel.app', 'file:///tmp/office', null,
  ]) {
    const f = fixture(); f.public.hosts.hub.origin = origin; unsafe(() => validate(f));
  }
});

test('expired authorization, stale deployment/branch verification and malformed timestamps fail closed', () => {
  for (const [where, field, value] of [
    ['root', 'expiresAt', now => new Date(now).toISOString()],
    ['host', 'verifiedAt', now => new Date(now - 86400000).toISOString()],
    ['host', 'verifiedAt', now => new Date(now + 300001).toISOString()],
    ['host', 'verifiedAt', () => '2026-02-30T12:00:00.000Z'],
    ['host', 'verifiedAt', () => '2026-10-11'],
    ['stage', 'verifiedAt', now => new Date(now - 86400000).toISOString()],
  ]) {
    const f = fixture(); const target = where === 'root' ? f.public : where === 'host' ? f.public.hosts.hub : f.stage.hosts.hub;
    target[field] = value(f.now); unsafe(() => validate(f));
  }
  for (const field of ['origin', 'projectRef', 'deploymentId', 'state', 'verifiedAt']) {
    const f = fixture(); delete f.public.hosts.hub[field]; unsafe(() => validate(f));
  }
  const extra = fixture(); extra.public.hosts.hub.url = origins.hub; unsafe(() => validate(extra));
  const accessor = fixture(); let getterRan = false;
  Object.defineProperty(accessor.public.hosts.hub, 'origin', { get() { getterRan = true; return origins.hub; } });
  unsafe(() => validate(accessor)); assert.equal(getterRan, false);
});

test('shortened Hub hostname is allowed only for the exact reviewed deployment identity', () => {
  const origin = 'https://office-staging-712fy2h57-jspdholding-7510s-projects.vercel.app';
  const deploymentId = 'dpl_5tzz4nco4XseNWuk9raShR2H1S6L';
  const f = fixture(); Object.assign(f.public.hosts.hub, { origin, deploymentId });
  const capability = validate(f);
  assert.equal(assertHostSessionTarget({ host: 'hub', baseOrigin: origin, expectedProjectRef: refs.hub, publicTarget: capability }).origin, origin);
  for (const change of [
    { deploymentId: 'dpl_Different' }, { state: 'BUILDING' }, { projectId: f.public.hosts.diriqo.projectId },
    { projectRef: refs.diriqo }, { origin: origin.replace('712fy2h57', 'unreviewed') },
    { origin: origin + '/' }, { origin: origin.replace('https:', 'http:') },
  ]) {
    const invalid = fixture(); Object.assign(invalid.public.hosts.hub, { origin, deploymentId }, change); unsafe(() => validate(invalid));
  }
  const otherHost = fixture(); Object.assign(otherHost.public.hosts.diriqo, { origin, deploymentId }); unsafe(() => validate(otherHost, 'diriqo'));
});

test('final Hub label deployment has its own exact binding and cannot reuse the prior deployment ID', () => {
  const origin = 'https://office-staging-nyf1c56p4-jspdholding-7510s-projects.vercel.app';
  const deploymentId = 'dpl_AhzzQw6qDKuDyMm98kzr7FwxyNdv';
  const f = fixture(); Object.assign(f.public.hosts.hub, { origin, deploymentId });
  const capability = validate(f);
  assert.equal(assertHostSessionTarget({ host: 'hub', baseOrigin: origin, expectedProjectRef: refs.hub, publicTarget: capability }).origin, origin);
  for (const change of [
    { deploymentId: 'dpl_5tzz4nco4XseNWuk9raShR2H1S6L' }, { state: 'BUILDING' },
    { origin: 'https://office-staging-712fy2h57-jspdholding-7510s-projects.vercel.app' },
    { origin: origin.replace('nyf1c56p4', 'unreviewed') }, { projectRef: 'yrxfozthravgbbcqklzy' },
  ]) {
    const invalid = fixture(); Object.assign(invalid.public.hosts.hub, { origin, deploymentId }, change); unsafe(() => validate(invalid));
  }
});

test('both session constructors reject unvalidated, forged, foreign and production targets before auth/network', () => {
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = () => { requests++; throw Error('No network allowed in target tests'); };
  try {
    for (const host of ['hub', 'diriqo']) {
      const capability = validate(fixture(), host), valid = sessionOptions(host, capability);
      for (const change of [
        { publicTarget: undefined }, { publicTarget: { ...capability } },
        { baseOrigin: origins[host] + '/office' }, { baseOrigin: 'https://diriqo.vercel.app' },
        { expectedProjectRef: 'yrxfozthravgbbcqklzy' }, { expectedProjectRef: 'wfcpfraxiuhuglnuaxqj' },
        { expectedProjectRef: refs[host === 'hub' ? 'diriqo' : 'hub'] },
      ]) unsafe(() => create(host, { ...valid, ...change }));
      unsafe(() => create(host, { ...valid, publicTarget: validate(fixture(), host === 'hub' ? 'diriqo' : 'hub') }));
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

test('Hub rejects secret/service/foreign/expired legacy public keys before loading an auth client', () => {
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = () => { requests++; throw Error('No network allowed in key tests'); };
  // Deliberately unusable signatures: only the local public-key policy is tested.
  const legacy = claims => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'), Buffer.from('invalid-unit-test-signature').toString('base64url')].join('.');
  try {
    const options = sessionOptions('hub', validate(fixture(), 'hub'));
    for (const publicKey of [
      undefined, 'sb_secret_unit_test_do_not_send',
      legacy({ role: 'service_role', ref: refs.hub, exp: 9999999999 }),
      legacy({ role: 'anon', ref: refs.diriqo, exp: 9999999999 }),
      legacy({ role: 'anon', ref: refs.hub, exp: 1 }),
    ]) assert.throws(() => createHubHostSession({ ...options, publicKey }), /STAGING_INVALID_PUBLISHABLE_KEY/);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

test('a public session revalidates expiry before login and every request', async () => {
  const f = fixture(), capability = validate(f, 'diriqo');
  const session = createDiriqoHostSession(sessionOptions('diriqo', capability));
  const originalNow = Date.now, originalFetch = globalThis.fetch; let requests = 0;
  Date.now = () => f.now + 3600000;
  globalThis.fetch = () => { requests++; throw Error('No network allowed after expiry'); };
  try {
    await assert.rejects(session.login({ email: 'office-unit@office-staging.invalid', password: 'not-a-real-password' }), /expired/);
    await assert.rejects(session.request('/office'), /expired/);
    assert.equal(requests, 0);
  } finally { Date.now = originalNow; globalThis.fetch = originalFetch; }
});

test('HTTPS session sends Secure cookies only to its reviewed origin and never follows a redirect', async () => {
  const session = createDiriqoHostSession(sessionOptions('diriqo', validate(fixture(), 'diriqo')));
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return new Response(JSON.stringify({ ok: true, redirectTo: '/office' }), {
      status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store',
        'set-cookie': 'sb-' + refs.diriqo + '-auth-token=opaque-unit-cookie; Path=/; Secure; SameSite=Lax' },
    });
    if (calls.length === 2) return new Response('<html>Office</html>', { headers: { 'content-type': 'text/html' } });
    return new Response('', { status: 307, headers: { location: 'https://diriqo.vercel.app/sign-in' } });
  };
  try {
    await session.login({ email: 'office-unit@office-staging.invalid', password: 'not-a-real-password' });
    await session.request('/office');
    assert.match(new Headers(calls[1].options.headers).get('cookie'), /opaque-unit-cookie/);
    assert.equal(calls[1].url, origins.diriqo + '/office');
    assert.equal(calls[1].options.redirect, 'manual');
    await assert.rejects(session.request('/office'), /HOST_REDIRECT_CROSS_ORIGIN/);
    assert.equal(calls.length, 3);
    await assert.rejects(session.request('//evil.example/path'), /HOST_PATH_INVALID/);
    for (const headers of [{ host: 'evil.example' }, { 'x-forwarded-host': 'evil.example' }, { authorization: 'Bearer invalid' }, { cookie: 'override' }]) {
      await assert.rejects(session.request('/office', { headers }), /HOST_(ROUTING_OVERRIDE|BEARER_BYPASS|COOKIE_OVERRIDE)_BLOCKED/);
    }
    assert.equal(calls.length, 3);
  } finally { globalThis.fetch = original; }
});

test('local mode remains loopback-only and will not send Secure cookies over HTTP', async () => {
  const session = createDiriqoHostSession({ baseOrigin: 'http://127.0.0.1:4332', expectedProjectRef: refs.diriqo });
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options);
    return new Response('{}', { headers: { 'content-type': 'application/json',
      'set-cookie': 'sb-' + refs.diriqo + '-auth-token=opaque-unit-cookie; Path=/; Secure' } });
  };
  try {
    await session.request('/office'); await session.request('/office');
    assert.equal(new Headers(calls[1].headers).has('cookie'), false);
    for (const baseOrigin of ['http://localhost:4332', 'http://192.168.1.1:4332', origins.diriqo]) {
      unsafe(() => createDiriqoHostSession({ baseOrigin, expectedProjectRef: refs.diriqo }));
    }
  } finally { globalThis.fetch = original; }
});
