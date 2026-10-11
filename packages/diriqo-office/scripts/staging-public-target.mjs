/**
 * Public HTTP tests use only the operator-reviewed READY deployment manifest.
 * No network lookup or environment/URL override. Review metadata through Vercel
 * before writing reports/public-staging-targets.json; this is not an attestation.
 */
import { validateTarget } from './staging-target.mjs';

const EXPECTED = Object.freeze({
  hub: Object.freeze({ projectId: 'prj_TWypfvehBvtM51pUQXBaF4KUJU7w', projectName: 'office-staging-hub', projectRef: 'amuhcvnvubsrvsfclqtg' }),
  diriqo: Object.freeze({ projectId: 'prj_bIzIYwBQAMhxZbJEmMSl8TISSOnW', projectName: 'office-staging-diriqo', projectRef: 'pkjzoplczxqqmmstnqgy' }),
});
const TEAM = 'team_T3CmcoBW7Z2p1EeDWreh7ZyV';
// Vercel may shorten generated hostnames. Each exact reviewed deployment stays
// tied to its existing expected Hub project, branch and READY manifest checks.
const REVIEWED_GENERATED_ORIGINS = Object.freeze({
  hub: Object.freeze([
    Object.freeze({ deploymentId: 'dpl_3CusNPbtk7BLPkidaNL7k2XKGN7W', origin: 'https://office-staging-bnp1tlyrl-jspdholding-7510s-projects.vercel.app' }),
    Object.freeze({ deploymentId: 'dpl_5tzz4nco4XseNWuk9raShR2H1S6L', origin: 'https://office-staging-712fy2h57-jspdholding-7510s-projects.vercel.app' }),
    Object.freeze({ deploymentId: 'dpl_AhzzQw6qDKuDyMm98kzr7FwxyNdv', origin: 'https://office-staging-nyf1c56p4-jspdholding-7510s-projects.vercel.app' }),
  ]),
});
const PRODUCTION = new Set(['yrxfozthravgbbcqklzy', 'wfcpfraxiuhuglnuaxqj']);
const DAY = 24 * 60 * 60 * 1000;
const FUTURE = 5 * 60 * 1000;
const capabilities = new WeakMap();
function fail(message) {
  const error = new Error('Unsafe public staging target: ' + message);
  error.code = 'UNSAFE_PUBLIC_STAGING_TARGET';
  throw error;
}
function record(value, allowed, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(label + ' must be a plain record');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail(label + ' contains an unexpected field');
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value')) fail(label + ' contains an accessor');
  }
  for (const key of required) if (!Object.hasOwn(value, key)) fail(label + ' is missing ' + key);
}
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) fail('timestamp must be UTC ISO');
  const result = Date.parse(value), normalized = value.length === 20 ? value.slice(0, -1) + '.000Z' : value;
  if (!Number.isFinite(result) || new Date(result).toISOString() !== normalized) fail('invalid calendar timestamp');
  return result;
}
function fresh(verified, expires, now) {
  if (!Number.isSafeInteger(now) || now < 0) fail('invalid clock');
  if (now - verified >= DAY || verified - now > FUTURE) fail('verification must be less than 24 hours old');
  if (expires <= now) fail('staging authorization has expired');
}
function publicOrigin(value, host, deploymentId) {
  let url;
  try { url = new URL(value); } catch { fail('invalid deployment origin'); }
  const reviewed = REVIEWED_GENERATED_ORIGINS[host];
  const exactGenerated = reviewed?.some(item => item.origin === value && item.deploymentId === deploymentId) === true;
  if (typeof value !== 'string' || url.origin !== value || url.protocol !== 'https:'
    || url.username || url.password || url.port
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(url.hostname)
    || (!url.hostname.startsWith(EXPECTED[host].projectName + '-') && !exactGenerated)) fail('expected the reviewed bare Vercel deployment origin');
  return value;
}

export function validatePublicHostTarget(manifest, stagingManifest, host, { now = Date.now() } = {}) {
  if (!Object.hasOwn(EXPECTED, host)) fail('unknown host');
  const target = validateTarget(stagingManifest, host, { now });
  record(manifest, ['schemaVersion', 'teamId', 'expiresAt', 'budgetUsd', 'hourlyPerBranchUsd', 'hosts'],
    ['schemaVersion', 'teamId', 'expiresAt', 'hosts'], 'manifest');
  if (manifest.schemaVersion !== 1 || manifest.teamId !== TEAM) fail('wrong schema or Vercel team');
  record(manifest.hosts, ['hub', 'diriqo'], [host], 'hosts');
  const fields = ['projectId', 'projectName', 'projectRef', 'origin', 'deploymentId', 'state', 'verifiedAt'];
  const source = manifest.hosts[host], expected = EXPECTED[host];
  record(source, fields, fields, 'deployment');
  if (source.projectId !== expected.projectId || source.projectName !== expected.projectName) fail('wrong Vercel project');
  if (PRODUCTION.has(source.projectRef) || source.projectRef !== expected.projectRef
    || source.projectRef !== target.projectRef) fail('wrong Supabase staging branch');
  if (source.state !== 'READY' || typeof source.deploymentId !== 'string'
    || !/^dpl_[A-Za-z0-9]+$/.test(source.deploymentId)) fail('deployment has no reviewed READY identity');
  const origin = publicOrigin(source.origin, host, source.deploymentId);
  const verified = time(source.verifiedAt), branchVerified = time(stagingManifest.hosts[host].verifiedAt), expires = time(manifest.expiresAt);
  fresh(verified, expires, now); fresh(branchVerified, expires, now);
  const result = Object.freeze({
    host, origin, projectRef: target.projectRef, projectId: expected.projectId,
    deploymentId: source.deploymentId, state: 'READY', verifiedAt: source.verifiedAt,
    expiresAt: manifest.expiresAt, branchId: target.branchId,
  });
  capabilities.set(result, { verified, branchVerified, expires });
  return result;
}

/** Rechecked before constructor, login and every request; a copied/forged object is insufficient. */
export function assertHostSessionTarget({ host, baseOrigin, expectedProjectRef, publicTarget }, { now = Date.now() } = {}) {
  if (!Object.hasOwn(EXPECTED, host)) fail('unknown host');
  if (typeof expectedProjectRef !== 'string' || !/^[a-z]{20}$/.test(expectedProjectRef) || PRODUCTION.has(expectedProjectRef)) fail('invalid or production project reference');
  let origin;
  try { origin = new URL(baseOrigin); } catch { fail('invalid host origin'); }
  if (typeof baseOrigin !== 'string' || origin.origin !== baseOrigin || origin.username || origin.password) fail('host origin must be bare');
  if (publicTarget !== undefined) {
    const metadata = publicTarget && capabilities.get(publicTarget);
    if (!metadata || publicTarget.host !== host || publicTarget.origin !== baseOrigin
      || publicTarget.projectRef !== expectedProjectRef) fail('public session requires the matching validated deployment capability');
    fresh(metadata.verified, metadata.expires, now); fresh(metadata.branchVerified, metadata.expires, now);
    publicOrigin(baseOrigin, host, publicTarget.deploymentId);
  } else if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') {
    fail('public host requires an explicitly validated public target; local mode is loopback only');
  }
  return origin;
}
