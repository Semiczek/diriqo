/** Original bounded OpenFormula/A1 translator; no evaluator or third-party source. */
export declare class OdfFormulaError extends Error {
    readonly code: 'UNSAFE_FORMULA' | 'UNSUPPORTED_FORMULA';
    constructor(message: string, code?: 'UNSAFE_FORMULA' | 'UNSUPPORTED_FORMULA');
}
export declare const officeFormulaToOdf: (formula: string) => string;
export declare const odfFormulaToOffice: (formula: string) => string;
