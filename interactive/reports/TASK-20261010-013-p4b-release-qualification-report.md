# P4b launch report — 2026-10-10

Task started on development-only `product/main`; maker-bound `master`
was untouched. Baseline dev SHA `c5aea17`.

## P4b-0 findings + landed changes

**Gap confirmed:** a V4 snapshot with all six tables could silently have
fewer rows than the current RecordDB, while its own canonical SHA-256
remained valid. Existing manifest/schema verification alone cannot detect
that class of export defect. Added independent per-table direct Dexie
`count()` versus exported row counts during capture, with explicit
exceptions instead of accepting dropped data. This cannot detect losses
that occurred *before* capture or all same-count row substitutions,
so further row-level source audit remains a blocker.

Post-Pull replay now recaptures actual restored RecordDB, daily sessions,
settings and navigation, and verifies the full canonical V4 fingerprint
against the staged immutable target before sealing and atomic baseline
revision advancement; an inconsistency must preserve the pending journal.

- `src/sync/v4-table-audit.ts`
- `src/sync/workspace-v4-browser.ts`
- `src/sync/v2-pull-recovery.ts`
- `tests/cloud/v4-table-audit.test.mjs`
- [Cloud Sync Gate PASS](https://github.com/smhe00/qwerty-learner/actions/runs/38052009227)
- [S1 Browser Gate PASS](https://github.com/smhe00/qwerty-learner/actions/runs/38052009218)

## P4b-1 bounded formal

`formal/sync/S2Recovery.tla` with backup/consent, CAS, journal,
failure/restart/replay, account switch, auth expiry, mount safety.
Positive 1-device/1-account TLC generated 1,065 states, 280 distinct;
deliberately unsafe-recovery mutant produces actual `Safety`
counterexample. Stronger 2-device, 2-account exploration is defined but
**NOT YET proven or required as a production Gate**.

[P4b S2 Recovery TLA Gate PASS](https://github.com/smhe00/qwerty-learner/actions/runs/38052252728)

## P4b-2 browser multi-device preparation

Two Playwright scenarios introduced: independent A/B replica push/pull,
then diverged edits (explicit conflict); independent A/B/C replicas sharing
a linearizable CAS fake cloud with simultaneous writes (exactly one
success per revision, no local data loss). Each device has separate
Chromium BrowserContext, IndexedDB and localStorage. These are *not*
EdgeOne/Blob results. First gate must pass before accepting P4b-2.

## Remaining

Critical: actual Maker/Blob tests; V1-to-V4 explicit user migration and
rollback; real session invalidation/foreign account; row-level evidence;
stronger bounded formal projection; existing Learn Journey regression
needs triage. Do not publish `master`.

## P4b-2 first browser acceptance — 60/60 PASS

- Code source `8693dd43164e60da48290e16b471f67c48bc5840`.
- [S1 Workspace Browser Gate 38053214157](https://github.com/smhe00/qwerty-learner/actions/runs/38053214157):
  **PASS 60/60** (previously 58/58).
- A and B: independent Chromium BrowserContexts, own Dexie IDB,
  localStorage and S1 Web Locks, one shared in-process CAS fake cloud.
  A pushes, B verifies Pull + FSRS and preserves source learning row.
  Both edit separately; B writes new revision and A correctly reports
  explicit conflict without losing its local change.
- A/B/C: all independently pull revision 1, edit distinct records
  and race the CAS server. Only ONE successor revision is created;
  exactly one device advances baseline while the others preserve
  their local records and earlier baseline. Client preflight
  conflicts and server 409 CAS are both safe rejection paths.
- Test harness first falsely returned 404 because generic route
  interception missed new Chromium contexts; fixed by regex route
  and `serviceWorkers: 'block'` in test-only contexts.
- **Important separate finding:** immediately after Pull, the mounted
  application can derive/mutate local runtime state, shifting the
  workspace full logical fingerprint even with correct FSRS/word rows.
  This needs a source-of-difference audit (DailySession/settings/
  navigation vs learning records) and explicit no-op/derived-only
  synchronization policy. Do NOT treat it as evidence of lost learning
  rows, but do NOT ignore as production quality risk either.
- Not EdgeOne or real Blob tests; Maker release remains BLOCKED.


## P4b G3: Learn Real Journey first-test CI blocker closed

Original failure: [38056826487](https://github.com/smhe00/qwerty-learner/actions/runs/38056826487).
Playwright artifact includes browser trace/screenshot showing the actual
Learn Typing surface still rendering the word-loading spinner after
S1 workspace bootstrap, while the test prematurely looked for the
"按任意键开始" prompt immediately after `page.goto('/learn')`.
This is a cold-start readiness race in the test (the regression itself
did not reach a spelling attempt), not evidence that Review advanced
incorrectly.

Code fix:
`tests/e2e/learn-review-flow.spec.ts` at commit
`b18dad6b7fa9ecff40e59d1b9ce652d191b639bc`.
Before first keystroke, wait for the actual active Learn session and
first rendered word, assert the exact seeded ordered queue
`cancel,analyse,numerous` and index 0. No production Learn code or
functional assertions were changed.

[Learn Real Journey PASS 38058144882](https://github.com/smhe00/qwerty-learner/actions/runs/38058144882):
- 1 true keyboard-to-durable Learn journey PASS
- 1 multiword Review completes all three words and durable session PASS
- 1 FSRS rating exercise PASS
- 1 ESC full-answer/skip lock PASS
- 1 Hint V2 three-attempt escalation PASS

The independent full Review Gate was re-triggered as 38058144893;
its conclusion must be separately reported. S2 EdgeOne release remains
blocked pending P4b-3/P4b-4.


## 2026-10-10 server allowlist deployment checkpoint

- EdgeOne Maker: user confirmed production `master` deployment **c1135a9**
  successful. This is a deployment attestation, not a measured HTTP/Blob
  acceptance. `master` embeds the server-side `S2_SYNC_WRITE_ACCOUNT_IDS`
  allowlist for both V4 write endpoints, fail-closed absent configured IDs.
- Server implementation commits: `b99a524` -> `0f9f39a`; predicate and
  mocked HTTP boundary tests are committed in `master`. Prior gate pass
  reports refer to *older* candidate commits; don't extrapolate.
- Added remote isolated-account smoke to dev `product/main`:
  `tests/cloud/p4b-edgeone-gate-smoke.mjs` and automatic
  `.github/workflows/p4b-edgeone-write-gate-smoke.yml`.
  This runs without Blob management secrets and deletes its temporary
  account; tests V2 fail-closed behavior, no revision mutation,
  and V1 backward-compatible upload.
- No independent real HTTP result has been observed yet because current
  execution environment cannot resolve `qwerty-plus.edgeone.dev`.
  GitHub connector does not expose push-triggered workflow status in its
  current commit-runs response. **DO NOT mark smoke PASS based on workflow creation.**
- P4b-3 remaining: collect actual smoke run result; use 2–3 approved
  disposable allowlisted account IDs for V4 Push/Pull, CAS concurrency,
  account switching/session invalidation, fingerprints and source-row audit.
- P4b-4 remaining: documented explicit V3->V4 consent migration, V1
  write rejection on upgraded V4, fault replay, and production-safe
  rollback rehearsal; all require actual recorded evidence.


## Real Maker EdgeOne isolated write-gate smoke — PASS (2026-10-10)

**Source tested:** Maker-deployed `master` c1135a9 (user deployment confirmation).
**Runner:** GitHub Actions on `product/main` script commit `08747a1`.
**Independent recorded evidence:** [run #38061862646](https://github.com/smhe00/qwerty-learner/actions/runs/38061862646), job `isolated-api-smoke` conclusion SUCCESS. Classic commit status context `p4b/edgeone-prod-write-gate` SUCCESS.

Actual production HTTP + Blob smoke PASS:
- GET `/api/health`;
- unauthenticated V2 PUT returns 401;
- newly registered disposable account PUT `/api/sync/v2` and
  `/api/sync/v2/recovery` returns 403 `s2_write_not_enabled`, with
  remote revision unchanged after each attempt;
- same disposable account completes legacy V1 PUT and readback,
  remote revision becomes 1 with V3 client format;
- subsequent V2 attempt still rejects, preserving V1 data;
- second independent disposable account sees revision 0 and cannot
  write V2; first account revision remains 1;
- both disposable accounts deleted successfully (explicit log confirmation).

**Scope is narrow:** This closes the production **deny-path/legacy
compatibility/isolation** smoke gate. It does not close allowlisted V4
Push/Pull, CAS winner race, replay/restore, V3→V4 migration, V1 client
write rejection after actual V4, or rollback. The first full
`Cloud Sync Gate` for this test-code commit must be checked separately.


## Source row semantic audit correction

The codebase already contains the stronger source-vs-export **row-level SHA-256**
audit in `src/sync/v4-table-audit.ts`, called from
`captureWorkingWorkspaceV4()`. It independently reads raw Dexie rows from
all six durable tables, normalizes transport-only `$types`, canonicalizes
row order and verifies counts **and per-table row payload digests** before
returning a backup. `tests/cloud/v4-table-audit.test.mjs` includes explicit
same-count FSRS mutation rejection. Prior "row-level audit remains to be
implemented" wording is stale. Implemented != latest candidate Gate PASS;
the refreshed Cloud Sync workflow now publishes the inspectable
`p4b/cloud-sync-gate` commit status for repeatable evidence.


## Refreshed Cloud Sync Gate — PASS (2026-10-10)

- [Run #38062061412](https://github.com/smhe00/qwerty-learner/actions/runs/38062061412)
  on `product/main` commit `1c3f2a0`; classic commit status
  `p4b/cloud-sync-gate=success`.
- **114/114** Node cloud tests PASS (including V4 row SHA, S2 route
  allowlist and backend compatibility tests).
- Backend lint PASS; frontend sync lint PASS; Vite build PASS.
  Logs include 12 pre-existing/nonblocking lint warnings, no errors.
- Real production smoke (separate run #38061862646): PASS, 2 temporary
  accounts both explicitly deleted.
- These are independently recorded results. Do not claim this also
  accepts the actual V4 **allowlisted** write path; EdgeOne server-side
  allowlist account configuration is required for that separate Gate.


## S2Recovery two-device TLA gate — PASS (2026-10-10)

- [Run #38062253933](https://github.com/smhe00/qwerty-learner/actions/runs/38062253933)
  on workflow update commit `beee782`; classic commit status
  `p4b/s2-recovery-tla=success`.
- Pinned TLC model checker fetched and module parsed successfully.
- Production-bounded recovery configuration PASS.
- `S2Recovery.two-device-cas.cfg`: two competing devices and one
  cloud account at `MaxRev=2` PASS.
- `S2Recovery.account-switch.cfg`: one device switching between two
  accounts with crash journal ownership at `MaxRev=2` PASS.
- Deliberately unsafe recovery mutant produced a real `Safety`
  counterexample (positive mutant-gate result).
- This is **bounded** formal verification, not a proof of unbounded
  concurrency or a substitute for real EdgeOne V4 allowlisted CAS.


## 2026-10-11 named production V4 proof: test13 + test24

The user explicitly authorized testing with disposable usernames `test13` and
`test24` and their deletion afterward. During a time-limited test-only
Master release, both account identities were newly registered and confirmed
distinct. Existing same-name accounts would NOT have been reused or deleted.

**First run FAIL, then two actual Maker/Blob runs PASS:**

- [First real run #38084721962](https://github.com/smhe00/qwerty-learner/actions/runs/38084721962):
  both registrations succeeded; ordinary V4 PUT over existing V3 revision
  returned unexpected HTTP **500** instead of expected 409. Both accounts
  subsequently deleted successfully. Root cause not independently confirmed.
- [Second run #38085108313](https://github.com/smhe00/qwerty-learner/actions/runs/38085108313):
  real Maker/Blob **PASS**:
  V3 upload; explicit V3->V4 migration with pinned cloud SHA and identity;
  reject implicit migration and wrong fingerprint; reject V1 writes after V4;
  concurrent A/B/C device-tagged requests produce exactly one CAS winner;
  V4 download verifies payload SHA, account owner, six-table manifest and
  word row; cross-account forged V4 refused; recovery requires pinned V4
  cloud fingerprint; second login revokes old token without data loss;
  `test24` and `test13` both deleted.
- [Independent workflow rerun of #38085108313](https://github.com/smhe00/qwerty-learner/actions/runs/38085108313)
  (job 114310561524) again **PASS** for all categories and both account
  deletions. No new Maker deploy was required for the rerun.
- The first 500 was not reproduced in the following two complete runs,
  but do not silently erase it from the risk log; EdgeOne runtime/transient
  handling remains a residual reliability investigation.

After validation, code in `product/main` and `master` was returned to
strict `S2_SYNC_WRITE_ACCOUNT_IDS` server-only write allowlist at commit
`bcc94f7`; temporary username allowance and scoped diagnostics are
**completely absent from the published source tree**. Cloud Sync Gate for
this cleanup commit PASS:
[run #38085354715](https://github.com/smhe00/qwerty-learner/actions/runs/38085354715).

A separate CI workflow
`.github/workflows/p4b-final-strict-maker.yml` confirms the actual
Maker backend has shed the temporary health capability and again denies
fresh `test13` V2/recovery writes, then deletes its temporary test
account. Do not claim this final deployment/cleanup proof PASS until
the workflow has an independent successful run.

**Scope limitation:** A/B/C parallel calls used distinct device IDs under
one authenticated session. They exercise actual Blob CAS, not multiple
independent logged-in browser sessions; browser-based multi-device/Pull
journal and physical rollback are separately tracked release gates.


## Final Maker strict gate restoration — PASS

Final production `master` commit `bcc94f7a559666f6ce8e359682d82ca506364620`
restored the original accountId-only `S2_SYNC_WRITE_ACCOUNT_IDS`
authorization, with **no test13/test24 special case and no diagnostic response**.
The cleanup candidate Cloud Sync Gate was successful
([38085354715](https://github.com/smhe00/qwerty-learner/actions/runs/38085354715)).

An independent runner waited for the actual production Maker HTTP health
capability to drop both temporary markers and then registered *a new* `test13`
on the live service:
- [Final strict production run #38085477624](https://github.com/smhe00/qwerty-learner/actions/runs/38085477624):
  **SUCCESS**; old Maker test capability absent;
- Both ordinary V2 and V2 recovery PUT returned **403**
  `s2_write_not_enabled` to the new `test13`, leaving revision at 0;
- The newly created final-verification `test13` account was explicitly
  deleted successfully.
- Prior named protocol run #38085108313, including its independent rerun,
  showed both `test13` and `test24` deleted successfully after each run.

**Outcome:** Real Maker/Blob protocol baseline and restored strict server
write gate verified. 2 complete named-account protocol PASS iterations,
1 prior anomalous transient HTTP 500 that remains recorded for reliability
analysis. No test accounts from this effort intentionally remain.

**Remaining P4b hardening:** full browser-driven independent device
end-to-end replay/journal on actual Maker, user-facing V3 migration consent,
and controlled Maker rollback with preserved V4 write protection; do not
silently treat pure API CAS tests as those browser/rollback tests.


## 2026-10-11 FINAL P4b production rollback and browser acceptance evidence

### Independent Chromium release Gate — PASS

- [Playwright recovery Gate #38085865247](https://github.com/smhe00/qwerty-learner/actions/runs/38085865247):
  **13/13 Chromium tests PASS** with three independent BrowserContexts,
  CAS conflicts and preservation of local records, credential expiry,
  precommit outage, ambiguous postcommit response, real browser reload and
  pre-mount Pull journal replay, V3 dual-backup explicit migration consent,
  stale-cloud rejection and recovery direction.
- First GitHub Actions execution failed before tests due to Ubuntu 24.04
  `libasound2` incompatibility in pinned Playwright; switched CI runner to
  Ubuntu 22.04 without modifying or weakening assertions.
- This is true Chromium against local Vite and simulated CAS service,
  **not** a Maker-backed end-to-end browser V4 writer test.

### Maker production browser smoke — PASS

- [Maker real Chromium #38086365378](https://github.com/smhe00/qwerty-learner/actions/runs/38086365378):
  **PASS**; two independent Chromium browser contexts access the deployed
  site and confirm production S2 Sync and Recovery experimental URLs
  fail closed before normal application writers run.
- Browser smoke is read-only and does not prove user-facing V4 Sync
  activation. This protection is intentional until rollout.

### Actual Maker V4 data-preserving rollback — PASS

- [Live rollback #38086096338](https://github.com/smhe00/qwerty-learner/actions/runs/38086096338):
  **PASS**, real EdgeOne Blob and two Maker deployments.
- Under a temporary new-`test13`-only backend allowance, wrote V4 snapshot
  to revision 1 (immutable owner + SHA evidence). CI emitted
  `p4b/rollback-seeded = success`.
- Reverted Maker `master` to
  `7818e2a51bafce48a7c8e6996fd451847f59b4cc`
  (Cloud Sync Gate [38086180015](https://github.com/smhe00/qwerty-learner/actions/runs/38086180015) PASS).
  Once strict backend was live, the **same** V4 revision 1 persisted;
  compressed Blob SHA-256 and logicalFingerprint matched the seed;
  actual downloaded JSON contained the original owner and learning row.
- Legacy V1 PUT to migrated V4 returned HTTP 409
  `sync_upgrade_required`. V2 unauthorised PUT returned HTTP 403
  `s2_write_not_enabled`. Remote revision stayed 1.
- The workflow deleted its own fresh `test13` cloud account successfully.
  CI emitted `p4b/rollback-complete = success`.
- No temporary username exception remains in current production source;
  the Maker strict version is `7818e2a`.

### Acceptance distinction

**P4b backend protocol, browser-side isolated simulation, and actual
data-preserving Maker rollback Gates now have successful independent evidence.**
Prior transient HTTP 500 remains recorded as a reliability follow-up;
subsequent API suites and data-preserving rollback were successful.

**Production S2 user-facing features remain guarded/off.** A true Maker
browser journey with the production S2 UI enabled, on multiple signed-in
devices with their own durable IDB and post-crash recovery, has not been
executed. Separate activation/rollout testing must precede general availability.
Do not conflate completed P4b protocol qualification with general user launch.

## Formal P4b closure decision — 2026-10-11

**Stage result: COMPLETED / QUALIFIED (bounded protocol and safe-release rollback).
Production S2 GA: NOT ENABLED.**

The P4b task checklist is now updated to reflect verified outcomes. CI
and Maker-backed evidence is listed directly in the task file:
`interactive/tasks/TASK-20261010-013-p4b-release-qualification.md`.

Final `master`: `7818e2a51bafce48a7c8e6996fd451847f59b4cc`.
Strict default-deny S2 server allowlist restored and independently verified;
the build remains with S2 UI experiment URLs closed. In-production username
test exemptions and error diagnostic responses were removed. Two independent
full named-account V4 protocol suites passed with all disposable accounts
deleted. Data-preserving V4 rollback over an actual Maker build switch
passed with old V1 write prevention and unchanged V4 SHA, revision and payload.

Boundaries of claim:
- TLC is bounded and decomposed, not exhaustive all-device/all-account model
  checking.
- Chromium 13/13 tests exercise true separate profiles but an in-memory
  CAS server; actual Maker Chromium smoke checks only that the S2 pilot UI
  is disabled.
- Actual Maker V4 CAS, session invalidation, migration and recovery were
  exercised via the API, not a live multi-browser UI journey.
- The one transient HTTP 500 remains unexplained; later full passes do
  not erase it.
- Forced logout dialog and user-confirmed anonymous workspace switch after
  a session revocation remain unimplemented.

Project follow-ups created:
1. P0 `interactive/tasks/TASK-20261011-014-forced-session-revocation.md`.
2. P1 `interactive/tasks/TASK-20261011-015-maker-intermittent-500.md`.
3. P0 Maker enabled-UI GA Gate
   `interactive/tasks/TASK-20261011-016-s2-maker-ui-pilot.md`.

P4b is closed as a **qualification milestone**, not a claim of feature
general availability. No new EdgeOne Maker build is needed merely to
publish this administrative closure.
