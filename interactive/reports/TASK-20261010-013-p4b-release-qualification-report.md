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
