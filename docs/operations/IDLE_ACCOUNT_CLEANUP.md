# 180-day idle accounts and SMHE administration

Implementation: `cloud-functions/_shared/idle-accounts.js`,
`cloud-functions/_shared/administrator.js`, existing `/api` gateway,
`src/sync/idle-maintenance-trigger.ts` and account dialog administrator panel.

## Policy and execution

- Continuous 180-day inactivity retires the account and its cloud learning
  data. No extra 30-day grace period, email or SMS notification is promised.
  The policy is shown in registration/account views. Browser learning data,
  IndexedDB, writer leases, FSRS and local workspace ownership are untouched.
- Existing accounts get a full 180 days from `IDLE_POLICY_START_AT`.
  Creation time or a later authenticated activity day extends that deadline.
  Activity uses deterministic UTC day keys, conservatively rounded to the end
  of the day; concurrent writers cannot regress an activity timestamp. This
  can retain data up to one additional day, rather than deleting early.
- The real app activates the trigger only after guarded startup and mounting.
  After 2.5 seconds it sends a separate authenticated `POST /api/maintenance/idle`.
  Subsequent successful authenticated cloud activity can signal it again on
  a later UTC day. Neither login, startup nor sync awaits its result. Failures
  are contained; a maintenance 401 does not emit the foreground session-revoked
  event. The trigger never deletes local data or changes local authentication.
- No GitHub Actions cron, Tencent timer, self-fetch, platform `waitUntil`,
  browser polling loop or detached post-response server task is used.
  No cloud activity means no maintenance. The browser can close or the request
  can be interrupted; the next day's activity safely retries unfinished work.
- A server-side daily record gates automatic runs. The request spends at most
  about 35 seconds doing work, leaving room under the project's 60-second
  function limit. Expensive storage calls can still exhaust the platform
  deadline: no checkpoint is treated as proof of completion. Cloud requests
  and deletion are sequential to bound resource contention.
- Pages of 20 accounts are internal iteration/checkpoint boundaries, not a
  requirement for 20 separate user visits. One request advances through as
  many pages as its time budget allows. On timeout it resumes the unfinished
  account, then later accounts, from a durable cursor. A failed account is
  revisited in the next full scan; other accounts can still progress.

## Deletion safety and boundaries

1. Re-read the immutable account identity and inactivity deadline. Exempt the
   configured administrator ID and the reserved normalized SMHE name. Accounts
   with a Circle participation marker are held pending a separate audited
   social-data cleanup. Circle frontend/scrubbing is outside this task.
2. Write a draining fence. New authenticated cloud operations for that account
   cannot start. Wait at least 24 hours, far longer than an in-flight function,
   before starting destruction. A returning valid password/session during
   draining records a cancellation request; a later maintenance pass renews
   activity and reopens access. Until then the account receives an explicit
   maintenance error. Unrelated accounts continue normally.
3. Set a separate monotonic deleting marker; a stale draining-fence overwrite
   cannot reopen access once destructive work starts. Remove only the exact
   `users/<immutable-id>/` and `accounts/<username-hash>/` namespaces. Validate
   every listed key. Re-read account identity before each object deletion and
   confirm the prefixes are empty before finalizing identity deletion LAST.
4. Interrupted deletion is retried. Missing objects are harmless. Keep a small
   ID/hash tombstone without plaintext username, password, token or learning
   data, and reserve username reuse for 24 hours after completion so old
   function requests cannot collide with a new account incarnation.

Blob cannot atomically delete multiple objects or provide a trustworthy
distributed compare-and-swap lock. The daily claim is a best-effort execution
gate, NOT a mathematical exactly-once guarantee across regions. Overlapping
claims and repeat deletion must remain harmless. Likewise an empty Blob listing
is not an independent global physical-erasure certificate. Real nonproduction
multi-region interruption/convergence testing is still required before enabling
destructive production execution. No complete physical erasure is claimed by
the UI or this implementation.

The independent request still consumes shared function/storage capacity. It
does not block the login or learning control flow; zero resource competition
is not promised. A single slow storage call can exceed the soft budget.

## Server-only configuration

Set these in EdgeOne Makers runtime environment variables, never `VITE_*`,
frontend build settings, source control or the browser:

| Variable | Value |
| --- | --- |
| `ADMIN_USER_ID` | The EXISTING SMHE account's immutable 32-character user ID, not the text `SMHE` |
| `ADMIN_PASSWORD` | Administrator password, case-sensitive, 4–128 characters; no value belongs in a report or commit |
| `IDLE_POLICY_START_AT` | Fixed ISO UTC activation date; do not move it backwards to accelerate deletion |
| `IDLE_CLEANUP_EXECUTE` | Default absent/false; set `true` only after deployment qualification |

SMHE usernames are case-insensitive; privilege requires the pinned ID AND
normalized name `smhe`. Do not create a new account or infer admin privileges
from a client-supplied username. Obtain the existing ID from the owner's own
verified login/account response; never request a password in chat.

The admin password is verified directly from the environment, not persisted
as a new database password or password verifier. Pre-existing ordinary SMHE
password records are ignored while admin binding is active; this task does
not erase historical credentials in existing account records. Its new random
session token is signed with the current environment password, so changing
that variable invalidates old administrator sessions without a stored password
fingerprint. Ordinary users keep their existing password/session behavior.
Application password-change and account-delete operations reject the admin.
Set both administrator variables together before use; an absent environment
password fails closed rather than falling back to the old database password.

Keep `ADMIN_USER_ID` pinned: removing the binding changes the account's auth
mode and is an operator rollback decision, not a password reset mechanism.

## Administrator workflow

The ordinary account dialog discovers privileges from `/api/admin/access`.
Only the verified administrator can read `/api/admin/storage`, preview
`GET /api/admin/idle` or confirm `POST /api/admin/idle`. Preview is read-only
with respect to target accounts; authenticating the administrator may record
its own daily activity. Mutation rechecks identity and inactivity server-side.
Manual execution deliberately permits operator retries, independently of the
automatic daily gate. Ordinary users can only signal the fixed automatic
policy; they cannot submit a target account, cursor or arbitrary deletion.

Storage usage reports object/account counts and bytes only if the provider
returns complete size metadata. Otherwise use the Tencent console for the
actual quota; do not substitute compressed snapshot size for total Blob usage.

Development delivery does not deploy Maker, configure these variables, bind
the real SMHE account or delete any real account. Release remains a separately
authorized operation under `AGENTS.md`.
