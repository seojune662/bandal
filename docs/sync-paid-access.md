# Cloud sync access and storage accounting

`20261015020000_sync_paid_access.sql` connects the existing personal-sync RPCs and
`bandal-assets` bucket to the Live Paddle entitlement. It requires the personal
sync schema already installed from `bandal-iPad/backend/supabase/migrations/202610130001_personal_sync.sql`
and the preceding Paddle Sandbox/Live migrations. The personal-sync schema was
originally applied directly; do not blindly reapply it or rewrite remote migration
history. The test fixture is a copy for isolated local environments only.

The migration starts with `bandal_sync_configuration.enforce_paid_access=false`.
This preserves existing cloud behavior while installing and checking the ledger.
After verification, the operator changes that singleton to `true`. Configuration,
beta grants, and usage rows are service-role only. Authenticated clients cannot
change them or call the original unmetered push function.

With enforcement on, writes require either:

- `paddle_billing_status(user_id,'live').active=true`, including a current paid
  period and the billing service's refund/chargeback rules; or
- an unexpired, explicitly assigned `bandal_sync_beta_access` grant. Grants have
  a reason and mandatory expiry; they are not purchases and never create a
  subscription. No user IDs or automatic legacy grants are seeded by migration.

Sandbox purchases grant no production sync access. Scheduled cancellation keeps
access during the paid period. Expiry or loss of the entitlement denies new
records and file uploads. Existing owner-only record reads, pull, downloads,
local editing, and manual `.bandalpack` transfer remain available. No files are
automatically deleted when a subscription ends.

## 5 GiB accounting

The allowance is 5,368,709,120 bytes per account: all files retained in the private
bucket plus the decoded payload bytes of the latest non-deleted records. Repeated
operation receipts and internal revision history are excluded from the displayed
product allowance. The existing 4 MiB record payload and 512 MiB individual file
limits remain; this change adds no new rate limit.

File bytes use Storage's backend-reported `metadata.size`, never the upload's
claimed `Content-Length` or custom user metadata. Record/object triggers update
the same per-user ledger under a transaction lock. Replacements apply only the
difference; retries do not charge twice. A failed quota check rolls back both
usage and the record/object write. `AFTER` triggers avoid the double charge that
`INSERT ... ON CONFLICT DO UPDATE` would cause with `BEFORE` insert/update hooks.

Storage makes an insert permission probe before uploading and rolls it back.
Its probe may lack final size metadata. A deferred constraint allows that probe
but refuses a committed object without a verified size. Final size updates in
the same transaction are supported. Enabling enforcement refuses unknown legacy
sizes until they are reconciled. This depends on the tested Storage HTTP protocol;
rerun the isolated test after relevant Supabase Storage upgrades.

Deleting a material does **not** currently collect old immutable file revisions.
Those retained files continue to consume space; record tombstones release their
current payload charge. A safe asset collector must consider offline clients,
pending imports, and conflict copies before removing unreferenced bytes. Until
such a collector exists, operators must not infer that a missing latest record
means an asset is safe to remove. Actual file removal uses the Storage API, never
direct SQL deletion. The usage trigger accounts for authorized API removals.

## Client contract

`bandal_sync_status()` takes no user ID. It binds to `auth.uid()` and returns:

- `writeAllowed`, `accessSource` (`subscription`, `beta`, `rollout`, or `none`),
  `enforcePaidAccess`, and `paidThrough`;
- `storageLimitBytes`, `storageUsedBytes`, `recordBytes`, `assetBytes`, and
  `usageComplete`.

The billing server can call `bandal_sync_status_for(actor uuid)` after validating
its logged-in user. That overload is service-role only; authenticated and
anonymous clients cannot query any supplied user ID, including their own.

The server emits `sync_subscription_required` for denied record writes and
`sync_storage_quota_exceeded` for insufficient capacity. Storage may wrap SQL
errors or return an RLS denial. Clients must map only explicitly recognized
codes/messages and never display arbitrary response bodies, which can contain
private data. A preflight status is useful for presentation, but the transactional
server checks remain authoritative.

`20261015030000_sync_quota_errors.sql` uses SQLSTATE `42501` for quota denial.
The Storage API preserves the fixed `sync_storage_quota_exceeded` message for
that code; generic `P0001` instead becomes an uninformative database error. The
real concurrent HTTP upload test verifies that client-visible message as well
as the atomic quota result.

## Verification

```sh
node tests/backend/syncAccess/run-local.mjs
```

The runner creates an isolated Supabase Auth/Postgres/Storage environment on
ports 56830–56832, runs the actual migrations, and destroys that temporary
environment. It refuses any non-dedicated/non-loopback URL. It never creates test
accounts in production or prints credentials.

Coverage includes disabled rollout, denied direct/privileged access, Live versus
Sandbox and beta grants, expiration with retained downloads, scheduled
cancellation, record replacement/idempotency/tombstones, provisional metadata
rollback and final validation, configuration activation, and combined record/file
quota rollback. The concurrency test seeds metadata near 5 GiB in the disposable
database, then uploads two real 200-byte files over HTTP with 300 bytes remaining;
exactly one must be stored. The seeded files are a quota fixture, not a claim to
have transferred 5 GiB or verified real device-to-device synchronization.

Sources: [Supabase uploader](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts),
[Storage database adapter](https://github.com/supabase/storage/blob/master/src/storage/database/pg.ts),
[Storage schema guidance](https://supabase.com/docs/guides/storage/schema/design).
