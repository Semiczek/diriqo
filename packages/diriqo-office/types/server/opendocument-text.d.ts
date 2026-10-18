import type { DocumentContent } from '../core/types.ts';
export declare const ODT_MIME = "application/vnd.oasis.opendocument.text";
export declare function importOdt(zip: Record<string, Uint8Array>): {
    content: DocumentContent;
    warnings: string[];
};
export declare function exportOdt(document: DocumentContent): {
    bytes: Uint8Array;
    warnings: string[];
};
