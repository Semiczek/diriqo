import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const document = text => ({ schemaVersion: 1, kind: 'document', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, page: { marginMm: 20, header: '', footer: '' } });
const spreadsheet = value => ({ schemaVersion: 1, kind: 'spreadsheet', workbook: { id: 'staging-book', name: 'Staging workbook', sheetOrder: ['input', 'summary'], styles: {}, sheets: {
  input: { id: 'input', name: 'Input', rowCount: 20, columnCount: 10, cellData: { 0: { 0: { v: value, t: 2 }, 1: { v: 20, t: 2 }, 2: { f: '=SUM(A1:B1)', v: value + 20, t: 2 } } } },
  summary: { id: 'summary', name: 'Summary', rowCount: 20, columnCount: 10, cellData: { 0: { 0: { f: '=Input!C1', v: value + 20, t: 2 } } } },
} } });
const code = result => typeof result?.errorCode === 'string' ? result.errorCode.replace(/^OFFICE_/, '') : '';
const succeeded = result => Number.isInteger(result?.status) && result.status >= 200 && result.status < 300 && !code(result);

/**
 * Explicitly invoked, transport-injected staging tests. This module does not read
 * credentials, select a Supabase project, make network requests, or clean up data.
 * The orchestrator MUST verify a disposable staging branch before passing request.
 * Actor credentials stay opaque; request maps actor.tenantId / principal to RPC args.
 * Created documents remain identified in the report for branch-level cleanup.
 */
export async function runIsolationTests({ request, actors, check }) {
  if (typeof request !== 'function' || typeof check !== 'function') throw new TypeError('request and check callbacks are required');
  const roles = { ownerA: 'owner', editorA: 'editor', readerA: 'reader', ownerB: 'owner', editorB: 'editor', readerB: 'reader', aiA: 'editor' };
  for (const name of Object.keys(roles)) {
    const actor = actors?.[name];
    if (!actor || typeof actor.tenantId !== 'string' || !actor.tenantId || actor.principal !== (name === 'aiA' ? 'ai' : 'human')) throw new TypeError('Invalid staging actor: ' + name);
  }
  const tenantA = actors.ownerA.tenantId, tenantB = actors.ownerB.tenantId;
  if (tenantA === tenantB) throw new TypeError('Two distinct staging tenants are required');
  for (const name of Object.keys(roles)) if (actors[name].tenantId !== (name.endsWith('B') ? tenantB : tenantA)) throw new TypeError('Actor tenant mismatch: ' + name);

  const runId = randomUUID(), prefix = 'Office staging ' + runId;
  const artifacts = [], checks = [], concurrency = [];
  let requests = 0;
  const note = async (name, passed, detail = {}) => {
    const entry = { name, passed: passed === true, ...detail };
    checks.push(entry);
    await check(name, entry.passed, detail);
    if (!entry.passed) throw new Error('STAGING_ASSERTION_FAILED: ' + name);
  };
  const send = async (actor, body) => {
    if (++requests > 240) throw new Error('STAGING_REQUEST_BUDGET_EXCEEDED');
    return request(actor, structuredClone(body));
  };
  const ok = async (name, actor, body) => {
    const result = await send(actor, body);
    await note(name, succeeded(result) && result.data !== null && typeof result.data === 'object', { status: result?.status, errorCode: code(result) });
    return result.data;
  };
  const denied = async (name, actor, body, expected) => {
    const result = await send(actor, body);
    const noContent = !result?.data || !['file', 'files', 'versions', 'proposal', 'proposals', 'permissions', 'original', 'base64', 'content', 'doc', 'workbook'].some(key => Object.hasOwn(result.data, key));
    await note(name, Number.isInteger(result?.status) && result.status >= 400 && code(result) === expected && noContent, { status: result?.status, errorCode: code(result), expected });
  };
  const mutation = (op, values) => ({ op, ...values, idempotencyKey: randomUUID() });
  const track = file => { artifacts.push({ id: file.id, tenantId: file.tenantId, kind: file.kind }); return file; };
  const create = async (name, actor, content) => {
    const result = await ok(name, actor, mutation('create', { kind: content.kind, title: prefix + ' ' + name, content }));
    await note(name + ' shape', typeof result.file?.id === 'string' && result.file.tenantId === actor.tenantId && result.file.kind === content.kind && result.file.revision === 1 && isDeepStrictEqual(result.file.content, content), { fileId: result.file?.id, tenantId: actor.tenantId });
    return track(result.file);
  };

  await note('staging isolation run initialized', true, { runId, prefix });
  const originalA = document(prefix + ' A private document'), originalB = document(prefix + ' B private document');
  let docA = await create('A document', actors.ownerA, originalA);
  const docB = await create('B document', actors.ownerB, originalB);
  let sheetA = await create('A spreadsheet', actors.editorA, spreadsheet(10));
  const sheetB = await create('B spreadsheet', actors.editorB, spreadsheet(50));

  for (const [name, actor] of Object.entries(actors).filter(([name]) => Object.hasOwn(roles, name))) {
    const own = name.endsWith('B') ? [docB, sheetB] : [docA, sheetA];
    for (const file of own) {
      const result = await ok(name + ' own ' + file.kind + ' read', actor, { op: 'read', id: file.id });
      await note(name + ' own ' + file.kind + ' content', isDeepStrictEqual(result.file?.content, file.content) && result.file?.tenantId === actor.tenantId);
    }
    const result = await ok(name + ' permissions', actor, { op: 'permissions', id: own[0].id });
    await note(name + ' permission role', result.permissions?.role === roles[name] && result.permissions?.canWrite === (roles[name] !== 'reader'));
  }

  for (const [name, actor] of Object.entries(actors).filter(([name]) => Object.hasOwn(roles, name))) {
    const foreign = name.endsWith('B') ? docA : docB;
    for (const op of ['read', 'versions', 'proposals', 'permissions', 'original']) await denied(name + ' foreign ' + op, actor, { op, id: foreign.id }, 'NOT_FOUND');
    const foreignSheet = name.endsWith('B') ? sheetA : sheetB;
    for (const op of ['read', 'versions']) await denied(name + ' foreign spreadsheet ' + op, actor, { op, id: foreignSheet.id }, 'NOT_FOUND');
    const listing = await ok(name + ' isolated list', actor, { op: 'list', query: prefix });
    await note(name + ' list scope and summaries', Array.isArray(listing.files) && listing.files.length === 2 && listing.files.every(file => file.tenantId === actor.tenantId && file.content === null && file.id !== foreign.id));
    if (name !== 'aiA') {
      const forged = { ...actor, tenantId: foreign.tenantId };
      await denied(name + ' forged tenant list', forged, { op: 'list' }, 'FORBIDDEN');
      await denied(name + ' forged tenant read', forged, { op: 'read', id: foreign.id }, 'FORBIDDEN');
    }
  }

  for (const [suffix, file] of [['A', docA], ['B', docB]]) {
    const reader = actors['reader' + suffix], editor = actors['editor' + suffix];
    const content = document('Reader must not persist this');
    const values = { id: file.id, expectedRevision: file.revision };
    for (const body of [
      mutation('create', { kind: 'document', title: prefix + ' denied', content }),
      mutation('save', { ...values, content }),
      mutation('copy', { id: file.id, title: prefix + ' denied copy' }),
      mutation('restore', { ...values, revision: 1 }),
      mutation('delete', values),
      mutation('propose', { ...values, content, summary: 'Reader proposal denied' }),
    ]) await denied('reader' + suffix + ' cannot ' + body.op, reader, body, 'FORBIDDEN');
    await denied('editor' + suffix + ' cannot delete owner document', editor, mutation('delete', values), 'FORBIDDEN');
    const foreign = suffix === 'A' ? docB : docA;
    await denied('owner' + suffix + ' cannot save foreign document', actors['owner' + suffix], mutation('save', { id: foreign.id, expectedRevision: 1, content }), 'NOT_FOUND');
    const foreignSheet = suffix === 'A' ? sheetB : sheetA;
    await denied('owner' + suffix + ' cannot save foreign spreadsheet', actors['owner' + suffix], mutation('save', { id: foreignSheet.id, expectedRevision: 1, content: spreadsheet(100) }), 'NOT_FOUND');
  }

  const savedContent = document(prefix + ' editor saved');
  const save = mutation('save', { id: docA.id, expectedRevision: docA.revision, content: savedContent });
  const firstSave = await ok('editor save', actors.editorA, save);
  docA = firstSave.file;
  const replay = await ok('save idempotent retry', actors.editorA, save);
  await note('save retry preserves exact response', isDeepStrictEqual(firstSave, replay) && docA.revision === 2);
  await denied('idempotency payload collision', actors.editorA, { ...save, content: document('Different payload') }, 'IDEMPOTENCY_CONFLICT');

  const race = async (file, contents) => {
    const attempts = contents.map(content => mutation('save', { id: file.id, expectedRevision: file.revision, content }));
    const results = await Promise.all([send(actors.ownerA, attempts[0]), send(actors.editorA, attempts[1])]);
    const winners = results.map((result, index) => succeeded(result) ? index : -1).filter(index => index >= 0);
    await note(file.kind + ' concurrent CAS has one winner', winners.length === 1 && results.filter(result => result.status >= 400 && code(result) === 'CONFLICT').length === 1);
    const winner = winners[0], current = (await ok(file.kind + ' read after race', actors.readerA, { op: 'read', id: file.id })).file;
    await note(file.kind + ' race winner persists once', current?.revision === file.revision + 1 && isDeepStrictEqual(current.content, contents[winner]));
    const versions = (await ok(file.kind + ' versions after race', actors.ownerA, { op: 'versions', id: file.id })).versions;
    await note(file.kind + ' race history has one new version', Array.isArray(versions) && versions.length === current.revision && new Set(versions.map(version => version.revision)).size === versions.length && versions.some(version => version.revision === current.revision && isDeepStrictEqual(version.content, current.content)));
    concurrency.push({ kind: file.kind, fileId: file.id, expectedRevision: file.revision, resultingRevision: current.revision, winners: 1, conflicts: 1 });
    return current;
  };
  docA = await race(docA, [document(prefix + ' concurrent owner'), document(prefix + ' concurrent editor')]);
  sheetA = await race(sheetA, [spreadsheet(70), spreadsheet(90)]);
  const restored = await ok('restore initial document', actors.ownerA, mutation('restore', { id: docA.id, expectedRevision: docA.revision, revision: 1 }));
  await note('restore advances revision and preserves initial content', restored.file?.revision === docA.revision + 1 && isDeepStrictEqual(restored.file.content, originalA));
  docA = restored.file;
  const copied = await ok('copy saved document', actors.editorA, mutation('copy', { id: docA.id, title: prefix + ' document copy' }));
  await note('copy has independent identity and revision', copied.file?.id !== docA.id && copied.file?.tenantId === tenantA && copied.file?.revision === 1 && isDeepStrictEqual(copied.file?.content, docA.content));
  track(copied.file);

  const originalBytes = Buffer.from(prefix + ' immutable original', 'utf8');
  const original = { name: 'staging-original.txt', mime: 'text/plain', size: originalBytes.length, base64: originalBytes.toString('base64'), sha256: createHash('sha256').update(originalBytes).digest('hex') };
  let imported = (await ok('import immutable original', actors.ownerA, mutation('import', { title: prefix + ' imported', content: document('Converted original'), original }))).file;
  await note('import returns metadata without original bytes', imported?.revision === 1 && imported?.original?.sha256 === original.sha256 && !Object.hasOwn(imported.original, 'base64'));
  track(imported);
  const importedId = imported.id;
  imported = (await ok('edit imported document', actors.editorA, mutation('save', { id: imported.id, expectedRevision: imported.revision, content: document('Edited conversion') }))).file;
  const download = await ok('reader downloads original', actors.readerA, { op: 'original', id: imported.id });
  await note('original byte identity survives editing', download.base64 === original.base64 && download.name === original.name && download.mime === original.mime);
  imported = (await ok('restore imported document', actors.ownerA, mutation('restore', { id: imported.id, expectedRevision: imported.revision, revision: 1 }))).file;
  const afterRestore = await ok('original after restore', actors.ownerA, { op: 'original', id: imported.id });
  await note('restore leaves original unchanged', isDeepStrictEqual(afterRestore, download));
  const originalCopy = (await ok('copy imported document', actors.ownerA, mutation('copy', { id: imported.id, title: prefix + ' imported copy' }))).file;
  track(originalCopy);
  await note('copied original is byte identical', isDeepStrictEqual(await ok('download copied original', actors.readerA, { op: 'original', id: originalCopy.id }), download));
  for (const name of ['ownerB', 'editorB', 'readerB']) await denied(name + ' cannot download A original', actors[name], { op: 'original', id: imported.id }, 'NOT_FOUND');
  await denied('import rejects mismatched original hash', actors.ownerA, mutation('import', { title: prefix + ' invalid hash', content: document('Invalid'), original: { ...original, sha256: '0'.repeat(64) } }), 'INVALID_ORIGINAL');

  const proposedContent = document(prefix + ' AI proposed content');
  const proposal = (await ok('AI creates proposal', actors.aiA, mutation('propose', { id: docA.id, expectedRevision: docA.revision, content: proposedContent, summary: 'Staging AI draft requires human approval' }))).proposal;
  await note('AI proposal is pending at current revision', proposal?.status === 'pending' && proposal.baseRevision === docA.revision && isDeepStrictEqual(proposal.content, proposedContent));
  await note('AI proposal leaves document unchanged', isDeepStrictEqual((await ok('read before human approval', actors.ownerA, { op: 'read', id: docA.id })).file?.content, docA.content));
  const approval = mutation('approve', { id: docA.id, proposalId: proposal.id, expectedRevision: docA.revision });
  await denied('AI cannot self-approve', actors.aiA, approval, 'HUMAN_APPROVAL_REQUIRED');
  await denied('signed AI cannot claim human approval', { ...actors.aiA, principal: 'human' }, { ...approval, idempotencyKey: randomUUID() }, 'HUMAN_APPROVAL_REQUIRED');
  await denied('AI cannot save directly', actors.aiA, mutation('save', { id: docA.id, expectedRevision: docA.revision, content: proposedContent }), 'HUMAN_APPROVAL_REQUIRED');
  await denied('reader cannot approve AI proposal', actors.readerA, { ...approval, idempotencyKey: randomUUID() }, 'FORBIDDEN');
  const applied = await ok('human approves AI proposal', actors.ownerA, approval);
  await note('human approval applies exact content once', applied.proposal?.status === 'applied' && applied.file?.revision === docA.revision + 1 && isDeepStrictEqual(applied.file.content, proposedContent));
  docA = applied.file;
  await note('approval retry is idempotent', isDeepStrictEqual(await ok('human approval replay', actors.ownerA, approval), applied));
  await denied('resolved proposal cannot apply twice', actors.ownerA, { ...approval, expectedRevision: docA.revision, idempotencyKey: randomUUID() }, 'PROPOSAL_FINAL');
  const stale = (await ok('create proposal before human edit', actors.aiA, mutation('propose', { id: docA.id, expectedRevision: docA.revision, content: document('Stale proposal'), summary: 'Stale staging draft' }))).proposal;
  docA = (await ok('human writes newer revision', actors.editorA, mutation('save', { id: docA.id, expectedRevision: docA.revision, content: document(prefix + ' newest human content') }))).file;
  await denied('stale proposal cannot overwrite newer revision', actors.ownerA, mutation('approve', { id: docA.id, proposalId: stale.id, expectedRevision: docA.revision }), 'CONFLICT');
  await note('failed approval preserves current document', isDeepStrictEqual((await ok('read after failed approval', actors.readerA, { op: 'read', id: docA.id })).file, docA));
  await note('human rejects stale proposal', (await ok('reject stale proposal', actors.ownerA, mutation('reject', { id: docA.id, proposalId: stale.id }))).proposal?.status === 'rejected');

  for (const file of [docB, sheetB]) await note('B ' + file.kind + ' untouched by A writes', isDeepStrictEqual((await ok('B final ' + file.kind + ' read', actors.readerB, { op: 'read', id: file.id })).file, file));
  const finalList = await ok('B final isolated list', actors.ownerB, { op: 'list', query: prefix });
  await note('B final list contains only B artifacts', Array.isArray(finalList.files) && finalList.files.length === 2 && finalList.files.every(file => file.tenantId === tenantB && [docB.id, sheetB.id].includes(file.id)));
  return { runId, prefix, requests, passed: checks.length, checks, artifacts, concurrency, importedFileId: importedId, skipped: [{ name: 'job/customer links', reason: 'Requires explicit tenant-owned seed IDs from the staging orchestrator.' }], scope: 'Direct authenticated Office RPC; formula storage is checked, not spreadsheet engine recalculation. No production target selection or network code is included.' };
}
