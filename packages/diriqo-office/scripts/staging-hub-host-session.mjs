/**
 * Actual Hub browser-auth protocol over a private in-memory cookie jar.
 * Uses the clone's existing @supabase/ssr serializer; installs no dependencies.
 * Importing this file makes no requests. No session JWT is fabricated or logged.
 * Caller must first verify the staging target and rebuild/start only the clone.
 */
import assert from 'node:assert/strict';
import { assertHostSessionTarget } from './staging-public-target.mjs';
import { createStagingTransport } from './staging-transport.mjs';
import { createRequire } from 'node:module';

const hostRequire = createRequire(new URL('../integrations/hub/package.json', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createHubHostSession({ baseOrigin, expectedProjectRef, supabaseUrl, publicKey, publicTarget }) {
  const verifyTarget = () => assertHostSessionTarget({ host: 'hub', baseOrigin, expectedProjectRef, publicTarget });
  const origin = verifyTarget();
  assert.equal(supabaseUrl, 'https://' + expectedProjectRef + '.supabase.co', 'STAGING_URL_MISMATCH');
  // Reuse the existing anon/public-key guard, including legacy role/ref binding.
  createStagingTransport({ target: Object.freeze({ host: 'hub', projectRef: expectedProjectRef, origin: supabaseUrl }), publishableKey: publicKey });
  assert.equal(typeof Headers.prototype.getSetCookie, 'function', 'NODE_GET_SET_COOKIE_REQUIRED');
  const { createBrowserClient } = hostRequire('@supabase/ssr');
  const { serialize, parse } = hostRequire('cookie');
  const jar = new Map();
  const sessionCookie = new RegExp('^sb-' + expectedProjectRef + '-auth-token(?:\\.\\d+)?$');
  let authenticatedUser = null;

  function absorbCookie(raw) {
    const [first, ...rest] = raw.split(';');
    const equal = first.indexOf('=');
    assert.ok(equal > 0, 'HOST_SET_COOKIE_INVALID');
    const name = first.slice(0, equal).trim();
    const value = first.slice(equal + 1);
    assert.match(name, /^[!#$%&'*+\-.^_|~0-9A-Za-z]+$/, 'HOST_COOKIE_NAME_INVALID');
    const attrs = new Map(rest.map(part => {
      const index = part.indexOf('=');
      return index < 0 ? [part.trim().toLowerCase(), '']
        : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()];
    }));
    assert.equal(attrs.get('path') ?? '/', '/', 'HOST_COOKIE_PATH_UNEXPECTED');
    const domain = attrs.get('domain')?.replace(/^\./, '');
    assert.ok(!domain || domain === origin.hostname, 'HOST_COOKIE_DOMAIN_UNEXPECTED');
    if (name.startsWith('sb-')) assert.ok(sessionCookie.test(name), 'HOST_COOKIE_PROJECT_MISMATCH');
    const expires = attrs.has('max-age')
      ? Date.now() + Number(attrs.get('max-age')) * 1000
      : attrs.has('expires') ? Date.parse(attrs.get('expires')) : Infinity;
    assert.ok(expires === Infinity || Number.isFinite(expires), 'HOST_COOKIE_EXPIRY_INVALID');
    if (!value || expires <= Date.now()) jar.delete(name);
    else jar.set(name, { value, expires, secure: attrs.has('secure') });
  }

  function cookieHeader() {
    return [...jar].filter(([, v]) => v.expires > Date.now() && (!v.secure || origin.protocol === 'https:'))
      .map(([name, v]) => name + '=' + v.value).join('; ');
  }

  const supabase = createBrowserClient(supabaseUrl, publicKey, {
    isSingleton: false,
    cookieOptions: { secure: origin.protocol === 'https:' },
    global: {
      fetch: (input, init = {}) => {
        verifyTarget();
        const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        assert.equal(target.origin, supabaseUrl, 'AUTH_CROSS_ORIGIN_BLOCKED');
        return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(45000) });
      },
    },
    cookies: {
      getAll: () => Object.entries(parse(cookieHeader())).map(([name, value]) => ({ name, value })),
      setAll: cookies => {
        // This is the exact cookie serializer used by createBrowserClient in Hub.
        for (const { name, value, options } of cookies) absorbCookie(serialize(name, value, options));
      },
    },
  });

  async function request(path, { method = 'GET', headers = {}, body } = {}) {
    verifyTarget();
    assert.ok(path.startsWith('/') && !path.startsWith('//'), 'HOST_PATH_INVALID');
    const url = new URL(path, origin);
    assert.equal(url.origin, origin.origin, 'HOST_CROSS_ORIGIN_BLOCKED');
    const requestHeaders = new Headers(headers);
    assert.ok(!requestHeaders.has('authorization'), 'HOST_BEARER_BYPASS_BLOCKED');
    assert.ok(!requestHeaders.has('cookie'), 'HOST_COOKIE_OVERRIDE_BLOCKED');
    for (const name of ['host', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto']) assert.ok(!requestHeaders.has(name), 'HOST_ROUTING_OVERRIDE_BLOCKED');
    const cookie = cookieHeader();
    if (cookie) requestHeaders.set('Cookie', cookie);
    const response = await fetch(url, {
      method, headers: requestHeaders, body, redirect: 'manual',
      signal: AbortSignal.timeout(45000),
    });
    for (const raw of response.headers.getSetCookie()) absorbCookie(raw);
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    assert.ok(text.length <= 40 * 1024 * 1024, 'HOST_RESPONSE_TOO_LARGE');
    let json = null;
    if (/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
      try { json = JSON.parse(text); } catch { throw new Error('HOST_JSON_INVALID'); }
    }
    const rawLocation = response.headers.get('location');
    const location = rawLocation ? new URL(rawLocation, origin) : null;
    // Never follow redirects. Only local Next may normalize 127.0.0.1 to localhost.
    if (location) {
      if (publicTarget) assert.equal(location.origin, origin.origin, 'HOST_REDIRECT_CROSS_ORIGIN');
      else {
        assert.equal(location.protocol, origin.protocol, 'HOST_REDIRECT_PROTOCOL');
        assert.equal(location.port, origin.port, 'HOST_REDIRECT_PORT');
        assert.ok(['127.0.0.1', 'localhost'].includes(location.hostname), 'HOST_REDIRECT_CROSS_ORIGIN');
      }
    }
    return {
      status: response.status, json, contentType,
      locationPath: location ? location.pathname + location.search : null,
      cacheControl: response.headers.get('cache-control'),
      htmlBytes: json ? null : Buffer.byteLength(text),
    };
  }

  async function login(actor) {
    verifyTarget();
    assert.equal(authenticatedUser, null, 'HOST_SESSION_ALREADY_AUTHENTICATED');
    assert.match(actor.email, /^office-[a-z0-9._+-]+@office-staging\.invalid$/);
    assert.equal(typeof actor.password, 'string', 'HOST_PASSWORD_REQUIRED');
    const signed = await supabase.auth.signInWithPassword({ email: actor.email, password: actor.password });
    assert.ok(!signed.error && signed.data.session, 'HOST_AUTH_LOGIN_REJECTED');
    const verified = await supabase.auth.getUser();
    assert.ok(!verified.error && verified.data.user?.id, 'HOST_AUTH_VERIFICATION_FAILED');
    assert.equal(verified.data.user.email?.toLowerCase(), actor.email.toLowerCase(), 'HOST_AUTH_IDENTITY_MISMATCH');
    assert.equal(verified.data.user.id, actor.userId, 'HOST_AUTH_ID_BINDING_MISMATCH');
    assert.equal(verified.data.user.app_metadata?.office_principal === 'ai', actor.principal === 'ai', 'HOST_AUTH_PRINCIPAL_MISMATCH');
    authenticatedUser = verified.data.user.id;
    assert.ok([...jar.keys()].some(name => sessionCookie.test(name)), 'HOST_SSR_COOKIE_MISSING');
    return { status: 200, protocol: 'Supabase password auth with actual Hub browser SSR cookie serializer' };
  }

  async function selectCompany(companyId) {
    verifyTarget();
    assert.ok(authenticatedUser, 'HOST_AUTH_REQUIRED');
    assert.match(companyId, UUID, 'HOST_COMPANY_ID_INVALID');
    const profileResult = await supabase.from('profiles').select('id,auth_user_id,user_id')
      .or('auth_user_id.eq.' + authenticatedUser + ',user_id.eq.' + authenticatedUser).limit(2);
    assert.equal(profileResult.error, null, 'HOST_PROFILE_LOOKUP_FAILED');
    const profile = profileResult.data?.find(p => p.auth_user_id === authenticatedUser)
      ?? profileResult.data?.find(p => p.user_id === authenticatedUser);
    assert.ok(profile?.id, 'HOST_PROFILE_REQUIRED');
    const membership = await supabase.from('company_members').select('id,company_id,profile_id,is_active,role')
      .eq('profile_id', profile.id).eq('company_id', companyId).eq('is_active', true).maybeSingle();
    assert.ok(!membership.error && membership.data?.id, 'HOST_ACTIVE_MEMBERSHIP_REQUIRED');
    assert.ok(['super_admin', 'company_admin', 'manager', 'worker', 'user'].includes(membership.data.role), 'HOST_OFFICE_ROLE_REQUIRED');
    // This is only the tenant preference; the host and RPC independently authorize it.
    absorbCookie(serialize('active_company_id', companyId, { path: '/', sameSite: 'lax', maxAge: 3600, secure: origin.protocol === 'https:' }));
    return { status: 200, companyId };
  }

  function upload({ tenantId, name, mime, bytes, idempotencyKey, parentId = null,
    originHeader = origin.origin, fetchSite = 'same-origin' }) {
    const body = new FormData();
    body.set('file', new Blob([bytes], { type: mime }), name);
    body.set('idempotencyKey', idempotencyKey);
    if (parentId) body.set('parentId', parentId);
    return request('/api/office/files', {
      method: 'POST',
      headers: { Origin: originHeader, 'Sec-Fetch-Site': fetchSite, 'X-Office-Tenant': tenantId },
      body,
    });
  }

  function exportFile({ tenantId, id, format }) {
    return request('/api/office/files?' + new URLSearchParams({ id, format }), {
      headers: { 'X-Office-Tenant': tenantId },
    });
  }

  return { request, login, selectCompany, upload, exportFile };
}
