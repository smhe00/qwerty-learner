# Use verified local data on unchanged startup

Status: REVIEW. Executor: Codex startup-local. Execution base: 2e18c82428fa21dd6f1478d6aa29f36d5268650a.

Owner asks to stop repeating expensive synchronization on every opening when local learning data is already current. Implement on product/main as a separate owner-directed task; do not take over the unrelated Circle CURRENT_TASK.

Scope: authenticated ordinary learning startup may reuse a completed full-V4 comparison only when a fresh authenticated remote revision/fingerprint, account/generation, durable baseline and independently read actual local contents all match. Keep all six tables, daily sessions, settings and navigation in the local comparison. No count/timestamp-only dirty flag; old/native writers and same-count edits must invalidate reuse. Missing/corrupt/unsupported cache falls back to existing complete sync. Manual sync remains complete. Preserve local-first offline fallback, pending outbox publication, session revocation, CAS conflicts, lost-ACK reconciliation and every recovery journal/owner guard.

Also avoid rewriting and rereading an already complete, exact server-owned history checkpoint on unchanged authenticated checks. Retain fresh authentication/ownership and content-addressed validation; changed heads/partial checkpoints follow existing verification. Do not claim a receipt listing proves complete account convergence.

Validation: focused cache invalidation/integrity contracts; real IndexedDB/browser repeated startup with network counts, local same-count modifications and remote changes, expired/revoked sessions, cache faults and pending recovery; existing startup recovery and sync policy/executor contracts; relevant server history tests, scoped lint and build. Report exact results and remaining limits in interactive/reports/STARTUP-UNCHANGED-LOCAL-20261029-report.md.

Delivery: commit/push product/main after validation. This implementation request does not itself authorize deploying this new candidate to etest/master; preserve pinned release candidates and branch ancestry. No force push, gate weakening, schema migration or edits to learning records merely to enable the optimization.

Source commit: f97b625f32e6320dfa5d6dc05f0677c4946138c8. Source tree: 23fb77035283902897c1ed4c97865955d977fca1. Implementation and local validation complete; exact evidence and limits are in interactive/reports/STARTUP-UNCHANGED-LOCAL-20261029-report.md.
