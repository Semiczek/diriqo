# Hub HTTP staging verification

Use only the isolated clone and a verified staging manifest. Build the clone with the staging NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. Set OFFICE_PUBLIC_ORIGIN to its exact loopback origin. The public Next variables are captured during the build.

Hub app/login/page.tsx calls auth.signInWithPassword from lib/supabase.ts, which uses the installed @supabase/ssr createBrowserClient. It has no Diriqo /auth/sign-in route.

scripts/staging-hub-host-session.mjs uses that same installed createBrowserClient and cookie serializer, authenticates against the actual staging Auth endpoint and verifies getUser. It never fabricates or signs tokens. It keeps cookie chunks in memory and sends actual HTTP Cookie headers to the host. No Authorization header is allowed on host requests.

Instantiate createHubHostSession({baseOrigin,expectedProjectRef,supabaseUrl,publicKey}), then login(actor), selectCompany(actor.tenantId), and request('/office'). Call selectCompany for every actor, including manager and worker. It verifies the actor's profile and active company membership through real RLS before setting the existing active_company_id preference cookie. That preference is still independently checked by the host and Office RPC.

upload and exportFile have the same contract as staging-diriqo-host-session.mjs. For Hub, anonymous redirects end at /login. Do not call Diriqo's /api/active-company from the Hub runner. Check response status, content type and exported content. Never report cookie values, credentials or full authentication responses.

This proves actual HTTP behavior with real Auth, the existing SSR cookie serializer and the host routes. It does not itself prove the visual login form; perform the separate browser login test for that.
