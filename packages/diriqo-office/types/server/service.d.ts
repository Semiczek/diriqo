import type { OfficeActor, OfficeContent, OfficeFile, OfficeRequest, OfficeResponse } from '../core/types.ts';
import type { OfficeStore } from './store.ts';
export type ImportInput = {
    title: string;
    content: OfficeContent;
    original: {
        name: string;
        mime: string;
        bytes: Uint8Array;
    };
    idempotencyKey: string;
    parentId?: string | null;
};
export type ServiceOptions = {
    resolveEntity?: (actor: OfficeActor, entity: {
        type: 'job' | 'customer';
        id: string;
    }) => Promise<{
        id: string;
        label: string;
    }>;
};
export declare function guardActor(a: OfficeActor, write?: boolean): void;
export declare class OfficeService {
    private readonly store;
    private readonly options;
    constructor(store: OfficeStore, options?: ServiceOptions);
    request(actor: OfficeActor, input: OfficeRequest): Promise<OfficeResponse>;
    import(actor: OfficeActor, input: ImportInput): Promise<{
        file: OfficeFile;
    }>;
    original(actor: OfficeActor, fileId: string): Promise<{
        name: string;
        mime: string;
        bytes: Uint8Array;
    }>;
    recordExport(actor: OfficeActor, fileId: string, format: string): Promise<void>;
}
