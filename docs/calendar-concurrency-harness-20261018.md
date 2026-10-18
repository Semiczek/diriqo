# Calendar event Auth/HTTP concurrency harness

`scripts/test-calendar-event-concurrency.mjs` is prepared for the fixed **Diriqo test project `wfcpfraxiuhuglnuaxqj`**. Preparation and `node --check` do not execute it. It creates no accounts, companies, events, license receipts, database functions or owner sessions. Running it later performs exactly two calendar update RPCs against pre-created synthetic fixtures, then verifies their results and logs out both acquired Auth sessions.

## Private fixture input

Use a private JSON file outside the repository. Do not paste its credentials into chat or commit it. The root's prepared path is `C:\Users\semis\Documents\Codex\diriqo-validation-20261018\private-calendar-fixture.json`. Setup and authorization to run are separate steps; an incomplete fixture deliberately fails before Auth or writes.

```json
{
  "users": [
    {
      "label": "a",
      "email": "calendar-concurrency-a@example.invalid",
      "password": "PRIVATE_SECRET",
      "authUserId": "AUTH_USER_A_UUID",
      "profileId": "PROFILE_A_UUID"
    },
    {
      "label": "b",
      "email": "calendar-concurrency-b@example.invalid",
      "password": "PRIVATE_SECRET",
      "authUserId": "AUTH_USER_B_UUID",
      "profileId": "PROFILE_B_UUID"
    }
  ],
  "fixture": {
    "project": "wfcpfraxiuhuglnuaxqj",
    "companyId": "TARGET_COMPANY_UUID",
    "companyName": "Synthetic calendar concurrency UNIQUE_RUN",
    "controlCompanyId": "CONTROL_COMPANY_UUID",
    "controlCompanyName": "Synthetic calendar control UNIQUE_RUN",
    "eventId": "TARGET_EVENT_UUID",
    "controlEventId": "CONTROL_EVENT_UUID",
    "workers": ["WORKER_A_PROFILE_UUID", "WORKER_B_PROFILE_UUID"],
    "expectedRevision": "EXACT_DECIMAL_STRING_READ_AFTER_SETUP",
    "attempts": {
      "A": {
        "title": "Synthetic editor A",
        "description": "A",
        "start_at": "2026-11-01T10:00:00Z",
        "end_at": "2026-11-01T11:00:00Z",
        "job_id": null,
        "assigned_profile_ids": ["WORKER_A_PROFILE_UUID"]
      },
      "B": {
        "title": "Synthetic editor B",
        "description": "B",
        "start_at": "2026-11-01T12:00:00Z",
        "end_at": "2026-11-01T13:00:00Z",
        "job_id": null,
        "assigned_profile_ids": ["WORKER_B_PROFILE_UUID"]
      }
    }
  }
}
```

Replace every UUID/revision placeholder with the actual synthetic fixture value. Additional fixture metadata such as `marker` or a setup-only `passwordHash` is ignored and never copied into evidence. Emails must match `calendar-…@example.invalid`; the two emails, Auth user IDs and profile IDs must differ. Both users must have an active profile and active `company_admin` or `super_admin` membership in **both** synthetic companies. Both assignment workers must be active target-company members; any non-null job must belong to that company. The calendar module and the current Core capability must permit both writes.

The baseline target can be `Synthetic calendar baseline`, description null, 2026-11-01 08:00–09:00 UTC, job null, assigned to worker A. Read `expectedRevision` **after** all fixture assignments have been inserted: triggers can advance it more than once, so do not assume `0` or `1`. Both candidate titles and times must differ, and both must move the baseline event. A must assign only `workers[0]`; B only `workers[1]`. A control event must already exist in the separate control company. Each company must contain 1–20 synthetic events with valid timestamps; complete counts are checked to reject API truncation.

Payloads must contain exactly `title`, `description`, `start_at`, `end_at`, `job_id`, `assigned_profile_ids`. The harness validates trimmed title/description, UUIDs, unique assignments, explicit timezones, valid time ordering and decimal-string bigint revision. It normalizes timestamps to ISO UTC before recording and sending the exact two request bodies. Neither passwords nor access/refresh tokens, password hashes or session IDs are written into the report.

## Later execution

After the reviewed migration/application release, explicit synthetic setup and authorization for the test, run:

```powershell
node scripts/test-calendar-event-concurrency.mjs `
  '--fixture=C:/Users/semis/Documents/Codex/diriqo-validation-20261018/private-calendar-fixture.json' `
  '--env-file=C:/Users/semis/OneDrive/Dokumenty/ChatGPT/hub -_ diri 3/diriqo/.env.local' `
  '--output=C:/Users/semis/Documents/Codex/diriqo-validation-20261018/calendar-concurrency-NEW_RUN.json' `
  --request-delay-ms=15000
```

The environment source must contain the exact fixed project URL in `NEXT_PUBLIC_SUPABASE_URL` and its public key in `NEXT_PUBLIC_SUPABASE_ANON_KEY`. No service-role key is used. The output parent directory must exist; output creation uses `wx`, so a previous report or credential file cannot be overwritten. The two administrator logins are checked against their explicit Auth/profile identities. Each gets a separate session, and both sessions read the same complete target snapshot before the harness prints `ready: true`.

At that point, exact attempts and initial fingerprints are already saved in the private evidence file. The configurable delay is 0–45000 ms (default 15000); it gives the owner time to establish the row lock. The two write requests then start together, each with a 60-second transport bound and the same recorded expected revision. There are no automatic or diagnostic write retries. Keep the evidence file private because it contains synthetic event bodies and IDs, even though it contains no credentials.

## External owner barrier and evidence

The harness does not connect as database owner or acquire the barrier. In a separate, explicitly authorized owner session, acquire the **exact target company/event row** during the ready delay and hold it for at most 45 seconds. A reviewed example, with the UUID placeholders replaced, is:

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '50s';
set local idle_in_transaction_session_timeout = '55s';
select id from public.calendar_events
where company_id = 'TARGET_COMPANY_UUID'::uuid
  and id = 'TARGET_EVENT_UUID'::uuid
for update;
-- Verify exactly one row was selected. Never sleep on an unmatched fixture.
select pg_sleep(5);
rollback;
```

Use a dedicated owner connection for this transaction; ensure rollback/disconnection in its own cleanup. The example's sleep is 5 seconds. Coordinate its start with the harness ready delay so both requests reach the barrier while it is held. Inspect the current authenticated statement timeout first and keep each request's actual wait below that timeout; the 45-second hold bound is only an absolute safety maximum, not a recommended hold. Do not alter role timeouts to make the test pass. The SQL changes no calendar data but temporarily blocks writes to that test event.

While both requests are pending, another owner observation must record the barrier PID, two `authenticator` request backends, timestamps, wait events and `pg_blocking_pids` edges. The second request may wait on an assignment row held by the first request; follow the **transitive** wait chain back to the owner barrier. It is not necessary for both backends to be blocked directly by the owner PID. Capture only the scoped activity metadata needed for proof, not unrelated query text or customer data. If two actual waiting request sessions cannot be tied to this bounded barrier, do not claim concurrent database overlap from elapsed HTTP timing.

## Assertions and limits

The harness requires exactly one HTTP 200 and exactly one HTTP 409 with code `PT409` and message `CALENDAR_STALE`. The winner must preserve event/company identity, advance the opaque revision, and contain its complete submitted header and assignment set. A fresh database snapshot must exactly match that winner. Both time aliases must match the winning timestamps. Original ID/company/location/creation time, unrelated target-company events and every control-company event/assignment snapshot must remain unchanged. Both locally acquired Auth sessions are logged out in `finally`; incomplete logout makes the report fail.

`passed: true` means these **authenticated HTTP assertions and logout checks** passed. `databaseOverlapEvidence` intentionally remains `REQUIRED_SEPARATE_OWNER_ROW_LOCK_BARRIER`: only the separately captured owner barrier evidence can satisfy that part. This script does not prove browser conflict handling, role/license revocation during waits, paid-receipt provenance, hardware behavior or overall commercial readiness.

On a timeout, malformed response or failed assertion, preserve the private evidence and fixture. Inspect the recorded attempts, current event revision and complete persisted snapshot before deciding whether anything committed. Do not rerun against the same changed fixture or reset its revision to recreate the race. Fixture access cleanup belongs to the separately authorized owner workflow; the harness neither deletes historical data nor disables accounts itself.
