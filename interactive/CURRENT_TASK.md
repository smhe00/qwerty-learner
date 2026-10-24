---
protocol_version: "1.1"
task_id: "CODEX-P1-V4-UTF8-IMPORT-20261024"
task_file: "interactive/tasks/CODEX-P1-V4-UTF8-IMPORT-20261024.md"
report_file: "interactive/reports/CODEX-P1-V4-UTF8-IMPORT-20261024-report.md"
target_branch: "product/main"
status: "PARTIAL"
executor: "Codex (single executor)"
claim_base_commit: "51d2124360b620d6d84742b5359d6991f1f60567"
release_to_master: true
last_commit: "9a254569cffe0af6bcf3f5e7732fc80a175289b0"
report_branch: "codex/v4-utf8-report-20261024"
---

Unicode repair PR #36 is qualified on etest and published at identical main/etest/master 9a254569. Read-only production version/health run 40063249178 passed. Conditional cancellation of auto regression 40063249142 could not proceed once its test had started; it completed successfully with disposable-account cleanup 200.

The owner now reports a generic complete-V4 sync failure on actual version 9a25456. This real-account incident remains unresolved. No existing user data has been accessed or changed. Owner confirms local backup export succeeds. Two supplied startup traces prove local capture and metadata request resolved before fingerprint-decision. Full history download/merge remains unproved because automatic-merge stages are not instrumented. Next: existing-tab S2 resource timing paths/status/durations only, without reload/retry; do not request a user backup or credentials. Preserve lossless and session guards; no repeated sync or forced overwrite. See report and redacted proof for exact evidence and retained failures.
