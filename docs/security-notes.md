# Security Notes

## Auth Perimeter

- `proxy.ts` is the perimeter for internal app pages, protected API routes, and customer portal routes.
- `proxy.ts` uses the current Supabase SSR pattern: `createServerClient()` from `@supabase/ssr`, cookie get/set/remove handlers, and `supabase.auth.getUser()` for session refresh and authentication.
- Server code must not trust `getSession()` as an authorization source. Use `getUser()` through `createSupabaseServerClient()` or the guard helpers in `lib/server-guards.ts`.
- Internal hub access is DB membership based: Auth user -> `profiles` -> active `company_members` -> role. Portal access is DB based through `customer_portal_users`.

## Guard Helpers And Server Actions

- Use `requireAuthenticatedUser()` for plain authenticated routes.
- Use `requireActiveCompanyContext()` when a business operation needs a tenant.
- Use `requireCompanyRole()`, `requireHubAccess()`, or `requireWorkerAccess()` for role-sensitive writes.
- Use `requirePortalAccess()` for customer portal reads/writes.
- Server actions should validate input first, require auth/company/role second, call a DAL/domain command third, then return an explicit typed result object or redirect only after success.

## Multi-Tenant Rules

- Resolve tenant context with `getActiveCompanyContext()` or DAL auth helpers. The `active_company_id` cookie is only a preference and must be checked against DB memberships.
- Every tenant query should filter by `company_id` or verify parent ownership before reading or mutating child rows.
- New tenant tables must have RLS before app code uses them. Prefer `company_id not null`; if tenant scope is parent-derived, policies must join through the parent.
- Do not authorize from `user_metadata`. Use DB membership tables for access decisions.

## SQL / RLS / Storage

- `docs/rls-audit.md` is the current RLS inventory and object-level tenant audit.
- Exposed views must use `security_invoker = true` unless they are intentionally private and not granted to app roles.
- Security-definer functions must set a safe `search_path` and have narrow grants.
- `job-photos` is private-by-default. Storage paths are `<company_id>/<job_id>/<category>/<timestamp>-<uuid>.<ext>` and policies must enforce company/job scope.
- Sensitive proof photos, invoices, customer documents, and worker/customer PII must never be stored in a public bucket.

## Secrets

- `SUPABASE_SERVICE_ROLE_KEY` may be used only through `lib/supabase-admin.ts`.
- `lib/supabase-admin.ts` is `server-only` and must never be imported by client components.
- Service role, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `MAIL_INBOUND_SHARED_SECRET` must not be logged.
- `NEXT_PUBLIC_*` variables are browser-visible. Do not put secrets there.

## Developer Guardrails

- No new write operation without a server-side guard and input validation.
- No new tenant table without RLS and tenant-scoped policies.
- No client import of `supabase-admin` or service-role wrappers.
- No public bucket for sensitive job evidence.
- No broad route redesign or UI rewrite for security fixes unless a focused risk requires it.
