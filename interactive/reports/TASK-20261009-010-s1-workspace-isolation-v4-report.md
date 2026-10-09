---
protocol_version: "1.1"
task_id: "TASK-20261009-010-s1-workspace-isolation-v4"
status: "PARTIAL"
executor: "ChatGPT (direct executor)"
target_branch: "product/main"
claim_base_commit: "77ce352abdf15148da69ed90b47fc77f03fd5039"
last_verified_source_commit: "c9d6dfa001e68d8e25c1f581ec2b6f1e99fd2007"
release_to_master: false
dirty_worktree: false
---

# S1 Workspace Isolation: implementation and verification checkpoint

## Summary

Partial delivery: developed a standalone executable Backup V4 model, an
opt-in browser V4 capture/restore adapter, an independent durable per-account
IndexedDB vault, a CAS-backed registry, a guarded IO coordinator, and an
exclusive writer lease. **None are wired to production V1 account UI.**
No master push, EdgeOne build, account deletion or live-user migration.

## Implemented source

- `src/sync/workspace-v4.ts`: V4 workspace envelope with complete logical
  database, allowlisted WorkspaceSettingsV1, durable DailySession state,
  navigation, source account ID (not username), strict decode and
  metadata-independent deterministic logical fingerprint.
- `src/sync/workspace-v4-browser.ts`: V3->V4 capture of real Dexie records,
  FSRS/achievement/review records, durable daily state, settings, and
  idempotent V4 restore/empty reset. Requires external writer exclusion.
- `src/sync/workspace-vault.ts`: separate IndexedDB snapshot vault,
  immutable accountId keys, atomic registry generation CAS, checksum
  integrity check and corruption rejection.
- `src/sync/workspace-coordinator.ts`: explicit legacy workspace ownership
  initialization and guarded source save/target restore/recovery.
- `src/sync/workspace-lock.ts`: Web Locks single-tab writing lease,
  intentionally not yet wired into app startup.
- `src/sync/workspace-transition.ts`: existing journal/CAS/Crash kernel;
  unchanged from baseline `8f7b6188`.
- Added isolated local Chromium workflow
  `.github/workflows/s1-workspace-gate.yml` and browser fixtures.

## Verification actually completed

| Check | Actual result | Evidence |
| --- | --- | --- |
| Cloud backend + S1 domain tests | PASS 35/35 | Cloud Sync Gate 37855817254 |
| ESLint cloud and sync source | PASS | same run |
| Vite production bundle | PASS (17.01s) | same run |
| Chromium V4/IDB/Crash/isolated workspaces/tab locks | PASS 6/6 | S1 Browser Gate 37856059765 |
| Verification Contract Gate on formal baseline | PASS | 37854631854 |
| Previous Learn/Review Gate | PASS | 37854631871 |
| Full S1 account UI E2E | NOT_RUN | no UI integration |
| S1 early-boot writer fencing | NOT_RUN | not implemented |
| S0.5 mandatory Sync TLA Gate on mutation changes | IN_PROGRESS / NOT VERIFIED | run 37856150599 |
| Three-device/four-username TLC full exhaustion | NOT_PROVED | manual nonblocking exploration |

The first formal run 37854631911 failed specifically because the stale-push
negative control could not reach a counterexample with its previous
projection/bounds. Its mutation-only config was updated to
`MaxSettingVersion=1`, `NEXT NextBlock` so the local setting transition
actually participates. The canonical `Next` and `Safety` were not changed.
The new TLA outcome must be inspected before claiming success.

## Data safety and rollout

Production Cloud Sync V1 still writes qwerty-backup-v3; no automatic V4
migration or account binding is enabled. `RecordDB` is still a singleton
working DB in the existing UI. The isolated S1 adapter operates only when
explicitly invoked under an exclusive lease and no other working writers.

## Remaining acceptance gaps / next action

1. Early app bootstrap + tab-wide ownership gate and recovery-before-hydration.
2. Migrate V1 local/auth ownership only with an explicit one-time user
   decision, including unowned/anonymous and dirty account data.
3. Make login/logout/register/reauth pathways use observable transaction
   stages, progress, failure and rollback; A->B requires anonymous stage.
4. Multi-tab broadcast/rebind and stale-writer inhibition across all existing
   database writers, not only the new coordinator.
5. Expand Playwright scenarios for offline/auth-expired/conflict/Crash at
   every operation boundary; check traces against canonical TLA+.
6. Review and close S0.5 negative-control CI outcome separately.

The next executor should begin from product/main at or after `c9d6dfa0`,
check `interactive/CURRENT_TASK.md`, the task and this report, and
continue without touching `master`. No claim that S1 is ready to release.

## Manual Backup V4 application-test integration (2026-10-09)

Implementation commit: `40c05aa052adeba79b4b96213f46b2f7dd36666e`.

- `src/sync/manual-backup-v4.ts`: app-facing V4 JSON export, gzip download,
  full six-table manifest preflight and **read-only** file inspection with
  logical fingerprint. It does not call V1 upload APIs or DB import.
- `src/pages/Typing/components/Setting/DataSetting.tsx`: explicit
  "Backup V4 (development application test)" controls for full export and
  read-only verification, with visible success/failure messages. Existing
  V3 buttons and cloud sync behavior are untouched.
- `tests/e2e/workspace-v4-app.spec.ts`: application-level test opens the
  actual data settings, downloads the gzip, inspects six durable Dexie tables,
  unfinished DailySession, FSRS, user preferences and credential exclusion,
  then validates the same file through a native file chooser. Another test
  confirms invalid gzip rejection and unchanged Learn records.
- `tests/e2e/workspace-v4.config.ts` and
  `.github/workflows/s1-workspace-gate.yml` run both application and
  storage-level browser suites on localhost without EdgeOne deployment.

### Verified CI, exact commit `40c05aa0`

| Gate | Conclusion | Details |
| --- | --- | --- |
| Cloud Sync Gate 37856717441 | PASS | 35/35 Node tests, ESLint, Vite build |
| S1 Workspace Browser Gate 37856717482 | PASS | 8/8 Chromium cases, including 2 app UI cases |
| S0.5 TLC large 3x4 | NOT REQUIRED | Exploratory; no whole-protocol proof |
| S0.5 mandatory TLC after negative mutation config | IN_PROGRESS at checkpoint | Run 37856150599 |
| Review Gate | IN_PROGRESS at checkpoint | Run 37856717477 |

### Explicit limitations

**Manual V4 import/overwrite is NOT exposed in the app.** This is deliberate:
S1 startup pending-journal recovery and all-tab writer fencing are not yet
wired. The S1 isolated harness has proven V4 restoration and data isolation,
but real-user destructive restore must not be enabled without Crash recovery.

The current V1 working DB is still shared across auth sessions. For a V4
export made while authenticated, the metadata account ID is a **source hint**
obtained from the authenticated V1 user, not a proof of complete S1 account
isolation. It must not be used to auto-authorize cross-account migration.

`master` and EdgeOne production remain unchanged; normal manual V3
export/import and cloud V3 payloads retain their existing behavior.

## 2026-10-09 guarded pre-mount checkpoint (post-CI)

Development implementation commits:
- `24a4f432`: S1 guarded startup primitive, six actual-Chromium
  boot/lock/crash/error cases; test harness and gate wiring.
- `1cc346d5`: force a fresh JS context after recovery, because importing
  the restore adapter may initialize Jotai/localStorage module caches before
  the target is restored.
- `fefc93dc`: isolate clean-journal boot path from restore imports.
- `90c9b5d3`: correct a test expectation (no `recovering` phase when
  no pending journal exists); there was no corresponding product failure.

**Verified CI:**
- S1 Workspace Browser Gate:
  https://github.com/smhe00/qwerty-learner/actions/runs/37858999566
  **PASS 14/14** real Chromium tests at `90c9b5d3` (8 existing, 6 new).
  The initial attempt at `fefc93dc` was 13/14 due solely to that incorrect
  stage expectation, fixed and rerun green.
- Cloud Sync Gate:
  https://github.com/smhe00/qwerty-learner/actions/runs/37858818743
  **PASS**, includes cloud tests, lint, Vite build at `fefc93dc`.
  The subsequent `90c9b5d3` modification is a test-only assertion change.
- The S0.5 protocol-wide TLA run `37856150599` was **CANCELLED**, not PASS.
  The optional whole-state 3-device/4-username TLC exploration remains
  nonblocking and unproved.

**Activation blocker remains P0:** This is an opt-in primitive exercised
from a browser harness, **not a wired app startup gate**. Existing V1 tabs,
Login/Logout, React hydration, and all RecordDB writers do not yet honor
this lease. No production safety claim is made. Before activation, route
every live writer through the guarded boot, stop stale tabs and replay
pending journals before mounting all Jotai modules. Then complete explicit
legacy ownership, auth/offline failure UX, account transitions and tests.

S1 remains **PARTIAL**. No `master` change or EdgeOne build authorized.

## Actual application pre-mount rollout checkpoint (2026-10-09)

- `76304cfc`: moved the original UI to `src/app.tsx`; minimal
  `src/index.tsx` now obtains a single-browser writer lease BEFORE app
  import, fails closed for initialized S1 auth/journal mismatch, and keeps
  gen=0 legacy V1 users working without implicit migration.
- `ab23c052`: corrected Playwright dynamic-import-in-evaluate harness
  errors, not product logic. Actual app Gate **20/20 PASS**:
  https://github.com/smhe00/qwerty-learner/actions/runs/37859615247
- `0e1ce8b7`: blocked V1 credential mutation, V1 cloud overwrite/upload
  and auto-sync, legacy destructive import/local clear whenever S1 registry
  is initialized, without affecting the default gen=0 V1 path.
  Chromium **22/22 PASS**:
  https://github.com/smhe00/qwerty-learner/actions/runs/37859862918
  Cloud Sync Gate **PASS**:
  https://github.com/smhe00/qwerty-learner/actions/runs/37859863015
- `f5788e5`: minimized an observed late audio call after first input by
  checking synchronous accepted length and terminal lock before automatic
  playback. Review Gate rerun:
  https://github.com/smhe00/qwerty-learner/actions/runs/37860148522
  (final status must be checked).

**Risk statement:** New-code tabs mutually exclude their own writes.
Already-open V1 tabs running older JS do not participate in Web Locks and
cannot be claimed fenced. V1 migration is unexposed. Current S1 identity
can be provisioned only through isolated test harness; no end-user account
switch is activated. Full writer quiescence on page lifecycle, multi-tab
rebind, destructive V4 restore and migration UX remain unimplemented.
Production branch stays unchanged. S1 is PARTIAL / NO RELEASE.

## Actual app Crash recovery + audio regression audit

At `757f3942`, a new full application test sets a durable pending switch
journal, preserves the original anonymous snapshot, navigates the real page,
waits for pending restore and page reload, and checks account identity,
registry generation=3, absent inherited anonymous records and intact
anonymous vault. Browser Gate 37860498562 **PASS 23/23**.

Review Gate revealed a separate timing-sensitive Typing audio test:
- `f5788e5` fences delayed automatic play after synchronous accepted
  keystrokes/terminal lock, preserving the intended one-shot entry sound.
- `d080a7d` gives cold development transform adequate wait for first word.
- `4a4828b` fixes the test oracle to count *new audio.play calls after actual
  completion*, not plays during spelling after an earlier pre-input baseline.
The production audio feature must not be labeled fully verified until Review
Gate https://github.com/smhe00/qwerty-learner/actions/runs/37860755931
concludes successfully.

Remaining S1 blockers: explicit one-time V1 ownership migration, complete
transactional register/login/logout UI with progress/recovery, stale older
JS tabs, all-writer quiescence during page lifecycle, offline/auth-expiry
error injection, protocol trace refinement. No EdgeOne build; no master push.


## 2026-10-09 S1 closure continuation: account ownership / writer lease

Code committed on \`product/main\` only:

- \`6bb6ed54\` and \`640b2f4e\`: Typing automatic pronunciation terminal/queued-audio suppression; Review Gate result is tracked separately (do not call PASS until confirmed).
- \`9f076a88\`: account tokens expiring in S1 do not silently de-own a local account workspace. On guarded boot the immutable owner is validated even when the cloud token is expired. V1 expiry retains previous semantics. A mounted app does not release its Web Lock merely because pagehide/BFCache fires.
- \`049a2e5e\` / \`4ab3b481\`: opt-in **development-only** V1 ownership consent is performed before React mounts, under the sole writer lease; it preserves existing records and immutable account IDs. Testing entry is \`/?s1-migration=confirm\` on local Vite DEV only, not available in production. A cancelled consent does not change records. A successful migration reloads from a clean JS context.

**Verified**: S1 Workspace Browser Gate run https://github.com/smhe00/qwerty-learner/actions/runs/37870686755 at \`4ab3b481\`: **29/29 PASS** (including actual pre-mount consent and cancelled migration), no EdgeOne build. Cloud Sync Gate at \`9f076a88\` (37870310069) PASS; Achievement Gate at \`049a2e5e\` (37870667736) PASS. Review Gate for the latest audio change must be checked independently.

**NOT completed**: safe production V1 ownership migration (already-open old-JS tabs are not fenced), full crash-consistent account register/login/logout/switch UI and dirty-cloud preflight, offline/auth error UX, per-phase fault injection and TLA+ trace refinement. No master release. S1 status remains PARTIAL.


## 2026-10-09 legacy V5 tab write fence and gate (S1 still PARTIAL)

Source: \`0675533e\` increments Dexie RecordDB from schema 5 to schema 6
without altering table stores or live records. A real Chromium cross-tab test
exercises an already-open old V5 client with no S1 Web Lock. The new real app
upgrades the database, forces versionchange, and the obsolete client cannot
reopen/write using schema V5. The old client writes made before the upgrade
remain durable; attempted old client writes after it are rejected.

Evidence: S1 browser run
https://github.com/smhe00/qwerty-learner/actions/runs/37871236510
**30/30 PASS**, Architecture run 37871236555 PASS, Achievement run
37871236487 PASS. These checks are all local CI, not production Maker.

**Important limit**: Dexie/IDB version fencing protects database writes
by V5 clients, not arbitrary localStorage mutations by an older JavaScript
tab. Full stale-tab rebind/isolation is therefore still a production
activation blocker. Upgrading schema to V6 also makes that local browser
profile incompatible with earlier V5 bundles; do not deploy the migration
indiscriminately without coordinated production rollout.

The Typing no-late-pronunciation Review Gate is tracked independently:
run 37871236488 FAILED at its 8th Typing test (1 failed, 7 passed).
New diagnosis run 37871506118 examines call stacks for late play events;
do not claim all Review Gates green without an observed successful run.

Remaining S1 P0: production-capable consent/migration with deterministic
multi-tab logout/rebind, transactional register/login/logout + crash recovery,
explicit user status and auth expiry/reauth UX; then offline, all-phase crash,
cross-tab and TLA+ trace refinement tests. No S1 release to master.


## 2026-10-09 S1 direct closure push: pre-mount auth transaction and account controls

**Current result: PARTIAL, NOT RELEASEABLE.** Do not merge to \`master\`.

Code committed:
- \`afd048dc\`: S1 auth intent \`qwerty.s1.auth-transition.v1\`. A pre-mount switch writes intent before durable workspace journal, leaves old auth in place until the target registry commits, and reconciles intent before React hydration after crash/reload. Failed pre-journal switches discard the intent without touching source credentials.
- \`348db5d7\`: pre-mount account management UI on \`/?s1-account=manage\` for **already isolated** workspaces. Provides login, same-ID reauthentication, registration with explicit anonymous data copy/blank choice, and offline-safe explicit logout to anonymous. The ordinary V1 mutation paths remain fenced in isolated workspaces. React Settings routes account actions to this UI.
- \`3c9b5950\`, \`b02551fe\`, \`5476211c\`: added browser contracts for real login/logout, registration copy, authentication failure, A->anonymous->B->anonymous->A data and preferences separation, and immutable-ID reauthentication refusal.
- \`6ecfb932\`: expired V1 credentials retain immutable local account ownership during explicit migration consent; malformed auth intents (same owner/direct A->B) are rejected.
- \`0f1d4c06\`: post-navigation success feedback after login/logout/register/reauth, with explicit in-progress/failure UI.
- \`345c3fca\`: bounded fault injection (flush, snapshot save, prepare CAS, restore, commit CAS) and an S0.5 abstract identity trace projection where only terminal S1 CAS commit changes ownership.

**Important verification state:** Earlier, S1 Browser Gate at source \`0675533e\` passed **30/30**, Architecture and Achievement passed. This DOES NOT cover the new auth code. As of this update, GitHub Actions shows **no new runs** for the later \`product/main\` commits; therefore new S1 browser, Cloud Sync lint/build, TLA and Review checks are **NOT VERIFIED**. The last observed Review run \`37871506118\` passed Typing lifecycle 8/8 and Learn audio 5/5, then FAILED three P3 browser stateful-fuzz cases by 180 s page.evaluate timeouts. Do not call Review PASS.

**Open acceptance blockers:** 1) Run new GitHub Actions and fix any compilation/browser failures; 2) stale old-JS clients can still mutate unversioned localStorage even though V5 IndexedDB writes are fenced by V6; 3) explicit production V1->V4 ownership migration currently remains DEV-only, not generally activated; 4) S1 current account UI intentionally does NOT do Cloud Sync V2 restore/push (deferred to S2), and login of an absent local account opens an isolated blank workspace; verify the S0.5 abstraction boundary and end-to-end UX; 5) test all-phase crash replay with real UI, auth expiration/revocation, injected offline and old-tab interference. S1 stays PARTIAL until all P0 acceptance criteria pass. Do not use the earlier green 30/30 as a release gate for current head.

**Branch policy:** development \`product/main\` only; \`master\` and Maker publication are untouched.


## 2026-10-09 S1 continuation: offline logout and stale client storage containment

At product/main source `fc8297fe` (and preceding incremental commits):

- `fefe879f`: local S1 logout no longer awaits cloud metadata; any offline, DNS or auth delay cannot prevent a safe logout. User sees an explicit warning that unsynced data remains local. `d8455ce2`: real UI regression counts sync-meta requests and demands **zero**.
- `522e2a0d`, `b442ff79`: mount-time isolated owner guards trusted cross-document `storage` events for account credentials, V4 allowlisted settings, navigation and DailySessions. Under an exclusive local writer lease, a matching stale-tab write is rolled back to its previous value; cross-tab `localStorage.clear()` cannot be reconstructed from the event and causes fail-closed reload. Synthetic same-document events are ignored. **This DOES NOT fully solve old-tab mutations outside the current owner document lifetime.**
- `e9eb7e21`: Chromium test models old V5 tab changing memory settings and identity and requires account/settings preservation after reloading the new app.
- `9d136e8c`: fault-injected actual boot tests for a crash *after* target registry CAS but *before* saving authenticated identity, plus a corrupt Auth Intent that must block all app writers and preserve local data.
- `fc8297fe`: verification-only task `interactive/tasks/TASK-20261009-011-s1-current-head-gate-verification.md`, ready for an authenticated GitHub Actions or local runner; the Chat/GitHub plugin has no available workflow dispatch operation.

**Gate truth:** as of this checkpoint, GitHub Actions still shows no new runs for the latest S1/auth changes. Previous S1 Browser Gate **30/30 PASS** at `0675533e` remains a historical baseline, NOT evidence for this newer source. No recent source can be marked CI-green. The latest observed Review Gate `37871506118` FAILED three P3 Fuzz cases via 180s `page.evaluate` timeouts after its Typing and Learn audio checks passed. Do not alter gates to conceal these failures.

**Remaining work** before S1 close: current-head lint/build/Cloud Gate/S1 Browser/TLA/Review; fix all failures; verify old-JS clients cannot contaminate user state even across owner-page termination; production opt-in V1->V4 ownership migration and rollback; complete fault and compatibility evidence. **Status remains PARTIAL.** No commit to `master`; no EdgeOne build.

## 2026-10-09 recovered GitHub CI / latest S1 acceptance run

**Exact tested source:** `cac469812bdd9c2f00e228ebb40638812d946b87` on `product/main`.

| Gate | Run | Conclusion |
| --- | --- | --- |
| Cloud Sync Gate | [37902537677](https://github.com/smhe00/qwerty-learner/actions/runs/37902537677) | **PASS** — cloud contracts, cloud/frontend lint, production build |
| S1 Workspace Browser Gate | [37902537727](https://github.com/smhe00/qwerty-learner/actions/runs/37902537727) | **PASS 45/45** — real Chromium / 1 worker |

Root-cause evidence for earlier red runs:
- [37901768089](https://github.com/smhe00/qwerty-learner/actions/runs/37901768089) at `888197be`: 37/37 cloud unit tests passed, cloud lint passed, frontend lint failed on two sorted import declarations; build skipped. Corrected by `6ea81866` and `23d30bec`.
- [37902042074](https://github.com/smhe00/qwerty-learner/actions/runs/37902042074) at `23d30bec`: 43/45 Chromium tests passed. The two failures were a stale test expecting deprecated V1 credentials in the now-isolated S1 Settings UI, and rejection order for direct A->B account switching. Corrected by `c129af1b` and `cac46981`, then 45/45 PASS.
- The follow-up commits **automatically started** push-triggered Actions, showing the normal GitHub CI path works again. Do not generalize this observation into an established explanation for earlier missing push triggers; the original missing-event root cause remains unconfirmed.

Remaining before S1 COMPLETE: Review Gate P3/Typing audio failure evidence and any fixes, required bounded TLA+ safety checks on current source, production migration old-tab rollout decisions, exact acceptance contract and deployment authorization. **S1 stays PARTIAL, no master update or EdgeOne deployment.**

## 2026-10-09 Review Gate 14-test timeout closure

**PASS evidence:** [Review Gate 37913062490](https://github.com/smhe00/qwerty-learner/actions/runs/37913062490) on `d091a2fcdde1099b1c0e41a62198763712880e13` (`product/main`). Entire job PASS, including full Learn browser contract suite **46/46**, Typing/ Learn audio, Learn stats, P3 stateful fuzz, Build, and production navigation smoke **5/5**.

**Diagnosed cause:** earlier [37910290749](https://github.com/smhe00/qwerty-learner/actions/runs/37910290749) had 14 Learn browser contracts time out (30s each) in `page.evaluate` at raw `indexedDB.open('RecordDB')` test-seed calls. The legacy fixtures only waited for `page.goto('/')`; S1 now gates module hydration/DB startup, and production `RecordDB` is Dexie schema V6. This allowed raw, versionless IDB opens to race initialization/upgrade before testing the actual Learn invariant.

**Fix:** commits `0e2b0119`, `d091a2fc` introduced `gotoReviewAppReady` into `tests/e2e/review-flow-harness.ts` and affected contracts: wait for real app settings control to mount; open the real V6 production Dexie database via a browser module script; verify readiness; then run the original native-IDB seeded scenarios. No production Learn or persistent-data algorithms changed. No assertions skipped or softened.

**Result:** the same 46 browser contracts passed, including all 14 previously blocked cases, reducing Learn contract suite duration from 8.5 minutes to 1.8 minutes. This rules out those CI failures as evidence of a product persistence regression, but does NOT by itself prove every pathological crash/window-switch recovery case.

**Status:** Review Gate PASS on `d091a2fc`. S1 overall still PARTIAL for production opt-in migration, obsolete-tab containment when owner is closed, and explicit publish authorization. `master` and EdgeOne remain unchanged.
