---
protocol_version: "1.1"
task_id: "CODEX-P2-LOGIN-EVENT-WARNING-20261024"
task_file: "interactive/tasks/CODEX-P2-LOGIN-EVENT-WARNING-20261024.md"
report_file: "interactive/reports/CODEX-P2-LOGIN-EVENT-WARNING-20261024-report.md"
target_branch: "product/main"
status: "REVIEW"
executor: "Codex (single executor)"
claim_base_commit: "bee3240ffcf1b120fab22bf43347e33698e29cc0"
release_to_master: false
---

Investigate a successful V4 no-op followed by M3 and M4 warnings on logout/login with no new learning. Correct confirmed duplicate execution/messages and provide fixed, privacy-safe reason descriptions. Preserve every event validation and ownership guard. Owner-supplied stage trace confirms outbox-recovery-legacy-or-corrupt-attempt; the exact invalid or missing field remains unknown. Development only, focused tests; no user data or live-account writes. Previous unload maintenance is REVIEW at bee3240f.

Scoped fix ready: stop event continuation after M3 rejection and show one fixed reason-specific notice. 9 login-handler regressions plus 23 adjacent contracts pass; scoped lint and diff check pass. No record compatibility rules changed, and no real data was accessed. Event-format rejection remains in force; this is not a claim that old records now qualify for M3/M4. No etest/master promotion.
