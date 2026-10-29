# Qwerty Plus Product Specification V1

> Status: **canonical product specification**
>
> Architecture is defined in `docs/ARCHITECTURE_V2.md`.
> Verification ownership is defined in
> `tests/verification/gate-manifest.json`.
> This document defines **what the product must do**.

## 1. Learn session model

### SPEC-LEARN-SESSION-001 — DailySession is the user-visible session

One local calendar day owns one active Learn DailySession per dictionary context.

A DailySession contains internal Blocks. A Block is an implementation and
checkpoint unit, not a user-visible session.

```text
DailySession
  ├─ Block
  │   └─ Attempt
  ├─ Pause
  └─ DailyComplete
```

Completing a Block enters Pause. It must not be presented as completing the
DailySession unless the daily completion invariant is satisfied.

### SPEC-LEARN-SESSION-002 — Daily target is frozen

At DailySession creation, the session freezes:

- due review logical words;
- carry-over unfinished acquisition;
- configured new-word target subject to actual unseen inventory.

The denominator must not grow silently while the user studies.

Unused fresh-word quota from a previous day does not become debt.

## 2. Progress and mastery

### SPEC-LEARN-PROGRESS-001 — Progress is logical-word mastery

Daily progress is:

```text
unique logical words with final valid independent completion
------------------------------------------------------------
frozen daily independent target logical words
```

A word contributes at most once.

Cursor position, Block index, raw attempt count, Hint-assisted success, and
visible-copy success must not directly advance Daily progress.

### SPEC-LEARN-ACQUISITION-001 — Acquisition cannot fabricate mastery

Acquisition may use Exposure and Supported phases, but admission to durable
long-term memory requires valid spacing-eligible Independent evidence.

Carry-over acquisition persists across days but does not consume the next day's
fresh-word admission quota.

## 3. Review and Hint

### SPEC-REVIEW-001 — FSRS-6 is the active long-term scheduler

Production long-term scheduling uses FSRS-6.

Pre-FSRS scheduler state is disposable test-era data. The product does **not**
migrate Basic-v1 scheduler state into FSRS state.

Basic-v2 may exist only as a shadow/comparator model for analysis. It is not the
production scheduler.

### SPEC-HINT-001 — Hint assistance is monotonic

Hint V2 escalates monotonically:

```text
Cold Probe
  -> Minimal
  -> Strong
  -> Full Answer
```

ESC is the explicit surrender action. Space remains ordinary spelling input,
including inside phrases.

Reload must not regress the active Hint assistance stage.

### SPEC-REVIEW-EVIDENCE-001 — Rating evidence is authoritative

Only eligible Learn Review evidence may mutate the long-term scheduler.
Assisted completion, acquisition attempts, ordinary Typing, and ineligible
Rating Gate events must not be replayed as positive spaced-review evidence.

### SPEC-REVIEW-EXERCISE-001 — Adaptive exercise policy cannot weaken Cold Probe

Adaptive targeted-mask/audio/scaffold plans may change training presentation,
but every new Review item begins from the canonical independent Cold Probe.
Historical adaptive shadows must not silently alter that starting condition.

### SPEC-SCAFFOLD-001 — Scaffold softens support, not independence

Dynamic scaffold and recovery-window logic may strengthen Supported training.
They must never weaken the final Independent retrieval requirement.

## 4. Persistence and recovery

### SPEC-RECOVERY-001 — Logical-word checkpoint

After a logical word is completed, its durable checkpoint must be committed
before the next word can become authoritative.

On reload/close/re-enter:

- already completed words must not replay as unfinished;
- the current logical word must not be skipped;
- partial character input may be discarded;
- Hint and Acquisition phase state must not regress.

### SPEC-PERSIST-001 — Durable completion barrier

The required order is:

```text
raw WordRecord
-> derived Review/Acquisition scheduler state
-> ReviewRecord checkpoint
-> flushLearnPersistence()
-> Block settlement
-> DailySession checkpoint
-> [if complete] Daily completion checkpoint
-> cloud sync
```

Cloud synchronization is outside the local durability barrier and may never
block local completion.

## 5. Cloud synchronization

> Implementation cross-check: 2026-10-26, `product/main@875c82a2`.
> The current implementation guide is [CLOUD_SYNC_ARCHITECTURE.md](./CLOUD_SYNC_ARCHITECTURE.md).
> [CLOUD_SYNC_V2_MODEL.md](./CLOUD_SYNC_V2_MODEL.md) records the protocol design and
> bounded formal model; its V2 name does not mean that Backup V4 or guarded
> synchronization is unimplemented. A model or local test pass is not deployed
> Cloud/Blob acceptance. This clarification changes no runtime behavior.

### SPEC-SYNC-V2-FORMAL-001 — Sync V2 protocol has one executable distributed state machine

The approved Sync V2 target in
[`CLOUD_SYNC_V2_MODEL.md`](./CLOUD_SYNC_V2_MODEL.md) is executable as
`formal/sync/CloudSyncV2.tla`.

The formal protocol covers the combined state machine rather than account logic
in isolation: local logical-word progress, frozen Block boundaries, automatic
and manual Sync, local/cloud revision authority, multi-device divergence,
workspace/account lifecycle, Backup V4 export/restore, destructive operations,
offline/auth failure, crash windows, username reuse with immutable account IDs,
and stale-device deletion propagation.

S1-S4 implementation behavior must refine legal transitions of the executable
model. A behavior that cannot be represented by a legal formal transition
requires either an implementation fix or an explicit protocol/specification
change.

### SPEC-SYNC-001 — Guarded V4 synchronization preserves durable local progress

Local completion is committed before a cloud handoff. On a cloud-enabled
deployment, a valid signed-in account can request the existing guarded V4 flow
after Daily completion or an execution-exhausted round. An exhausted round does
not certify mastery. Other visible Block milestones require the device-local,
account-scoped opt-in, which defaults to off. Pages keeps cloud disabled.

`LearnResultScreen` stages the account-bound intent through `learn-block-sync`
and navigates to a new document. The guarded pre-mount executor must obtain the
writer lease and perform the existing session, owner, journal and snapshot
checks before cloud reconciliation. Mounted UI must not directly replace the
working database. The same protected infrastructure also supports login/startup
and explicit synchronization; it is not a completion-only upload service.

Reconciliation may be a no-op, safe upload, verified pull, or a supported
same-account merge. A remote-ahead or diverged state is not permission for a
blind overwrite. Unsupported evidence, conflicts, authentication failures and
network failures must preserve local progress and recovery evidence. Unknown
commit results must not be blindly replayed. An event receipt does not prove
that all six V4 tables and all devices have converged.

The old `src/sync/auto.ts` completion-only upload helper is not the current
Learn completion UI entry point. Its conservative one-way rule remains a
description of that legacy helper, not the complete product synchronization
contract. Historical V3 browser tests are likewise not current V4 release proof.

Verification is separated in the gate manifest: local completion/handoff
contracts, backend contracts, exact-SHA etest completion readback, and the
retained legacy browser harness. Listing a workflow here does not authorize
dispatching it or claim that its current deployed run has passed.

## 6. Audio

### SPEC-AUDIO-001 — No post-success auto pronunciation

Word entry may trigger automatic pronunciation according to the normal audio
policy.

Spelling completion must never trigger a second automatic pronunciation and
must never wait for pronunciation playback before advancing.

## 7. Sidecars

### SPEC-ACHIEVEMENT-001 — Achievement processing is non-blocking

Achievement detection and ceremony are additive sidecars. Achievement failures
must never block raw evidence persistence, Block settlement, Daily completion,
or recovery.

## 8. Typing / Learn isolation

### SPEC-MODE-001 — Typing cannot mutate Learn scheduling

Typing remains the practice surface. Typing evidence may be retained for
diagnostics, but Typing activity alone must not create, reactivate, or advance a
long-term Learn scheduler state.

Learn owns long-term acquisition, review scheduling, Hint policy, DailySession,
and durable recovery.

## 9. Verification rule

Every behavior-changing implementation change must update or preserve the
matching executable contract in `tests/verification/gate-manifest.json`.

A historical regression listed in
`tests/verification/regression-catalog.json` cannot be removed unless the
catalog is explicitly updated to point to an equivalent canonical test.

The verification hierarchy is:

- L0 — Product Contract
- L1 — Domain / Formal / Simulation
- L2 — Integration / Browser
- L3 — Historical Regression
