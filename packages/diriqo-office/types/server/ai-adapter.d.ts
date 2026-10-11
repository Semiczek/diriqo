import type { OfficeActor, OfficeContent, OfficeProposal, OfficeRequest, OfficeResponse } from '../core/types.ts';
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
export type OfficeAICostPort = {
    record(event: OfficeAICostEvent): Promise<void>;
};
export type OfficeRange = {
    sheetId: string;
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
};
export type OfficeDiff = {
    entries: Array<{
        path: string;
        before: string;
        after: string;
    }>;
    truncated: boolean;
};
export type OfficeAIExport = {
    name: string;
    mime: string;
    base64: string;
    warnings: string[];
};
export type OfficeAIOptions = {
    exportFile?: (content: OfficeContent, title: string, format: string) => Promise<OfficeAIExport>;
    costs?: OfficeAICostPort;
};
export declare function compareOfficeContent(before: OfficeContent, after: OfficeContent): OfficeDiff;
/** Construct only in a server handler after authenticating the user and active company.
 * AI tool registries must use this allowlist; human approval is a separate server operation.
 */
export declare class OfficeAIAdapter {
    static readonly toolNames: readonly ["search", "readContent", "readRange", "metadata", "propose", "compare", "export", "prepareQuoteLines"];
    private readonly service;
    private readonly actor;
    private readonly options;
    constructor(service: OfficeServicePort, actor: OfficeActor, options?: OfficeAIOptions);
    private file;
    search(query?: string, afterId?: string): Promise<{
        trust: "untrusted_document_data";
        nextCursor: string | null;
        files: {
            id: string;
            title: string;
            kind: "document" | "spreadsheet" | "folder";
            revision: number;
            parentId: string | null;
            link: import("../core/types.ts").OfficeLink | null;
        }[];
    }>;
    readContent(fileId: string): Promise<{
        trust: "untrusted_document_data";
        fileId: string;
        revision: number;
        title: string;
        content: OfficeContent | null;
    }>;
    readRange(fileId: string, range: OfficeRange): Promise<{
        trust: "untrusted_document_data";
        fileId: string;
        revision: number;
        sheetId: string;
        range: {
            sheetId: string;
            startRow: number;
            endRow: number;
            startColumn: number;
            endColumn: number;
        };
        cells: {
            row: number;
            column: number;
            value: string | number | boolean | null;
            formula: string | null;
        }[];
    }>;
    metadata(fileId: string): Promise<{
        trust: "untrusted_document_data";
        fileId: string;
        revision: number;
        kind: "document" | "spreadsheet" | "folder";
        original: {
            name: string;
            mime: string;
            size: number;
            sha256: string;
        } | null;
        link: import("../core/types.ts").OfficeLink | null;
        page: {
            marginMm: number;
            header: string;
            footer: string;
        } | null;
        locale?: undefined;
        sheets?: undefined;
        formulas?: undefined;
        totalFormulas?: undefined;
        formulasTruncated?: undefined;
    } | {
        trust: "untrusted_document_data";
        fileId: string;
        revision: number;
        kind: "document" | "spreadsheet" | "folder";
        locale: any;
        original: {
            name: string;
            mime: string;
            size: number;
            sha256: string;
        } | null;
        link: import("../core/types.ts").OfficeLink | null;
        sheets: any;
        formulas: {
            sheetId: string;
            row: number;
            column: number;
            formula: string;
        }[];
        totalFormulas: number;
        formulasTruncated: boolean;
        page?: undefined;
    }>;
    propose(input: {
        fileId: string;
        expectedRevision: number;
        content: OfficeContent;
        summary: string;
        idempotencyKey: string;
    }): Promise<{
        trust: "untrusted_document_data";
        proposal: OfficeProposal;
        diff: OfficeDiff;
        requiresHumanApproval: true;
    }>;
    compare(fileId: string, proposalId: string): Promise<{
        trust: "untrusted_document_data";
        fileId: string;
        proposalId: string;
        currentRevision: number;
        baseRevision: number;
        stale: boolean;
        diff: OfficeDiff;
    }>;
    export(fileId: string, format: string): Promise<{
        trust: "untrusted_document_data";
        sourceFileId: string;
        sourceRevision: number;
        artifact: OfficeAIExport;
    }>;
    prepareQuoteLines(input: {
        fileId: string;
        range: OfficeRange;
        currency: string;
        descriptionColumn: number;
        quantityColumn: number;
        unitPriceColumn: number;
    }): Promise<{
        trust: "untrusted_document_data";
        schemaVersion: 1;
        target: "jobQuoteLines";
        tenantId: string;
        source: {
            fileId: string;
            revision: number;
            range: {
                sheetId: string;
                startRow: number;
                endRow: number;
                startColumn: number;
                endColumn: number;
            };
        };
        rows: {
            sourceRow: number;
            description: string;
            quantity: number;
            unitPrice: number;
            currency: string;
        }[];
        requiresHumanApproval: true;
        committed: false;
    }>;
}
/** Call only from the human approval endpoint using a freshly authenticated human actor.
 * Never register this function in an AI provider's tool registry.
 */
export declare function approveOfficeProposal(service: OfficeServicePort, humanActor: OfficeActor, input: {
    fileId: string;
    proposalId: string;
    expectedRevision: number;
    idempotencyKey: string;
}): Promise<OfficeResponse>;
