/** Reads only our hash-pinned, unmodified OFL font. Never accepts uploaded fonts.
 * Original implementation from the OpenType head/hhea/hmtx/cmap specifications. */
export declare function loadPdfFont(): {
    bytes: Buffer<ArrayBuffer>;
    license: string;
    glyph: (code: number) => number;
    width: (code: number) => number;
    bbox: number[];
    ascent: number;
    descent: number;
};
