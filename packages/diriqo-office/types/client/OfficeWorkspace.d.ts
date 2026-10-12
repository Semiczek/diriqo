import React from 'react';
import type { OfficeLocale, OfficeTransport } from '../core/types';
export type OfficeWorkspaceProps = {
    transport: OfficeTransport;
    locale?: OfficeLocale;
    readOnly?: boolean;
    title?: string;
};
/** Host must guard a tenant switch against unsaved edits, then remount with key={tenantId}. */
export declare function OfficeWorkspace({ transport, locale, readOnly, title }: OfficeWorkspaceProps): React.JSX.Element;
export default OfficeWorkspace;
