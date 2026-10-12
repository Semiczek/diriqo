import React from 'react';
import type { OfficeLocale, OfficeTransport } from '../core/types';
export type OfficeWorkspaceProps = {
    transport: OfficeTransport;
    locale?: OfficeLocale;
    readOnly?: boolean;
    canCreate?: boolean;
    title?: string;
    headerSecondary?: React.ReactNode;
    hideHeader?: boolean;
};
/** Host must guard a tenant switch against unsaved edits, then remount with key={tenantId}. */
export declare function OfficeWorkspace({ transport, locale, readOnly, canCreate, title, headerSecondary, hideHeader }: OfficeWorkspaceProps): React.JSX.Element;
export default OfficeWorkspace;
