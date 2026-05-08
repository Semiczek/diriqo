# Diriqo Architecture

## Product Shape

Diriqo is a multi-company SaaS app. A signed-in user works inside an active company, and business data is always scoped by `company_id` where the schema supports it.

## Core Boundaries

- Next.js App Router provides pages, server actions, API routes, and `proxy.ts`.
- Supabase stores auth-linked profiles, company membership, jobs, workers, customers, quotes, invoices, portal access, and communication data.
- RLS remains the primary database boundary.
- `proxy.ts` and server-side helpers keep session and active company behavior consistent.

## Auth And Perimeter

- `proxy.ts` is the request perimeter for internal app pages, protected API routes, and portal routes. It uses `@supabase/ssr` `createServerClient()` and `supabase.auth.getUser()` so Supabase can refresh cookies safely during SSR.
- Internal hub access is membership based. `proxy.ts` resolves the Auth user, application profile, active `company_members` rows, and allows only hub roles from `lib/hub-access.ts`.
- Portal access is separate from hub access and is checked through `customer_portal_users`.
- Server code must not use `getSession()` as a security source. Use `supabase.auth.getUser()`, `requireAuthenticatedUser()`, `requireActiveCompanyContext()`, `requireCompanyRole()`, `requireHubAccess()`, `requireWorkerAccess()`, or `requirePortalAccess()` from `lib/server-guards.ts`.
- Server actions should follow this order: validate input, require auth/company/role, call DAL/domain command, return an explicit typed result or redirect after a successful mutation.

## Active Company Model

- `profiles` links application users to Supabase Auth users.
- `companies` represents tenants.
- `company_members` links profiles to companies and roles.
- Internal pages and actions should resolve company context through `getActiveCompanyContext()` from `@/lib/active-company`.
- The `active_company_id` cookie is only a preference. `getActiveCompanyContext()` reconciles it against live active memberships and falls back to an allowed company.
- Company switching goes through `/api/active-company` and `resolveActiveCompanySwitch()`, which accepts only companies in the authenticated membership list.
- Queries over tenant data must explicitly filter by the active company whenever possible.
- Tenant tables should carry `company_id not null`; child tables without their own `company_id` must derive tenant scope from a parent row and have matching RLS.

## Server-First Pattern

- New internal pages should read on the server through `createSupabaseServerClient()`.
- Server actions are preferred for internal create/update/delete flows.
- DAL modules live under `lib/dal/` and are split by domain: auth, companies, calculations, jobs, quotes, invoices, flow, and economics.
- DAL callers should pass an authenticated `DalContext` from `requireHubDalContext()` or `requireCompanyRoleDalContext()` instead of rebuilding tenant checks in UI components.
- API routes are used for public endpoints, webhooks, integrations, storage boundaries, and JSON endpoints called outside the React action flow.
- Browser Supabase is tolerated for auth UX and existing complex editors, but should not become the default write layer.

## Public Surfaces

- Public offer routes are token-based and must not require admin login.
- Public lead intake is a disabled paid add-on in the MVP demo. The route exists only as a compatibility placeholder.
- Customer portal routes use portal-specific auth/session checks and show customer-safe data only.
- Public token and lead helper functions live in `lib/public-offer-security.ts` and `lib/public-lead-security.ts`; keep validation bounded and enum-based.

## SQL, RLS, Views, And Functions

- The current tenant isolation audit is in `docs/rls-audit.md`.
- Tenant-scoped objects include company settings, customers, jobs, assignments, shifts/logs, job photos, calculations, quotes, invoices, worker finance, absences, leads, mailboxes, messages, offer events/responses, and related item tables.
- Views exposed to application roles must use `security_invoker = true` or be kept out of exposed schemas. Runtime patches cover `jobs_with_state`, `work_shift_payroll_view`, `job_economics_summary`, and `worker_job_assignment_summary`.
- Security-definer functions must have a fixed `search_path` and narrow grants. Public offer/lead RPCs should stay minimal and token-scoped.
- Storage policies for `job-photos` use the path convention plus DB membership/job checks; reads should normally be short-lived signed URLs.

## Storage And Photos

- Job evidence photos use the private `job-photos` bucket.
- The upload path is `<company_id>/<job_id>/<category>/<timestamp>-<uuid>.<ext>`.
- Allowed categories are `before`, `after`, `issue`, and `proof`.
- Binary photo payloads should not go through Server Actions. The app coordinates signed uploads through API routes and writes `job_photos` metadata after revalidating tenant/job scope.
- See `docs/job-photo-storage.md` for the current pipeline.

## E-Mail Threading

- New outbound subjects use `[DIRIQO:T:...]` tracking tokens.
- The inbound parser still accepts `[JSPD:T:...]` only for legacy reply compatibility.
- Default outbound identity comes from `MAILBOX_DEFAULT_FROM_NAME` and `MAILBOX_DEFAULT_FROM_EMAIL`.

## RLS Guidance

Do not redesign RLS or table names for branding cleanup. Rename UI, docs, env defaults, and demo data; keep schema and policies stable unless a focused security bug requires a small explicit fix.

## Developer Guardrails

- No new write operation without a server-side guard and input validation.
- No new tenant table without RLS and tenant-scoped policies.
- No client import of `lib/supabase-admin.ts` or any service-role wrapper.
- No public storage bucket for sensitive job evidence, invoices, customer documents, or worker/customer PII.
- No authorization decision based on `user_metadata`; use app metadata only for non-authoritative hints and DB membership tables for access.
