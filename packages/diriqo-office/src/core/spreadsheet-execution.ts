import type {OfficeContent,OfficeLocale} from './types.ts';
import {assertFormulaGraph, type FormulaGraphStats} from './formula-graph.ts';
// Preserve the previously reviewed interactive engine budget. Larger imports are
// retained losslessly, but must never be sent to Fortune's eager calculation path.
export const SPREADSHEET_EXECUTION_LIMITS=Object.freeze({formulas:2_000,expandedReferences:200_000});
export const CACHED_PREVIEW_MODE='cached-readonly-v1';
export function formulaGraphRequiresPreview(stats:FormulaGraphStats):boolean{
 return stats.formulaCount>SPREADSHEET_EXECUTION_LIMITS.formulas||stats.expandedReferences>SPREADSHEET_EXECUTION_LIMITS.expandedReferences;
}
export function isSpreadsheetCachedPreview(content:OfficeContent|null|undefined):boolean{
 return content?.kind==='spreadsheet'&&(content.workbook.officeCalculationMode===CACHED_PREVIEW_MODE||formulaGraphRequiresPreview(assertFormulaGraph(content)));
}
export const spreadsheetPreviewMessages:Record<OfficeLocale,{title:string;description:string;formula:string;previous:string;next:string;rows:string}>={
 cs:{title:'Náhled složitého sešitu',description:'Zobrazené hodnoty pocházejí z nahraného souboru. Vzorce jsou zachované, ale tento sešit zatím nelze bezpečně přepočítat ani upravovat. Pro úpravy stáhněte originál a otevřete jej v Excelu.',formula:'Vzorec / hodnota',previous:'Předchozí',next:'Další',rows:'Řádky'},
 sk:{title:'Náhľad zložitého zošita',description:'Zobrazené hodnoty pochádzajú z nahraného súboru. Vzorce sú zachované, ale zošit zatiaľ nemožno bezpečne prepočítať ani upravovať. Na úpravy stiahnite originál a otvorte ho v Exceli.',formula:'Vzorec / hodnota',previous:'Predchádzajúce',next:'Ďalšie',rows:'Riadky'},
 en:{title:'Complex workbook preview',description:'Values come from the uploaded file. Formulas are preserved, but this workbook cannot yet be safely recalculated or edited. Download the original and open it in Excel to edit it.',formula:'Formula / value',previous:'Previous',next:'Next',rows:'Rows'},
 de:{title:'Vorschau einer komplexen Arbeitsmappe',description:'Die Werte stammen aus der hochgeladenen Datei. Formeln bleiben erhalten, diese Mappe kann aber noch nicht sicher neu berechnet oder bearbeitet werden. Laden Sie das Original herunter und öffnen Sie es in Excel.',formula:'Formel / Wert',previous:'Zurück',next:'Weiter',rows:'Zeilen'},
 pl:{title:'Podgląd złożonego skoroszytu',description:'Wartości pochodzą z przesłanego pliku. Formuły są zachowane, ale tego skoroszytu nie można jeszcze bezpiecznie przeliczać ani edytować. Pobierz oryginał i otwórz go w Excelu.',formula:'Formuła / wartość',previous:'Poprzednie',next:'Następne',rows:'Wiersze'},
 tr:{title:'Karmaşık çalışma kitabı önizlemesi',description:'Değerler yüklenen dosyadan gelir. Formüller korunur ancak bu kitap henüz güvenli biçimde yeniden hesaplanamaz veya düzenlenemez. Düzenlemek için özgün dosyayı indirip Excel ile açın.',formula:'Formül / değer',previous:'Önceki',next:'Sonraki',rows:'Satırlar'},
 sq:{title:'Pamje paraprake e librit kompleks',description:'Vlerat vijnë nga skedari i ngarkuar. Formulat ruhen, por libri ende nuk mund të rillogaritet ose redaktohet në mënyrë të sigurt. Shkarkoni origjinalin dhe hapeni në Excel për ta redaktuar.',formula:'Formula / vlera',previous:'Mëparshme',next:'Tjetër',rows:'Rreshtat'},
};