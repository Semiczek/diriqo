<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Diriqo Guardrails

- Keep auth, tenant, and write guards server-side.
- Do not trust `getSession()` in server authorization code; use `getUser()` and the guard helpers.
- Do not add tenant tables without RLS.
- Do not import `lib/supabase-admin.ts` from client code.
- Keep sensitive storage private and scoped.
