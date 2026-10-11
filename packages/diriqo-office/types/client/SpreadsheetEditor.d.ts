import React from 'react';
import type { OfficeLocale, SpreadsheetContent } from '../core/types';
export type SpreadsheetEditorProps = {
    content: SpreadsheetContent;
    onChange: (content: SpreadsheetContent) => void;
    readOnly?: boolean;
    disabled?: boolean;
    locale?: OfficeLocale;
};
export declare function SpreadsheetEditor({ content, onChange, readOnly, disabled, locale }: SpreadsheetEditorProps): React.JSX.Element;
export default SpreadsheetEditor;
