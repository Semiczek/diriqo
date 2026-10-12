import type { SpreadsheetContent } from './types.ts';
/** Deliberately bounded A1-only grammar. This analyzes dependencies; it never evaluates formulas. */
export declare const FORMULA_GRAPH_LIMITS: Readonly<{
    rows: 10000;
    columns: 256;
    sheets: 32;
    formulas: 2000;
    formulaLength: 4096;
    tokens: 2048;
    depth: 64;
    functionArguments: 255;
    referencesPerFormula: 100000;
    expandedReferences: 200000;
    scannedCells: 100000;
}>;
export declare const OFFICE_FORMULA_FUNCTIONS: readonly ["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA", "IF", "AND", "OR", "SUMIF", "COUNTIF", "ROUND", "IFERROR", "NOT", "ABS", "ROUNDUP", "ROUNDDOWN", "VLOOKUP", "HLOOKUP", "MATCH", "INDEX", "TODAY", "DATE", "YEAR", "MONTH", "DAY", "TIMEVALUE"];
export type FormulaGraphCode = 'FORMULA_WORKBOOK' | 'FORMULA_SYNTAX' | 'FORMULA_UNSUPPORTED_FUNCTION' | 'FORMULA_NAMED_REFERENCE' | 'FORMULA_UNKNOWN_SHEET' | 'FORMULA_REFERENCE_BOUNDS' | 'FORMULA_LIMIT' | 'FORMULA_CYCLE' | 'FORMULA_UNSAFE';
export declare class FormulaGraphError extends Error {
    readonly code: FormulaGraphCode;
    readonly status = 400;
    readonly cell?: string;
    readonly details?: Record<string, unknown>;
    constructor(code: FormulaGraphCode, message: string, cell?: string, details?: Record<string, unknown>);
}
export type FormulaSheetDescriptor = {
    id: string;
    name: string;
    rowCount: number;
    columnCount: number;
};
export type FormulaReference = {
    sheetId: string;
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
};
export type FormulaReferenceResult = {
    references: FormulaReference[];
    expandedReferences: number;
};
export type FormulaGraphStats = {
    formulaCount: number;
    expandedReferences: number;
    dependencyEdges: number;
};
/** Returns bounded rectangles, never a potentially huge materialized coordinate list. */
export declare function parseFormulaReferences(formula: string, options: {
    sheetId: string;
    sheets: readonly FormulaSheetDescriptor[];
    cell?: string;
}): FormulaReferenceResult;
/** Call before every engine execution and before accepting imported, saved or proposed workbook content. */
export declare function assertFormulaGraph(content: SpreadsheetContent): FormulaGraphStats;
