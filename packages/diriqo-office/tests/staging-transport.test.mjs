import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStagingTransport, validateCredentials } from '../scripts/staging-transport.mjs';

const ref = 'abcdefghijklmnopqrst', origin = 'https://' + ref + '.supabase.co';
const target = Object.freeze({ host: 'diriqo', projectRef: ref, origin });
const publishableKey = 'sb_publishable_staging_public_test_key';
const jwt = claims => [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify(claims)).toString('base64url'), Buffer.from('fake-signature-unit-test-only').toString('base64url')].join('.');
const credentials = principal => ({ email: 'office-transport-test@office-staging.invalid', password: 'unit-test-password-never-send-live', userId: randomUUID(), tenantId: randomUUID(), principal: principal ?? 'human', label: principal === 'ai' ? 'aiA' : 'ownerA' });
const claims = (user, extra = {}) => ({ iss: origin + '/auth/v1', sub: user.userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: user.principal === 'ai' ? { office_principal: 'ai' } : {}, ...extra });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

function mock(user = credentials(), options = {}) {
  const token = jwt(claims(user, options.claims)), calls = [], events = [];
  const queue = [() => json({ access_token: token, refresh_token: 'never-return-refresh-token' }), () => json({ id: user.userId, email: user.email, app_metadata: user.principal === 'ai' ? { office_principal: 'ai' } : {}, ...options.user })];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); assert.ok(queue.length, 'No unplanned network call'); return queue.shift()(url, init); };
  const transport = createStagingTransport({ target, publishableKey, fetchImpl, onRequest: async event => { events.push(event); } });
  return { user, token, calls, events, queue, transport };
}

test('login verifies Auth identity and request uses fixed RPC endpoint with no retries or redirects', async () => {
  const fixture = mock(), actor = await fixture.transport.login(fixture.user);
  assert.deepEqual(Object.keys(actor).sort(), ['accessToken', 'label', 'principal', 'tenantId', 'userId']);
  assert.equal(actor.accessToken, fixture.token);
  assert.ok(Object.isFrozen(actor));
  fixture.queue.push(() => json({ files: [] }));
  const body = { op: 'list' }, result = await fixture.transport.request(actor, body);
  assert.deepEqual(result, { data: { files: [] }, status: 200, errorCode: null });
  assert.equal(fixture.calls.length, 3);
  assert.equal(fixture.calls[0].url, origin + '/auth/v1/token?grant_type=password');
  assert.equal(fixture.calls[1].url, origin + '/auth/v1/user');
  assert.equal(fixture.calls[2].url, origin + '/rest/v1/rpc/office_request');
  assert.deepEqual(JSON.parse(fixture.calls[0].init.body), { email: fixture.user.email, password: fixture.user.password });
  assert.deepEqual(JSON.parse(fixture.calls[2].init.body), { p_company_id: actor.tenantId, p_request: body, p_principal: 'human' });
  for (const call of fixture.calls) {
    assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store'); assert.equal(call.init.credentials, 'omit');
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.equal(new Headers(call.init.headers).get('apikey'), publishableKey);
  }
  for (const call of fixture.calls.slice(1)) assert.equal(new Headers(call.init.headers).get('authorization'), 'Bearer ' + fixture.token);
  assert.ok(!('password' in actor) && !('email' in actor) && !('refresh_token' in actor));
  for (const event of fixture.events) assert.deepEqual(Object.keys(event).sort(), ['elapsedMs', 'errorCode', 'label', 'op', 'startedAt', 'status', 'tenantId']);
  const report = JSON.stringify(fixture.events);
  for (const secret of [fixture.user.password, fixture.user.email, fixture.token, publishableKey, 'refresh_token']) assert.ok(!report.includes(secret));
});

test('production refs, altered origins, mutable targets, secrets and legacy privileged keys are rejected before fetch', () => {
  let fetched = false; const fetchImpl = () => { fetched = true; throw Error('must not fetch'); };
  for (const projectRef of ['wfcpfraxiuhuglnuaxqj', 'yrxfozthravgbbcqklzy']) assert.throws(() => createStagingTransport({ target: Object.freeze({ projectRef, origin: 'https://' + projectRef + '.supabase.co' }), publishableKey, fetchImpl }), /STAGING_INVALID_TARGET/);
  for (const invalid of [{ ...target }, Object.freeze({ ...target, origin: origin + '/' }), Object.freeze({ ...target, origin: 'http://' + ref + '.supabase.co' }), Object.freeze({ ...target, origin: origin + '@127.0.0.1' })]) assert.throws(() => createStagingTransport({ target: invalid, publishableKey, fetchImpl }), /STAGING_INVALID_TARGET/);
  for (const key of [undefined, 'sb_secret_supersecret', jwt({ role: 'service_role', ref, exp: 9999999999 }), jwt({ role: 'anon', ref: 'bcdefghijklmnopqrstu', exp: 9999999999 })]) assert.throws(() => createStagingTransport({ target, publishableKey: key, fetchImpl }), /STAGING_INVALID_PUBLISHABLE_KEY/);
  assert.doesNotThrow(() => createStagingTransport({ target, publishableKey: jwt({ role: 'anon', ref, exp: 9999999999 }), fetchImpl }));
  assert.equal(fetched, false);
});

test('credentials accept only staging identities and require long passwords and UUID bindings', () => {
  const good = credentials();
  assert.equal(validateCredentials(good).email, good.email);
  for (const changes of [{ email: 'real-user@example.com' }, { email: 'office-x@office-staging.invalid.attacker.test' }, { password: 'short' }, { userId: 'bad' }, { tenantId: 'bad' }, { principal: 'service_role' }, { label: 'secret@email.test' }]) assert.throws(() => validateCredentials({ ...good, ...changes }), /STAGING_INVALID_CREDENTIALS/);
});

test('login rejects a mismatched user, email, principal, issuer, sub, privileged role or expired token', async () => {
  const variants = [
    { user: { id: randomUUID() } }, { user: { email: 'office-other@office-staging.invalid' } },
    { user: { app_metadata: { office_principal: 'ai' } } },
    { claims: { iss: 'https://wfcpfraxiuhuglnuaxqj.supabase.co/auth/v1' } },
    { claims: { sub: randomUUID() } }, { claims: { role: 'service_role' } }, { claims: { exp: 1 } },
    { claims: { app_metadata: { office_principal: 'ai' } } },
  ];
  for (const options of variants) {
    const fixture = mock(credentials(), options);
    await assert.rejects(fixture.transport.login(fixture.user), error => /^STAGING_(?:USER|PRINCIPAL|TOKEN)_BINDING_FAILED$/.test(error.code));
  }
  const ai = mock(credentials('ai'), { user: { app_metadata: {} } });
  await assert.rejects(ai.transport.login(ai.user), /STAGING_PRINCIPAL_BINDING_FAILED/);
});

test('RPC errors expose only parsed Office codes; forged tenant and AI principal remain testable server inputs', async () => {
  const fixture = mock(credentials('ai')), actor = await fixture.transport.login(fixture.user), foreignTenant = randomUUID();
  fixture.queue.push(() => json({ code: 'P0001', message: JSON.stringify({ code: 'HUMAN_APPROVAL_REQUIRED', message: fixture.user.password }) }, 400));
  const result = await fixture.transport.request({ ...actor, tenantId: foreignTenant, principal: 'human' }, { op: 'approve', id: 'test', proposalId: 'test', expectedRevision: 1, idempotencyKey: randomUUID() });
  assert.deepEqual(result, { data: null, status: 400, errorCode: 'HUMAN_APPROVAL_REQUIRED' });
  assert.equal(JSON.parse(fixture.calls[2].init.body).p_company_id, foreignTenant);
  assert.equal(JSON.parse(fixture.calls[2].init.body).p_principal, 'human');
  assert.ok(!JSON.stringify([result, fixture.events]).includes(fixture.user.password));
  fixture.queue.push(() => json({ code: 'P0001', message: fixture.user.password }, 400));
  assert.equal((await fixture.transport.request(actor, { op: 'list' })).errorCode, 'HTTP_ERROR');
});

test('actor token binding failures and absent authentication cause no RPC request', async () => {
  const fixture = mock(), actor = await fixture.transport.login(fixture.user);
  for (const changed of [{ ...actor, accessToken: undefined }, { ...actor, userId: randomUUID() }, { ...actor, accessToken: jwt(claims(fixture.user, { iss: 'https://other.invalid/auth/v1' })) }]) await assert.rejects(fixture.transport.request(changed, { op: 'list' }), /STAGING_(INVALID_TOKEN|TOKEN_BINDING_FAILED)/);
  await assert.rejects(fixture.transport.request(null, { op: 'list' }), /STAGING_INVALID_ACTOR/);
  assert.equal(fixture.calls.length, 2);
});

test('redirects, unexpected response URLs and oversized streamed JSON fail closed without leaking responses', async () => {
  const fixture = mock(), actor = await fixture.transport.login(fixture.user);
  fixture.queue.push(() => new Response('', { status: 302, headers: { location: 'https://wfcpfraxiuhuglnuaxqj.supabase.co' } }));
  assert.equal((await fixture.transport.request(actor, { op: 'list' })).errorCode, 'REDIRECT_NOT_ALLOWED');
  fixture.queue.push(() => { const response = json({}); Object.defineProperty(response, 'url', { value: 'https://127.0.0.1/unexpected' }); return response; });
  assert.equal((await fixture.transport.request(actor, { op: 'list' })).errorCode, 'REDIRECT_NOT_ALLOWED');
  fixture.queue.push(() => json({}, 200, { 'Content-Length': String(5 * 1024 * 1024) }));
  assert.equal((await fixture.transport.request(actor, { op: 'list' })).errorCode, 'RESPONSE_TOO_LARGE');
  fixture.queue.push(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3 * 1024 * 1024)); controller.enqueue(new Uint8Array(2 * 1024 * 1024)); controller.close(); } }), { headers: { 'Content-Type': 'application/json' } }));
  assert.equal((await fixture.transport.request(actor, { op: 'list' })).errorCode, 'RESPONSE_TOO_LARGE');
  assert.equal(fixture.calls.length, 6);
});

test('network exceptions are sanitized and mutations are never automatically retried', async () => {
  const fixture = mock(), actor = await fixture.transport.login(fixture.user);
  fixture.queue.push(() => { throw new Error('network leaked ' + fixture.user.password + ' ' + fixture.token); });
  const result = await fixture.transport.request(actor, { op: 'save', id: 'test', expectedRevision: 1, content: {}, idempotencyKey: randomUUID() });
  assert.deepEqual(result, { data: null, status: 0, errorCode: 'TRANSPORT_FAILED' });
  assert.equal(fixture.calls.length, 3);
  assert.ok(!JSON.stringify([result, fixture.events]).includes(fixture.token));
  assert.ok(!JSON.stringify([result, fixture.events]).includes(fixture.user.password));
});

test('request timing metadata names only valid UUID files and uses a nonnegative monotonic duration', async () => {
  const fixture = mock(), actor = await fixture.transport.login(fixture.user), fileId = randomUUID();
  fixture.queue.push(() => json({}));
  const before = Date.now();
  await fixture.transport.request(actor, { op: 'save', id: fileId, content: { secret: 'never report content' } });
  const event = fixture.events.at(-1);
  assert.equal(event.fileId, fileId);
  assert.ok(Date.parse(event.startedAt) >= before && Date.parse(event.startedAt) <= Date.now());
  assert.ok(Number.isInteger(event.elapsedMs) && event.elapsedMs >= 0);
  assert.ok(!JSON.stringify(event).includes('never report content'));
  fixture.queue.push(() => json({}));
  await fixture.transport.request(actor, { op: 'read', id: 'not-a-uuid-secret' });
  assert.equal('fileId' in fixture.events.at(-1), false);
});
