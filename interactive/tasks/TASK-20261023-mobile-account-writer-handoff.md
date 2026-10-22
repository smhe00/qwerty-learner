---
protocol_version: "1.1"
task_id: "TASK-20261023-mobile-account-writer-handoff"
status: "PARTIAL"
target_branch: "product/main"
base_commit: "09383bdb306494d8d3a0788c7e77261881a50485"
executor: "Codex"
report_file: "interactive/reports/TASK-20261023-mobile-account-writer-handoff-report.md"
release_to_master: false
---

# Mobile account entry contention recovery

User reports Huawei Chromium-based browser shows writer contention immediately after tapping the home login link, before credentials. Ordinary Chrome phone-entry/login regression 2/2 passed at base; Huawei root cause remains unconfirmed. User requests a solution; this is a separate authorized mobile entry fix, not reassignment of CURRENT_TASK cloud convergence.

Scope: make ordinary account-link activation explicitly same-document-context navigation; allow bounded non-stealing writer acquisition at mobile account boot; retry in place before mounting. Preserve all writer exclusivity, pending-journal/identity/legacy guards and stored learning records. Never release mounted writers on pagehide or force an old document out of its lease.

Acceptance: normal touch and keyboard activation do not create another tab even under simulated link-opening policy; delayed native/fallback release recovers automatically; persistent native/fallback contention stays pre-mount with no auth requests; retry recovers without reload once former owner closes; existing account isolation and writer compatibility regressions pass. Run lint, build, focused browser tests and exact-SHA deployment gates before etest promotion. master unchanged. No claim of Huawei real-device fix without device confirmation.


## Device correction and open diagnosis

User corrected the earlier response: manually entering /mobile/account in the same Huawei browser tab also remained blocked. Do not use the withdrawn claim of successful direct entry as evidence for a new-tab root cause. The deployed change covers link policy and transient handoff only; persistent Huawei occupation is not yet reproduced or fixed with evidence. Awaiting user check after fully exiting/reopening browser while retaining site data. No unsafe force-steal or storage deletion authorized or implemented.
