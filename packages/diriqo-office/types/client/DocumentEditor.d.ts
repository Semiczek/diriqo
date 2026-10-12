import React from 'react';
import type { DocumentContent, OfficeLocale } from '../core/types';
/** Detached template content is inert while pasted content is sanitized. */
export declare function sanitizeOfficePaste(html: string): string;
export type DocumentEditorProps = {
    content: DocumentContent;
    onChange: (content: DocumentContent) => void;
    readOnly?: boolean;
    locale?: OfficeLocale;
};
export declare function DocumentEditor({ content, onChange, readOnly, locale }: DocumentEditorProps): React.JSX.Element;
export default DocumentEditor;
