import { officeUploadStatuses, officeFormulaUploadCategories, type OfficeUploadErrorCode } from './upload-messages'

// Exact known parser messages only. Do not search arbitrary exception text for
// words such as "encrypted", a path, filename or Office code embedded in data.
const protectedMessages = new Set([
  'XML entities are disabled', 'Macros, active objects and external workbooks are not accepted',
  'OpenDocument active objects are not accepted', 'Active XML content is not accepted',
  'Active or encrypted OpenDocument content is not accepted', 'OpenDocument processing instructions are disabled',
  'OpenDocument script attributes are disabled', 'OpenDocument external resources are disabled',
  'Macros, embedded objects and encrypted files are not accepted', 'Embedded compound file object storage is not accepted',
  'Encrypted or obfuscated DOC is not accepted', 'DOC active or embedded objects are not accepted',
  'DOC active or external fields are not accepted', 'ODT processing instructions are disabled',
  'ODT macros, forms, embedded active objects and encrypted files are disabled',
  'ODT event handlers are disabled', 'ODT external resources are disabled', 'ODT macros are disabled',
  'Encrypted, macro or external-name XLS is not accepted', 'Macro sheets are not accepted',
  'External workbooks and add-ins are not accepted', 'External or active spreadsheet formula is not accepted',
  'External or active formula is not accepted', 'Unsafe formula',
])
const limitMessages = new Set([
  'File exceeds 12 MiB', 'ZIP expansion limit exceeded', 'OpenDocument XML size limit exceeded',
  'OpenDocument XML element limit exceeded', 'OpenDocument XML nesting limit exceeded',
  'Compound file directory limit exceeded', 'Compound file stream size limit exceeded', 'Compound file stream total limit exceeded',
  'DOC field nesting limit exceeded', 'DOC field instruction limit exceeded', 'DOC text or stream size limit exceeded',
  'DOC character property limit exceeded', 'ODT repetition limit exceeded', 'ODT XML size limit exceeded',
  'ODT XML node limit exceeded', 'ODT XML depth limit exceeded', 'ODT style limit exceeded',
  'ODT document node limit exceeded', 'ODT text expansion limit exceeded', 'ODT table row limit exceeded',
  'ODT table cell limit exceeded', 'ODT header/footer limit exceeded', 'OpenDocument repetition limit exceeded',
  'ODS row limit exceeded', 'ODS expanded cell limit exceeded', 'Too many sheets', 'Cell limit exceeded',
  'Too many merged ranges', 'Sheet dimensions exceed limit', 'Oversized column range',
  'Too many populated cells', 'CSV limit exceeded', 'Too many CSV rows',
  'Shared formula exceeds length limit', 'XLSX XML nesting limit exceeded',
])
const runtimeCodes = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_REQUIRE_ESM', 'ERR_WORKER_INIT_FAILED', 'ERR_WORKER_PATH', 'ERR_WORKER_UNSUPPORTED_OPERATION'])
// The reviewed Office worker serializes messages without native error codes.
// Recognize only these complete zlib diagnostics; never substring-match input.
const compressionMessages = new Set([
  'invalid block type', 'invalid stored block lengths', 'invalid code lengths set',
  'invalid literal/lengths set', 'invalid distances set', 'invalid distance too far back',
  'invalid distance code', 'invalid literal/length code', 'unexpected end of file',
])

function ownString(error: unknown, key: string): string {
  if (!error || typeof error !== 'object') return ''
  try {
    const value = Object.getOwnPropertyDescriptor(error, key)?.value
    return typeof value === 'string' && value.length <= 4096 ? value : ''
  } catch { return '' }
}
const result = (code: OfficeUploadErrorCode) => ({ code, status: officeUploadStatuses[code] })

/** Call only at the multipart/parser boundary; authorization and persistence
 * errors belong to the route's existing error contract, never this classifier.
 * Its return value is the entire safe response/log payload. Never append error. */
export function classifyOfficeUploadError(error: unknown, stage: 'multipart' | 'import') {
  const message = ownString(error, 'message'), code = ownString(error, 'code')
  if (Object.hasOwn(officeUploadStatuses, message)) return result(message as OfficeUploadErrorCode)
  if (message === 'OFFICE_FORMAT: Upload size exceeds limit') return result('OFFICE_HOST_LIMIT')
  if (stage === 'multipart') return result('OFFICE_UPLOAD_INVALID')
  const formulaCode=code.startsWith('FORMULA_')?'OFFICE_'+code:code
  if (Object.hasOwn(officeFormulaUploadCategories,formulaCode)) return result(officeFormulaUploadCategories[formulaCode])
  const serializedCode=/^(OFFICE_FORMULA_[A-Z_]+): /.exec(message)?.[1]
  if (serializedCode&&Object.hasOwn(officeFormulaUploadCategories,serializedCode)) return result(officeFormulaUploadCategories[serializedCode])
  if (code === 'ERR_WORKER_OUT_OF_MEMORY') return result('OFFICE_IMPORT_LIMIT')
  if (runtimeCodes.has(code) || /^OFFICE_FORMAT: Import worker exited \(-?\d{1,3}\)$/.test(message)) return result('OFFICE_IMPORT_RUNTIME')
  if (message === 'OFFICE_FORMAT: Import processing time limit exceeded') return result('OFFICE_IMPORT_TIMEOUT')
  if (['UNSAFE_FORMULA', 'UNSAFE_RESOURCE'].includes(code)) return result('OFFICE_IMPORT_PROTECTED')
  if (['CONTENT_LIMIT', 'FILE_LIMIT'].includes(code)) return result('OFFICE_IMPORT_LIMIT')
  if (message === 'OFFICE_FORMAT: Invalid file' || message === 'OFFICE_FORMAT: Expected multipart upload') return result('OFFICE_UPLOAD_INVALID')
  if (message.startsWith('OFFICE_FORMAT: ')) {
    const detail = message.slice('OFFICE_FORMAT: '.length)
    if (protectedMessages.has(detail)) return result('OFFICE_IMPORT_PROTECTED')
    if (limitMessages.has(detail)) return result('OFFICE_IMPORT_LIMIT')
    // Legacy combined messages (e.g. encrypted/oversized/unsupported ZIP)
    // cannot reliably identify one cause and deliberately remain generic.
    return result('OFFICE_IMPORT_FORMAT')
  }
  if (['Z_DATA_ERROR', 'Z_BUF_ERROR', 'ERR_ENCODING_INVALID_ENCODED_DATA'].includes(code) || compressionMessages.has(message)) return result('OFFICE_IMPORT_FORMAT')
  return result('OFFICE_IMPORT_RUNTIME')
}
