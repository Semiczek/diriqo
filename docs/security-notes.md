# Security notes

- `SUPABASE_SERVICE_ROLE_KEY` se smi pouzivat pouze pres `lib/supabase-admin.ts`.
- `lib/supabase-admin.ts` musi zustat `server-only`.
- Client komponenty nesmi importovat `supabase-admin`.
- Service role se nesmi logovat.
- Inline server actions v `app/poptavky/page.tsx` a `app/workers/new/page.tsx` jsou aktualne bezpecne, ale do budoucna je mozne je presunout do samostatnych `actions.ts` souboru.
