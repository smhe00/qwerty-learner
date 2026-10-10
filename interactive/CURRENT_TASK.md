---
protocol_version: "1.1"
task_id: "TASK-20261011-014-forced-session-revocation"
task_file: "interactive/tasks/TASK-20261011-014-forced-session-revocation.md"
report_file: "interactive/reports/TASK-20261011-014-forced-session-revocation-report.md"
target_branch: "product/main"
status: "READY"
executor: "unassigned"
release_to_master: false
priority: "P0"
---

# Current task — Forced session logout + safe anonymous workspace switch

**Prior P4b milestone: CLOSED / qualified on 2026-10-11.**
See `interactive/tasks/TASK-20261010-013-p4b-release-qualification.md`
and `interactive/reports/TASK-20261010-013-p4b-release-qualification-report.md`.
This closes bounded backend protocol / Chrome recovery / real Maker rollback
qualification, **not public S2 UI GA**.

## Next P0

Implement user-visible forced logout when `/api/auth/me` or another
authenticated endpoint returns `401 session_revoked`, with session checks
on resume/focus and bounded periodic polling. After explicit user
confirmation, execute S1 pre-mount, WebLock-protected durable
account→anonymous switch; preserve all original account Vault data and
correctly handle crash/restart. Network outage or ordinary expiry are NOT
forced-logout events.

Source: `interactive/tasks/TASK-20261011-014-forced-session-revocation.md`.

## Queued separately

- P1 EdgeOne V3→V4 implicit migration denial sometimes returned HTTP 500:
  `interactive/tasks/TASK-20261011-015-maker-intermittent-500.md`.
- P0 gated Maker UI test on independent logged-in durable Chromium profiles
  before public S2 enablement:
  `interactive/tasks/TASK-20261011-016-s2-maker-ui-pilot.md`.

## Production state

EdgeOne Maker `master` release: `7818e2a51bafce48a7c8e6996fd451847f59b4cc`.
S2 frontend pilot OFF; V2 backend writes fail closed except server configured
immutable account IDs. Do not publish new frontend activation without
P0 release criteria; continue development only on `product/main`.
