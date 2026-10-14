---
protocol_version: "1.1"
task_id: "TASK-20261013-019-independent-device-sessions"
task_file: "interactive/tasks/TASK-20261013-019-independent-device-sessions.md"
report_file: "interactive/reports/TASK-20261013-019-independent-device-sessions-report.md"
target_branch: "product/main"
status: "PARTIAL"
executor: "ChatGPT (direct executor)"
release_to_master: false
priority: "P0"
---

# M1 — independent multi-device authentication (gated implementation)

## Objective
Remove the single-active-session restriction without requiring linearizable Blob writes. Allow independently authenticated devices to coexist, subject to server-verified expiry/revocation and strict S1 account ownership isolation.

## Implemented in development
- Optional \`MULTI_DEVICE_AUTH_ENABLED=true\`, default OFF.
- Independent per-token session records, random hash keys, compatible read of previously valid legacy latest session.
- Token-scoped immutable revocation marker, \`POST /api/auth/logout\`.
- Account-wide password change invalidates sessions by auth version; account delete clears all session objects.
- V4 writes explicitly fail closed in multi-device pilot until M2/M3 lossless merge is ready.
- Regression tests in \`tests/cloud/multi-session-auth.test.mjs\`.

## Required release gates (unfinished)
- [ ] Verify current Cloud Sync Gate on newest commit, including build/lint/tests.
- [ ] Independent Chromium profiles + real EdgeOne Maker authentication (pilot flag enabled) and multi-POP eventual consistency.
- [ ] Repeated cross-device revoke/password reset; slow listing, stale auth version, mixed/legacy sessions and account re-registration.
- [ ] Prove token expiration under clock skew and safe garbage collection of expired session objects.
- [ ] Demonstrate no V4 silent overwrite; implement M2 event merge and M3 no-loss publication.
- [ ] Complete existing P0 forced-revocation/anonymous workspace exit task and reconcile with new session semantics.
- [ ] Enable multi-session only on isolated test deployment, then run full release gates before any master change.

## Risks / invariants
- EdgeOne Blob is **not an atomic CAS**. Per-token random object keys avoid contention for session issuance but do not make account auth-version listing globally linearizable. Immediate cross-region password-reset/logout invalidation is NOT yet proven.
- M1 is not M2 or M3. Concurrent V4 writes are refused, not merged. A successful login does not imply automatic cloud convergence.
- Do not modify master; normal production remains single-active-session.
