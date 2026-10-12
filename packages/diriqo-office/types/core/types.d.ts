/** Host-neutral contract. Actor and tenant must originate in an authenticated server guard. */
export type OfficeRole = 'owner' | 'editor' | 'reader';
export type OfficeActor = {
    tenantId: string;
    actorId: string;
    role: OfficeRole;
    enabled: boolean;
    principal: 'human' | 'ai';
};
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export type DocumentContent = {
    schemaVersion: 1;
    kind: 'document';
    doc: Record<string, any>;
    page: {
        marginMm: number;
        header: string;
        footer: string;
    };
};
export type SpreadsheetContent = {
    schemaVersion: 1;
    kind: 'spreadsheet';
    workbook: Record<string, any>;
};
export type OfficeContent = DocumentContent | SpreadsheetContent;
export type OfficeLink = {
    type: 'job' | 'customer';
    id: string;
    label: string;
};
export type OfficeFile = {
    id: string;
    tenantId: string;
    ownerId: string;
    ownerName?: string;
    access?: {
        canWrite: boolean;
        canDelete: boolean;
        canShare: boolean;
    };
    title: string;
    kind: 'document' | 'spreadsheet' | 'folder';
    parentId: string | null;
    revision: number;
    content: OfficeContent | null;
    updatedAt: string;
    link: OfficeLink | null;
    original?: {
        name: string;
        mime: string;
        size: number;
        sha256: string;
    } | null;
};
export type OfficeVersion = {
    revision: number;
    createdAt: string;
    actorId: string;
    content: OfficeContent | null;
    title: string;
};
export type OfficeProposal = {
    id: string;
    fileId: string;
    baseRevision: number;
    status: 'pending' | 'applied' | 'rejected';
    summary: string;
    content: OfficeContent;
    createdBy: string;
    createdAt: string;
};
export type OfficeVersionSummary = Omit<OfficeVersion, 'content'>;
export type OfficeProposalSummary = Omit<OfficeProposal, 'content'>;
export type OfficeRequest = {
    op: 'list';
    query?: string;
    parentId?: string | null;
} | {
    op: 'listFiles';
    query?: string;
    parentId?: string | null;
    afterId?: string;
    limit?: number;
    foldersOnly?: boolean;
} | {
    op: 'listVersions';
    id: string;
    beforeRevision?: number;
    limit?: number;
} | {
    op: 'readVersion';
    id: string;
    revision: number;
} | {
    op: 'listProposals';
    id: string;
    afterId?: string;
    limit?: number;
} | {
    op: 'readProposal';
    id: string;
    proposalId: string;
} | {
    op: 'read';
    id: string;
} | {
    op: 'create';
    title: string;
    kind: OfficeFile['kind'];
    content?: OfficeContent;
    parentId?: string | null;
    idempotencyKey: string;
} | {
    op: 'save';
    id: string;
    expectedRevision: number;
    content: OfficeContent;
    idempotencyKey: string;
} | {
    op: 'rename';
    id: string;
    expectedRevision: number;
    title: string;
    idempotencyKey: string;
} | {
    op: 'move';
    id: string;
    expectedRevision: number;
    parentId: string | null;
    idempotencyKey: string;
} | {
    op: 'copy';
    id: string;
    title: string;
    idempotencyKey: string;
} | {
    op: 'delete';
    id: string;
    expectedRevision: number;
    idempotencyKey: string;
} | {
    op: 'versions';
    id: string;
} | {
    op: 'restore';
    id: string;
    expectedRevision: number;
    revision: number;
    idempotencyKey: string;
} | {
    op: 'link';
    id: string;
    expectedRevision: number;
    type: 'job' | 'customer';
    entityId: string;
    idempotencyKey: string;
} | {
    op: 'permissions';
    id: string;
} | {
    op: 'propose';
    id: string;
    expectedRevision: number;
    content: OfficeContent;
    summary: string;
    idempotencyKey: string;
} | {
    op: 'proposals';
    id: string;
} | {
    op: 'approve';
    id: string;
    proposalId: string;
    expectedRevision: number;
    idempotencyKey: string;
} | {
    op: 'reject';
    id: string;
    proposalId: string;
    idempotencyKey: string;
};
export type OfficeResponse = {
    files?: OfficeFile[];
    file?: OfficeFile;
    versions?: OfficeVersion[];
    version?: OfficeVersion;
    versionSummaries?: OfficeVersionSummary[];
    proposal?: OfficeProposal;
    proposals?: OfficeProposal[];
    proposalSummaries?: OfficeProposalSummary[];
    nextCursor?: string | null;
    permissions?: {
        role: OfficeRole;
        ownerId: string;
        canWrite: boolean;
        canDelete: boolean;
    };
    deleted?: boolean;
};
export type OfficePerson = {
    id: string;
    name: string;
};
export type OfficeSharingState = {
    fileId: string;
    owner: OfficePerson;
    visibility: 'restricted' | 'private' | 'company';
    revision: number;
    canManage: boolean;
    members: Array<OfficePerson & {
        role: 'reader' | 'editor';
    }>;
    colleagues: OfficePerson[];
    automaticReaders?: OfficePerson[];
};
export type OfficeSharingUpdate = {
    fileId: string;
    expectedRevision: number;
    memberId: string;
    role: 'reader' | 'editor' | null;
    idempotencyKey: string;
};
export type OfficeTransport = {
    request: (request: OfficeRequest) => Promise<OfficeResponse>;
    importFile: (data: FormData) => Promise<{
        file: OfficeFile;
        warnings: string[];
    }>;
    exportFile: (id: string, format: string) => Promise<{
        name: string;
        mime: string;
        base64: string;
        warnings: string[];
    }>;
    templateVariables?: (link?: {
        type: 'job' | 'customer';
        id: string;
    }) => Promise<Record<string, string | number>>;
    sharingRead?: (id: string, query?: string) => Promise<OfficeSharingState>;
    sharingUpdate?: (input: OfficeSharingUpdate) => Promise<OfficeSharingState>;
};
export type OfficeLocale = 'cs' | 'sk' | 'en' | 'de' | 'pl' | 'tr' | 'sq';
