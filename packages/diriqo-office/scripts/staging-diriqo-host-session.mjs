/**
 * Proposed Diriqo host HTTP helper; importing this file performs no I/O.
 * Caller must have verified the staging target, rebuilt/started ONLY the clone
 * with staging NEXT_PUBLIC_SUPABASE_URL/ANON_KEY and DIRIQO_MODULE_BILLING_MODE=test.
 * Fresh auth cookies are issued by the real host /auth/sign-in route.
 * No token fabrication, installations, service-role key, auto redirects or logging.
 */
import assert from 'node:assert/strict';
import { assertHostSessionTarget } from './staging-public-target.mjs';

export function createDiriqoHostSession({ baseOrigin, expectedProjectRef, publicTarget }) {
  const verifyTarget = () => assertHostSessionTarget({ host: 'diriqo', baseOrigin, expectedProjectRef, publicTarget });
  const origin = verifyTarget();
  assert.equal(typeof Headers.prototype.getSetCookie, 'function', 'NODE_GET_SET_COOKIE_REQUIRED');

  const jar = new Map();
  const sessionCookie = new RegExp('^sb-' + expectedProjectRef + '-auth-token(?:\\.\\d+)?$');

  function absorb(response) {
    for (const raw of response.headers.getSetCookie()) {
      const [first, ...rest] = raw.split(';');
      const equal = first.indexOf('=');
      assert.ok(equal > 0, 'HOST_SET_COOKIE_INVALID');
      const name = first.slice(0, equal).trim();
      const value = first.slice(equal + 1); // Preserve wire encoding; never decode a JWT.
      assert.match(name, /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, 'HOST_COOKIE_NAME_INVALID');
      const attrs = new Map(rest.map(part => {
        const index = part.indexOf('=');
        return index < 0
          ? [part.trim().toLowerCase(), '']
          : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()];
      }));
      assert.equal(attrs.get('path') ?? '/', '/', 'HOST_COOKIE_PATH_UNEXPECTED');
      const domain = attrs.get('domain')?.replace(/^\./, '');
      assert.ok(!domain || domain === origin.hostname, 'HOST_COOKIE_DOMAIN_UNEXPECTED');
      if (name.startsWith('sb-')) assert.ok(sessionCookie.test(name), 'HOST_COOKIE_PROJECT_MISMATCH');
      const maxAge = attrs.has('max-age') ? Number(attrs.get('max-age')) : null;
      const expires = maxAge !== null
        ? Date.now() + maxAge * 1000
        : attrs.has('expires') ? Date.parse(attrs.get('expires')) : Infinity;
      assert.ok(expires === Infinity || Number.isFinite(expires), 'HOST_COOKIE_EXPIRY_INVALID');
      if (!value || expires <= Date.now()) jar.delete(name);
      else jar.set(name, { value, expires, secure: attrs.has('secure') });
    }
  }

  async function request(path, { method = 'GET', headers = {}, body } = {}) {
    verifyTarget();
    assert.ok(path.startsWith('/') && !path.startsWith('//'), 'HOST_PATH_INVALID');
    const url = new URL(path, origin);
    assert.equal(url.origin, origin.origin, 'HOST_CROSS_ORIGIN_BLOCKED');
    const requestHeaders = new Headers(headers);
    assert.ok(!requestHeaders.has('authorization'), 'HOST_BEARER_BYPASS_BLOCKED');
    assert.ok(!requestHeaders.has('cookie'), 'HOST_COOKIE_OVERRIDE_BLOCKED');
    for (const name of ['host', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto']) assert.ok(!requestHeaders.has(name), 'HOST_ROUTING_OVERRIDE_BLOCKED');
    const cookies = [...jar].filter(([, item]) =>
      item.expires > Date.now() && (!item.secure || origin.protocol === 'https:'));
    if (cookies.length) requestHeaders.set('Cookie', cookies.map(([name, item]) =>
      name + '=' + item.value).join('; '));
    const response = await fetch(url, {
      method, headers: requestHeaders, body, redirect: 'manual',
      signal: AbortSignal.timeout(45000),
    });
    absorb(response);
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    assert.ok(text.length <= 40 * 1024 * 1024, 'HOST_RESPONSE_TOO_LARGE');
    let json = null;
    if (/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
      try { json = JSON.parse(text); } catch { throw new Error('HOST_JSON_INVALID'); }
    }
    const rawLocation = response.headers.get('location');
    const location = rawLocation ? new URL(rawLocation, origin) : null;
    if (location) assert.equal(location.origin, origin.origin, 'HOST_REDIRECT_CROSS_ORIGIN');
    // Never include Set-Cookie, response body or request credentials in reports.
    return {
      status: response.status, json, contentType,
      locationPath: location ? location.pathname + location.search : null,
      cacheControl: response.headers.get('cache-control'),
      htmlBytes: json ? null : Buffer.byteLength(text),
    };
  }

  async function login(actor) {
    verifyTarget();
    assert.match(actor.email, /^office-[a-z0-9._+-]+@office-staging\.invalid$/);
    const result = await request('/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin.origin },
      body: JSON.stringify({ email: actor.email, password: actor.password }),
    });
    assert.equal(result.status, 200, 'HOST_LOGIN_REJECTED');
    assert.equal(result.json?.ok, true, 'HOST_LOGIN_FAILED');
    assert.ok([...jar.keys()].some(name => sessionCookie.test(name)), 'HOST_SSR_COOKIE_MISSING');
    assert.equal(result.cacheControl, 'no-store', 'HOST_LOGIN_CACHE');
    // /onboarding is a legitimate post-login destination for a fresh test identity.
    return { status: result.status, redirectTo: result.json.redirectTo };
  }

  async function selectCompany(companyId) {
    // Current route is owner/admin-only; do not call this for manager/worker.
    const result = await request('/api/active-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin.origin },
      body: JSON.stringify({ companyId }),
    });
    assert.equal(result.status, 200, 'HOST_COMPANY_SWITCH_REJECTED');
    assert.equal(result.json?.companyId, companyId, 'HOST_COMPANY_SWITCH_MISMATCH');
    assert.equal(jar.get('active_company_id')?.value, companyId, 'HOST_ACTIVE_COOKIE_MISSING');
    return { status: result.status, companyId };
  }

  async function upload({ tenantId, name, mime, bytes, idempotencyKey, parentId = null,
    originHeader = origin.origin, fetchSite = 'same-origin' }) {
    const body = new FormData();
    body.set('file', new Blob([bytes], { type: mime }), name);
    body.set('idempotencyKey', idempotencyKey);
    if (parentId) body.set('parentId', parentId);
    return request('/api/office/files', {
      method: 'POST',
      headers: {
        Origin: originHeader, 'Sec-Fetch-Site': fetchSite, 'X-Office-Tenant': tenantId,
      },
      body, // Let native fetch set the multipart boundary and content length.
    });
  }

  function exportFile({ tenantId, id, format }) {
    const params = new URLSearchParams({ id, format });
    return request('/api/office/files?' + params, {
      headers: { 'X-Office-Tenant': tenantId },
    });
  }

  return { request, login, selectCompany, upload, exportFile };
}
