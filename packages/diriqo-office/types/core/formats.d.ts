/** Shared UI/transport capabilities. Conversion adapters still validate file bytes;
 * a name or browser accept hint never authorizes content or bypasses size limits. */
export declare const OFFICE_DOCUMENT_EXPORT_FORMATS: readonly ["docx", "odt", "pdf", "txt", "html"];
export declare const OFFICE_SPREADSHEET_EXPORT_FORMATS: readonly ["xlsx", "ods", "xls", "csv", "tsv"];
export declare const OFFICE_IMPORT_FORMATS: readonly ["docx", "odt", "doc", "xlsx", "ods", "xls", "csv", "tsv", "txt", "html"];
/** DOC only recovers text. Never offer an OOXML file renamed with a DOC suffix. */
export declare const OFFICE_IMPORT_ONLY_FORMATS: readonly ["doc"];
export declare const OFFICE_IMPORT_EXTENSIONS: string;
export type OfficeImportFormat = typeof OFFICE_IMPORT_FORMATS[number];
export type OfficeExportFormat = typeof OFFICE_DOCUMENT_EXPORT_FORMATS[number] | typeof OFFICE_SPREADSHEET_EXPORT_FORMATS[number];
export type OfficeExportAuditFormat = OfficeExportFormat | 'print';
export type OfficeDownloadFormat = OfficeExportAuditFormat | 'original';
export declare function isOfficeExportFormat(value: unknown): value is OfficeExportFormat;
export declare function isOfficeExportAuditFormat(value: unknown): value is OfficeExportAuditFormat;
export declare function isOfficeDownloadFormat(value: unknown): value is OfficeDownloadFormat;
