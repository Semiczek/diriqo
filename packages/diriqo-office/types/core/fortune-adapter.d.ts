import type { Sheet } from '@fortune-sheet/core';
import type { SpreadsheetContent } from './types';
export { isOfficeFormulaSafe } from './formula-policy.ts';
export declare function isFortuneInputSafe(value: unknown): boolean;
export declare function toFortuneSheets(content: SpreadsheetContent, formatter?: (format: string, value: any) => unknown): Sheet[];
export declare function fromFortuneSheets(data: Sheet[], base: SpreadsheetContent): SpreadsheetContent;
