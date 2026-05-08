# Diriqo Deployment Checklist

## GitHub

- Create a new repository for Diriqo.
- Commit only the cleaned SaaS/demo code.
- Do not commit `.env.local`, production dumps, or real customer data.

## Supabase

- Create a new Supabase project.
- Apply all migrations in `supabase/migrations`.
- Confirm the base schema exists before running demo data. The local file `supabase/migrations/20260408160615_remote_schema.sql` is currently empty, so verify the initial schema source before first production-like setup.
- Apply the runtime patches from `supabase/patch-*.sql` that match the deployed release.
- Verify RLS is enabled on tenant tables and exposed views use `security_invoker = true` where they are granted to app roles.
- Keep the `job-photos` bucket private and apply the storage policies from the photo/storage patch.
- Use `/onboarding` for the first real production company.
- Run `supabase/seed-demo-diriqo.sql` only for local/staging/demo projects.
- Create demo Auth users using `supabase/DEMO_USERS.md` only in demo projects.
- Leave public lead intake disabled for the MVP demo. Landing pages and forms are a paid add-on.

## Vercel

- Import the GitHub repository.
- Set framework preset to Next.js.
- Configure production env vars from `.env.example`.
- Add domains:
  - `app.diriqo.com` for the application
  - `diriqo.com` for the marketing site or landing frontend

## Required Env Vars

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_BASE_URL=https://app.diriqo.com
NEXT_PUBLIC_APP_URL=https://app.diriqo.com
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
MAIL_INBOUND_SHARED_SECRET=
MAILBOX_DEFAULT_FROM_NAME=Diriqo
MAILBOX_DEFAULT_FROM_EMAIL=no-reply@diriqo.com
NEXT_PUBLIC_SUPPORT_EMAIL=support@diriqo.com
PUBLIC_LEADS_TARGET_COMPANY_ID=
PUBLIC_LEADS_ALLOWED_SOURCES=
```

Public browser-visible variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPPORT_EMAIL`

Server-only secrets:

- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `MAIL_INBOUND_SHARED_SECRET`

Use the service role key only through `lib/supabase-admin.ts` in server-only code. Do not expose it to Vercel preview logs, client bundles, public runtime config, or browser code.

## Pre-Deploy Checks

- No JSPD production domains in code or env.
- No real company, customer, personal, or invoice data.
- RLS enabled on tenant tables.
- `proxy.ts` is deployed as the active Next.js proxy/middleware perimeter.
- `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` pass.
- Demo users can log in.
- Admin sees Diriqo Demo company.
- Worker sees only assigned jobs.
- Public lead route is disabled in the MVP demo and should return HTTP 410 until the landing/forms add-on is enabled.
- New outbound e-mails contain `[DIRIQO:T:...]` tokens.
