# RLS / Tenant Isolation Audit

Date: 2026-05-08

Scope: `supabase/bootstrap-diriqo-schema.sql`, runtime SQL patches, `seed-demo-diriqo.sql`, `lib/active-company.ts`, TypeScript `company_id` queries, and job photo storage call sites.

## Object Inventory

Business tables used by the app:

`companies`, `profiles`, `company_members`, `company_modules`, `company_settings`, `company_payroll_settings`, `company_billing_settings`, `worker_payment_settings`, `customers`, `customer_contacts`, `customer_portal_users`, `jobs`, `job_customer_contacts`, `job_assignments`, `work_shifts`, `work_logs`, `job_cost_items`, `job_photos`, `checklist_templates`, `checklist_template_items`, `job_checklists`, `job_checklist_items`, `issues`, `calendar_events`, `calendar_event_assignments`, `calculations`, `calculation_items`, `calculation_versions`, `calculation_version_items`, `quotes`, `quote_items`, `invoices`, `invoice_items`, `invoice_jobs`, `invoice_number_sequences`, `payroll_items`, `advance_requests`, `worker_advances`, `absence_requests`, `absences`, `leads`, `pohoda_exports`, `pohoda_export_invoices`, `mailboxes`, `message_threads`, `outbound_messages`, `inbound_messages`, `message_events`, `offer_events`, `offer_responses`.

Views exposed to the app:

`jobs_with_state`, `work_shift_payroll_view`, `job_economics_summary`, `worker_job_assignment_summary`.

Functions used by SQL/API flow:

`current_profile_id()`, `is_company_member(uuid)`, `has_company_role(uuid, text[])`, `is_company_admin(uuid)`, `job_company_id(uuid)`, `is_worker_assigned_to_job(uuid)`, `next_invoice_number(uuid, integer)`, `create_public_lead(...)`, `get_public_offer_by_token(text)`, `get_public_offer_items_by_token(text)`, `track_public_offer_event(...)`, `submit_public_offer_response(...)`.

Storage bucket:

`job-photos`.

## Audit Table

| Object | Tenant scope | RLS status | Risk | Fix |
|---|---:|---|---|---|
| `companies` | `id` | Enabled; member/admin policies | Medium: company row is root tenant object | Existing policies retained |
| `profiles` | Membership-derived | Enabled; self/related profile policies | Medium: shared identity table without direct `company_id` | Existing membership-derived policies retained |
| `company_members`, `company_modules` | `company_id not null` | Enabled; member select/admin write | Low | Existing policies retained |
| `company_settings`, `company_payroll_settings`, `company_billing_settings`, `worker_payment_settings` | `company_id not null` | Missing before patch | High: runtime tables can hold tenant config without RLS | Added tables if missing, RLS, select/admin write policies |
| Core customer/job/work tables | `company_id` | Enabled in bootstrap | Medium: some child tables allowed nullable `company_id` | Backfilled child `company_id`; conditional `NOT NULL`; policies retained |
| Calculation version tables | Parent calculation/company | Missing before patch | High: app writes version history, public offer function reads it | Added tables if missing, RLS, parent-scoped item policies |
| Quote/invoice item tables | Parent quote/invoice plus `company_id` | Enabled via parent policies | Medium: nullable `company_id` can weaken auditability | Backfilled and conditional `NOT NULL` |
| Public offer event/response tables | `company_id`, quote token path | Enabled for authenticated; public writes through RPC/admin route | Medium: public interaction flow needs narrow token access | Kept table RLS; revoked direct anon table access globally |
| Views | Caller tenant via underlying RLS | Runtime patch had `security_invoker`; bootstrap did not | High if default definer view bypasses base table RLS | Patch sets all exposed views `security_invoker = true` |
| Security-definer helpers | Membership and public-token helpers | `search_path = public`; grants mostly tightened | Medium: functions live in exposed schema | Confirmed fixed `search_path`; residual item below |
| `job-photos` storage | Path starts with `job_id` | Missing enforceable policies before patch | High: private files need DB-backed scope | Created/forced private bucket and storage.objects policies using job path mapping |
| Demo seed | Fixed demo tenant | Not part of runtime | Low: no Auth users/passwords created | Seed remains manual-only; report calls out not to run in prod flow |

## Business Table Detail

All tenant-owned tables should either have `company_id not null` or derive tenant through a parent row. The audit found four categories:

| Category | Tables | Status after patch |
|---|---|---|
| Direct `company_id not null` | `company_modules`, `customers`, `customer_contacts`, `jobs`, `work_shifts`, `work_logs`, `checklist_templates`, `checklist_template_items`, `issues`, `calendar_events`, `calculations`, `quotes`, `job_photos`, `payroll_items`, `advance_requests`, `worker_advances`, `leads`, `absence_requests`, `customer_portal_users`, `invoices`, `invoice_jobs`, `invoice_number_sequences`, `pohoda_exports`, `mailboxes`, `message_threads`, `outbound_messages`, `inbound_messages`, `message_events`, plus new settings/version tables | RLS enabled; member select/admin write policies |
| Direct `company_id`, previously nullable | `job_assignments`, `job_cost_items`, `job_checklists`, `job_checklist_items`, `calendar_event_assignments`, `quote_items`, `invoice_items`, `offer_events`, `offer_responses`, `job_customer_contacts` | Backfilled from parent rows; `NOT NULL` applied only if no null rows remain |
| Parent-derived without own `company_id` | `calculation_items`, `calculation_version_items` | RLS derives via `calculations` / `calculation_versions` |
| Non-tenant identity/root tables | `profiles`, `companies` | RLS derives from membership/self access |

## TypeScript Access Findings

`getActiveCompanyContext()` uses `supabase.auth.getUser()` server-side and filters active memberships from `company_members`. It does not trust `getSession()` for server auth. The active company cookie is only used as a preference and is reconciled against DB memberships.

Most server routes filter business reads/writes with `.eq('company_id', activeCompany.companyId)` or validate parent ownership before mutation. The main storage metadata issue was in `app/api/job-photos/route.ts`: upload metadata inserted `job_photos` without `company_id`. That is fixed by inserting `company_id: activeCompany.companyId`.

Client components still call `getSession()` in some browser-only flows (`CalculationCreateForm`, `CalculationEditForm`, `CreateQuoteFromCalculationButton`, `QuoteActionsPanel`, `AdminAuthGuard`). This is not a server trust source, but these writes still rely on RLS and should be moved behind typed server actions in later blocks.

`app/api/customer-portal-users/route.ts` writes `user_metadata` when creating/updating customer portal auth users. The audited authorization path does not rely on `user_metadata`; access is resolved through `customer_portal_users` and customer/company rows.

## Storage Audit

The application bucket is `job-photos`.

Call sites:

- `app/api/job-photos/route.ts`: lists metadata, creates signed upload/read URLs, uploads to storage path `<company_id>/<job_id>/<category>/<timestamp>-<uuid>.<ext>`, then inserts `job_photos`.
- `app/api/job-photos/url/route.ts`: validates `job_photos -> jobs.company_id` before creating a 30 minute signed URL.
- `lib/customer-portal/data.ts`: uses admin client after portal customer auth, then creates signed URLs for job photos.

Patch behavior:

- Creates or updates `storage.buckets` row for `job-photos` with `public = false`.
- Adds `storage.objects` policies where path segments carry company/job scope and current user must be a member/admin or assigned worker for that job company.
- Keeps reading through signed URLs where the UI needs temporary access.

## Residual Risks

- Public offer RPC functions remain callable through public function names because existing app routes depend on those RPC names. They have fixed `search_path`, table RLS remains enabled, and grants are explicit, but a later hardening pass should move definer bodies into `diriqo_private` with thin public wrappers.
- Several client components perform writes directly from the browser. RLS limits tenant access, but later blocks should migrate these into server actions with typed validation.
- Existing demo seed is manual and contains no Auth password creation, but deployment docs should continue to keep it outside production deploy automation.

## Patch

Applied patch file:

`supabase/patch-tenant-isolation-audit.sql`
