import { readFile, writeFile, rename, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { OfficeFile, OfficeVersion, OfficeProposal, OfficeResponse } from '../core/types.ts';
import { OfficeError } from '../core/validation.ts';
export type StoredFile = OfficeFile & { deletedAt?: string };
export type AuditEvent = { id: string; at: string; actorId: string; principal: 'human' | 'ai'; operation: string; fileId?: string; revision?: number; details?: Record<string, string | number | boolean> };
export type TenantState = { files: Record<string, StoredFile>; versions: Record<string, OfficeVersion[]>; proposals: Record<string, OfficeProposal>; originals: Record<string, { name: string; mime: string; base64: string }>; receipts: Record<string, { fingerprint: string; response: OfficeResponse }>; audit: AuditEvent[] };
export function emptyState(): TenantState { return { files: {}, versions: {}, proposals: {}, originals: {}, receipts: {}, audit: [] }; }
function quota(state:TenantState){const {audit,...data}=state;if(Buffer.byteLength(JSON.stringify(data))>64*1024*1024)throw new OfficeError('TENANT_QUOTA','Pilot workspace quota is 64 MiB. Contact the administrator to expand persistence before adding more data.',413);}
export interface OfficeStore { transaction<T>(tenantId: string, fn: (state: TenantState) => Promise<T> | T): Promise<T>; }
export class MemoryStore implements OfficeStore {
  private states: Record<string, TenantState> = {}; private queue: Promise<void> = Promise.resolve();
  async transaction<T>(tenantId: string, fn: (state: TenantState) => Promise<T> | T): Promise<T> { const prior = this.queue; let release!: () => void; this.queue = new Promise(r => release = r); await prior; try { const next = structuredClone(this.states[tenantId] ?? emptyState()); const result = await fn(next); quota(next); this.states[tenantId] = next; return structuredClone(result); } finally { release(); } }
}
const queues = new Map<string, Promise<void>>();
/** Local reference adapter. Do not deploy on ephemeral or network file systems. */
export class FileStore implements OfficeStore {
  readonly path: string; constructor(path: string) { this.path = resolve(path); }
  async transaction<T>(tenantId: string, fn: (state: TenantState) => Promise<T> | T): Promise<T> {
    const prior = queues.get(this.path) ?? Promise.resolve(); let release!: () => void; const pending = new Promise<void>(r => release = r); queues.set(this.path, pending); await prior;
    const lockPath = this.path + '.lock'; let lock: Awaited<ReturnType<typeof open>> | undefined; const temp = this.path + '.' + randomUUID() + '.tmp';
    try {
      await mkdir(dirname(this.path), { recursive: true }); try { lock = await open(lockPath, 'wx', 0o600); } catch (e: any) { if (e.code === 'EEXIST') throw new OfficeError('STORE_BUSY', 'Another process is using the Office store. Retry; stale lock removal requires confirming no process is writing.', 503); throw e; }
      let envelope: { schemaVersion: 1; tenants: Record<string, TenantState> }; try { envelope = JSON.parse(await readFile(this.path, 'utf8')); if (envelope.schemaVersion !== 1 || !envelope.tenants || typeof envelope.tenants !== 'object') throw new Error('Invalid store schema.'); } catch (e: any) { if (e.code === 'ENOENT') envelope = { schemaVersion: 1, tenants: {} }; else throw new OfficeError('STORE_CORRUPT', 'Office store cannot be read; no data was overwritten.', 500); }
      const next = structuredClone(envelope.tenants[tenantId] ?? emptyState()); const result = await fn(next); quota(next); envelope.tenants[tenantId] = next;
      await writeFile(temp, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); const handle = await open(temp, 'r+'); try { await handle.sync(); } finally { await handle.close(); } await rename(temp, this.path); return structuredClone(result);
    } finally { if (lock) { await lock.close(); await unlink(lockPath).catch(() => {}); } await unlink(temp).catch(() => {}); release(); if (queues.get(this.path) === pending) queues.delete(this.path); }
  }
}
