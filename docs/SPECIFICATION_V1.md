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

### SPEC-SYNC-001 — Safe completion-only auto upload

After DailySession completion, automatic cloud upload may occur only when:

```text
authenticated
AND localDirty
AND NOT remoteChanged
```

Remote-ahead, diverged, unsupported, conflict, auth failure, or network failure
must never overwrite remote state automatically and must never roll back local
Daily completion.

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
