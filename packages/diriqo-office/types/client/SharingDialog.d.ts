import React from 'react';
import type { OfficeFile, OfficeLocale, OfficeTransport } from '../core/types';
export declare function SharingDialog({ file, transport, locale, onClose, onUpdated }: {
    file: Pick<OfficeFile, 'id' | 'title'>;
    transport: OfficeTransport;
    locale: OfficeLocale;
    onClose: () => void;
    onUpdated?: () => void;
}): React.JSX.Element;
