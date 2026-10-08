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
3. **S1.3: partial.** `workspace-coordinator.ts` +
   `workspace-lock.ts` implement explicit one-time legacy ownership
   assignment, registry CAS, restore replay and single-writer Web Locks
   lease. Early app bootstrap gating/React hydration and multi-tab rebind
   are NOT wired, so cross-tab production safety is NOT claimed.
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
