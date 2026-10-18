export declare const FORMAT_LIMITS: {
    inputBytes: number;
    expandedBytes: number;
    entryBytes: number;
    entries: number;
    ratio: number;
    cells: number;
    rows: number;
    columns: number;
    sheets: number;
};
export declare function readSafeZip(input: Uint8Array, kind?: 'ooxml' | 'odf'): Record<string, Buffer>;
/** Validate syntax and bound parser recursion before any ODF codec sees the XML. */
export declare function inspectOdfXml(data: Uint8Array): string;
