create extension if not exists pgcrypto;

create table if not exists public.legal_document_versions (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  version text not null,
  title text not null,
  content text not null,
  locale text not null default 'cs',
  published_at timestamptz not null default now(),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint legal_document_versions_type_check
    check (type in ('terms', 'privacy', 'cookies', 'dpa', 'security')),
  constraint legal_document_versions_locale_check
    check (locale in ('cs', 'en', 'de')),
  constraint legal_document_versions_version_not_empty
    check (length(btrim(version)) > 0),
  constraint legal_document_versions_title_not_empty
    check (length(btrim(title)) > 0)
);

create unique index if not exists legal_document_versions_type_version_locale_uidx
  on public.legal_document_versions(type, version, locale);

create unique index if not exists legal_document_versions_active_type_locale_uidx
  on public.legal_document_versions(type, locale)
  where is_active = true;

create index if not exists legal_document_versions_type_locale_published_idx
  on public.legal_document_versions(type, locale, published_at desc);

create table if not exists public.user_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  ip_address text null,
  user_agent text null,
  created_at timestamptz not null default now(),
  constraint user_legal_acceptances_document_type_check
    check (document_type in ('terms', 'privacy', 'cookies', 'dpa', 'security')),
  constraint user_legal_acceptances_version_not_empty
    check (length(btrim(version)) > 0)
);

create unique index if not exists user_legal_acceptances_user_document_version_uidx
  on public.user_legal_acceptances(user_id, document_type, version);

create index if not exists user_legal_acceptances_user_document_idx
  on public.user_legal_acceptances(user_id, document_type, accepted_at desc);

alter table public.legal_document_versions enable row level security;
alter table public.user_legal_acceptances enable row level security;

grant select on public.legal_document_versions to anon, authenticated;
grant select, insert on public.user_legal_acceptances to authenticated;

drop policy if exists legal_document_versions_public_select on public.legal_document_versions;
create policy legal_document_versions_public_select
on public.legal_document_versions
for select
to anon, authenticated
using (is_active = true);

drop policy if exists user_legal_acceptances_select_own on public.user_legal_acceptances;
create policy user_legal_acceptances_select_own
on public.user_legal_acceptances
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists user_legal_acceptances_insert_own on public.user_legal_acceptances;
create policy user_legal_acceptances_insert_own
on public.user_legal_acceptances
for insert
to authenticated
with check (user_id = auth.uid());

update public.legal_document_versions
set is_active = false
where locale = 'cs'
  and type in ('terms', 'privacy', 'cookies', 'dpa', 'security');

insert into public.legal_document_versions (
  type,
  version,
  title,
  content,
  locale,
  published_at,
  is_active
)
values
  (
    'terms',
    '2026.05.17',
    'Podmínky používání aplikace Diriqo',
    $legal$
Diriqo je SaaS platforma pro řízení zakázek, zákazníků, pracovníků, směn, docházky, fotografií, nabídek, fakturace, komunikace, portálů a mobilních funkcí.

Organizace odpovídá za správnost vložených dat, nastavení rolí a oprávnění, zákonnost zpracování dat, obsah nahraných fotografií a kontrolu výstupů z aplikace.

Služba nemusí být dostupná nepřetržitě. Mohou nastat plánované odstávky, technické výpadky, výpadky infrastruktury třetích stran, konflikty offline synchronizace nebo chyby, které vyžadují ruční kontrolu.

Uživatel nesmí obcházet bezpečnostní opatření, zneužívat API, scrapovat službu, provádět reverse engineering, ukládat nelegální obsah, narušovat provoz nebo neoprávněně přistupovat k datům.

Provozovatel vynakládá přiměřené odborné úsilí k zabezpečení a provozu služby. Odpovědnost je omezena v rozsahu přípustném právem a podrobněji popsána v in-app dokumentu.
$legal$,
    'cs',
    '2026-05-17 00:00:00+00',
    true
  ),
  (
    'privacy',
    '2026.05.17',
    'Ochrana osobních údajů',
    $legal$
Diriqo rozlišuje vlastní zpracování jako správce a zákaznická provozní data zpracovávaná jako zpracovatel podle pokynů organizace.

Jako správce Diriqo zpracovává zejména účet, autentizaci, podporu, bezpečnost, technické logy, abuse prevention a budoucí billing.

Jako zpracovatel Diriqo zpracovává zejména data zaměstnanců, zákazníků, zakázek, fotografií, docházky, směn, komunikace a zákaznického portálu.

Organizace odpovídá za právní základ, informační povinnosti a zákonnost dat, která do Diriqo vkládá.
$legal$,
    'cs',
    '2026-05-17 00:00:00+00',
    true
  ),
  (
    'cookies',
    '2026.05.17',
    'Cookies a podobné technologie',
    $legal$
Diriqo používá nezbytné cookies a lokální úložiště pro přihlášení, bezpečnost, relaci, jazyk, aktivní firmu, preference a základní fungování aplikace.

V budoucnu mohou být použity analytické, monitoringové nebo marketingové technologie. Pokud to bude vyžadovat právo, budou aktivovány až po odpovídajícím souhlasu.
$legal$,
    'cs',
    '2026-05-17 00:00:00+00',
    true
  ),
  (
    'dpa',
    '2026.05.17',
    'GDPR a Data Processing Addendum',
    $legal$
Organizace je správcem provozních dat vložených do Diriqo a Diriqo je u těchto dat zpracovatelem.

Zpracování zahrnuje ukládání, zobrazení, úpravy, synchronizaci, export, audit, zabezpečení a zálohování dat podle nastavení služby.

Diriqo může využívat subprocesory pro hosting, databázi, úložiště, e-mail, platby, monitoring, podporu, mobilní služby, push notifikace, analytiku, integrace a budoucí AI funkce.
$legal$,
    'cs',
    '2026-05-17 00:00:00+00',
    true
  ),
  (
    'security',
    '2026.05.17',
    'Informace o bezpečnosti',
    $legal$
Diriqo staví bezpečnost na autentizaci, server-side autorizaci, tenant izolaci, RLS politikách, soukromém úložišti, auditních záznamech a omezení klientských oprávnění.

Organizace odpovídá za správu uživatelů, bezpečnost hesel, přiměřené role, kontrolu exportů, zákonnost obsahu a odebrání přístupů osobám, které je již nepotřebují.
$legal$,
    'cs',
    '2026-05-17 00:00:00+00',
    true
  )
on conflict (type, version, locale) do update
set
  title = excluded.title,
  content = excluded.content,
  published_at = excluded.published_at,
  is_active = excluded.is_active;

notify pgrst, 'reload schema';
