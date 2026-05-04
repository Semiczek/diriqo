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
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
MAIL_INBOUND_SHARED_SECRET=
MAILBOX_DEFAULT_FROM_NAME=Diriqo
MAILBOX_DEFAULT_FROM_EMAIL=no-reply@diriqo.com
# Optional paid add-on: public landing forms and lead intake.
PUBLIC_LEADS_TARGET_COMPANY_ID=
PUBLIC_LEADS_ALLOWED_SOURCES=
```

## Supabase Setup

1. Create a new Supabase project for Diriqo.
2. Apply migrations from `supabase/migrations`.
3. Verify RLS is enabled and policies are present.
4. Run the demo seed from `supabase/seed-demo-diriqo.sql`.
5. Create demo auth users manually using `supabase/DEMO_USERS.md`.

## Demo Seed

Run in Supabase SQL editor or through your local database connection:

```sql
\i supabase/seed-demo-diriqo.sql
```

The seed uses only demo identities and skips optional tables that do not exist in the target schema.

## Deployment

Deploy the app to Vercel with the environment variables from `.env.example`. Use:

- App domain: `https://app.diriqo.com`
- Marketing domain: `https://diriqo.com`
- Support mailbox: `support@diriqo.com`

See `DEPLOYMENT_DIRIQO.md` for the full checklist.
