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
