import type { OfficeLocale } from '@diriqo/office/core'

export const officeUploadStatuses = {
  OFFICE_UPLOAD_INVALID: 400,
  OFFICE_IMPORT_FORMAT: 422,
  OFFICE_IMPORT_PROTECTED: 422,
  OFFICE_IMPORT_LIMIT: 413,
  OFFICE_IMPORT_TIMEOUT: 422,
  OFFICE_IMPORT_RUNTIME: 503,
  OFFICE_HOST_LIMIT: 413,
} as const
export type OfficeUploadErrorCode = keyof typeof officeUploadStatuses
type UploadMessages = Record<OfficeUploadErrorCode, string>

export const officeUploadMessages: Record<OfficeLocale, UploadMessages> = {
  cs: {
    OFFICE_UPLOAD_INVALID: 'Soubor se nepodařilo přijmout. Vyberte jej znovu a zopakujte nahrání.',
    OFFICE_IMPORT_FORMAT: 'Soubor je poškozený nebo obsahuje nepodporovanou variantu formátu. Zkuste jej otevřít v původním editoru a uložit novou kopii jako DOCX, ODT nebo XLSX.',
    OFFICE_IMPORT_PROTECTED: 'Import byl odmítnut kvůli šifrování, makrům nebo jinému aktivnímu obsahu. Použijte zkontrolovanou kopii bez ochrany a aktivních prvků.',
    OFFICE_IMPORT_LIMIT: 'Dokument překračuje bezpečné limity zpracování. Zmenšete jej nebo rozdělte na menší soubory.',
    OFFICE_IMPORT_TIMEOUT: 'Zpracování dokumentu trvalo příliš dlouho. Zkuste jednodušší nebo menší kopii souboru.',
    OFFICE_IMPORT_RUNTIME: 'Import teď na serveru není dostupný. Zkuste jej později; původní soubor nebyl změněn.',
    OFFICE_HOST_LIMIT: 'Soubor nebo jeho rozbalený obsah překračuje limit tohoto nasazení. Pro nahrání použijte soubor do 3 MiB nebo menší dokument.',
  },
  sk: {
    OFFICE_UPLOAD_INVALID: 'Súbor sa nepodarilo prijať. Vyberte ho znova a zopakujte nahranie.',
    OFFICE_IMPORT_FORMAT: 'Súbor je poškodený alebo obsahuje nepodporovaný variant formátu. Otvorte ho v pôvodnom editore a uložte novú kópiu ako DOCX, ODT alebo XLSX.',
    OFFICE_IMPORT_PROTECTED: 'Import bol odmietnutý pre šifrovanie, makrá alebo iný aktívny obsah. Použite skontrolovanú kópiu bez ochrany a aktívnych prvkov.',
    OFFICE_IMPORT_LIMIT: 'Dokument prekračuje bezpečné limity spracovania. Zmenšite ho alebo rozdeľte na menšie súbory.',
    OFFICE_IMPORT_TIMEOUT: 'Spracovanie dokumentu trvalo príliš dlho. Skúste jednoduchšiu alebo menšiu kópiu súboru.',
    OFFICE_IMPORT_RUNTIME: 'Import teraz na serveri nie je dostupný. Skúste to neskôr; pôvodný súbor nebol zmenený.',
    OFFICE_HOST_LIMIT: 'Súbor alebo jeho rozbalený obsah prekračuje limit tohto nasadenia. Na nahranie použite súbor do 3 MiB alebo menší dokument.',
  },
  en: {
    OFFICE_UPLOAD_INVALID: 'The file could not be received. Select it again and retry the upload.',
    OFFICE_IMPORT_FORMAT: 'The file is damaged or uses an unsupported format variant. Open it in its original editor and save a new copy as DOCX, ODT or XLSX.',
    OFFICE_IMPORT_PROTECTED: 'Import was rejected because of encryption, macros or other active content. Use a reviewed copy without protection or active elements.',
    OFFICE_IMPORT_LIMIT: 'The document exceeds safe processing limits. Reduce it or split it into smaller files.',
    OFFICE_IMPORT_TIMEOUT: 'Processing the document took too long. Try a simpler or smaller copy of the file.',
    OFFICE_IMPORT_RUNTIME: 'Import is temporarily unavailable on the server. Try again later; the original file was not changed.',
    OFFICE_HOST_LIMIT: 'The file or its expanded content exceeds this deployment limit. Upload a file of up to 3 MiB or a smaller document.',
  },
  de: {
    OFFICE_UPLOAD_INVALID: 'Die Datei konnte nicht empfangen werden. Wählen Sie sie erneut aus und wiederholen Sie den Upload.',
    OFFICE_IMPORT_FORMAT: 'Die Datei ist beschädigt oder verwendet eine nicht unterstützte Formatvariante. Öffnen Sie sie im ursprünglichen Editor und speichern Sie eine neue Kopie als DOCX, ODT oder XLSX.',
    OFFICE_IMPORT_PROTECTED: 'Der Import wurde wegen Verschlüsselung, Makros oder anderer aktiver Inhalte abgelehnt. Verwenden Sie eine geprüfte Kopie ohne Schutz und aktive Elemente.',
    OFFICE_IMPORT_LIMIT: 'Das Dokument überschreitet die sicheren Verarbeitungsgrenzen. Verkleinern Sie es oder teilen Sie es in kleinere Dateien auf.',
    OFFICE_IMPORT_TIMEOUT: 'Die Verarbeitung hat zu lange gedauert. Versuchen Sie eine einfachere oder kleinere Dateikopie.',
    OFFICE_IMPORT_RUNTIME: 'Der Import ist auf dem Server vorübergehend nicht verfügbar. Versuchen Sie es später erneut; die Originaldatei wurde nicht verändert.',
    OFFICE_HOST_LIMIT: 'Die Datei oder ihr entpackter Inhalt überschreitet die Grenze dieser Bereitstellung. Laden Sie eine Datei bis 3 MiB oder ein kleineres Dokument hoch.',
  },
  pl: {
    OFFICE_UPLOAD_INVALID: 'Nie udało się odebrać pliku. Wybierz go ponownie i powtórz przesyłanie.',
    OFFICE_IMPORT_FORMAT: 'Plik jest uszkodzony lub używa nieobsługiwanej odmiany formatu. Otwórz go w oryginalnym edytorze i zapisz nową kopię jako DOCX, ODT lub XLSX.',
    OFFICE_IMPORT_PROTECTED: 'Import odrzucono z powodu szyfrowania, makr lub innej aktywnej zawartości. Użyj sprawdzonej kopii bez ochrony i aktywnych elementów.',
    OFFICE_IMPORT_LIMIT: 'Dokument przekracza bezpieczne limity przetwarzania. Zmniejsz go lub podziel na mniejsze pliki.',
    OFFICE_IMPORT_TIMEOUT: 'Przetwarzanie dokumentu trwało zbyt długo. Spróbuj prostszej lub mniejszej kopii pliku.',
    OFFICE_IMPORT_RUNTIME: 'Import jest chwilowo niedostępny na serwerze. Spróbuj później; oryginalny plik nie został zmieniony.',
    OFFICE_HOST_LIMIT: 'Plik lub jego rozpakowana zawartość przekracza limit tego wdrożenia. Prześlij plik do 3 MiB lub mniejszy dokument.',
  },
  tr: {
    OFFICE_UPLOAD_INVALID: 'Dosya alınamadı. Dosyayı yeniden seçip yüklemeyi tekrar deneyin.',
    OFFICE_IMPORT_FORMAT: 'Dosya bozuk veya desteklenmeyen bir biçim kullanıyor. Özgün düzenleyicisinde açıp DOCX, ODT veya XLSX olarak yeni bir kopya kaydedin.',
    OFFICE_IMPORT_PROTECTED: 'Şifreleme, makro veya başka etkin içerik nedeniyle içe aktarma reddedildi. Koruma ve etkin öğeler içermeyen, kontrol edilmiş bir kopya kullanın.',
    OFFICE_IMPORT_LIMIT: 'Belge güvenli işleme sınırlarını aşıyor. Küçültün veya daha küçük dosyalara bölün.',
    OFFICE_IMPORT_TIMEOUT: 'Belgenin işlenmesi çok uzun sürdü. Daha basit veya daha küçük bir dosya kopyası deneyin.',
    OFFICE_IMPORT_RUNTIME: 'Sunucuda içe aktarma geçici olarak kullanılamıyor. Daha sonra tekrar deneyin; özgün dosya değiştirilmedi.',
    OFFICE_HOST_LIMIT: 'Dosya veya açılmış içeriği bu kurulumun sınırını aşıyor. En fazla 3 MiB boyutunda bir dosya veya daha küçük bir belge yükleyin.',
  },
  sq: {
    OFFICE_UPLOAD_INVALID: 'Skedari nuk u pranua. Zgjidheni përsëri dhe riprovoni ngarkimin.',
    OFFICE_IMPORT_FORMAT: 'Skedari është i dëmtuar ose përdor një variant formati që nuk mbështetet. Hapeni në redaktuesin origjinal dhe ruani një kopje të re si DOCX, ODT ose XLSX.',
    OFFICE_IMPORT_PROTECTED: 'Importi u refuzua për shkak të enkriptimit, makrove ose përmbajtjes tjetër aktive. Përdorni një kopje të kontrolluar pa mbrojtje dhe elemente aktive.',
    OFFICE_IMPORT_LIMIT: 'Dokumenti tejkalon kufijtë e sigurt të përpunimit. Zvogëlojeni ose ndajeni në skedarë më të vegjël.',
    OFFICE_IMPORT_TIMEOUT: 'Përpunimi i dokumentit zgjati shumë. Provoni një kopje më të thjeshtë ose më të vogël.',
    OFFICE_IMPORT_RUNTIME: 'Importi nuk është përkohësisht i disponueshëm në server. Provoni më vonë; skedari origjinal nuk është ndryshuar.',
    OFFICE_HOST_LIMIT: 'Skedari ose përmbajtja e tij e hapur tejkalon kufirin e këtij instalimi. Ngarkoni një skedar deri në 3 MiB ose një dokument më të vogël.',
  },
}

/** Unknown codes and response text are never rendered as parser diagnostics. */
export function officeUploadUserMessage(code: unknown, locale: OfficeLocale): string | undefined {
  if (typeof code !== 'string' || !Object.hasOwn(officeUploadStatuses, code)) return undefined
  const language = Object.hasOwn(officeUploadMessages, locale) ? locale : 'cs'
  return officeUploadMessages[language][code as OfficeUploadErrorCode]
}
