export { FORMAT_LIMITS, readSafeZip } from './container-safety.ts';
import type { DocumentContent, OfficeContent, SpreadsheetContent } from '../core/types.ts';
export declare function safeLink(url: unknown): string | null;
export declare function sanitizeOfficeHtml(value: string): string;
export declare function htmlToDocument(html: string): DocumentContent;
export declare function documentToHtml(document: DocumentContent): string;
export declare function documentToText(document: DocumentContent): string;
export declare function importDocx(input: Uint8Array): {
    content: DocumentContent;
    warnings: string[];
};
export declare function exportDocx(document: DocumentContent): {
    bytes: Buffer;
    warnings: string[];
};
export declare function columnName(index: number): string;
export declare function address(value: string): {
    row: number;
    col: number;
};
export declare function safeFormula(formula: string): boolean;
export declare function importXlsx(input: Uint8Array): {
    content: SpreadsheetContent;
    warnings: string[];
};
export declare function exportXlsx(content: SpreadsheetContent): {
    bytes: Buffer;
    warnings: string[];
};
export declare function importCsv(value: string, delimiter?: '\t'): SpreadsheetContent;
export declare function exportCsv(content: SpreadsheetContent, delimiter?: string): string;
export declare function importOfficeFile(name: string, bytes: Uint8Array): Promise<{
    content: OfficeContent;
    warnings: string[];
    original: {
        name: string;
        mime: string;
        size: number;
        sha256: string;
    };
}>;
export declare const MIME: Record<string, string>;
export declare function exportOfficeFile(content: OfficeContent, title: string, format: string): {
    name: string;
    mime: string;
    base64: string;
    warnings: string[];
};
