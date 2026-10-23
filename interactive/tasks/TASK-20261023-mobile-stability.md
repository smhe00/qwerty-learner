---
protocol_version: "1.1"
task_id: "TASK-20261023-mobile-stability"
status: "REVIEW"
target_branch: "product/main"
base_commit: "94f71b527b64d08495b8dbf0d00fd2eed6aa25c1"
executor: "Codex (independent mobile UI stability)"
report_file: "interactive/reports/TASK-20261023-mobile-stability-report.md"
release_to_master: false
---

Owner explicitly selected mobile stability wrap-up after the local learning loop. Continue the existing no-cloud boundary: do not edit src/sync, cloud-functions, account UI, CURRENT_TASK or the other executor's records. Scope: local pause/page lifecycle/audio ownership, soft keyboard visual viewport and IME safety, recovery from failed local answers, and same-document mobile back/menu recovery without duplicate attempts. Reuse existing persistence/progression/FSRS; no new durable or remote schema, no router rewrite, no cloud account actions, etest/master promotion or runtime changes. Transient UI draft is document-memory only and keyed by session/dictionary/item identity; full reload/account document replacement discards it. Do not promise force-kill or physical device certification.

Acceptance: paused/hidden audio late callbacks never mark playback or restart it; resume remains explicit. Failed Again/Hard answers have an honest retry preserving the frozen grade. Soft keyboard height/offset keeps input and submit reachable without disabling zoom. IME Enter cannot submit. Same-tab navigation back/menu restores partial input, revealed decisions and already saved feedback/pending writes, without creating a second WordRecord. Check real local browser cases, desktop shared-tap regressions, scoped lint/type/architecture, normal/Pages builds, route fallbacks and source-SHA Pages smoke. Record physical Huawei/Chrome/iOS acceptance separately.

Implementation commit: 4b7bb63e5bb71c395277219593399cd6fb594fa6. Review the report and physical-device checklist before any release claim.
