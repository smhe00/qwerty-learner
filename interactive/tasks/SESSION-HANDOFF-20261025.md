---
task_id: SESSION-HANDOFF-20261025
status: PARTIAL
executor: ChatGPT (scoped handoff qualification)
base_commit: 6064bb504c89100551836a0b2629220ee41ea35d
upstream_inspected: 279bd3bc1ff99c548ca515ebc373d3146db94f3b
target_branch: fix/session-handoff-20261025
report_file: interactive/reports/SESSION-HANDOFF-20261025-exceptions.md
staged_runtime: 34a3d15f35ede8dec073fa88deaa5f3125f2ee95
live_harness: c008507fb83e5b98de55f45c896673237494a402
live_run: 40184449856
isolated_pilot_passed: true
release_to_master: false
---

# Safe account/session handoff

Owner authorized continued Etest verification. Focus: stop old requests, drain
admitted effects, then return new login success. No database selection/migration
or production change. Preserve independent idle-activation CURRENT_TASK/executor.
Work on feature, stage only qualified runtime changes without force, and never
silently enroll existing accounts. No Maker rebuild merely for tests/reports.

Initial live13/13 run40183383995 remains valid. Latest continuation added an
actual-gateway TCP disconnect contract and two completed real-Blob runs:
40184183249 PASS30 assertions; 40184449856 PASS32 assertions including full native
backup-byte readback. Same runtime34a3d15; latest harnessc008507f. Both observed
held writer+pending login, intentionally aborted the writer's client response,
recovered exact cloud evidence without replay, then exercised two simultaneous
pending takeovers, exactly one surviving token, repeated switches and logout.
Both zero pre-write retries; synthetic accounts safely deleted; audit receipts
retained. Final pre-cleanup unresolved=0. No runtime/source deployment change.

Only new reserved qh26 accounts are protected. This is NOT server-crash recovery,
automatic FSRS merge, general rollout or overall release certification.
Latest broader V4 transport retest job121141968729 FAILED503 at malformed-SHA
negative case (v4_direct_body_read_failed); earlier migration now passed. Browser
job success does not make the failed release gate green. Preserve all failures.

Next: investigate body-receive503 with actual request lifecycle evidence; complete
safe orphan/unknown-operation recovery and bounded receipts; audit social/idle
writers and old-code cutover before enabling ordinary users. No TTL/fixed sleep,
local mutex or guessed empty/stable metadata may authorize an old-writer unlock.
Read the latest report and evidence JSON; earlier reports remain historical.
