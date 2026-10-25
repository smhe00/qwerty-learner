---
task_id: ETEST-TWO-REGRESSIONS-20261025
status: IN_PROGRESS
executor: ChatGPT
base_commit: f91a4ac6701e83f9d65657c0cc67d69898706794
staging_inspected: 1059efd9c2fe6a88c81c42b86a117a5204c6bc95
target_branch: product/main
release_to_master: false
---

Owner requested resolving two specific failures from staged4c20e26 and closing
related PRs: divergent historical login observed4 instead of5 rows; completion
journey stopped in account login navigation. No database migration, general
handoff redesign or root-cause campaign for historic request-body faults.

Preserve independent idle CURRENT_TASK and newer Learn work. Native git network
is unavailable in the chat container; repository access uses GitHub connector.
Work scoped on fix/etest-regressions-20261025 then integrate normally. Etest is
authorized for these tests; master is not. Do not force-push or delete branches.

At startup, upstream already includes corrected completion-dialog handling and
resume-word waiting (f91a4ac). Etest1059efd has identical application code to
4c20e26; differences are completion tests/reports only. Latest history live run
40196696864 PASSED full five-row union, archives, six-table reference preservation
and re-login. This does NOT identify the cause of the prior intermittent failure.
Completion40196696841 now passes login and the entire unmastered path; complete
path fails later with cloud revision1 instead of2 after extra-round reload.
Do not label a successful login as completed cloud convergence when startup
reports pending. Obtain redacted phase evidence before changing merge behavior.

Focused diagnostic workflow40197654012 pins actual staging ref, deployed source
and application source equality before new synthetic fixtures. It retains all
existing assertions; diagnostics add counts/fixed enums only. Evidence must not
include credentials, cloud tokens, raw backups or real-user data.

PR41 and42 are already merged/closed. The only open PR at inspection is unrelated
Circle17, postponed by the separate task; do not discard it as part of this fix.
Close/merge any PRs created for this scoped follow-up after validation.
