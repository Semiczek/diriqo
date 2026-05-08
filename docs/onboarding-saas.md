# SaaS Onboarding

First-run onboarding is intentionally small:

- authenticated user without a company opens `/onboarding`;
- server action creates the company, first admin membership, default settings, default modules and support mailbox;
- dashboard shows a first-run checklist until the company has workers, customers, a quote and a job.

Demo data remains separate from production onboarding. Use `supabase/seed-demo-diriqo.sql` only for local or demo projects. Production onboarding must create real tenant data through the app flow, not by running the demo seed.

Trial/billing foundation is metadata-only for now: `companies.plan_key`, trial timestamps, `is_demo`, and `support_email`. Full payment processing is intentionally not implemented in this block.

The onboarding server action uses the server-only admin client for the first tenant bootstrap because the user has no membership yet and RLS correctly blocks normal tenant writes. The service role key stays isolated in `lib/supabase-admin.ts` and is never sent to the browser.

Environment expectations:

- `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SUPPORT_EMAIL` are public and can be used by UI.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only and required for bootstrap/onboarding server code.
- `MAILBOX_DEFAULT_FROM_NAME` and `MAILBOX_DEFAULT_FROM_EMAIL` provide the default support mailbox when a company has none.
