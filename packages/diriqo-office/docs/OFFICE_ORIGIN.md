# Veřejný origin Office uploadu

Oba hostitelé, JSPD Hub i Diriqo, musí mít nastavenou serverovou proměnnou `OFFICE_PUBLIC_ORIGIN` na přesný veřejný origin aplikace. Jde o protokol, host a případný port bez cesty, parametrů či fragmentu. Hodnota není tajná a nepřichází z HTTP požadavku.

Pro lokální staging na portu 4332 nastavte před spuštěním integračního hostitele:

```powershell
$env:OFFICE_PUBLIC_ORIGIN = 'http://127.0.0.1:4332'
```

V druhém hostiteli nastavte jeho skutečný port. Otevírejte přesně nakonfigurovanou adresu; `localhost`, `127.0.0.1` a `[::1]` jsou rozdílné originy. Nenahrazujte tuto konfiguraci hlavičkou `Origin` přepsanou v testu na jiný host.

Pro HTTPS staging nebo produkční nasazení nastavte přesnou veřejnou adresu konkrétního hostitele, například:

```text
OFFICE_PUBLIC_ORIGIN=https://office-staging.example.test
```

Ukázkovou doménu nahraďte skutečným ověřeným cílem. Nepoužívejte wildcard, seznam domén ani produkční doménu pro preview nasazení. Každé nasazení má vlastní hodnotu. HTTP je dovoleno pouze pro explicitně nakonfigurovaný loopback `localhost`, `127.0.0.1` nebo `[::1]`; externí adresy vyžadují HTTPS.

Obě `/api/office/files` POST routy používají tentýž `assertOfficeRequestOrigin` ze sdíleného serverového balíčku. Kontrola vyžaduje:

- přesnou shodu hlavičky `Origin` s konfigurací;
- odpovídající veřejný `Host`;
- chybějící `Sec-Fetch-Site` nebo hodnotu `same-origin`.

`cross-site`, `same-site`, chybějící/opaque origin, cizí host, port či schéma se odmítnou. Kontrola doplňuje autentizaci, tenant guard a oprávnění; nenahrazuje je.

Chybějící nebo neplatná konfigurace odmítne upload chybou `OFFICE_ORIGIN_CONFIGURATION`. Nesoulad požadavku vrátí `OFFICE_FORBIDDEN`. Výchozí fallback na produkci ani původ odvozený z libovolného requestu neexistuje.

## Reverse proxy

TLS může končit na reverzní proxy a vnitřní spojení může být HTTP. Nakonfigurovaný origin zůstává veřejný HTTPS origin. Proxy musí zachovat veřejnou hodnotu hlavičky `Host`. Pokud ji přepisuje na interní hostname, upravte její známou konfiguraci; Office požadavek se do té doby bezpečně odmítne.

Helper nečte `Forwarded`, `X-Forwarded-Host` ani `X-Forwarded-Proto` a neodvozuje bezpečnostní rozhodnutí z normalizované `request.url`. Instalovaná verze Next normalizuje loopback adresy na `localhost`, což nemění skutečný origin v prohlížeči.

## Ověření

Spusťte `node --experimental-strip-types --test tests/origin.test.mjs`, společné testy a build balíčku. Přeneste tentýž ověřený archiv do obou integračních klonů a proveďte jejich buildy. Ve skutečném staging HTTP testu odešlete přihlášený upload se správným originem a ověřte úspěch, pak ověřte odmítnutí cizího originu/hostu, jiného portu, stejného webu s jinou subdoménou a podvržených forwarded hlaviček.

Tato serverová proměnná neřeší nastavení Supabase. Staging build i proces nadále musí používat ověřené staging `NEXT_PUBLIC_SUPABASE_URL` a `NEXT_PUBLIC_SUPABASE_ANON_KEY`; Diriqo navíc `DIRIQO_MODULE_BILLING_MODE=test` pro skutečný nefinanční testovací grant.
