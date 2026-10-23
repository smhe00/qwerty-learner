# Codex Handoff — P0 M4 transaction seal exception / offline three-device convergence

**Status:** COMPLETE / guarded witness seal root cause proven and fixed; exact-SHA real etest acceptance PASS
**Created:** 2026-10-23  
**Repo:** `smhe00/qwerty-learner`  
**Codex task branch:** `codex/m4-seal-diagnosis-20261023`  
**Base SHA (product/main and edgeone-test at audit):** `1a70bfe219af1fef187fcd4b71484332415a291f`  
**Production master SHA at audit:** `6d7839b9a9fd7a31459a19aeca948227b1f7b3c2`  
**Release authorization:** **NONE. NEVER push / merge / deploy master.**

## Completion checkpoint — 2026-10-23

- Root fix: `51868a7ef1a1414fa963db6f871aa39e613afb7e`.
- Validated application, product/main and edgeone-test SHA: `01ed8574da7a231482bf6911038a1fe04e277392`.
- Hard real three-device run https://github.com/smhe00/qwerty-learner/actions/runs/39958673863 : each A/B/C final RecordDB has exact 3/3 immutable attempts; M4 finalized, no pending journal; strict disposable-account DELETE 200 and `accountDeleted:true`.
- Same-SHA Pages, real Blob/browser Cloud E2E and mandatory release-ready PASS: https://github.com/smhe00/qwerty-learner/actions/runs/39958673832 . This does not authorize production release.
- Full evidence, historical failures, cleanup-500 limitation and production recommendation: `interactive/reports/CODEX-P0-M4-SEAL-THREE-DEVICE-20261023-report.md`.
- This completion update is documentation only on the diagnosis branch; retain the validated application SHA on main/etest. master remains `6d7839b9a9fd7a31459a19aeca948227b1f7b3c2`.

The original mission, incident and acceptance requirements below are retained for audit.

## Mission

Find the **first actual cause** of failed no-click V4 reconciliation. Fix it with minimal, data-safe changes and prove the result in an isolated test environment. Keep `single-active-session`: A/B/C cannot all have valid logins simultaneously; their offline WordRecord histories must persist through token revocation; after individually reauthenticating they must auto-merge to an exact verified union without a manual Sync or overwrite choice.

Read repository `AGENTS.md`, `interactive/CURRENT_TASK.md`, and any existing work before editing. This handoff branch is intentionally separate from both `product/main` and `edgeone-test` so writing task context does not invalidate the candidate SHA. Use this branch for your fix; only propose merging to product/main and testing edgeone-test once safety gates pass. Explicit authorization is still required to publish master.

## Verified prior work

1. `aca7018` contained an exact Typeson representation mismatch: scratch Dexie had no `mapToClass` mapping, unlike the production RecordDB, causing a `$types[''] = 'userObject'` difference and an unequal full V4 fingerprint after otherwise identical persisted data.
2. `src/utils/db/core.ts` now exports `applyRecordClassMappings(target)` and `src/sync/workspace-v4-browser.ts` applies it to the scratch DB **before export**.
3. `1a70bfe` introduced a real Chromium/IndexedDB six-table parity and fingerprint regression `tests/e2e/workspace-v4-m4-journal.spec.ts:185`. **All 111 S1 browser tests passed**: https://github.com/smhe00/qwerty-learner/actions/runs/39936313378 . Do not re-investigate this solved cause without new contrary evidence.
4. Further same-SHA PASS: P4b recovery https://github.com/smhe00/qwerty-learner/actions/runs/39936313341 ; safe merge writeback pilot https://github.com/smhe00/qwerty-learner/actions/runs/39937158616 ; M3 single-session relay https://github.com/smhe00/qwerty-learner/actions/runs/39937158607 ; Pages deploy https://github.com/smhe00/qwerty-learner/actions/runs/39936313439 .
5. **P0 RED:** true-browser three-device offline fork/reauth/automatic adoption https://github.com/smhe00/qwerty-learner/actions/runs/39937158658 . Branch Cloud E2E https://github.com/smhe00/qwerty-learner/actions/runs/39937158647 has successful `real-v4-transport` and `live-browser-cloud` jobs, but fails only final `Pages + etest Release Readiness` due to the mandatory 3-device hard gate. Do not bypass this gate.

## Precisely observed incident (hard E2E job 120359706396)

- Deployed EdgeOne test URL is `https://t.smhe.cn/`; `etest.edgeone.dev` is also a known staging hostname but actual current E2E and implementation hostname gate use `t.smhe.cn`. Confirm source marker/hostname on test environment instead of assuming.
- `tests/e2e/etest-three-device-auto-fork.spec.ts` runs genuine Learn in three separate persistent browser profiles, goes offline for independent A/B/C learning, restores networking, verifies revoked A/B tokens fail (401), and performs sequential A/B/C/A/B/C reauthentication. No manual sync.
- Redacted A trace near final login:

```text
published: idle, scanned=1
observed: heads-observed-only
witnessed: witnessed, reason=verified-prefix-only
candidate: candidate, added=1
scratch: validate -> schema -> import -> readback -> audit-proposal
         -> export -> audit-normalized -> validated
materialized: added=1
transaction: capture -> stage -> restore -> verify -> seal
blocked: at=exception
# missing transaction finalize, complete, and adopted
```

- This implies the scratch materialization and full V4 readback check got past the previous Typeson mismatch, but the M4 transaction did **not** visibly finish. `recoverM4Merge` in `src/sync/m4-merge-transaction.ts` notifies `seal` immediately before awaiting `replica.seal()`, and would notify `finalize` after that await. In the active browser adapter `seal: async () => refreshWorkspaceMigrationWitness()` is in `src/sync/m4-witnessed-prefix-browser.ts`. **Investigate the seal/witness/storage guard as a lead, NOT an established root cause.** Verify whether the actual exception occurs in seal, if it is preserved as `cause` inside `m4-merge-interrupted-recovery-required`, and why pending M4 journal replay fails to complete on subsequent boot.
- Diagnostic at test failure `localRows: A=0, B=1, C=1`. **Do not label this proven data loss**: pre-mount restore/reload may leave preserved data in the durable M4 journal. Prove journal presence and intact original rollback snapshot independently, using redacted counts/digests (no raw user content).
- The E2E's `finally` block logs in with a new token and DELETEs its disposable test account; `DELETE /api/auth/account` returned HTTP **500**. Current test fails at `tests/e2e/etest-three-device-auto-fork.spec.ts:279` because cleanup requires status 200. This may MASK the preceding convergence failure. Fix test reporting so the first application error and cleanup error are reported independently. Diagnose and fix DELETE 500 separately; do not make a failure pass by weakening cleanup assertions.

## Relevant source

- `src/sync/m4-witnessed-prefix-browser.ts` (start of M4, redacted phase trace, journal adapter)
- `src/sync/m4-merge-transaction.ts` (staged rollback/restore/verify/seal/finalize)
- `src/sync/m4-merge-journal.ts` (S1 vault persistence)
- `src/sync/workspace-storage-witness.ts`, `src/sync/workspace-bootstrap.ts` (S1 writer lease, Storage hooks, boot and journal resume)
- `src/sync/workspace-v4-browser.ts`, `src/utils/db/core.ts` (scratch mapped Dexie, real six-table capture/restore)
- `src/sync/m3-background-browser.ts` (idle automatic reconcile navigation)
- `tests/e2e/etest-three-device-auto-fork.spec.ts`, `.github/workflows/etest-three-device-auto-fork.yml`
- `scripts/release-readiness.mjs` (same-SHA hard-release gate)
- `docs/sync/ETEST_THREE_DEVICE_AUTO_FORK_E2E.md`
- `docs/sync/M2_M3_M4_ACCOUNT_CONVERGENCE_2026-10-21.md`
- `AGENTS.md`, `interactive/CURRENT_TASK.md`

## Steps and acceptance

1. Re-read current heads, CI and instructions. Reproduce original failure at current same SHA without production writes. Obtain **first redacted exception category/stack** from M4, distinct from teardown DELETE 500. No sensitive payloads/token/account IDs/word histories.
2. Determine whether `refreshWorkspaceMigrationWitness()` throws; whether seal runs before storage hooks are in the expected state; whether original+candidate M4 snapshots remain in the durable journal after interruption; whether boot-time `recoverPendingM4Merge('apply')` safely retries or blocks. Test crash at each phase.
3. Add small regression for the identified bug (real Chromium IndexedDB, S1 owner, entire V4 fingerprint). Fix the minimal necessary code. Preserve fail-closed semantics, full source-row audits and rollback archive.
4. Run exact-final-SHA S1 workspace gate, P4b recovery, Cloud Sync, Review, relevant mobile and Pages gates. Deploy **only** to isolated `edgeone-test` with matching source SHA and retry hard test. Real pass requires all of A/B/C previously durable attempts in active final RecordDB **exact 3/3 union** after single-session sequential reauth and no manual action. Also test no record loss, no double FSRS reward, session and six-table FK integrity, revocation 401, offline reconnection, retries, idempotency and journal crash recovery.
5. Distinguish the E2E's core assertion failure from account cleanup failure. Delete only disposable test accounts, never production ones. Keep failed test RED when cleanup fails.
6. Report first root cause, patch commits/PR, test run URLs tied to the final SHA, exact pass/fail table, and **NO-GO / GO recommendation**, with unresolved issues listed. **Do not release master.**

## Product and release invariants

- Account login is **single active session**, not multi-session. Revoked offline clients retain their durable local attempts and may explicitly reauthenticate to rejoin the cloud.
- Remote Blob/KV are eventually consistent; no atomic multi-client overwrites, no last-writer-wins, no treating incomplete event prefix/Blob listing as complete account history. M3 immutable event receipts alone are not six-table convergence evidence.
- FSRS-6 history/derived state, WordRecords, ReviewRecords, reviewWordStates, chapters, achievements, sessions, settings and S1 ownership cannot be silently dropped or contaminated across accounts.
- Never relax release gates, remove data-safety checks, fake 3/3 completion, enable simultaneous login, touch production accounts/Blob or deploy `master`.
- The M3/M4 experimental path currently runs only on `t.smhe.cn`; production `q.smhe.cn` is separately gated. A passing etest run is necessary but not sufficient for enabling the feature in production.
