---
task_id: SESSION-HANDOFF-20261025
status: IN_PROGRESS
executor: ChatGPT (scoped handoff qualification)
base_commit: 6064bb504c89100551836a0b2629220ee41ea35d
upstream_inspected: a782fb0e46c361bff1eca5ffaef2aee15fe8d18a
target_branch: fix/session-handoff-20261025
report_file: interactive/reports/SESSION-HANDOFF-20261025-gateway-qualification.md
release_to_master: false
---

# Safe account/session handoff

Owner explicitly authorized continued implementation through Etest verification.
Focus is stop old requests, drain admitted effects, then return new login success.
No PostgreSQL selection, provisioning, migration, or production changes.

Scoped exception: preserve the independent idle-activation CURRENT_TASK and its
executor. Work on the feature branch, merge current product/main without force,
qualify the resulting code, then stage that feature SHA directly to edgeone-test
for isolated real-Blob qualification. Do not overwrite upstream development or
update master. Staging pushes auto-deploy; avoid redundant ones.

Candidate: actual HTTP gateway, complete request write tracking, immutable-ticket
Blob coordinator, credential preflight and revalidation, durable single-session
logout. Only NEW random accounts matching ^qh26[0-9a-f]{24}$; existing accounts
are not enrolled. Strong globally complete get/list is a required assumption.
Unknown write results block takeover, never force unlock. No receipt pruning.

Local evidence: previous selected suite 107/107, plus hardened body-classification
regression; final gateway suite 10/10. Repository workflow will run all 108 after
applying the pinned reviewed source wiring and merging main. CI must finish and
identify exact tested SHA before etest promotion. Live validation must observe
held manifest and pending login, not merely rely on timers or no-error responses.

Unresolved for general rollout: provider consistency contract, crash recovery,
bounded history, social/maintenance writers, safe old-code cutover and user UX.
A successful disposable pilot does NOT certify all real accounts.
