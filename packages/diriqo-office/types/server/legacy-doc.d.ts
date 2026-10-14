import type { DocumentContent } from '../core/types.ts';
/** Import main-story text from genuine Word 97–2007 binary DOC. There is no DOC writer. */
export declare function importDoc(input: Uint8Array): {
    content: DocumentContent;
    warnings: string[];
};
