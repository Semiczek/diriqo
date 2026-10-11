/** Shared fail-closed boundary before any spreadsheet engine or format converter. */
export function isOfficeFormulaSafe(value:unknown):boolean {
 if(typeof value!=='string')return true;
 // Fortune has an inline-HTML editing path. Raw file/cell values must never enter it.
 if(/<(?:script|iframe|object|img|svg|math|link|style|meta|audio|video|input|textarea|span)\b|javascript:|\bon[a-z]+\s*=/i.test(value))return false;
 if(!value.trimStart().startsWith('='))return true;
 if(value.length>4096||/[\u0000-\u001f]/.test(value))return false;
 return !/(?:https?:|file:|ftp:|data:|\\\\|\[|\]|\|)|\b(?:WEBSERVICE|FILTERXML|HYPERLINK|IMAGE|IMPORTXML|IMPORTDATA|IMPORTHTML|IMPORTRANGE|GOOGLEFINANCE|RTD|CALL|REGISTER(?:\.ID)?|EXEC|EVALUATE|SQL\.REQUEST|DDE)\s*\(/i.test(value);
}
