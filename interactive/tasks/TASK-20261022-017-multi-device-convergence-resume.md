---
protocol_version: "1.1"
task_id: "TASK-20261022-017-multi-device-convergence-resume"
target_branch: "product/main"
status: "IN_PROGRESS"
priority: "P0"
executor: "ChatGPT (direct executor)"
claim_base_commit: "3547113f08333880fe5f9490b4afc730851b1e86"
release_to_master: false
---

# Resume original M2→M3→M4 auto-convergence, not discarded experiment

## Objective
Ship lossless and eventually seamless same-account learning convergence across phone, PC and mixed devices. Resume the “开发状态摘要” baseline whose exact tree is commit 959b8c9. Do NOT restore the nine discarded experimental commits after it.

## Scope and reuse
- Reuse existing S1 isolation, V4 backup, per-attempt UUID events, durable M3 outbox/verify-set, two-device checkout evidence, deterministic FSRS-6 replay, six-table candidates, ReviewSession three-way identities, tested V4 CAS writeback and M4 journal recovery.
- Gate M2.12 independent checkout declaration using pinned S2 ancestor, cloud revision, verified M3 head and exact readback; existing etest-only flags, no automatic V4 writes.
- Next: attach bounded checkout evidence creation to the verified M3 receipt under S1 owner lease; preserve idempotence without false completeness; add read-only cross-device dry-run; then explicit M4 admission only after no-loss checks.

## Strict out-of-scope
No FSRS or snapshot protocol redesign. No silent acceptance of divergent DailySessions or user settings. No 60-second heuristic deletion of distinct UUID attempts. No last-writer-wins V4 overwrite. No new competing import journal. No automatic account UI adoption, etest flag changes or master release in this task.

## Acceptance
1. Same UUID retry does not double-count; independent same-word attempts remain recorded and deterministically replayed.
2. Missing/forged head, stale parent, switched account, cross-POP incompleteness, 409, ambiguous 5xx or crash never cause silent data loss.
3. Independent readback and session/FSRS/foreign-key checks precede any future M4 admission; preserve rollback archives.
4. Record actual unit, browser, CI, etest live results against exact SHA and distinguish partial implementation from user-visible auto-sync.

## Validation and release
Run Cloud Sync Gate, P4b Browser Recovery Gate, Review Gate, Etest Admission and published Pages checks. Stage/etest promotion only for a verified gate and isolated test plan. `master` changes are forbidden absent a new explicit release authorization.

## Handoff
Prior active forced-session-revocation task remains in historical `interactive/tasks/TASK-20261011-014-forced-session-revocation.md`; this owner-requested explicit reassignment supersedes the stale CURRENT_TASK pointer, not the safety guarantees of that work. See `docs/sync/M2_M3_M4_ACCOUNT_CONVERGENCE_2026-10-21.md` final checkpoint and the linked report.
