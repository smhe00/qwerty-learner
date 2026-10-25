---
task_id: ETEST-TWO-REGRESSIONS-20261025
status: PARTIAL
executor: ChatGPT
base_commit: f91a4ac6701e83f9d65657c0cc67d69898706794
staged_runtime: 1059efd9c2fe6a88c81c42b86a117a5204c6bc95
report_file: interactive/reports/ETEST-TWO-REGRESSIONS-20261025-report.md
live_run: 40197654012
focused_live_passed: true
historical_failure_root_cause_confirmed: false
target_branch: product/main
release_to_master: false
---

Owner requested resolving historical divergent-login4/5 and completion login
navigation failures, then closing related PRs. Keep historical request-body
faults, database changes and general handoff redesign outside this scope.

Existing upstream confirmation-dialog and resume-word test corrections reused;
original completion-login problem is repaired. Actual Etest1059efd qualified:
historical full five-row/six-table convergence1/1 and both complete/unmastered
end-to-end journeys2/2 PASS, with exact cloud readback and three cleanups.
Runtime source equality and staging ref verified before/after. No assertions
removed, no extra Maker deployment, no customer/production writes.

Historical4/5 failure did NOT recur and old evidence lacks its error phase.
Do not call that a confirmed merge-algorithm repair or erase the failure. This
PARTIAL status preserves that uncertainty rather than demanding a new broad
fault campaign. Focused diagnostic workflow on fix/etest-regressions-20261025
retains only safe phase/count evidence for any recurrence; no uncertain POST
replay is introduced. See report for exact commits, runs and artifact digest.

PR41 and42 were already merged/closed and remain so. Independent Circle17 and
its source branch are untouched. No new PR is needed for this additive evidence
checkpoint. Preserve all concurrent main Learn/IDLE work and CURRENT_TASK.
