# Seven-day pure-Blob Circle
Status: IN_PROGRESS. Executor: Codex-circle-seven-day.
Base: 12c2069469c0c00d85f2e9c238eb4e2c2b955f01.

## Owner decisions
- Retain pure Blob / Node Cloud Functions and current authenticated Circle API actions.
- Admission uses a shareable invitation, no approval/private-mode branch. Creator counts as a member.
- Membership is direct write/delete with strong readback; no permanent join/leave history or ban. Removed members may rejoin with a valid invite. Owner closes rather than leaves.
- Check 50 members per circle and 3 circles per account; these are advisory under concurrency. No CAS, distributed lock, hard seat assignment or displacement. A delayed old join may revive membership; accepted tradeoff. Client operations must be serialized and obsolete join retries stopped.
- Keep today plus preceding six days, using Asia/Shanghai dates. No monthly/yearly statistics.
- Stable per-actor activity keys, logical dedup; progress merges completion OR and max daily self-reported newWords. Social data does not affect learning/FSRS.
- Persist daily summaries; normal history reads must not GET each activity again. Retain raw recent activity for rebuild; purge old activity and summaries through resumable bounded maintenance.
- Retain authentication, trusted IP/account limiter, owner checks, response limits and conservative Circle account deletion hold. Do not interpret social simplification as authorization to remove these.
- No implicit migration/destruction of v2 events. Legacy API remains supported without rewriting real data.

## Work and acceptance
Implement scoped v3 Blob adapter, membership/index service, day-partitioned immutable activities and keyed daily view cache; preserve existing API action routes and add personal-circle/daily/maintenance reads as needed. Ensure failed/unknown writes remain explicit. Indexes are repairable, not membership authority; handle partial membership writes and deleted/closed index entries.
Use bounded validated pagination and bounded parallel reads. Summaries identify their immutable source keys so late activity invalidates the view without shared increment counters. Maintenance must be resumable and scoped to expired v3 activity/summary partitions; never delete current records or durable control state. Provide an operator-triggered script (dry-run default) for inactive-circle maintenance; do not enable production schedules without release.
Tests: membership/rejoin/remove/close, retries/readback failures, partial indexes, advisory limits/concurrency, auth and path scope, seven-day boundaries/late data, deterministic aggregation, cached I/O, paginated cleanup/restart, legacy routing, gateway limits, unchanged core/V4 data safety. Run scoped lint and relevant existing cloud regressions. Source review and tests are not live EdgeOne acceptance.
Document schema/API differences, accepted races, maintenance operation and historical document supersession. Commit/push product/main only after validation and upstream integration. Never touch master/etest or user data.

## Related work
PR17 was reviewed and closed at owner request as superseded. Its branch/commits remain for bounded I/O and live-test reference; do not merge its old rollout assumptions.
