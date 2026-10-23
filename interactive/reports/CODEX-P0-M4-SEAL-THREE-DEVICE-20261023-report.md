# P0 M4 seal diagnosis — 2026-10-23

Status: PARTIAL / NO-GO. Fix remains on `codex/m4-seal-diagnosis-20261023`.
No update to product/main, edgeone-test or master has been made by this task.

## Verified intake

- Diagnosis branch: `67beceaa85ad431c3fa3dc456efbac1ed09e1841`.
- product/main and edgeone-test: `1a70bfe219af1fef187fcd4b71484332415a291f`.
- master: `6d7839b9a9fd7a31459a19aeca948227b1f7b3c2`.
- Read the complete handoff, AGENTS, CURRENT_TASK, referenced task/report and convergence checkpoint.
- Existing failing staging evidence: https://github.com/smhe00/qwerty-learner/actions/runs/39937158658 . The final cleanup 500 concealed the application error.

## First proven cause

`installWorkspaceStorageWriterGuard()` replaces `Storage.prototype.setItem` and rejects direct writes to the migration witness. `refreshWorkspaceMigrationWitness()` used that same public method. Account-management boot installs the guard before reauthentication; its pre-mount M4 transaction therefore completes restore and exact full-V4 readback, then throws in seal before finalize.

Reproduced against the original source in real Chrome/IndexedDB with the S1 lease and installed guard. Fixed diagnostic chain: `executeM4Merge -> recoverM4Merge -> replica.seal -> refreshWorkspaceMigrationWitness -> guarded Storage.setItem`. Wrapped cause: `S1 migration witness is managed by the guarded writer only`.

Redacted original-source reproduction:

```json
{"errorCategory":"guard-rejected-managed-seal","phases":["capture","stage","restore","verify","seal"],"pending":true,"rollbackIntact":true,"candidateIntact":true,"exactCandidate":true,"sealed":"sealed","rejectsSet":true,"rejectsRemove":true,"rejectsClear":true}
```

The prior M4 browser tests ran without installing this guard. The fix keeps a private managed-refresh closure using the original setter captured by the guard. Public set/remove/clear restrictions remain enforced; no ownership, full-V4 verification, source-row audit or journal CAS was relaxed.

## Recovery and evidence boundary

- Real-IDB regressions inject interruption at restore, seal and finalize under the guard. Both full snapshot fingerprints are checked before reload; actual S1 boot must restore the exact candidate before mounting, require a reload, clear the pending journal only after verification and make a second replay a no-op.
- Explicit rollback, foreign owner rejection and scratch six-table Typeson parity remain covered.
- These tests prove journal retention/recovery for the reproduced fault. The old CI profiles were closed without a journal artifact, so the historical `A=0` observation cannot prove either permanent loss or intact rollback on that specific profile.
- New staging failure evidence independently reads the durable vault and reports only six-table counts and snapshot-integrity booleans. It never exports account/device IDs, attempt UUIDs, tokens, words or snapshot payloads.

## Three-device and cleanup reporting

- Keep single-active-session and sequential reauthentication. No manual Sync or test writes to RecordDB.
- Strengthen final verification to exact 3/3 attempts on **each** A/B/C profile, with original immutable fields preserved once each.
- Retain application and cleanup errors independently; Playwright 1.40 requires explicitly preserving both assertion stacks because it does not serialize AggregateError.errors.
- Write the redacted artifact expected by the existing upload step.
- DELETE 500 is **not fixed or explained yet**. Add only fixed failure-stage diagnosis (identity, Circle activity guard, body read, content deletion). A failed Circle safety check remains RED and cannot authorize deletion. Only disposable accounts may be cleaned up.
- Repair the pre-existing Windows `URL.pathname` test-entry bug with `fileURLToPath`, allowing all route integration tests to execute locally.

## Local validation at initial patch

| Check | Actual result |
| --- | --- |
| Cloud contracts | 549/549 PASS |
| Modified frontend sync + backend lint | PASS |
| Production bundle | PASS |
| M4 guarded seal | PASS, phases include finalize and complete; full-V4 fingerprint exact |
| Full S1 | 114/115 PASS; first legacy-app startup visibility assertion still under investigation |
| M4/P4b cases inside S1 | All PASS, including guarded restore/seal/finalize interruptions |
| Mobile P0 browser suite | 41/41 PASS |
| Review browser suite | Running at checkpoint |
| Exact-patch Pages / etest / release readiness | NOT RUN; no promotion or release |

Local logs and synthetic traces remain in the isolated checkout's `.diagnostic/` and ignored test outputs; no user data or credentials are committed. The branch-only `P0 M4 Diagnosis Safety` workflow runs Linux Cloud/lint/build and full S1 without deploying, creating accounts, changing release status or bypassing existing gates.

## Next action / release recommendation

1. Inspect the branch-only Linux safety workflow tied to the fix SHA. Resolve actual failures and finish local Review/account coverage.
2. Follow the handoff's explicit promotion boundary: only propose product/main and edgeone-test promotion after safety passes. Existing same-SHA Pages + Cloud admission and all mandatory release checks must remain unchanged.
3. On an authorized etest promotion, verify `https://t.smhe.cn/` source marker and single-session backend before creating disposable accounts. Run the strengthened hard three-device test; inspect independent cleanup-stage evidence if DELETE still fails, fix the actual cause and rerun the complete gate.
4. Until full exact-SHA Pages, P4b, S1, Review, mobile, Cloud, real transport and hard three-device acceptance pass, recommendation is **NO-GO**. No master release authorization exists.
