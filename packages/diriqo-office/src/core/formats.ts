/** Shared UI/transport capabilities. Conversion adapters still validate file bytes;
 * a name or browser accept hint never authorizes content or bypasses size limits. */
export const OFFICE_DOCUMENT_EXPORT_FORMATS = ['docx', 'odt', 'pdf', 'txt', 'html'] as const;
export const OFFICE_SPREADSHEET_EXPORT_FORMATS = ['xlsx', 'ods', 'xls', 'csv', 'tsv'] as const;
export const OFFICE_IMPORT_FORMATS = ['docx', 'odt', 'doc', 'xlsx', 'ods', 'xls', 'csv', 'tsv', 'txt', 'html'] as const;
/** DOC only recovers text. Never offer an OOXML file renamed with a DOC suffix. */
export const OFFICE_IMPORT_ONLY_FORMATS = ['doc'] as const;
export const OFFICE_IMPORT_EXTENSIONS = [...OFFICE_IMPORT_FORMATS.map(format => '.' + format), '.htm'].join(',');
export type OfficeImportFormat = typeof OFFICE_IMPORT_FORMATS[number];
export type OfficeExportFormat = typeof OFFICE_DOCUMENT_EXPORT_FORMATS[number] | typeof OFFICE_SPREADSHEET_EXPORT_FORMATS[number];
export type OfficeExportAuditFormat = OfficeExportFormat | 'print';
export type OfficeDownloadFormat = OfficeExportAuditFormat | 'original';
export function isOfficeExportFormat(value: unknown): value is OfficeExportFormat {
 return typeof value === 'string' && [...OFFICE_DOCUMENT_EXPORT_FORMATS, ...OFFICE_SPREADSHEET_EXPORT_FORMATS].some(format => format === value);
}
export function isOfficeExportAuditFormat(value: unknown): value is OfficeExportAuditFormat {
 return value === 'print' || isOfficeExportFormat(value);
}
export function isOfficeDownloadFormat(value: unknown): value is OfficeDownloadFormat {
 return value === 'original' || isOfficeExportAuditFormat(value);
}
