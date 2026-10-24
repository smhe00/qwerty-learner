# Legacy event compatibility repair

Status: IMPLEMENTED, awaiting exact-SHA etest qualification and master release.
Base: 4982e53700c507d457444108799ad12b81e92c25. Owner authorizes product/main -> edgeone-test -> master, targeted verification, no existing customer data operations.

## Root cause and boundary

WordRecord historically made attemptId and sourceMode optional. Each login rescans all historical rows, so no new study is needed to hit the combined legacy-or-corrupt M3 recovery error. The same assumption independently blocked the read-only witnessed receiver and M4 candidate. The owner supplied the exact recovery code; private row field counts were NOT read. Computer Use stopped because it could not confidently identify Chrome's URL, and no alternate UI access was attempted.

Missing UUID/provenance alone now classifies a row as snapshot-only. It stays byte-for-byte in full V4; we do not invent UUIDs, infer absent sourceMode, delete history or modify user databases directly. Eligible new events can publish and be received alongside it. Invalid present identity, mode, timestamp or review baseline, UUID contradictions, unverified cloud receipts, account/lease changes and export/readback mismatch still fail closed.

M4 replays the complete applicable local review history, including pre-UUID negative reviews. Sparse historical archives retain their richer persisted scheduler state instead of downgrading it, following existing full-V4 policy. Original six-table evidence, exact immutable events, scratch audit, durable before/after journal and post-restore fingerprint checks remain mandatory.

Successful handled compatibility is silent. Genuine incomplete sync has a short plain-language notice. The settings incident package now includes fixed field-issue counts, M3/witness/M4/V4 statuses, retained richer-state counts and timing; this new section contains no credentials, identifiers or learning payload. The existing incident bundle still explicitly includes relevant local learning data under its existing export disclosure.

## Targeted local evidence

- 45 focused recovery/outbox/M4/login/UI contracts passed.
- 7 witnessed receiver contracts and 3 diagnostic sanitation contracts passed (55 distinct unit tests total). Subsequent changes to diagnostic type narrowing and receiver iteration were rerun: 10/10 passed.
- Real isolated browser: mixed legacy source -> independent lossless materialization -> durable M4 journal restore -> exact old rows/all durable tables -> repeated prefix no-op -> read-only incident export passed. Existing guarded seal and crash-after-staging recovery also passed (3 distinct browser contracts). Final mixed-history case rerun after formatting: 1/1 passed.
- Scoped ESLint: zero errors; existing-style non-null assertions and ignored destructured metadata yield warnings. etest spec loads successfully via Playwright --list.
- Repository-wide TypeScript has a known baseline (144 errors); two new diagnostics found during implementation were fixed. Final run returned exactly 144 baseline errors and no diagnostics in the two new compatibility/diagnostic modules.
- Expanded the existing etest historical-login test, reusing its disposable account: mixed missing-ID/missing-mode rows, real Learn attempt, M3-only publication with unchanged V4 revision, witnessed M4 reception, real logout/login without study, and exported diagnostic counts. Actual live result pending.

## Validation/release operations

Owner explicitly authorized making production-three-device-sync.yml manual-only on 2026-10-24 after automatic approval requested clarification. Its tests and workflow_dispatch remain; etest qualification and production read-only source/health verification remain automatic. No production test account is needed for this release.

Pre-commit now runs only lint-staged with formatter and ESLint on staged source files. Removed the two whole-repository mutation commands. A local package script alias unexpectedly expanded an attempted scoped formatting command; execution was interrupted, all changed files backed up and hash-verified, and precisely 116 unrelated formatter-only paths restored. All intended changes were preserved; no unrelated files are included in this commit. Direct node_modules binaries are used for scoped checks.

Next: commit/merge main, advance etest to identical SHA, require historical compatibility proof plus existing Pages/etest/Blob/release-ready gates, promote identical SHA to master, verify canonical production source and health read-only. No manual edits to customer records.
