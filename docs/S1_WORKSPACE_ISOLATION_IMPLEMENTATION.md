# Sync V2: S1 Workspace Isolation — execution baseline (2026-10-09)

Status: **S1 implementation PARTIAL / isolated foundation verified / NOT ENABLED in UI**.
Work is restricted to `product/main`; `master` is the release branch.

## Decision: S0.5 conditionally frozen

The canonical `formal/sync/CloudSyncV2.tla` remains the implementation
contract. Existing bounded production, Block, identity, backup and two-device
TLC projections and mutation counterexamples remain mandatory. The incomplete
3-device/4-username `NextScale` run is manual only. It is not a proof of
full `Next`; formal verification status is **PARTIAL**.

## S0 dependency audit: blocking real activation

- Current backup is `qwerty-backup-v3` (not V4).
- Current `RecordDB` is a singleton working IndexedDB, not account-isolated.
- Standalone Backup V4 model, V3 migration adapter, real Dexie roundtrip,
  separate immutable-ID vault, atomic IndexedDB registry CAS, and an opt-in
  Web Locks writer lease are implemented and browser-tested.
- Their real activation is still blocked by early boot fencing, all-writer
  quiescence, explicit legacy ownership migration consent, and account UX.
- Boot recovery MUST complete before any DB writer or React hydration.
- Target restore MUST be idempotent and reset an absent workspace to empty.
- Preserve V1 cloud data and existing users; no silent account migration.

## S1 implementation slices

1. **S1.1: foundation, implemented in isolation.**
   `src/sync/workspace-transition.ts` defines identities, monotonic
   generation, CAS journal, crash recovery and A -> anonymous -> B rule.
   Tests: `tests/cloud/workspace-transition.test.mjs`.
2. **S1.2: isolated implementation verified.** `workspace-v4.ts`,
   `workspace-v4-browser.ts`, `workspace-vault.ts`: V4 envelope,
   allowlisted settings, complete DailySession capture, V3->V4 conversion,
   canonical logical fingerprint, durable vault and real Dexie round-trip.
   V1 public backup and cloud payload intentionally stay V3.
3. **S1.3: partial (pre-mount gate integrated on product/main).** `workspace-coordinator.ts` +
   `workspace-lock.ts` implement explicit one-time legacy ownership
   assignment, registry CAS, restore replay and single-writer Web Locks
   lease. The actual `src/index.tsx` is now a minimal pre-mount
   entry: it acquires the writer lease and verifies/replays the registry
   BEFORE dynamically importing `src/app.tsx` (React/Jotai/DB).
   Legacy uninitialized V1 remains unmodified, except that new-code tabs
   wait if another writer tab is active. Journal replay requires a clean
   navigation before app hydration. Multi-tab rebind, previously-open old-JS
   tabs, full write-quiescence on page exit and browser compatibility are
   NOT yet proven for production S1 activation.
4. **S1.4: pending.** Login/logout/registration adapter, explicit anonymous
   copy decision, visible stages and offline/auth failure semantics.
5. **S1.5: partial.** `tests/cloud/workspace-transition.test.mjs` and
   `tests/cloud/workspace-v4.test.mjs` pass. `tests/e2e/workspace-v4.spec.ts`
   passes six real Chromium cases: complete V4 roundtrip, IndexedDB CAS,
   persistent Crash journal, corruption refusal, anonymous/A isolation,
   and single-tab writer lease. Remaining: auth/offline failures, full
   injection at every IO phase, actual UI boot/rebind and TLA+ trace
   refinement.

A transition is allowed only under an external cross-tab lock. Flush and
durably vault the source before committing the pending journal; restore target
only after journal commit; commit active pointer last. After any failure with
a pending journal, block user writes until recovery replays target restoration.

**Do not wire the kernel to the live V1 UI until S1.2–S1.5 gates pass.**

## Validation evidence (2026-10-09)

- Cloud Sync Gate (commit `be0074d1`): **SUCCESS**, 35/35 Node tests,
  cloud/frontend lint and Vite production build.
  Run: https://github.com/smhe00/qwerty-learner/actions/runs/37855817254
- S1 Workspace Browser Gate (commit `c9d6dfa0`): **SUCCESS**, 6/6 real
  Chromium tests on isolated localhost, no EdgeOne deployment.
  Run: https://github.com/smhe00/qwerty-learner/actions/runs/37856059765
- Learn/Review Gate at `8f7b6188` passed; S0.5 Sync TLA mutation
  checking was not green as of this checkpoint. Narrow mutation configuration
  was expanded to permit both settings changes and concurrent writes:
  `formal/sync/CloudSyncV2.stale-push-mutation.cfg`. Formal results must
  be checked separately and never inferred from the nonformal S1 gates.

### Activation blockers

1. Acquire the writer lease before any React mount, Jotai hydration or DB
   write. A second tab must render read-only/waiting UI, never run old writers.
2. Integrate pending-journal recovery before startup and prevent any write on
   failed recovery. Add tab broadcast/rebind and unload behavior.
3. Implement explicit one-time migration ownership decision for existing
   V1 account users and rollback on failures.
4. Wire registration/logout/login progress, dirty-sync preflight,
   account-to-anonymous-to-account transitions, and clear failure states.
5. Extend browser/trace tests for auth expiry, offline, stale tab,
   cloud conflict, migrations and failure injection before enabling the
   new behavior.

No code in this milestone changes the deployed V1 account UI, EdgeOne
backend protocol, or the production release branch.

## Developer application entry for manual Backup V4

From commit `40c05aa0`, `product/main` Settings > Data Settings
includes "Export full V4 backup" and "Verify V4 backup file (read-only)".
Both use the actual S1 V4 snapshot model, including durable Learn sessions
and the explicit preference whitelist. Verification does not import records.
This is an application-test feature, not account isolation activation.

CI: Cloud Sync Gate run 37856717441 PASS (35/35, lint, build); Chromium S1
Browser Gate run 37856717482 PASS (8/8, of which 2 are real Settings UI tests).
No EdgeOne build triggered, and `master` remains unchanged.

The existing manual V3 export/import and Cloud Sync V1/V3 are unchanged.
Full V4 manual restore, V1 account migration, stale-tab protection and
auto boot recovery still require separate implementation and safety gates.

## S1 pre-mount safety primitive (2026-10-09)

`src/sync/workspace-bootstrap.ts` now exposes `prepareGuardedWorkspaceBoot`
and `mountGuardedWorkspaceApp`. An experimental caller MUST defer dynamic
import of the mounted application until the exclusive Web Lock has been
acquired, a previously initialized registry has been validated, pending
journal recovery has completed and its account ID matches current auth.
If a journal was recovered, the guard **requires a fresh page navigation**
before mounting: importing the recovery adapter can initialize legacy store
modules from pre-restore localStorage, so mounting in that same JS realm
could resurrect stale state. The normal no-pending path does not import the
recovery adapter or those store modules before mount.
It **fails closed**, without mounting the callback, for uninitialized V1
storage, competing tabs, corrupted/pending restore failures and identity
mismatch. The lease must remain held for the entire mounted writer lifetime.

This is tested in a real Chromium browser against IndexedDB, including a
reload after injected restore crash, tab contention, an account/auth mismatch,
and corrupt-vault recovery refusal. The legacy production entry point is
**still intentionally unguarded**: the new safety primitive must not be
presented as cross-tab protection while V1 tabs and account actions can still
write without participating in the lock. This checkpoint is NOT S1 activation
and no master deployment is authorized.

### Verification addendum: guarded boot

At source checkpoint `90c9b5d3`, the real Chromium S1 Gate passed **14/14**
including six new fail-closed and journal-recovery scenarios; workflow
https://github.com/smhe00/qwerty-learner/actions/runs/37858999566 .
Cloud Sync Gate for boot source `fefc93dc` passed tests/lint/build:
https://github.com/smhe00/qwerty-learner/actions/runs/37858818743 .
These results cover an *unmounted harness*; S1 early-boot protection of the
real V1 application is NOT delivered. The 3-device/4-username full TLC proof
is still not complete.

## 2026-10-09 actual-app bootstrap / V1 bypass fence checkpoint

The real app entry is split into `src/index.tsx` (minimal writer gate) and
`src/app.tsx` (original React application). The running app retains the Web
Locks exclusive lease; competing new-version tabs render an explicit
read-only/waiting screen with a retry action, not a second writable app.

When the S1 registry is initialized, the boot guard enforces active immutable
account ID matching the authenticated ID. Pending restore is replayed before
app import; after replay, the browser is reloaded to avoid hydration of stale
module-level caches. A corrupt vault or mismatched login fails closed.
For an uninitialized registry, this is merely a **single-writer V1
compatibility gate**, NOT implicit V1->V4 account migration.

`src/sync/workspace-auth-guard.ts` now fences old UI login/logout/register,
V1 cloud upload/download/auto-upload and old destructive V3 import/local
clear once S1 registry is initialized. Read-only backup export/inspection
continues. Existing gen=0 V1 operations are preserved.

CI evidence:
- Source `ab23c052` actual-app browser Gate:
  https://github.com/smhe00/qwerty-learner/actions/runs/37859615247
  **20/20 PASS** (14 foundation + 6 actual-app).
- Source `0e1ce8b7` browser Gate:
  https://github.com/smhe00/qwerty-learner/actions/runs/37859862918
  **22/22 PASS**, with V1 mutation isolation.
- Cloud Sync Gate `0e1ce8b7`:
  https://github.com/smhe00/qwerty-learner/actions/runs/37859863015
  **PASS** including lint + production build.
- Earlier Review Gate `0e1ce8b7` found a delayed Typing auto-pronunciation
  race in a real browser audio test; source `f5788e5` adds a synchronous
  input-length/completion lock guard. Review rerun:
  https://github.com/smhe00/qwerty-learner/actions/runs/37860148522
  (inspect final outcome before marking a review gate as PASS).

**Open blockers:** No V1 account ownership consent/transactional UI;
no supported S1 login/register/logout/switch user flows; no multi-device
or production EdgeOne migration; no verified handling of already-open older
application tabs; successful post-crash restore-then-app-mount now tested end-to-end in
Chromium; V1 consent and account switch UI are still unimplemented. Do not publish `master` or call S1 complete.

### S1 post-crash actual-app recovery gate

At `757f3942`, an injected Crash after durable journal persistence
was replayed by the **real** `src/index.tsx` entry point before React.
The app then reloaded from a clean JS context, selected the recovered account,
kept its working database empty (rather than inheriting anonymous data),
and verified that the anonymous V4 snapshot remained durable.
S1 Browser Gate **23/23 PASS**:
https://github.com/smhe00/qwerty-learner/actions/runs/37860498562

The unrelated Typing audio lifecycle gate exposed a timing-sensitive legacy
assertion; the source fix synchronously fences automatic audio after accepted
input, and its browser regression now measures the no-late-play invariant
from the actual success boundary, not an earlier typing start. Latest Review:
https://github.com/smhe00/qwerty-learner/actions/runs/37860755931
(check final result). This does not change S1's PARTIAL status.


## 2026-10-09 S1 closure continuation: account ownership / writer lease

Code committed on \`product/main\` only:

- \`6bb6ed54\` and \`640b2f4e\`: Typing automatic pronunciation terminal/queued-audio suppression; Review Gate result is tracked separately (do not call PASS until confirmed).
- \`9f076a88\`: account tokens expiring in S1 do not silently de-own a local account workspace. On guarded boot the immutable owner is validated even when the cloud token is expired. V1 expiry retains previous semantics. A mounted app does not release its Web Lock merely because pagehide/BFCache fires.
- \`049a2e5e\` / \`4ab3b481\`: opt-in **development-only** V1 ownership consent is performed before React mounts, under the sole writer lease; it preserves existing records and immutable account IDs. Testing entry is \`/?s1-migration=confirm\` on local Vite DEV only, not available in production. A cancelled consent does not change records. A successful migration reloads from a clean JS context.

**Verified**: S1 Workspace Browser Gate run https://github.com/smhe00/qwerty-learner/actions/runs/37870686755 at \`4ab3b481\`: **29/29 PASS** (including actual pre-mount consent and cancelled migration), no EdgeOne build. Cloud Sync Gate at \`9f076a88\` (37870310069) PASS; Achievement Gate at \`049a2e5e\` (37870667736) PASS. Review Gate for the latest audio change must be checked independently.

**NOT completed**: safe production V1 ownership migration (already-open old-JS tabs are not fenced), full crash-consistent account register/login/logout/switch UI and dirty-cloud preflight, offline/auth error UX, per-phase fault injection and TLA+ trace refinement. No master release. S1 status remains PARTIAL.
