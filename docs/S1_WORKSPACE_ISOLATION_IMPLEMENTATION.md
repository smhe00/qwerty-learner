# Sync V2: S1 Workspace Isolation — execution baseline (2026-10-09)

Status: **S1 started / transaction kernel only / NOT ENABLED in UI**.
Work is restricted to `product/main`; `master` is the release branch.

## Decision: S0.5 conditionally frozen

The canonical `formal/sync/CloudSyncV2.tla` remains the implementation
contract. Existing bounded production, Block, identity, backup and two-device
TLC projections and mutation counterexamples remain mandatory. The incomplete
3-device/4-username `NextScale` run is manual only. It is not a proof of
full `Next`; formal verification status is **PARTIAL**.

## S0 dependency audit: blocking real activation

- Current backup is `qwerty-backup-v3` (not V4).
- Current `RecordDB` is a singleton working IndexedDB, not account-isolated.
- Before integration, implement canonical Backup V4 (durable session/runtime
  and settings whitelist), V3 -> V4 migration/roundtrip with real data,
  separate durable per-account snapshot vault keyed by immutable account ID,
  atomic/fenced registry CAS, and cross-tab exclusive writer lock.
- Boot recovery MUST complete before any DB writer or React hydration.
- Target restore MUST be idempotent and reset an absent workspace to empty.
- Preserve V1 cloud data and existing users; no silent account migration.

## S1 implementation slices

1. **S1.1: foundation, implemented in isolation.**
   `src/sync/workspace-transition.ts` defines identities, monotonic
   generation, CAS journal, crash recovery and A -> anonymous -> B rule.
   Tests: `tests/cloud/workspace-transition.test.mjs`.
2. **S1.2: pending.** Backup V4 and migration + workspace snapshot vault.
3. **S1.3: pending.** Atomic registry adapter + multi-tab writer exclusion;
   crash-safe startup recovery before opening the working DB.
4. **S1.4: pending.** Login/logout/registration adapter, explicit anonymous
   copy decision, visible stages and offline/auth failure semantics.
5. **S1.5: pending.** Browser fault injection across all transaction windows,
   reload/restart tests and TLA+ transition trace refinement.

A transition is allowed only under an external cross-tab lock. Flush and
durably vault the source before committing the pending journal; restore target
only after journal commit; commit active pointer last. After any failure with
a pending journal, block user writes until recovery replays target restoration.

**Do not wire the kernel to the live V1 UI until S1.2–S1.5 gates pass.**
