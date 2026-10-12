import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { runIsolationTests } from '../scripts/staging-isolation.mjs';
import { OfficeService } from '../src/server/service.ts';
import { MemoryStore } from '../src/server/store.ts';

function fixture({ allowForgedTenant = false } = {}) {
  const service = new OfficeService(new MemoryStore()), tenantA = randomUUID(), tenantB = randomUUID();
  const actors = {}, identities = new Map();
  for (const name of ['ownerA', 'editorA', 'readerA', 'ownerB', 'editorB', 'readerB', 'aiA']) {
    const identity = { tenantId: name.endsWith('B') ? tenantB : tenantA, actorId: randomUUID(), role: name.startsWith('owner') ? 'owner' : name.startsWith('reader') ? 'reader' : 'editor', enabled: true, principal: name === 'aiA' ? 'ai' : 'human' };
    const credential = randomUUID(); identities.set(credential, identity);
    actors[name] = { tenantId: identity.tenantId, principal: identity.principal, credential };
  }
  let calls = 0;
  const request = async (actor, body) => {
    calls++;
    const identity = identities.get(actor.credential);
    if (!identity || (!allowForgedTenant && identity.tenantId !== actor.tenantId)) return { data: null, status: 403, errorCode: 'FORBIDDEN' };
    const authenticated = { ...identity, tenantId: actor.tenantId, principal: identity.principal === 'ai' ? 'ai' : actor.principal };
    try {
      let data;
      if (body.op === 'original') {
        const original = await service.original(authenticated, body.id);
        data = { name: original.name, mime: original.mime, base64: Buffer.from(original.bytes).toString('base64') };
      } else if (body.op === 'import') {
        const bytes = Buffer.from(body.original.base64, 'base64');
        if (bytes.length !== body.original.size || createHash('sha256').update(bytes).digest('hex') !== body.original.sha256) return { data: null, status: 400, errorCode: 'INVALID_ORIGINAL' };
        data = await service.import(authenticated, { ...body, original: { ...body.original, bytes } });
      } else data = await service.request(authenticated, body);
      return { data, status: 200, errorCode: null };
    } catch (error) { return { data: null, status: error.status ?? 500, errorCode: error.code ?? 'UNEXPECTED' }; }
  };
  return { request, actors, calls: () => calls };
}

test('staging runner exercises authenticated in-memory contract; this is not remote staging proof', async () => {
  const setup = fixture(), observed = [];
  const report = await runIsolationTests({ ...setup, check: async (name, passed) => { observed.push(name); assert.equal(passed, true, name); } });
  assert.equal(report.requests, setup.calls());
  assert.equal(report.passed, observed.length);
  assert.ok(report.passed > 100);
  assert.equal(report.artifacts.length, 7);
  assert.equal(report.concurrency.length, 2);
  assert.ok(report.concurrency.every(x => x.winners === 1 && x.conflicts === 1));
  assert.equal(report.skipped[0].name, 'job/customer links');
  assert.ok(!JSON.stringify(report).includes('credential'));
});

test('runner fails closed when the transport allows a forged tenant scope', async () => {
  const setup = fixture({ allowForgedTenant: true });
  await assert.rejects(runIsolationTests({ ...setup, check: async () => {} }), /STAGING_ASSERTION_FAILED: ownerA forged tenant list/);
});

test('runner detects two successful writes at the same revision', async () => {
  const setup = fixture();
  const request = async (actor, body) => {
    const result = await setup.request(actor, body);
    if (body.op === 'save' && result.errorCode === 'CONFLICT') return { data: {}, status: 200, errorCode: null };
    return result;
  };
  await assert.rejects(runIsolationTests({ request, actors: setup.actors, check: async () => {} }), /STAGING_ASSERTION_FAILED: document concurrent CAS has one winner/);
});

test('an error response must not expose another tenant permissions or contents', async () => {
  const setup = fixture();
  const request = async (actor, body) => {
    const result = await setup.request(actor, body);
    if (result.errorCode === 'NOT_FOUND') return { ...result, data: { permissions: { ownerId: 'foreign-profile' } } };
    return result;
  };
  await assert.rejects(runIsolationTests({ request, actors: setup.actors, check: async () => {} }), /STAGING_ASSERTION_FAILED: ownerA foreign read/);
});

test('invalid actor configuration cannot issue requests', async () => {
  const setup = fixture();
  setup.actors.ownerB.tenantId = setup.actors.ownerA.tenantId;
  await assert.rejects(runIsolationTests({ ...setup, check: async () => {} }), /Two distinct staging tenants/);
  assert.equal(setup.calls(), 0);
});
