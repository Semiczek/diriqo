# Job Photo Storage Pipeline

Job photos use the private Supabase Storage bucket `job-photos`. This bucket must remain private in every environment because photos are customer/job evidence.

Upload flow:

1. Client asks `POST /api/job-photos` for a signed upload token.
2. Server validates active company, paid `core.files.upload` capability, assigned job/manager/admin scope, MIME type and size. The private server client is used only after these guards pass.
3. Server returns a signed upload target for:
   `<company_id>/<job_id>/<category>/<uuid>.<ext>`
4. Client uploads the file directly to Supabase Storage with the anon client and signed token.
5. Client calls `PATCH /api/job-photos`; server revalidates paid capability, scope and canonical path. Storage `info()` must confirm that the uploaded object exists with the expected byte size and MIME type before metadata is written.
6. The object UUID is also the metadata row ID. A repeated PATCH reads the existing row only under the same company, job and path. Uncertain metadata writes return 503 and retain the object for a safe confirmation retry.

If an upload response is lost, retrying the same signed target can return Storage 409 / an already-exists code. The client then proceeds to server confirmation of that exact path; it does not overwrite the object or request a new one. Success still requires PATCH to verify the object and return its metadata. Authentication failures are not treated as conflicts.

Categories:

- `before`
- `after`
- `progress`
- `issue`
- `document` (legacy `proof` category is normalized to `document`)

Reads use metadata queries plus short-lived signed URLs. They sign the exact path stored in existing metadata, so historic three-segment paths are still readable. New metadata accepts only the canonical company/job/category/UUID path. The bucket should stay private; do not make `job-photos` public.

There is no Server Action body size workaround for photos. Binary payloads should not go through Server Actions; the API route only coordinates signed upload and metadata.

Authorization and database requirements:

- path segment 1 is `company_id`;
- path segment 2 is `job_id`;
- the trusted API issues uploads only to a worker/admin/manager scoped to that company/job and with an active upload capability;
- current direct-client Storage RLS is not broadened; the signed target is created by the server and no service credential is returned to the client;
- read/list is through metadata plus signed URLs unless a route has already revalidated portal/internal scope.

The Diriqo runtime needs the scoped column grants in `supabase/migrations/20261011175514_mobile_server_runtime_grants.sql`. The actual database verification is `tests/mobile-runtime-grants-verification.sql`; mocked TypeScript tests cannot prove deployed PostgreSQL privileges. The live check on 11 October 2026 exposed missing service-role SELECT/INSERT/UPDATE grants despite passing route tests. RLS and public-client grants were preserved by the repair. Release evidence and remaining device checks are recorded in `docs/diriqo/android-test-release.md`.
