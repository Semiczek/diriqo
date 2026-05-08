# Job Photo Storage Pipeline

Job photos use the private Supabase Storage bucket `job-photos`. This bucket must remain private in every environment because photos are customer/job evidence.

Upload flow:

1. Client asks `POST /api/job-photos` for a signed upload token.
2. Server validates active company, assigned job/admin scope, MIME type and size.
3. Server returns a signed upload target for:
   `<company_id>/<job_id>/<category>/<timestamp>-<uuid>.<ext>`
4. Client uploads the file directly to Supabase Storage with the anon client and signed token.
5. Client calls `PATCH /api/job-photos`; server revalidates scope/path and writes `job_photos` metadata with `company_id`, `job_id`, category and storage path.

Categories:

- `before`
- `after`
- `issue`
- `proof`

Reads use metadata queries plus short-lived signed URLs. The bucket should stay private; do not make `job-photos` public.

There is no Server Action body size workaround for photos. Binary payloads should not go through Server Actions; the API route only coordinates signed upload and metadata.

Storage policy expectations:

- path segment 1 is `company_id`;
- path segment 2 is `job_id`;
- upload/write is allowed only for a worker/admin/manager scoped to that company/job;
- read/list is through metadata plus signed URLs unless a route has already revalidated portal/internal scope.
