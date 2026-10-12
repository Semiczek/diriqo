import type { OfficeContent, OfficeRequest } from './types.ts';
export declare class OfficeError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status?: number);
}
export declare function check(ok: unknown, code: string, message: string, status?: number): asserts ok;
export declare function obj(x: unknown): x is Record<string, any>;
export declare function id(x: unknown): string;
export declare function title(x: unknown, max?: number): string;
export declare const OFFICE_LIMITS: {
    readonly contentBytes: 8000000;
    readonly originalBytes: number;
    readonly cells: 100000;
    readonly rows: 100000;
    readonly columns: 16384;
    readonly sheets: 64;
};
export declare function validateContent(x: unknown): OfficeContent;
export declare function validateRequest(x: unknown): OfficeRequest;
