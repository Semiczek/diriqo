import { performance } from 'node:perf_hooks';

const PRODUCTION_REFS = new Set(['wfcpfraxiuhuglnuaxqj', 'yrxfozthravgbbcqklzy']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JSON_TYPE = /^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 26_000_000;
const TIMEOUT_MS = 20_000;
const OFFICE_OPS = new Set(['list', 'listFiles', 'read', 'versions', 'listVersions', 'readVersion', 'proposals', 'listProposals', 'readProposal', 'permissions', 'create', 'save', 'copy', 'restore', 'delete', 'rename', 'move', 'link', 'propose', 'approve', 'reject', 'import', 'original', 'recordExport']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class StagingTransportError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'StagingTransportError';
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status = 0) => { throw new StagingTransportError(code, status); };

function decodeJwt(token) {
  if (typeof token !== 'string' || token.length > 32_768) fail('STAGING_INVALID_TOKEN');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) fail('STAGING_INVALID_TOKEN');
  try {
    const decode = part => {
      const bytes = Buffer.from(part, 'base64url');
      if (bytes.toString('base64url') !== part) fail('STAGING_INVALID_TOKEN');
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!record(value)) fail('STAGING_INVALID_TOKEN');
      return value;
    };
    const header = decode(parts[0]), payload = decode(parts[1]);
    if (typeof header.alg !== 'string' || header.alg.toLowerCase() === 'none') fail('STAGING_INVALID_TOKEN');
    return payload;
  } catch { fail('STAGING_INVALID_TOKEN'); }
}

function accessClaims(token, userId, origin) {
  const claims = decodeJwt(token);
  if (claims.iss !== origin + '/auth/v1' || claims.sub !== userId || claims.role !== 'authenticated'
    || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) fail('STAGING_TOKEN_BINDING_FAILED');
  return claims;
}

function publicKey(key, projectRef) {
  if (typeof key !== 'string' || key.length > 32_768) fail('STAGING_INVALID_PUBLISHABLE_KEY');
  if (/^sb_publishable_[A-Za-z0-9_-]{16,200}$/.test(key)) return key;
  try {
    const claims = decodeJwt(key);
    if (claims.role !== 'anon' || claims.ref !== projectRef || !Number.isSafeInteger(claims.exp)
      || claims.exp <= Math.floor(Date.now() / 1000)) fail('STAGING_INVALID_PUBLISHABLE_KEY');
    return key;
  } catch { fail('STAGING_INVALID_PUBLISHABLE_KEY'); }
}

export function validateCredentials(credentials) {
  if (!record(credentials)) fail('STAGING_INVALID_CREDENTIALS');
  const { email, password, userId, tenantId, principal, label } = credentials;
  if (typeof email !== 'string' || !/^office-[A-Za-z0-9][A-Za-z0-9._+-]{0,100}@office-staging\.invalid$/.test(email)
    || typeof password !== 'string' || password.length < 16 || password.length > 1024
    || typeof userId !== 'string' || !UUID.test(userId) || typeof tenantId !== 'string' || !UUID.test(tenantId)
    || !['human', 'ai'].includes(principal) || typeof label !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(label)) fail('STAGING_INVALID_CREDENTIALS');
  return Object.freeze({ email: email.toLowerCase(), password, userId: userId.toLowerCase(), tenantId: tenantId.toLowerCase(), principal, label });
}

async function boundedJson(response) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => {});
    fail('RESPONSE_TOO_LARGE', response.status);
  }
  if (!JSON_TYPE.test(response.headers.get('content-type') ?? '') || !response.body) fail('INVALID_RESPONSE', response.status);
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) fail('INVALID_RESPONSE', response.status);
      length += part.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => {}); fail('RESPONSE_TOO_LARGE', response.status); }
      chunks.push(part.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)));
  } catch (error) {
    if (error instanceof StagingTransportError) throw error;
    fail('INVALID_RESPONSE', response.status);
  } finally { reader.releaseLock(); }
}

function officeError(body, status) {
  if (record(body) && body.code === 'P0001' && typeof body.message === 'string' && body.message.length <= 8192) {
    try {
      const parsed = JSON.parse(body.message);
      if (record(parsed) && typeof parsed.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(parsed.code)) return parsed.code.replace(/^OFFICE_/, '');
    } catch { /* Do not expose an upstream error message. */ }
  }
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  return 'HTTP_ERROR';
}

/**
 * No implicit login, retries, refreshes or URL overrides. The orchestrator must
 * separately prove that this ref belongs to its authorized disposable branch.
 * JWT claims are checked locally; /auth/v1/user and PostgREST verify signatures.
 */
export function createStagingTransport({ target, publishableKey, fetchImpl = globalThis.fetch, onRequest = () => {}, timeoutMs = TIMEOUT_MS } = {}) {
  if (!record(target) || !Object.isFrozen(target) || typeof target.projectRef !== 'string'
    || !/^[a-z0-9]{20}$/.test(target.projectRef) || PRODUCTION_REFS.has(target.projectRef)
    || target.origin !== 'https://' + target.projectRef + '.supabase.co') fail('STAGING_INVALID_TARGET');
  if (typeof fetchImpl !== 'function' || typeof onRequest !== 'function') fail('STAGING_INVALID_CALLBACK');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) fail('STAGING_INVALID_TIMEOUT');
  const origin = target.origin, key = publicKey(publishableKey, target.projectRef);

  async function perform(path, options, meta, interpret) {
    // Capture the request interval before fetch. Interval overlap is evidence of
    // concurrent HTTP requests, not proof of a particular database lock schedule.
    const startedAt = new Date().toISOString(), started = performance.now(), controller = new AbortController();
    let status = 0, errorCode = null, expired = false, timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { expired = true; controller.abort(); reject(new StagingTransportError('TRANSPORT_TIMEOUT', status)); }, timeoutMs); });
    try {
      return await Promise.race([(async () => {
        const response = await fetchImpl(origin + path, { ...options, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
        status = Number.isInteger(response?.status) ? response.status : 0;
        if (!status || response.redirected || (status >= 300 && status < 400)
          || (response.url && response.url !== origin + path)) fail('REDIRECT_NOT_ALLOWED', status);
        const parsed = await boundedJson(response);
        const result = interpret(status, parsed);
        errorCode = result?.errorCode ?? null;
        return result;
      })(), timeout]);
    } catch (error) {
      const safe = error instanceof StagingTransportError ? error : new StagingTransportError(expired || error?.name === 'TimeoutError' ? 'TRANSPORT_TIMEOUT' : 'TRANSPORT_FAILED', status);
      errorCode = safe.code;
      throw safe;
    } finally {
      clearTimeout(timer); controller.abort();
      const event = Object.freeze({ label: meta.label, op: meta.op, tenantId: meta.tenantId,
        ...(typeof meta.fileId === 'string' && UUID.test(meta.fileId) ? { fileId: meta.fileId } : {}),
        status, errorCode, startedAt, elapsedMs: Math.max(0, Math.round(performance.now() - started)) });
      try { await onRequest(event); } catch { fail('STAGING_OBSERVER_FAILED', status); }
    }
  }

  async function login(credentials) {
    const clean = validateCredentials(credentials);
    const token = await perform('/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: clean.email, password: clean.password }),
    }, { label: clean.label, tenantId: clean.tenantId, op: 'login' }, (status, body) => {
      if (status < 200 || status >= 300 || !record(body) || typeof body.access_token !== 'string') fail('AUTH_LOGIN_FAILED', status);
      const claims = accessClaims(body.access_token, clean.userId, origin);
      if ((claims.app_metadata?.office_principal === 'ai') !== (clean.principal === 'ai')) fail('STAGING_PRINCIPAL_BINDING_FAILED', status);
      return body.access_token;
    });
    await perform('/auth/v1/user', { method: 'GET', headers: { apikey: key, Authorization: 'Bearer ' + token, Accept: 'application/json' } }, { label: clean.label, tenantId: clean.tenantId, op: 'auth-user' }, (status, user) => {
      if (status < 200 || status >= 300 || !record(user) || user.id !== clean.userId || typeof user.email !== 'string' || user.email.toLowerCase() !== clean.email) fail('STAGING_USER_BINDING_FAILED', status);
      if ((user.app_metadata?.office_principal === 'ai') !== (clean.principal === 'ai')) fail('STAGING_PRINCIPAL_BINDING_FAILED', status);
      return user;
    });
    return Object.freeze({ label: clean.label, userId: clean.userId, tenantId: clean.tenantId, principal: clean.principal, accessToken: token });
  }

  async function request(actor, body) {
    if (!record(actor) || typeof actor.userId !== 'string' || !UUID.test(actor.userId)
      || typeof actor.tenantId !== 'string' || !UUID.test(actor.tenantId) || !['human', 'ai'].includes(actor.principal)
      || typeof actor.label !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(actor.label)) fail('STAGING_INVALID_ACTOR');
    accessClaims(actor.accessToken, actor.userId, origin);
    if (!record(body)) fail('STAGING_INVALID_REQUEST');
    let serialized;
    try { serialized = JSON.stringify({ p_company_id: actor.tenantId, p_request: body, p_principal: actor.principal }); } catch { fail('STAGING_INVALID_REQUEST'); }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BYTES) fail('STAGING_REQUEST_TOO_LARGE');
    try {
      return await perform('/rest/v1/rpc/office_request', {
        method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + actor.accessToken, 'Content-Type': 'application/json', Accept: 'application/json' }, body: serialized,
      }, { label: actor.label, tenantId: actor.tenantId, op: OFFICE_OPS.has(body.op) ? body.op : 'unknown', fileId: typeof body.id === 'string' && UUID.test(body.id) ? body.id : undefined }, (status, data) => {
        if (status < 200 || status >= 300) return { data: null, status, errorCode: officeError(data, status) };
        if (!record(data)) fail('INVALID_RESPONSE', status);
        return { data, status, errorCode: null };
      });
    } catch (error) {
      if (error instanceof StagingTransportError && error.code !== 'STAGING_OBSERVER_FAILED') return { data: null, status: error.status, errorCode: error.code };
      throw error;
    }
  }
  return Object.freeze({ login, request });
}
