# SaaS Onboarding

Current code checkpoint: 10 October 2026. Diriqo has account/company onboarding, an optional tutorial and a company setup checklist. It does not yet have a complete registration-to-paid-modules onboarding flow.

## Account and company flow

1. `/register` and `/sign-up` render the same `app/sign-up/SignUpForm.tsx`. The form collects email, password, password confirmation and acceptance of the legal documents. It records intended legacy plan/interval metadata, which does not itself create a subscription or grant module access. Google registration is currently disabled.
2. Signup without an immediate session shows an email-confirmation notice. With a session, the form continues to `/onboarding/company`. The Auth callback and `/auth/continue` use `lib/auth-redirect.ts`: no profile/company leads to company setup, incomplete user onboarding leads to `/onboarding`, and completed user onboarding leads to the dashboard.
3. `/onboarding/company` requires a verified user and collects company name, country, language and currency. Changing country selects the corresponding language/currency defaults; registration/tax identifiers, address, phone and company email are optional. Existing active-company users are redirected to the dashboard.
4. `createCompanyOnboarding` in `app/onboarding/actions.ts` verifies identity with `getUser()` and calls `create_onboarding_company` through the authenticated server client. On success it sets the `active_company_id` cookie and redirects to `/onboarding`.

The applied RPC definition is in `supabase/migrations/20261010085039_preserve_onboarding_country_and_module_defaults.sql`. It validates inputs, serializes provisioning for the authenticated account, checks profile identity and creates the company, an active `company_admin` membership, operating/payroll/billing settings and 17 legacy module settings. `public_leads` starts disabled; the other defaults are enabled. These settings are operational toggles, not purchased licenses or platform-administrator privileges.

Provisioning uses a restricted `SECURITY DEFINER` RPC callable by authenticated users, rather than an admin client in the server action. The RPC also creates a `Support` mailbox record using the Auth email, with a fallback address. A database mailbox record does not establish verified email delivery.

## Tutorial and company checklist

`/onboarding` offers three choices: skip, quick introduction and detailed tutorial. `chooseOnboardingMode` stores the choice in `user_onboarding_state` and redirects to `/`, `/?tour=quick` or `/?tour=detailed`. `FloatingHelpWidget` starts the selected tutorial and persists tutorial progress. Recording the onboarding choice is separate from completing company setup.

The dashboard calls `getCompanyOnboardingChecklist` from `lib/onboarding.ts` and renders `components/onboarding/OnboardingChecklist.tsx`. Its four steps are:

- Company profile: name, country, language and currency.
- First customer.
- First worker/member with a positive hourly rate. The checklist also offers using the current administrator's own profile as a worker.
- First job.

Completion is derived from the company's records and saved to `company_onboarding`. The checklist can be minimized and reopened through `/?onboarding=open`; a completed checklist is hidden unless explicitly reopened. Team creation and worker invitations are separate screens, with email delivery or a WhatsApp invitation link.

The older `getFirstRunChecklist` helper, which includes a quote step, is not called by the current dashboard. The older `app/register/RegisterForm.tsx` is also not the registration component currently rendered by `/register`.

## Relationship to paid modules

Module selection and checkout live separately at `/billing/modules`. The onboarding form/checklist does not include a purchase step, enforce payment, create a paid entitlement, or enroll a company in `company_module_rollouts`. The current company action calls `create_onboarding_company`, not the separate legacy trial-company RPC.

The new module checkout remains disabled by default and the offer catalog is empty/unpublished. Companies explicitly enrolled in the test licensing pilot encounter the relevant server/database checks when creating jobs or invoices; other companies retain the existing access rules. This is not a finished commercial onboarding wizard. See [module-operation-authority.md](diriqo/module-operation-authority.md) and [module-payments.md](diriqo/module-payments.md) for exact coverage and release limitations.

## Deployment and verification boundaries

- Auth and the onboarding RPC use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` with the user's session. The current company-creation action does not require a service-role client. Other server features may require service credentials; none belong in browser code.
- `NEXT_PUBLIC_APP_URL` must identify the intended public application for confirmation callbacks. Supabase Auth redirect configuration and actual email delivery must be verified for the deployed host. Creating the default mailbox does not verify either.
- Demo data remains separate from real onboarding. Do not run `supabase/seed-demo-diriqo.sql` as the customer onboarding flow.
- Existing platform-authority SQL tests cover the onboarding RPC, identity boundaries and selected country/module defaults. That database evidence is not an authenticated browser signup, delivered confirmation email, full tutorial run or Stripe payment test. This documentation update did not create a user, send an invitation or perform such an end-to-end test.
