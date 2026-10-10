---
protocol_version: "1.1"
task_id: "TASK-20261010-013-p4b-release-qualification"
task_file: "interactive/tasks/TASK-20261010-013-p4b-release-qualification.md"
report_file: "interactive/reports/TASK-20261010-013-p4b-release-qualification-report.md"
target_branch: "product/main"
status: "ACTIVE"
executor: "ChatGPT (direct executor)"
claim_base_commit: "c5aea17a7f249a8c431dd5a502342a89f3e50ec2"
release_to_master: false
priority: "P0"
---

# Current task — P4b Release Qualification (started)

Previous S2-P3b DEV acceptance:
- Cloud Sync Gate 100/100 PASS at 38050718488.
- S1 Browser Gate 58/58 PASS at 38050718549.
- Previous task: `interactive/tasks/TASK-20261010-012-s2-unified-manual-sync.md`.
- `master` remains Maker-bound production; NO publishing by P4b.

First P4b implementation, code in `product/main`:
- P4b-0: independently compare all six live Dexie table counts to the
  exported V4 snapshot and verify full restored V4 fingerprint *before*
  accepting a restored Pull baseline. `src/sync/v4-table-audit.ts`.
  Verified Cloud Sync Gate 38052009227 PASS and Browser Gate
  38052009218 PASS on source `c0f81e29`.
- P4b-1: add bounded formal `formal/sync/S2Recovery.tla` with crash
  replay, account switch, consent and CAS invariants. New dedicated
  `P4b S2 Recovery TLA Gate` 38052252728 PASS (bounded one-device
  model and confirmed unsafe-overwrite counterexample).
- P4b-2: real Playwright three-context same-account simulated cloud
  tests, each context independently owns IndexedDB/localStorage/Web
  Locks. First run is in progress; not yet accepted.
- The S1/Sync development launch flag stays OFF in production; Maker
  server migration API not live. No real EdgeOne/Blob device test yet.

Required release blockers: P4b-2 browser data-flow Gate,
multi-account/per-device fault injection, 2-device TLA bounded scaling
or documented state-space limit, per-table row-level semantics audit,
V1/V3/legacy-client deployment migration consent and rollback SOP,
Maker disposable-user smoke and an independent Review/Learn Gate.

2026-10-10 P4b-2 initial Chromium result:
- Source `8693dd43164e60da48290e16b471f67c48bc5840`, S1 Browser Gate
  https://github.com/smhe00/qwerty-learner/actions/runs/38053214157
  **PASS 60/60**. Multi-profile two-device divergent-edit safety and
  three-device single-winner CAS with each profile's own IDB/Baseline passed.
- First test harness had route interception 404: fixed test-only regex
  interception + blocked service workers (no production API changes).
- **NEW P4b finding:** post-Pull app mount may cause the newly restored
  V4 full logical fingerprint to diverge from the cloud, while actual
  word/FSRS records and revision baseline remain intact. Investigate
  derived DailySession/settings initialization and no-op semantics before
  final P4b real Maker release. Avoid classifying this as a data-loss defect.
- Next: row-level direct source audit, targeted two-device TLA projection,
  multi-account/expiry/crash matrix, real Maker disposable-user tests.
