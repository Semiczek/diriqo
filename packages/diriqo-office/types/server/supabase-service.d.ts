import type { OfficeActor, OfficeRequest, OfficeResponse, OfficeFile } from '../core/types.ts';
import { type ImportInput } from './service.ts';
type RpcClient = {
    rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
        data: any;
        error: any;
    }>;
};
/** Requires an authenticated Supabase client. The RPC independently authorizes operations. */
export declare class SupabaseOfficeService {
    private readonly client;
    constructor(client: RpcClient);
    private call;
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
export {};
