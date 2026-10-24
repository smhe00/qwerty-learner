---
protocol_version: '1.1'
task_id: 'CODEX-P1-LEGACY-EVENT-COMPAT-20261024'
task_file: 'interactive/tasks/CODEX-P1-LEGACY-EVENT-COMPAT-20261024.md'
report_file: 'interactive/reports/CODEX-P1-LEGACY-EVENT-COMPAT-20261024-report.md'
target_branch: 'product/main'
status: 'DONE'
executor: 'Codex (single executor)'
claim_base_commit: '4982e53700c507d457444108799ad12b81e92c25'
release_to_master: true
---

Owner explicitly requests the actual legacy-record compatibility fix, preserving historical data and lossless validation, followed by main -> etest targeted verification -> master. Ordinary users must not see internal diagnostics or harmless handled legacy-format notices. Put localization details in the diagnostic export. No real user data mutation; use isolated synthetic staging accounts and verify their cleanup. The previous scoped warning fix is complete at 4982e537; this task supersedes its development-only scope.

Completed: application05e5e8f0 passed live mixed-history etest acceptance and was released to master. Canonical q.smhe.cn source and health verified by run40082649297. The following main-only commit records evidence and fixes the test landing-route assertion; application source remains identical to the released commit.
