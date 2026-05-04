# Diriqo Deployment Checklist

## GitHub

- Create a new repository for Diriqo.
- Commit only the cleaned SaaS/demo code.
- Do not commit `.env.local`, production dumps, or real customer data.

## Supabase

- Create a new Supabase project.
- Apply all migrations in `supabase/migrations`.
- Confirm the base schema exists before running demo data. The local file `supabase/migrations/20260408160615_remote_schema.sql` is currently empty, so verify the initial schema source before first production-like setup.
- Run `supabase/seed-demo-diriqo.sql` for demo data.
- Create demo Auth users using `supabase/DEMO_USERS.md`.
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
PUBLIC_LEADS_TARGET_COMPANY_ID=
PUBLIC_LEADS_ALLOWED_SOURCES=
```

## Pre-Deploy Checks

- No JSPD production domains in code or env.
- No real company, customer, personal, or invoice data.
- RLS enabled on tenant tables.
- Demo users can log in.
- Admin sees Diriqo Demo company.
- Worker sees only assigned jobs.
- Public lead route is disabled in the MVP demo and should return HTTP 410 until the landing/forms add-on is enabled.
- New outbound e-mails contain `[DIRIQO:T:...]` tokens.
