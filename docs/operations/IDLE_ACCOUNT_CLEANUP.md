# 180-day idle accounts and admin direct login

Implementation: `cloud-functions/_shared/idle-accounts.js`,
`cloud-functions/_shared/administrator.js`, existing `/api` gateway,
`src/sync/idle-maintenance-trigger.ts` and account dialog administrator panel.

## Policy and execution

- Continuous 180-day inactivity retires the account and its cloud learning
  data. No extra 30-day grace period, email or SMS notification is promised.
  The policy is shown in registration/account views. Browser learning data,
  IndexedDB, writer leases, FSRS and local workspace ownership are untouched.
- Existing accounts get a full 180 days from the first automatic maintenance activation stored in Blob (or an explicitly configured legacy `IDLE_POLICY_START_AT`). A registered administrator is not required to activate the retention policy; both admin and legacy SMHE names are always protected, even without an administrator password or ID binding.
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
   configured administrator ID and both reserved normalized names, admin and smhe. Accounts
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

### Deploying the code activates maintenance

`cloud-functions/_shared/idle-deployment-policy.js` is the nonsecret release
configuration. Its `enabled: true` makes the normal deployed gateway enable
independent maintenance without a control-plane login, new API Token, GitHub
Secret, console environment edit or external scheduler. Existing Cloud Function
Blob authorization is reused, just as for account synchronization.

The first executing maintenance pass creates
`maintenance/idle-policy/v1.json` with version1 and a fixed server UTC
`startedAt`, using conditional creation and canonical read-back before scanning
accounts. All preexisting accounts receive at least180 days from that floor.
Later activity/creation can extend it. Later instances and code deployments
read the same record instead of resetting the clock. The record contains no
account/password/learning data and is separate for each project's existing Blob
namespace. Do not remove/rewrite it during routine deployments.

Login, public policy reads and administrator dry-run previews never initialize
that record. Preview without a persisted floor conservatively retains all
accounts and writes nothing. Initialization and account scanning run only in
executing maintenance; failure/unconfirmed/corrupt metadata stops deletion and
can be retried on later activity. Conditional creation is not claimed to be a
global CAS lock; concurrent initial timestamps can conservatively extend
retention but never precede the first activation attempt.

To stop execution through code, change release `enabled` to false and deploy
normally. The stored activation date is retained for a later re-enable. This
code stop overrides even a legacy execution=true environment setting.

### Optional legacy overrides and administrator configuration

No IDLE environment variables are required. Existing explicit overrides remain
supported: an execution value other than exact `true` stops destructive work;
an explicitly invalid/empty start date disables policy instead of silently
falling back. Administrator password configuration remains server-only.

| Variable | Value |
| --- | --- |
| `ADMIN_USER_ID` | Optional existing immutable administrator ID pin; normally the first verified admin login binds it |
| `ADMIN_PASSWORD` | Required case-sensitive administrator password,4–128 characters; missing/empty/invalid disables administrator login; keep it private |
| `IDLE_POLICY_START_AT` | Optional legacy fixed ISO UTC floor; never backdate; omitted uses automatic persistent activation |
| `IDLE_CLEANUP_EXECUTE` | Optional explicit stop/override; omitted follows release policy; only exact `true` permits work when present |

Both sites are in the China console. Historical external SDK/token workflows
are optional investigation tools, not a runtime or release requirement. Their
old global-project sandbox evidence and China authentication failures remain
in the task report; they do not establish the owner's international-site usage.
No owner console work should be requested to enable this code-managed path.

Node Cloud Functions read these four feature settings (the two ADMIN and two
IDLE keys) from `process.env`, with explicitly supplied context values taking
precedence. Undefined context entries do not hide Node bindings. Literal Node
access also supports provider function bundling. Existing storage, CORS and
sync-suspension settings keep their previous source; this feature does not
silently activate unrelated Node configuration.

Normal code deployment loads the release policy. Optional environment edits
also require redeployment. `GET /api/account-policy` reports policy permission
with `enabled` and effective destructive permission with `executionEnabled`;
these booleans are not proof that a maintenance pass has completed. Health
capability `idle-auto-policy-v1` identifies this code-managed implementation.
Public reads never expose the stored start date or trigger initialization.

The no-control-plane staging workflow `idle-code-qualification.yml` verifies
an exact normally deployed SHA, real login/learning while maintenance is held,
the independent real maintenance response, preserved local/session state and
verified deletion of only its disposable test account. It consumes no Makers
API Token and changes no console settings. Preserve same-SHA Pages/etest/
release gates before production promotion and all interruption/deletion safety
requirements. Do not age customer accounts to demonstrate cleanup.

The isolated real SDK qualification (run40159814798) passed8/8 and confirmed
all69 tracked fixture keys absent, with no production namespace touched.
This is external SDK/two-client coverage, not a global physical-erasure or
multi-region certificate. Its exact report is retained under
`interactive/reports/evidence/IDLE-QUALIFICATION-20261025/`.

### Administrator login, without registration

Use the existing Login tab with username `admin` (case-insensitive) and the
server-only `ADMIN_PASSWORD`. The variable name is uppercase and case-sensitive;
`admin_password` is not read. Missing, empty or invalid configuration disables
administrator login. There is no source-defined/default password. Redeploy the
same code after changing EdgeOne environment settings. Never send passwords in chat.

Leave ADMIN_USER_ID unset in the normal flow. Loading configuration creates no
account. Only an actual successful admin login initializes an absent identity
and persists its immutable ID in `maintenance/administrator/v1.json`. Registration
of either `admin` or legacy `smhe` is rejected with a direct-login hint. Login as
`smhe` directs the operator to `admin`; normal users use their existing names.
Read-only authentication preflight cannot initialize or enroll an administrator.

The public profile is `admin`, while the legacy SMHE account hash, immutable ID,
workspace and session namespace remain unchanged internally. This avoids copying
or losing existing learning/feedback data. An existing SMHE identity is adopted
only after the environment password is verified; its old ordinary password and
unsigned sessions cannot grant administrator access. Privilege requires the
bound immutable ID, active identity and administrator name, never a name alone.
If an ordinary account already occupies `admin`, login fails with an explicit
conflict instead of overwriting or promoting that account. A missing/replaced
bound identity or conflicting ADMIN_USER_ID also fails closed, without recreation.

Only environment-managed metadata is stored for newly initialized accounts, not
the password or a password verifier. Historical ordinary SMHE password records
are retained but ignored. Sessions are signed using the current server password;
rotating or removing it invalidates old administrator sessions. Application
password-change and self-delete reject the administrator. Ordinary users keep
their password/session behavior. Do not remove the persistent binding to reset
a password: change ADMIN_PASSWORD privately and redeploy.

Binding writes use canonical identity checks, provider onlyIfNew and read-back
verification. Provider onlyIfNew is not treated as a globally atomic lock. A lost
receipt is accepted only when confirmed; otherwise login fails without returning
a token. A later explicit login can reuse the durable identity. Real nonproduction
concurrent initialization qualification remains required before production release.

Idle cleanup protects the bound ID and both reserved names independently of
login configuration. More than 180 days of inactivity, repeated executing passes,
or stale cleanup markers cannot make these identities deletion candidates.
Protection includes their account/session, learning and feedback namespaces;
this exemption never grants administrator permissions to an ordinary same-name
account. Normal expired users still follow the drain-and-delete policy.
