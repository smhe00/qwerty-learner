# M3.7 Recovery staging checkpoint

Account-owned browser recovery is **explicit and disabled from normal UI**.
It captures complete RecordDB.wordRecords evidence only after verifying the S1
registry is not in transition, its immutable account ID matches current auth,
the token is still valid, and that identity/generation remains unchanged
between bounded staging chunks. Legacy/malformed/unanchored event evidence
blocks the entire scan; it is never guessed or silently dropped. The pure
scan plan is deterministic, refuses contradictory UUID evidence, and removes
local Dexie IDs and FSRS-derived metadata.

Cross-DB atomicity between RecordDB and EventOutbox is unavailable. A crash
between the WordRecord insert and Outbox append is recovered by rerunning the
full authenticated scan. The confirmed UUID ledger prevents resubmission of
already verified batches; incomplete network calls keep the immutable
inflight payload. Accounts stay isolated. The scanner is not currently wired
to automatic Learn/Typing or cloud synchronization.

Remaining for promotion of full multi-device functionality:
- prove account-scoped write quiescence during capture and restore;
- full six-table M2 reconciliation and FSRS6 deterministic replay;
- bounded acknowledged-event ledger retention / quota strategy;
- account event discovery under eventual consistency, including previously
  unknown devices and unobserved forks;
- M4 durable restore journal and automatic scheduling with explicit fail-safe;
- real etest Maker multi-device tests with pilot flags and crash injection.

The presence of these files must not be interpreted as permission to turn on
\`MULTI_DEVICE_AUTH_ENABLED\` or \`MULTI_DEVICE_EVENT_PILOT_ENABLED\`.

## Etest pilot GitHub Actions activation

GitHub requires a workflow to exist on the default branch for direct
workflow_dispatch activation; the stable master intentionally does not contain
experimental testing workflows. Therefore the M1/M3 trial is **push-triggered
on edgeone-test**, additionally gated by repository Actions variable
ETEST_M3_PILOT_ENABLED=true. Set this variable and the test Maker's two
server-side M1/M3 flags before the chosen staging promotion; then ONE
promotion triggers ONE EdgeOne staging build and the opt-in test job.
When the variable is absent, experimental writes do not run.

Later test reruns without another staging build may use the GitHub Actions
re-run capability where permitted, or run the same guarded Node script in
an isolated CI/local test environment with GITHUB_REF_NAME=edgeone-test,
GITHUB_RUN_ID set, and QWERTY_SYNC_BASE_URL=https://etest.edgeone.dev/.
## Outbox fail-closed integrity correction (2026-10-14)

A stale or corrupted queued/in-flight copy with the same UUID as a confirmed
receipt must not shadow the confirmed evidence ledger during recovery scans.
The kernel now rejects a contradictory persisted state before staging new
events; regression coverage includes a forged pending row. Do not interpret
a successfully read IDB record as proof it has immutable self-consistency.
