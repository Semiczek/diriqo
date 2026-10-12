import type { OfficeLocale } from '@diriqo/office/core'

type ContextMessages = { checking: string; changed: string; unavailable: string; recovery: string; verify: string; open: string }
export const officeContextMessages: Record<OfficeLocale, ContextMessages> = {
  cs: {
    checking: 'Ověřujeme aktivní firmu. Ukládání je dočasně pozastavené.',
    changed: 'V jiném panelu se změnila firma, účet nebo oprávnění. Tento dokument zůstává v původní firmě a ukládání je pozastavené.',
    unavailable: 'Aktuální přístup nelze ověřit. Ukládání je pozastavené; rozepsaný dokument zůstává v tomto panelu.',
    recovery: 'Použijte „Stáhnout pracovní zálohu“. Pro uložení do původní firmy ji znovu vyberte v druhém panelu, ověřte přístup a zopakujte Uložit. Aktuální firmu můžete otevřít v novém panelu.',
    verify: 'Ověřit přístup znovu', open: 'Otevřít aktuální firmu v novém panelu',
  },
  sk: {
    checking: 'Overujeme aktívnu firmu. Ukladanie je dočasne pozastavené.',
    changed: 'V inom paneli sa zmenila firma, účet alebo oprávnenia. Tento dokument zostáva v pôvodnej firme a ukladanie je pozastavené.',
    unavailable: 'Aktuálny prístup sa nedá overiť. Ukladanie je pozastavené; rozpracovaný dokument zostáva v tomto paneli.',
    recovery: 'Použite „Stiahnuť pracovnú zálohu“. Pre uloženie do pôvodnej firmy ju znova vyberte v druhom paneli, overte prístup a zopakujte Uložiť. Aktuálnu firmu môžete otvoriť v novom paneli.',
    verify: 'Znova overiť prístup', open: 'Otvoriť aktuálnu firmu v novom paneli',
  },
  en: {
    checking: 'Checking the active company. Saving is temporarily paused.',
    changed: 'The company, account or permissions changed in another tab. This document still belongs to the original company and saving is paused.',
    unavailable: 'Current access could not be verified. Saving is paused; your draft stays in this tab.',
    recovery: 'Use “Download working backup”. To save to the original company, select it again in the other tab, verify access and retry Save. You can open the active company in a new tab.',
    verify: 'Check access again', open: 'Open active company in a new tab',
  },
  de: {
    checking: 'Das aktive Unternehmen wird geprüft. Das Speichern ist vorübergehend pausiert.',
    changed: 'Unternehmen, Konto oder Berechtigungen wurden in einem anderen Tab geändert. Dieses Dokument gehört weiterhin zum ursprünglichen Unternehmen. Das Speichern ist pausiert.',
    unavailable: 'Der aktuelle Zugriff konnte nicht geprüft werden. Das Speichern ist pausiert; Ihr Entwurf bleibt in diesem Tab.',
    recovery: 'Wählen Sie „Arbeitskopie herunterladen“. Zum Speichern im ursprünglichen Unternehmen wählen Sie es im anderen Tab erneut aus, prüfen den Zugriff und wählen erneut Speichern. Das aktive Unternehmen lässt sich in einem neuen Tab öffnen.',
    verify: 'Zugriff erneut prüfen', open: 'Aktives Unternehmen in neuem Tab öffnen',
  },
  pl: {
    checking: 'Sprawdzamy aktywną firmę. Zapisywanie jest chwilowo wstrzymane.',
    changed: 'W innej karcie zmieniono firmę, konto lub uprawnienia. Ten dokument nadal należy do poprzedniej firmy, a zapisywanie jest wstrzymane.',
    unavailable: 'Nie można zweryfikować dostępu. Zapisywanie jest wstrzymane; wersja robocza pozostaje w tej karcie.',
    recovery: 'Wybierz „Pobierz kopię roboczą”. Aby zapisać w poprzedniej firmie, wybierz ją ponownie w innej karcie, sprawdź dostęp i ponów Zapisz. Aktywną firmę możesz otworzyć w nowej karcie.',
    verify: 'Sprawdź dostęp ponownie', open: 'Otwórz aktywną firmę w nowej karcie',
  },
  tr: {
    checking: 'Etkin şirket doğrulanıyor. Kaydetme geçici olarak duraklatıldı.',
    changed: 'Başka bir sekmede şirket, hesap veya izinler değişti. Bu belge hâlâ önceki şirkete aittir ve kaydetme duraklatıldı.',
    unavailable: 'Geçerli erişim doğrulanamadı. Kaydetme duraklatıldı; taslağınız bu sekmede kalır.',
    recovery: '“Çalışma yedeğini indir” seçeneğini kullanın. Önceki şirkete kaydetmek için diğer sekmede o şirketi tekrar seçin, erişimi doğrulayın ve Kaydet işlemini yineleyin. Etkin şirketi yeni sekmede açabilirsiniz.',
    verify: 'Erişimi tekrar doğrula', open: 'Etkin şirketi yeni sekmede aç',
  },
  sq: {
    checking: 'Po verifikohet kompania aktive. Ruajtja është ndalur përkohësisht.',
    changed: 'Kompania, llogaria ose lejet ndryshuan në një skedë tjetër. Ky dokument i përket ende kompanisë fillestare dhe ruajtja është ndalur.',
    unavailable: 'Qasja aktuale nuk mund të verifikohej. Ruajtja është ndalur; drafti mbetet në këtë skedë.',
    recovery: 'Përdorni “Shkarko kopjen e punës”. Për të ruajtur në kompaninë fillestare, zgjidheni përsëri në skedën tjetër, verifikoni qasjen dhe provoni sërish Ruaj. Kompaninë aktive mund ta hapni në një skedë të re.',
    verify: 'Verifiko qasjen përsëri', open: 'Hap kompaninë aktive në një skedë të re',
  },
}

export const officeShellMessages: Record<OfficeLocale, {
  company: string; switchCompany: string; switchHint: string; logout: string; logoutHint: string; switchFailed: string
}> = {
  cs: { company: 'Firma tohoto dokumentu', switchCompany: 'Přepnout aktivní firmu', switchHint: 'Po přepnutí zůstane rozpracovaný dokument v tomto panelu. Novou firmu otevřete samostatným odkazem v novém panelu.', logout: 'Odhlásit v novém panelu', logoutHint: 'Odhlášení otevře potvrzení v novém panelu. Před odhlášením uložte změny nebo stáhněte pracovní zálohu.', switchFailed: 'Firmu se nepodařilo přepnout. Znovu ověřte přístup.' },
  sk: { company: 'Firma tohto dokumentu', switchCompany: 'Prepnúť aktívnu firmu', switchHint: 'Po prepnutí zostane rozpracovaný dokument v tomto paneli. Novú firmu otvoríte samostatným odkazom v novom paneli.', logout: 'Odhlásiť v novom paneli', logoutHint: 'Odhlásenie otvorí potvrdenie v novom paneli. Pred odhlásením uložte zmeny alebo stiahnite pracovnú zálohu.', switchFailed: 'Firmu sa nepodarilo prepnúť. Znova overte prístup.' },
  en: { company: 'Company for this document', switchCompany: 'Switch active company', switchHint: 'Your draft stays in this tab after switching. Open the new company using the separate link in a new tab.', logout: 'Sign out in a new tab', logoutHint: 'Sign-out opens a confirmation in a new tab. Save your changes or download a working backup first.', switchFailed: 'The company could not be switched. Check access again.' },
  de: { company: 'Unternehmen dieses Dokuments', switchCompany: 'Aktives Unternehmen wechseln', switchHint: 'Ihr Entwurf bleibt nach dem Wechsel in diesem Tab. Öffnen Sie das neue Unternehmen über den separaten Link in einem neuen Tab.', logout: 'In neuem Tab abmelden', logoutHint: 'Die Abmeldung öffnet eine Bestätigung in einem neuen Tab. Speichern Sie vorher Ihre Änderungen oder laden Sie eine Arbeitskopie herunter.', switchFailed: 'Das Unternehmen konnte nicht gewechselt werden. Prüfen Sie den Zugriff erneut.' },
  pl: { company: 'Firma tego dokumentu', switchCompany: 'Zmień aktywną firmę', switchHint: 'Po zmianie wersja robocza pozostanie w tej karcie. Nową firmę otwórz osobnym linkiem w nowej karcie.', logout: 'Wyloguj w nowej karcie', logoutHint: 'Wylogowanie otwiera potwierdzenie w nowej karcie. Najpierw zapisz zmiany lub pobierz kopię roboczą.', switchFailed: 'Nie udało się zmienić firmy. Sprawdź dostęp ponownie.' },
  tr: { company: 'Bu belgenin şirketi', switchCompany: 'Etkin şirketi değiştir', switchHint: 'Şirket değiştikten sonra taslağınız bu sekmede kalır. Yeni şirketi ayrı bağlantıyla yeni sekmede açın.', logout: 'Yeni sekmede çıkış yap', logoutHint: 'Çıkış onayı yeni sekmede açılır. Önce değişikliklerinizi kaydedin veya çalışma yedeğini indirin.', switchFailed: 'Şirket değiştirilemedi. Erişimi tekrar doğrulayın.' },
  sq: { company: 'Kompania e këtij dokumenti', switchCompany: 'Ndrysho kompaninë aktive', switchHint: 'Drafti mbetet në këtë skedë pas ndryshimit. Hapeni kompaninë e re me lidhjen e veçantë në një skedë të re.', logout: 'Dil nga llogaria në skedë të re', logoutHint: 'Dalja hap një konfirmim në skedë të re. Ruani ndryshimet ose shkarkoni një kopje pune më parë.', switchFailed: 'Kompania nuk mund të ndryshohej. Verifikoni qasjen përsëri.' },
}
