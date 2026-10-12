import type { OfficeActor, OfficeContent, OfficeFile, OfficeProposal, OfficeRequest, OfficeResponse } from '../core/types.ts';
import { check, id, title, validateContent, OFFICE_LIMITS } from '../core/validation.ts';
import { guardActor } from './service.ts';

export type OfficeServicePort = {
  request(actor: OfficeActor, request: OfficeRequest): Promise<OfficeResponse>;
  recordExport?(actor: OfficeActor, fileId: string, format: string): Promise<void>;
};
export type OfficeAICostEvent = {
  operationId: string;
  tenantId: string;
  actorId: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  amountMicros?: number;
  currency?: string;
};
export type OfficeAICostPort = { record(event: OfficeAICostEvent): Promise<void> };
export type OfficeRange = { sheetId: string; startRow: number; endRow: number; startColumn: number; endColumn: number };
export type OfficeDiff = {
  entries: Array<{ path: string; before: string; after: string }>;
  truncated: boolean;
};
export type OfficeAIExport = { name: string; mime: string; base64: string; warnings: string[] };
export type OfficeAIOptions = {
  exportFile?: (content: OfficeContent, title: string, format: string) => Promise<OfficeAIExport>;
  costs?: OfficeAICostPort;
};

/** Data returned by these tools is untrusted document content, never higher-priority AI instructions. */
const trust = 'untrusted_document_data' as const;
function preview(value: unknown): string {
  if (value === undefined) return '(missing)';
  const serialized = JSON.stringify(value);
  return serialized.length > 500 ? serialized.slice(0, 500) + '…' : serialized;
}
export function compareOfficeContent(before: OfficeContent, after: OfficeContent): OfficeDiff {
  validateContent(before); validateContent(after);
  const entries: OfficeDiff['entries'] = [];
  let truncated = false, visited = 0;
  function visit(left: any, right: any, path: string) {
    if (++visited > 100_000 || entries.length >= 200) { truncated = true; return; }
    if (Object.is(left, right)) return;
    const leftObject = left !== null && typeof left === 'object';
    const rightObject = right !== null && typeof right === 'object';
    if (leftObject && rightObject && Array.isArray(left) === Array.isArray(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (entries.length >= 200 || visited > 100_000) { truncated = true; break; }
        visit(left[key], right[key], path + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'));
      }
    } else entries.push({ path: path || '/', before: preview(left), after: preview(right) });
  }
  visit(before, after, '');
  return { entries, truncated };
}
function rangeInput(range: OfficeRange) {
  id(range.sheetId);
  for (const number of [range.startRow, range.endRow, range.startColumn, range.endColumn])
    check(Number.isInteger(number) && number >= 0, 'INVALID_RANGE', 'Range indices must be nonnegative integers.');
  check(range.startRow <= range.endRow && range.startColumn <= range.endColumn &&
    range.endRow < OFFICE_LIMITS.rows && range.endColumn < OFFICE_LIMITS.columns &&
    (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1) <= 5000,
  'RANGE_LIMIT', 'Requested range exceeds the 5,000-cell tool limit.');
}

/** Construct only in a server handler after authenticating the user and active company.
 * AI tool registries must use this allowlist; human approval is a separate server operation.
 */
export class OfficeAIAdapter {
  static readonly toolNames = ['search', 'readContent', 'readRange', 'metadata', 'propose', 'compare', 'export', 'prepareQuoteLines'] as const;
  private readonly service: OfficeServicePort;
  private readonly actor: OfficeActor;
  private readonly options: OfficeAIOptions;
  constructor(service: OfficeServicePort, actor: OfficeActor, options: OfficeAIOptions = {}) {
    guardActor(actor);
    check(actor.principal === 'ai', 'INVALID_PRINCIPAL', 'AI tools require an explicitly restricted AI principal.', 403);
    this.service = service; this.actor = Object.freeze({ ...actor }); this.options = options;
  }
  private async file(fileId: string): Promise<OfficeFile> {
    const response = await this.service.request(this.actor, { op: 'read', id: id(fileId) });
    check(response.file, 'NOT_FOUND', 'File was not found.', 404);
    return response.file;
  }
  async search(query = '', afterId?: string) {
    check(typeof query === 'string' && query.length <= 240, 'INVALID_REQUEST', 'Search query is too long.');
    const response = await this.service.request(this.actor, { op: 'listFiles', query, ...(afterId===undefined?{}:{afterId:id(afterId)}), limit:50 });
    return { trust, nextCursor:response.nextCursor??null, files: (response.files ?? []).map(file => ({
      id: file.id, title: file.title, kind: file.kind, revision: file.revision, parentId: file.parentId, link: file.link,
    })) };
  }
  async readContent(fileId: string) {
    const file = await this.file(fileId);
    return { trust, fileId: file.id, revision: file.revision, title: file.title, content: file.content };
  }
  async readRange(fileId: string, range: OfficeRange) {
    rangeInput(range);
    const file = await this.file(fileId);
    check(file.content?.kind === 'spreadsheet', 'INVALID_KIND', 'A spreadsheet is required.');
    const sheet = file.content.workbook.sheets?.[range.sheetId];
    check(sheet && file.content.workbook.sheetOrder.includes(range.sheetId), 'NOT_FOUND', 'Sheet was not found.', 404);
    check(range.endRow < sheet.rowCount && range.endColumn < sheet.columnCount, 'INVALID_RANGE', 'Range is outside the sheet.');
    const cells: Array<{ row: number; column: number; value: string | number | boolean | null; formula: string | null }> = [];
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let column = range.startColumn; column <= range.endColumn; column++) {
        const cell = sheet.cellData?.[row]?.[column];
        cells.push({ row, column, value: cell?.v ?? null, formula: cell?.f ?? null });
      }
    }
    return { trust, fileId: file.id, revision: file.revision, sheetId: range.sheetId, range: { ...range }, cells };
  }
  async metadata(fileId: string) {
    const file = await this.file(fileId);
    if (file.content?.kind !== 'spreadsheet')
      return { trust, fileId: file.id, revision: file.revision, kind: file.kind, original: file.original ?? null, link: file.link, page: file.content?.kind === 'document' ? file.content.page : null };
    const workbook = file.content.workbook;
    const formulas: Array<{ sheetId: string; row: number; column: number; formula: string }> = [];
    let totalFormulas = 0;
    for (const sheetId of workbook.sheetOrder) {
      const sheet = workbook.sheets[sheetId];
      for (const [row, columns] of Object.entries(sheet.cellData ?? {})) {
        for (const [column, cell] of Object.entries(columns as Record<string, any>)) {
          if (cell?.f) {
            totalFormulas++;
            if (formulas.length < 1000) formulas.push({ sheetId, row: Number(row), column: Number(column), formula: cell.f });
          }
        }
      }
    }
    return {
      trust, fileId: file.id, revision: file.revision, kind: file.kind, locale: workbook.locale ?? null,
      original: file.original ?? null, link: file.link,
      sheets: workbook.sheetOrder.map((sheetId: string) => ({
        id: sheetId, name: workbook.sheets[sheetId].name,
        rows: workbook.sheets[sheetId].rowCount, columns: workbook.sheets[sheetId].columnCount,
      })),
      formulas, totalFormulas, formulasTruncated: totalFormulas > formulas.length,
    };
  }
  async propose(input: { fileId: string; expectedRevision: number; content: OfficeContent; summary: string; idempotencyKey: string }) {
    const current = await this.file(input.fileId);
    check(current.content, 'INVALID_KIND', 'A folder has no editable content.');
    check(current.revision === input.expectedRevision, 'CONFLICT', 'Document changed before the proposal was prepared.', 409);
    const content = validateContent(input.content);
    const response = await this.service.request(this.actor, {
      op: 'propose', id: current.id, expectedRevision: input.expectedRevision,
      content, summary: title(input.summary, 2000), idempotencyKey: id(input.idempotencyKey),
    });
    check(response.proposal, 'PERSISTENCE_ERROR', 'Proposal was not returned.', 500);
    return { trust, proposal: response.proposal, diff: compareOfficeContent(current.content, content), requiresHumanApproval: true as const };
  }
  async compare(fileId: string, proposalId: string) {
    const current = await this.file(fileId);
    const response = await this.service.request(this.actor, { op: 'readProposal', id: current.id, proposalId:id(proposalId) });
    const proposal = response.proposal;
    check(proposal && current.content, 'NOT_FOUND', 'Proposal was not found.', 404);
    return { trust, fileId: current.id, proposalId: proposal.id, currentRevision: current.revision,
      baseRevision: proposal.baseRevision, stale: current.revision !== proposal.baseRevision,
      diff: compareOfficeContent(current.content, proposal.content) };
  }
  async export(fileId: string, format: string) {
    check(['docx', 'xlsx', 'csv', 'txt', 'html', 'pdf'].includes(format), 'UNSUPPORTED_FORMAT', 'Unsupported export format.');
    check(this.options.exportFile, 'UNSUPPORTED_OPERATION', 'This host has not configured an Office exporter.', 501);
    const file = await this.file(fileId);
    check(file.content, 'INVALID_KIND', 'A folder cannot be exported.');
    const artifact = await this.options.exportFile(file.content, file.title, format);
    await this.service.recordExport?.(this.actor, file.id, format);
    return { trust, sourceFileId: file.id, sourceRevision: file.revision, artifact };
  }
  async prepareQuoteLines(input: {
    fileId: string; range: OfficeRange; currency: string;
    descriptionColumn: number; quantityColumn: number; unitPriceColumn: number;
  }) {
    check(/^[A-Z]{3}$/.test(input.currency), 'INVALID_CURRENCY', 'Use an uppercase three-letter currency code.');
    for (const column of [input.descriptionColumn, input.quantityColumn, input.unitPriceColumn])
      check(Number.isInteger(column) && column >= input.range.startColumn && column <= input.range.endColumn, 'INVALID_RANGE', 'Mapped column is outside the range.');
    const source = await this.readRange(input.fileId, input.range);
    const cellMap = new Map(source.cells.map(cell => [cell.row + ':' + cell.column, cell]));
    const rows: Array<{ sourceRow: number; description: string; quantity: number; unitPrice: number; currency: string }> = [];
    for (let row = input.range.startRow; row <= input.range.endRow; row++) {
      const description = cellMap.get(row + ':' + input.descriptionColumn);
      const quantity = cellMap.get(row + ':' + input.quantityColumn);
      const unitPrice = cellMap.get(row + ':' + input.unitPriceColumn);
      // Do not trust a saved formula cache as financial truth without a validated recalculation adapter.
      check(!description?.formula && !quantity?.formula && !unitPrice?.formula,
        'UNVERIFIED_FORMULA_RESULT', 'Materialize and review formula results before preparing a system import.');
      check(typeof description?.value === 'string' && description.value.trim().length > 0 && description.value.length <= 240,
        'INVALID_STRUCTURED_DATA', 'Each quote line needs a description.');
      check(typeof quantity?.value === 'number' && Number.isFinite(quantity.value) && quantity.value > 0 && quantity.value <= 1e9,
        'INVALID_STRUCTURED_DATA', 'Quantity must be a positive numeric cell.');
      check(typeof unitPrice?.value === 'number' && Number.isFinite(unitPrice.value) && unitPrice.value >= 0 && unitPrice.value <= 1e9,
        'INVALID_STRUCTURED_DATA', 'Unit price must be a nonnegative numeric cell.');
      rows.push({ sourceRow: row, description: description.value.trim(), quantity: quantity.value, unitPrice: unitPrice.value, currency: input.currency });
    }
    return { trust, schemaVersion: 1 as const, target: 'jobQuoteLines' as const, tenantId: this.actor.tenantId,
      source: { fileId: source.fileId, revision: source.revision, range: source.range },
      rows, requiresHumanApproval: true as const, committed: false as const };
  }
}

/** Call only from the human approval endpoint using a freshly authenticated human actor.
 * Never register this function in an AI provider's tool registry.
 */
export async function approveOfficeProposal(service: OfficeServicePort, humanActor: OfficeActor, input: {
  fileId: string; proposalId: string; expectedRevision: number; idempotencyKey: string;
}): Promise<OfficeResponse> {
  guardActor(humanActor, true);
  check(humanActor.principal === 'human', 'HUMAN_APPROVAL_REQUIRED', 'Explicit human approval required.', 403);
  return service.request(humanActor, { op: 'approve', id: id(input.fileId), proposalId: id(input.proposalId),
    expectedRevision: input.expectedRevision, idempotencyKey: id(input.idempotencyKey) });
}
