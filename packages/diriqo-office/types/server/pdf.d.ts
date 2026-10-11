import type { DocumentContent } from '../core/types.ts';
export declare const PDF_LIMITS: Readonly<{
    characters: 100000;
    nodes: 20000;
    depth: 32;
    pages: 200;
    tableCells: 5000;
    tableColumns: 16;
}>;
export declare function exportPdf(content: DocumentContent): {
    bytes: Buffer;
    warnings: string[];
};
