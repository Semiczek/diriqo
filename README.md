# Diriqo

Diriqo is a clean SaaS/demo version of an operations system for jobs, workers, customers, quotes, invoices, a customer portal, and company-level reporting. The app keeps the original architecture, multi-company model, RLS-first Supabase access, login/session flow, and active company context.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env.local` for local development and fill in project-specific values. Never commit `.env.local` or real production secrets.

Required basics:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_BASE_URL=https://app.diriqo.com
NEXT_PUBLIC_APP_URL=https://app.diriqo.com
NEXT_PUBLIC_SUPPORT_EMAIL=support@diriqo.com
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
MAIL_INBOUND_SHARED_SECRET=
MAILBOX_DEFAULT_FROM_NAME=Diriqo
MAILBOX_DEFAULT_FROM_EMAIL=no-reply@diriqo.com
NEXT_PUBLIC_SUPPORT_EMAIL=support@diriqo.com
# Optional paid add-on: public landing forms and lead intake.
PUBLIC_LEADS_TARGET_COMPANY_ID=
PUBLIC_LEADS_ALLOWED_SOURCES=
```

Public variables are intentionally prefixed with `NEXT_PUBLIC_` and may be visible in the browser. `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `MAIL_INBOUND_SHARED_SECRET` are server-only secrets and must never be imported into client components.

## Supabase Setup

1. Create a new Supabase project for Diriqo.
2. Apply migrations from `supabase/migrations`.
3. Verify RLS is enabled and policies are present.
4. Apply runtime patches from `supabase/patch-*.sql` that match the deployed release.
5. Create the first real company through `/onboarding`; do not insert production tenants by hand.
6. For demo-only projects, run `supabase/seed-demo-diriqo.sql` and create demo auth users using `supabase/DEMO_USERS.md`.

## Demo Seed

Run in Supabase SQL editor or through your local database connection only for local/staging/demo projects:

```sql
\i supabase/seed-demo-diriqo.sql
```

The seed uses only demo identities and skips optional tables that do not exist in the target schema. Never include it in a production deploy flow.

## First-Run Onboarding

New authenticated users without a company are sent to `/onboarding`. The flow creates the company, default settings, default modules, first admin membership, and a support mailbox. The dashboard then shows a short checklist for currency/fakturace, workers, customers, first quote, and first job.

## Developer Guardrails

- Use `proxy.ts` and server guard helpers for perimeter checks; server code must call `supabase.auth.getUser()`, not trust `getSession()`.
- Resolve tenant context through `getActiveCompanyContext()` or DAL auth helpers before business reads/writes.
- Every new write operation needs a server-side guard and schema/input validation.
- Every new tenant table needs `company_id` or a clear parent-derived tenant scope plus RLS policies before it is used.
- Never import `lib/supabase-admin.ts` from client code. The service role key is only for narrow server-only flows such as onboarding/bootstrap, portal-scoped signed URLs, and trusted webhooks.
- Keep `job-photos` private. Sensitive job proof photos must use signed upload/read URLs and scoped metadata.

## Deployment

Deploy the app to Vercel with the environment variables from `.env.example`. Use:

- App domain: `https://app.diriqo.com`
- Marketing domain: `https://diriqo.com`
- Support mailbox: `support@diriqo.com`

See `DEPLOYMENT_DIRIQO.md` for the full checklist.
