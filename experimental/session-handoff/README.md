# Session handoff prototype — NOT production enabled

Base: `ad092c7348260407c0c91102073c5447fffeee07` (product/main).
The existing API gateway is intentionally unchanged. The current production
handoff gap is NOT closed merely by merging these new files.

## Implemented boundary

A previously admitted writer owns a durable marker. A pending takeover prevents
new writers from entering. The takeover callback cannot run until the existing
writer's awaited effects settle successfully and its durable marker is released.
B must return login success only after the takeover callback and barrier release.

The callback MUST await every effect. Do not launch detached writes or use
Promise.race to report a running write as finished. Unknown write outcomes poison
the account barrier; request timeout is not permission to release it. A failed
request that demonstrably started no mutation may use BeforeMutationError.

A crashed operation's marker does not expire. This deliberately trades
availability for safety until a proven recovery protocol exists. There is NO
automatic reset or lease stealing in P0. Receipt tombstones prevent a cancelled
or completed request from being resurrected by a delayed/retried admission RPC.

## Storage and deployment

Blob payloads are unchanged. The reference PostgreSQL adapter stores ONLY
coordination state in a separate control-plane schema. It holds a row lock only
while applying the short state transition, never during a Blob transfer. The
committed active marker survives connection loss; it is not a connection lock.

The adapter accepts a node-postgres-compatible pool, does not provision any
service and is not imported by the EdgeOne gateway. The test AtomicTestStore is
ONLY a model and is never a production fallback. Plain Blob get/set cannot
implement the required atomic transaction.

P0 keeps terminal receipts in JSONB without expiry. That is adequate to qualify
the protocol, not a bounded long-term production representation. A production
ledger must bound growth WITHOUT deleting IDs that delayed requests can reuse.

SQL defaults are not a HA certificate: qualify fsync, durable acknowledgments,
replication/failover RPO, routing to the authoritative primary, connection loss
and restart. SET LOCAL synchronous_commit=on does not by itself establish
synchronous failover on a provider. A stale promoted replica must never forget
an active writer and grant a second one.

## Integration checklist (outstanding)

1. Validate takeover credentials before closing admission, then revalidate after
   acquiring ownership. Otherwise unauthenticated requests can freeze accounts.
2. Use one server-derived account namespace for login/session changes and every
   authoritative mutation. Do not key locks by device, token or client input.
3. Cover V4 direct/legacy/recovery/migration, final multipart commit, events,
   account deletion/password/session changes; audit Circle and idle-maintenance
   interactions. Staged immutable chunks must never implicitly publish state.
4. Preserve pre-mutation vs ambiguous mutation errors. Unknown outcome requires
   verified recovery, not automatic unlocking on exception or process timeout.
5. Provide bounded receipts, restart/recovery, cancellation, observability and a
   login-pending UI. Test invalid credentials and denied-owner requests do not
   strand a barrier. Define migration/cutover so old unguarded instances cannot
   continue serving writes during activation or rollback.
6. Run real multi-instance coordination plus etest browser/Blob handoff at the
   manifest boundary. CI provider models are not etest or production proof.

## Tests

- `session-handoff-barrier.test.mjs`: protocol interleavings and fault handling.
- `session-handoff-postgres.test.mjs`: adapter connection/transaction contract.
- `session-handoff-core.test.mjs`: imports the unchanged actual core and Blob
  adapter; provider model deliberately ignores onlyIfNew. Two BASELINE tests
  assert the existing vulnerability is reproducible; they are not fixed-system
  acceptance. The third test exercises explicitly guarded calls.
- `session-handoff-postgres.integration.mjs`: real PostgreSQL in isolated CI,
  separate pools and durable markers. Missing DB is a failure, not a skip.

No cloud customer accounts, production data, repository secrets or live EdgeOne
settings are accessed by the new workflow. Its PostgreSQL password is a public,
disposable CI fixture and has no external authority.

## Primary references

- PostgreSQL row locking: https://www.postgresql.org/docs/current/explicit-locking.html
- Durable commit and replication: https://www.postgresql.org/docs/current/runtime-config-wal.html
- Single-client transactions: https://node-postgres.com/features/transactions
- Pool release/discard: https://node-postgres.com/apis/pool
