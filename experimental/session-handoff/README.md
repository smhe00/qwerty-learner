# Account handoff qualification

Current work: [Blob-only HTTP gateway qualification](BLOB-QUALIFICATION.md).
The owner asked for safe account/session handoff, not a database migration.

The first P0 prototype retained a PostgreSQL reference adapter and tests. Those
files are historical optional experiments, are not imported by the gateway and
do not select or provision a database. The current runtime qualification uses
Blob immutable per-invocation tickets and complete strong listings.

Only newly generated reserved fixture accounts are enabled. Existing accounts
and master remain unchanged. This is NOT general production protection.

Read the current task and report:
- interactive/tasks/SESSION-HANDOFF-20261025.md
- interactive/reports/SESSION-HANDOFF-20261025-gateway-qualification.md

The historical SESSION-HANDOFF-20261025-report.md documents the earlier P0 state.
Do not confuse old prototype test results with the current real-gateway or live
EdgeOne test results. Do not report Etest success without its exact workflow.
