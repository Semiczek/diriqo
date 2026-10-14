import type { SpreadsheetContent } from '../core/types.ts';
export declare const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";
export declare function importAlternativeSpreadsheet(bytes: Uint8Array, format: 'ods' | 'xls'): {
    content: SpreadsheetContent;
    warnings: string[];
};
export declare function exportAlternativeSpreadsheet(content: SpreadsheetContent, format: 'ods' | 'xls'): {
    bytes: Buffer;
    warnings: string[];
};
