import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOfficeRequestOrigin } from '../src/server/origin.ts';

const local = 'http://127.0.0.1:4332';
const live = 'https://office-staging.example.test';

function request({ origin = local, host = '127.0.0.1:4332', site = 'same-origin',
  url = 'http://localhost:4332/api/office/files', forwarded = {} } = {}) {
  const headers = new Headers(forwarded);
  if (origin !== null) headers.set('Origin', origin);
  if (host !== null) headers.set('Host', host);
  if (site !== null) headers.set('Sec-Fetch-Site', site);
  return new Request(url, { method: 'POST', headers });
}
const allowed = (req, configured = local) =>
  assert.doesNotThrow(() => assertOfficeRequestOrigin(req, configured));
const denied = (req, configured = local) =>
  assert.throws(() => assertOfficeRequestOrigin(req, configured), /^Error: OFFICE_FORBIDDEN$/);

test('NextURL localhost normalization does not change the public request origin', () => {
  const req = request();
  assert.equal(new URL(req.url).origin, 'http://localhost:4332');
  allowed(req);
});

test('same configured origin works with or without Fetch Metadata', () => {
  allowed(request());
  allowed(request({ site: null }));
  allowed(request({ host: 'OFFICE-STAGING.EXAMPLE.TEST', origin: live }), live);
});

test('explicit localhost and IPv6 loopback deployments remain distinct origins', () => {
  allowed(request({ origin: 'http://localhost:4332', host: 'localhost:4332' }), 'http://localhost:4332');
  allowed(request({ origin: 'http://[::1]:4332', host: '[::1]:4332' }), 'http://[::1]:4332');
  denied(request({ origin: 'http://localhost:4332' }));
  denied(request({ origin: 'http://localhost:4332', host: 'localhost:4332' }));
  denied(request({ origin: 'http://127.0.0.2:4332', host: '127.0.0.2:4332' }));
});

test('unknown Host or a matching forged Host/Origin pair cannot choose the trust target', () => {
  denied(request({ host: 'attacker.example' }));
  denied(request({ host: 'attacker.example', origin: 'https://attacker.example' }));
  denied(request({ host: 'office-staging.example.test.attacker.example', origin: live }), live);
  denied(request({ host: null }));
  denied(request({ host: '127.0.0.1:4332,attacker.example' }));
  denied(request({ host: '127.0.0.1:4332@attacker.example' }));
});

test('cross-site, same-site and contradictory Fetch Metadata are rejected', () => {
  for (const site of ['cross-site', 'same-site', 'none', 'same-origin, cross-site', 'invalid']) {
    denied(request({ site }));
  }
  denied(request({ origin: 'https://attacker.example', site: 'same-origin' }));
});

test('missing, opaque or noncanonical origins and port/scheme mismatches are rejected', () => {
  for (const origin of [
    null, 'null', local + '/', local + '/path', local + '?q=1', local + '#fragment',
    'http://user:pass@127.0.0.1:4332', local + ' https://attacker.example',
    'http://127.0.0.1:4333', 'https://127.0.0.1:4332',
  ]) denied(request({ origin }));
});

test('TLS termination works with configured HTTPS and preserved public Host', () => {
  allowed(request({
    url: 'http://internal-proxy:3000/api/office/files',
    origin: live, host: 'office-staging.example.test',
    forwarded: { 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'attacker.example' },
  }), live);
});

test('forwarded headers cannot repair a forged request or internal Host rewrite', () => {
  denied(request({
    origin: 'https://attacker.example', host: 'attacker.example',
    forwarded: { 'X-Forwarded-Host': 'office-staging.example.test', 'X-Forwarded-Proto': 'https' },
  }), live);
  denied(request({
    origin: live, host: 'internal-proxy:3000',
    forwarded: { 'X-Forwarded-Host': 'office-staging.example.test', 'X-Forwarded-Proto': 'https' },
  }), live);
});

test('missing or unsafe deployment origin fails closed', () => {
  for (const configured of [
    undefined, '', 'not a URL', 'http://office-staging.example.test', 'ftp://example.test',
    'https://user:pass@example.test', live + '/path', live + '?q=1', live + '#fragment',
  ]) {
    assert.throws(() => assertOfficeRequestOrigin(request(), configured),
      /^Error: OFFICE_ORIGIN_CONFIGURATION$/);
  }
});
