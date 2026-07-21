update public.legal_document_versions
set is_active = false
where type = 'cookies'
  and locale = 'cs';

insert into public.legal_document_versions (
  type,
  version,
  title,
  content,
  locale,
  published_at,
  is_active
)
values (
  'cookies',
  '2026.07.21',
  'Cookies a podobné technologie',
  $legal$
Diriqo používá nezbytné cookies a lokální úložiště pro přihlášení, bezpečnost, relaci, jazyk, aktivní firmu, zapamatování cookie volby a základní fungování aplikace. Bez nich nelze službu spolehlivě poskytovat.

Aplikace může ukládat volby uživatele, například jazyk, stav onboarding průvodce, lokální pracovní stav, dočasné hodnoty formulářů nebo informace potřebné pro offline režim.

Diriqo může po souhlasu uživatele používat Vercel Web Analytics pro agregované měření návštěvnosti a používaných stránek. Analytika se nespouští před udělením souhlasu a preference lze později změnit.

Do analytiky neposíláme e-mail, jméno uživatele, obsah firemních dat ani query parametry. Cesty s tokeny nebo identifikátory aplikace rediguje na obecné názvy tras.

Marketingové cookies nejsou v současné verzi aktivní. Pokud budou později přidány, budou řešeny oddělenou volbou souhlasu.
$legal$,
  'cs',
  '2026-07-21 00:00:00+00',
  true
)
on conflict (type, version, locale) do update
set
  title = excluded.title,
  content = excluded.content,
  published_at = excluded.published_at,
  is_active = excluded.is_active;

notify pgrst, 'reload schema';
