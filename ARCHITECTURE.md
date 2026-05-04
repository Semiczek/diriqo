# Diriqo Architecture

## Product Shape

Diriqo is a multi-company SaaS app. A signed-in user works inside an active company, and business data is always scoped by `company_id` where the schema supports it.

## Core Boundaries

- Next.js App Router provides pages, server actions, API routes, and middleware.
- Supabase stores auth-linked profiles, company membership, jobs, workers, customers, quotes, invoices, portal access, and communication data.
- RLS remains the primary database boundary.
- Middleware and server-side helpers keep session and active company behavior consistent.

## Active Company Model

- `profiles` links application users to Supabase Auth users.
- `companies` represents tenants.
- `company_members` links profiles to companies and roles.
- Internal pages and actions should resolve company context through `getActiveCompanyContext()` from `@/lib/active-company`.
- Queries over tenant data should explicitly filter by the active company whenever possible.

## Server-First Pattern

- New internal pages should read on the server through `createSupabaseServerClient()`.
- Server actions are preferred for internal create/update/delete flows.
- API routes are used for public endpoints, webhooks, integrations, storage boundaries, and JSON endpoints called outside the React action flow.
- Browser Supabase is tolerated for auth UX and existing complex editors, but should not become the default write layer.

## Public Surfaces

- Public offer routes are token-based and must not require admin login.
- Public lead intake is a disabled paid add-on in the MVP demo. The route exists only as a compatibility placeholder.
- Customer portal routes use portal-specific auth/session checks and show customer-safe data only.

## E-Mail Threading

- New outbound subjects use `[DIRIQO:T:...]` tracking tokens.
- The inbound parser still accepts `[JSPD:T:...]` only for legacy reply compatibility.
- Default outbound identity comes from `MAILBOX_DEFAULT_FROM_NAME` and `MAILBOX_DEFAULT_FROM_EMAIL`.

## RLS Guidance

Do not redesign RLS or table names for branding cleanup. Rename UI, docs, env defaults, and demo data; keep schema and policies stable unless a focused security bug requires a small explicit fix.
