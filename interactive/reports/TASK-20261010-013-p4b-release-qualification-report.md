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
