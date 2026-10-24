---
protocol_version: "1.1"
task_id: "CODEX-P0-LOGIN-V4-ETEST-20261024"
task_file: "interactive/tasks/CODEX-P0-LOGIN-V4-ETEST-20261024.md"
report_file: "interactive/reports/CODEX-P0-LOGIN-V4-ETEST-20261024-report.md"
target_branch: "product/main"
status: "REVIEW"
executor: "Codex (single executor)"
claim_base_commit: "a2dc907c9c0f6e8924f441fa360ebabd317233dd"
release_to_master: false
---

Owner: fix login V4 sync, merge product/main FIRST, then synchronize edgeone-test and experiment on https://t.smhe.cn/. No master release or real-user account mutation. Continue PR #32; the previous production release task is historical and does not authorize a new release.

Application SHA: 1bce4bfa2afc4c712338bebc4bb6303293c8100d (product/main then edgeone-test). Main admission and staging full-V4 historical startup / conflict proof passed. Final new test identity cleanup200 verified; two earlier staging identities remain cleanup-unconfirmed (separate evidence). master unchanged at a2dc907. Report-only branch; no new deployment.
