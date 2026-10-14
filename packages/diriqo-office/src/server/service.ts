import { createHash, randomUUID } from 'node:crypto';
import type { OfficeActor, OfficeContent, OfficeFile, OfficeLink, OfficeRequest, OfficeResponse, OfficeProposal } from '../core/types.ts';
import { check, id, title, validateContent, validateRequest, validateExportAuditFormat, OFFICE_LIMITS } from '../core/validation.ts';
import type { OfficeStore, TenantState, StoredFile } from './store.ts';
export type ImportInput = { title: string; content: OfficeContent; original: { name: string; mime: string; bytes: Uint8Array }; idempotencyKey: string; parentId?: string | null };
export type ServiceOptions = { resolveEntity?: (actor: OfficeActor, entity: { type: 'job' | 'customer'; id: string }) => Promise<{ id: string; label: string }> };
const reads = new Set(['list', 'listFiles', 'listVersions', 'readVersion', 'listProposals', 'readProposal', 'read', 'versions', 'proposals', 'permissions']);
export function guardActor(a: OfficeActor, write = false) { check(a && typeof a === 'object', 'UNAUTHENTICATED', 'Sign in required.', 401); id(a.tenantId); id(a.actorId); check(['owner', 'editor', 'reader'].includes(a.role) && ['human', 'ai'].includes(a.principal), 'UNAUTHENTICATED', 'Invalid principal.', 401); check(a.enabled === true, 'MODULE_DISABLED', 'Office is disabled for this company.', 403); if (write) check(a.role !== 'reader', 'FORBIDDEN', 'Write permission required.', 403); }
function canonical(x: any): string { if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']'; if (x && typeof x === 'object') return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}'; return JSON.stringify(x); }
function fingerprint(x: unknown) { return createHash('sha256').update(canonical(x)).digest('hex'); }
function audit(s: TenantState, a: OfficeActor, operation: string, file?: OfficeFile, details?: Record<string, string | number | boolean>) { s.audit.push({ id: randomUUID(), at: new Date().toISOString(), actorId: a.actorId, principal: a.principal, operation, ...(file ? { fileId: file.id, revision: file.revision } : {}), ...(details ? { details } : {}) }); }
function file(s: TenantState, a: OfficeActor, fileId: string): StoredFile { const f = s.files[id(fileId)]; check(f && !f.deletedAt && f.tenantId === a.tenantId, 'NOT_FOUND', 'File was not found.', 404); return f; }
function expect(f: OfficeFile, revision: number) { check(f.revision === revision, 'CONFLICT', 'A newer version exists. Reload before saving.', 409); }
function snapshot(s: TenantState, a: OfficeActor, f: OfficeFile) { (s.versions[f.id] ??= []).push({ revision: f.revision, createdAt: f.updatedAt, actorId: a.actorId, content: structuredClone(f.content), title: f.title }); }
function advance(s: TenantState, a: OfficeActor, f: OfficeFile) { f.revision++; f.updatedAt = new Date().toISOString(); snapshot(s, a, f); }
function parent(s: TenantState, a: OfficeActor, parentId: string | null, movingId?: string) { let current = parentId; const visited = new Set<string>(); while (current) { check(!visited.has(current) && current !== movingId, 'FOLDER_CYCLE', 'A folder cannot contain itself.'); visited.add(current); check(visited.size <= 100, 'FOLDER_DEPTH', 'Folder nesting limit exceeded.'); const p = file(s, a, current); check(p.kind === 'folder', 'INVALID_PARENT', 'Parent must be a folder.'); current = p.parentId; } }
function receipt(s: TenantState, a: OfficeActor, key: string, input: unknown): { key: string; fingerprint: string; response?: OfficeResponse } { const receiptKey = a.actorId + ':' + id(key); const hash = fingerprint(input); const old = s.receipts[receiptKey]; if (old) { check(old.fingerprint === hash, 'IDEMPOTENCY_CONFLICT', 'This operation key was used for a different request.', 409); return { key: receiptKey, fingerprint: hash, response: old.response }; } return { key: receiptKey, fingerprint: hash }; }
export class OfficeService {
  private readonly store: OfficeStore; private readonly options: ServiceOptions;
  constructor(store: OfficeStore, options: ServiceOptions = {}) { this.store = store; this.options = options; }
  async request(actor: OfficeActor, input: OfficeRequest): Promise<OfficeResponse> {
    const r = validateRequest(input); guardActor(actor, !reads.has(r.op)); if (actor.principal === 'ai') check(reads.has(r.op) || r.op === 'propose', 'HUMAN_APPROVAL_REQUIRED', 'AI may read and propose changes; a human must apply them.', 403);
    return this.store.transaction(actor.tenantId, async s => {
      const memo = 'idempotencyKey' in r ? receipt(s, actor, r.idempotencyKey, r) : null;
      if (memo?.response) { if ('id' in r && r.op !== 'delete') file(s, actor, r.id); audit(s, actor, 'idempotency.replay', undefined, { operation: r.op }); return memo.response; }
      let result: OfficeResponse;
      if (r.op === 'list' || r.op === 'listFiles') {
        if (r.parentId) parent(s, actor, r.parentId);
        const query = (r.query ?? '').toLocaleLowerCase();
        let rows = Object.values(s.files).filter(f => !f.deletedAt && f.tenantId === actor.tenantId && (r.parentId === undefined || f.parentId === r.parentId) && (!query || f.title.toLocaleLowerCase().includes(query)));
        if (r.op === 'listFiles') {
          rows = rows.filter(f => (!r.afterId || f.id > r.afterId) && (!r.foldersOnly || f.kind === 'folder')).sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
          const limit=r.limit ?? 50, page=rows.slice(0,limit);
          result={files:page.map(f=>({...f,content:null})),nextCursor:rows.length>limit?page.at(-1)!.id:null};
        } else result = { files: rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(f=>({...f,content:null})) };
        audit(s,actor,r.op,undefined,{count:result.files!.length});
      }
      else if (r.op === 'create') { parent(s, actor, r.parentId ?? null); check(Object.values(s.files).filter(f => !f.deletedAt).length < 10000, 'FILE_LIMIT', 'Company file quota reached.'); const f: OfficeFile = { id: randomUUID(), tenantId: actor.tenantId, ownerId: actor.actorId, title: title(r.title), kind: r.kind, parentId: r.parentId ?? null, revision: 1, content: r.kind === 'folder' ? null : validateContent(r.content), updatedAt: new Date().toISOString(), link: null }; s.files[f.id] = f; snapshot(s, actor, f); audit(s, actor, 'create', f); result = { file: f }; }
      else {
        const f = file(s, actor, r.id); switch (r.op) {
          case 'read': result = { file: f }; break;
          case 'permissions': result = { permissions: { role: actor.role, ownerId: f.ownerId, canWrite: actor.role !== 'reader', canDelete: actor.role === 'owner' || (actor.role === 'editor' && f.ownerId === actor.actorId) } }; break;
          case 'versions': result = { versions: s.versions[f.id] ?? [] }; break;
          case 'proposals': result = { proposals: Object.values(s.proposals).filter(p => p.fileId === f.id) }; break;
          case 'listVersions': {
            const rows=(s.versions[f.id]??[]).filter(v=>r.beforeRevision===undefined||v.revision<r.beforeRevision).sort((a,b)=>b.revision-a.revision),limit=r.limit??50,page=rows.slice(0,limit);
            result={versionSummaries:page.map(({content,...metadata})=>metadata),nextCursor:rows.length>limit?String(page.at(-1)!.revision):null};break;
          }
          case 'readVersion': { const version=s.versions[f.id]?.find(v=>v.revision===r.revision);check(version,'NOT_FOUND','Version was not found.',404);result={version};break; }
          case 'listProposals': {
            const rows=Object.values(s.proposals).filter(p=>p.fileId===f.id&&(!r.afterId||p.id>r.afterId)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),limit=r.limit??50,page=rows.slice(0,limit);
            result={proposalSummaries:page.map(({content,...metadata})=>metadata),nextCursor:rows.length>limit?page.at(-1)!.id:null};break;
          }
          case 'readProposal': { const proposal=s.proposals[r.proposalId];check(proposal&&proposal.fileId===f.id,'NOT_FOUND','Proposal was not found.',404);result={proposal};break; }
          case 'save': expect(f, r.expectedRevision); check(f.kind === r.content.kind, 'INVALID_CONTENT', 'Content kind cannot change.'); f.content = validateContent(r.content); advance(s, actor, f); result = { file: f }; break;
          case 'rename': expect(f, r.expectedRevision); f.title = title(r.title); advance(s, actor, f); result = { file: f }; break;
          case 'move': expect(f, r.expectedRevision); parent(s, actor, r.parentId, f.id); f.parentId = r.parentId; advance(s, actor, f); result = { file: f }; break;
          case 'copy': { check(f.kind !== 'folder', 'UNSUPPORTED_OPERATION', 'Copy individual documents; folder copying is not supported.'); check(Object.keys(s.files).length < 10000, 'FILE_LIMIT', 'Company file quota reached.'); const copy: OfficeFile = { ...structuredClone(f), id: randomUUID(), ownerId: actor.actorId, title: title(r.title), revision: 1, updatedAt: new Date().toISOString() }; s.files[copy.id] = copy; if (s.originals[f.id]) s.originals[copy.id] = structuredClone(s.originals[f.id]); snapshot(s, actor, copy); result = { file: copy }; break; }
          case 'delete': expect(f, r.expectedRevision); check(actor.role === 'owner' || f.ownerId === actor.actorId, 'FORBIDDEN', 'Only the file owner or company administrator may delete it.', 403); check(!Object.values(s.files).some(x => !x.deletedAt && x.parentId === f.id), 'FOLDER_NOT_EMPTY', 'Move or delete folder contents first.', 409); f.deletedAt = new Date().toISOString(); advance(s, actor, f); result = { deleted: true }; break;
          case 'restore': { expect(f, r.expectedRevision); const old = s.versions[f.id]?.find(v => v.revision === r.revision); check(old, 'NOT_FOUND', 'Version was not found.', 404); f.content = old.content ? validateContent(old.content) : null; f.title = old.title; advance(s, actor, f); result = { file: f }; break; }
          case 'link': { expect(f, r.expectedRevision); check(this.options.resolveEntity, 'UNSUPPORTED_OPERATION', 'This host has no entity resolver.', 501); const resolved = await this.options.resolveEntity(actor, { type: r.type, id: r.entityId }); check(resolved && resolved.id === r.entityId, 'NOT_FOUND', 'Entity was not found in the active company.', 404); f.link = { type: r.type, id: resolved.id, label: title(resolved.label) } satisfies OfficeLink; advance(s, actor, f); result = { file: f }; break; }
          case 'propose': { expect(f, r.expectedRevision); check(f.kind === r.content.kind, 'INVALID_CONTENT', 'Content kind cannot change.'); const p: OfficeProposal = { id: randomUUID(), fileId: f.id, baseRevision: f.revision, status: 'pending', summary: title(r.summary, 2000), content: validateContent(r.content), createdBy: actor.actorId, createdAt: new Date().toISOString() }; s.proposals[p.id] = p; result = { proposal: p }; break; }
          case 'approve': { check(actor.principal === 'human', 'HUMAN_APPROVAL_REQUIRED', 'Explicit human approval required.', 403); expect(f, r.expectedRevision); const p = s.proposals[r.proposalId]; check(p && p.fileId === f.id, 'NOT_FOUND', 'Proposal was not found.', 404); check(p.status === 'pending', 'PROPOSAL_FINAL', 'Proposal has already been resolved.', 409); expect(f, p.baseRevision); check(p.content.kind === f.kind, 'INVALID_CONTENT', 'Content kind mismatch.'); f.content = validateContent(p.content); advance(s, actor, f); p.status = 'applied'; result = { file: f, proposal: p }; break; }
          case 'reject': { check(actor.principal === 'human', 'HUMAN_APPROVAL_REQUIRED', 'Explicit human approval required.', 403); const p = s.proposals[r.proposalId]; check(p && p.fileId === f.id, 'NOT_FOUND', 'Proposal was not found.', 404); check(p.status === 'pending', 'PROPOSAL_FINAL', 'Proposal has already been resolved.', 409); p.status = 'rejected'; result = { proposal: p }; break; }
          default: throw new Error('Unreachable Office operation.');
        } audit(s, actor, r.op, result.file ?? f);
      }
      if (memo) s.receipts[memo.key] = { fingerprint: memo.fingerprint, response: structuredClone(result) }; return result;
    });
  }
  async import(actor: OfficeActor, input: ImportInput): Promise<{ file: OfficeFile }> {
    guardActor(actor, true); check(actor.principal === 'human', 'HUMAN_APPROVAL_REQUIRED', 'Human import required.', 403); const content = validateContent(input.content); const name = title(input.original.name); const mime = title(input.original.mime, 160); const bytes = input.original.bytes; check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= OFFICE_LIMITS.originalBytes, 'FILE_LIMIT', 'Original exceeds 12 MiB limit.'); const sha256 = createHash('sha256').update(bytes).digest('hex'); const data = { title: title(input.title), parentId:input.parentId==null?null:id(input.parentId), content, original: { name, mime, size: bytes.length, sha256 }, idempotencyKey: id(input.idempotencyKey) };
    return this.store.transaction(actor.tenantId, s => { const memo = receipt(s, actor, input.idempotencyKey, { op: 'import', ...data }); if (memo.response) return memo.response as { file: OfficeFile }; parent(s,actor,data.parentId); check(Object.keys(s.files).length < 10000, 'FILE_LIMIT', 'Company file quota reached.'); const f: OfficeFile = { id: randomUUID(), tenantId: actor.tenantId, ownerId: actor.actorId, title: data.title, kind: content.kind, parentId: data.parentId, revision: 1, content, updatedAt: new Date().toISOString(), link: null, original: data.original }; s.files[f.id] = f; s.originals[f.id] = { name, mime, base64: Buffer.from(bytes).toString('base64') }; snapshot(s, actor, f); audit(s, actor, 'import', f, { originalSha256: sha256 }); const result = { file: f }; s.receipts[memo.key] = { fingerprint: memo.fingerprint, response: structuredClone(result) }; return result; });
  }
  async original(actor: OfficeActor, fileId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }> { guardActor(actor); return this.store.transaction(actor.tenantId, s => { const f = file(s, actor, fileId); const original = s.originals[f.id]; check(original, 'NOT_FOUND', 'Original file is not available.', 404); audit(s, actor, 'original.read', f); return { name: original.name, mime: original.mime, bytes: Buffer.from(original.base64, 'base64') }; }); }
  async recordExport(actor: OfficeActor, fileId: string, format: string): Promise<void> { guardActor(actor); validateExportAuditFormat(format); await this.store.transaction(actor.tenantId, s => { const f = file(s, actor, fileId); audit(s, actor, 'export', f, { format }); }); }
}
