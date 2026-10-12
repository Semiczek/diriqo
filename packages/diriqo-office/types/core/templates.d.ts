import type { DocumentContent, OfficeContent, SpreadsheetContent } from './types.ts';
export type TemplateId = 'quote' | 'workReport' | 'handover' | 'estimate' | 'attendance' | 'letter';
export type TemplateVariables = {
    companyName: string;
    customerName: string;
    jobName: string;
    date: string;
    price: number;
    currency: string;
};
export declare const TEMPLATE_VARIABLES: Readonly<{
    readonly companyName: "string";
    readonly customerName: "string";
    readonly jobName: "string";
    readonly date: "date";
    readonly price: "number";
    readonly currency: "currency";
}>;
export declare const OFFICE_TEMPLATES: readonly {
    id: TemplateId;
    kind: 'document' | 'spreadsheet';
    title: string;
}[];
export declare function blankDocument(): DocumentContent;
export declare function blankSpreadsheet(): SpreadsheetContent;
export declare function validateTemplateVariables(input: Partial<TemplateVariables>): TemplateVariables;
export declare function createTemplate(id: TemplateId, input?: Partial<TemplateVariables>): OfficeContent;
