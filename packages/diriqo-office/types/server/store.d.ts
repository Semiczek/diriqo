import type { OfficeFile, OfficeVersion, OfficeProposal, OfficeResponse } from '../core/types.ts';
export type StoredFile = OfficeFile & {
    deletedAt?: string;
};
export type AuditEvent = {
    id: string;
    at: string;
    actorId: string;
    principal: 'human' | 'ai';
    operation: string;
    fileId?: string;
    revision?: number;
    details?: Record<string, string | number | boolean>;
};
export type TenantState = {
    files: Record<string, StoredFile>;
    versions: Record<string, OfficeVersion[]>;
    proposals: Record<string, OfficeProposal>;
    originals: Record<string, {
        name: string;
        mime: string;
        base64: string;
    }>;
    receipts: Record<string, {
        fingerprint: string;
        response: OfficeResponse;
    }>;
    audit: AuditEvent[];
};
export declare function emptyState(): TenantState;
export interface OfficeStore {
    transaction<T>(tenantId: string, fn: (state: TenantState) => Promise<T> | T): Promise<T>;
}
export declare class MemoryStore implements OfficeStore {
    private states;
    private queue;
    transaction<T>(tenantId: string, fn: (state: TenantState) => Promise<T> | T): Promise<T>;
}
/** Local reference adapter. Do not deploy on ephemeral or network file systems. */
export declare class FileStore implements OfficeStore {
    readonly path: string;
    constructor(path: string);
    transaction<T>(tenantId: string, fn: (state: TenantState) => Promise<T> | T): Promise<T>;
}
