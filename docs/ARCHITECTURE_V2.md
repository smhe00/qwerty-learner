# Qwerty Plus Architecture V2

> Status: **canonical architecture baseline**
>
> This document supersedes older Learn architecture notes when they conflict
> with the current product. Historical phase documents remain useful evidence,
> but they are not the source of truth for runtime semantics.

## 1. Product-level boundaries

Qwerty Plus has two top-level learning surfaces:

- **Typing**: upstream-compatible typing practice. It must not mutate long-term
  Learn scheduling state.
- **Learn**: long-term memory workflow. It owns acquisition, review scheduling,
  DailySession progress, checkpoint recovery, and completion-triggered cloud
  synchronization.

The shared typing engine may render/input words for both surfaces, but Learn
policy must live under `src/learn/**` or `src/review/**`, not inside UI
components.

## 2. Learn hierarchy

```text
Learn
└── DailySession                 user-visible unit: today's plan
    ├── Block                    internal scheduling/checkpoint unit
    │   └── Attempt              one logical-word interaction
    ├── Pause                    durable block boundary / encouragement
    └── DailyComplete            local durability complete; cloud sync follows
```

### DailySession

Owned by `src/learn/daily-session.ts`.

It freezes the day's planned review set and new-word target. The denominator
must not grow silently while the user studies.

Daily progress is:

```text
independent-clean logical words completed
-----------------------------------------
frozen daily independent target words
```

A word contributes at most once to the numerator.

### Block

A Block is not a user-visible "session". The current target size is an
implementation detail. Completing a Block enters Pause; it does not imply that
the DailySession is complete.

### Attempt

Attempt-level policy belongs to Review/Acquisition state machines. UI input
components collect evidence; they do not decide long-term scheduling policy.

## 3. Runtime ownership

| Responsibility | Canonical owner |
| --- | --- |
| Daily plan / progress | `src/learn/daily-session.ts` |
| Learn orchestration / selection | `src/learn/controller.ts` |
| Acquisition phases | `src/learn/acquisition.ts` |
| Review rating / evidence | `src/review/**` |
| FSRS scheduler | `src/review/fsrs/**`, `src/review/scheduler.ts` |
| Block/Daily durable settlement | `src/learn/settlement.ts` |
| Persistence barrier | `src/learn/persistence.ts` |
| ReviewRecord checkpoint queue | `src/store/reviewInfoAtom.ts` |
| Completion-only cloud sync | `src/sync/auto.ts` |
| Presentation | `src/pages/**` |

UI components may invoke these services, but should not reproduce their
business rules.

## 4. Persistence and recovery contract

The durable order is:

```text
Attempt evidence
→ WordRecord durable
→ derived scheduler/acquisition update
→ ReviewRecord checkpoint
→ flushLearnPersistence()
→ Block settlement
→ DailySession checkpoint
→ [if complete] DailySession completion checkpoint
→ cloud sync (non-blocking)
```

Hard invariants:

1. A completed logical word never becomes unfinished after reload.
2. Reload restores the current logical word; partial character input may be
   discarded.
3. Hint and acquisition phases do not regress across reload.
4. Daily progress is reconstructed from durable evidence, not React cursor
   state.
5. Cloud synchronization can never weaken local completion or overwrite a
   remote-ahead/diverged state.

## 5. React boundary rule

React effects are subscribers to domain operations, not owners of those
operations.

Durable operations that must survive StrictMode replay must be represented by
stable promises or domain coordinators. A component cleanup may detach a
subscriber, but must not cancel the only durable settlement operation.

`src/learn/settlement.ts` is the canonical Block/Daily settlement coordinator.
`LearnResultScreen` is presentation/control glue only.

## 6. Verification architecture

Verification follows four levels:

- **L0 Product Contract** — stable user/domain invariants.
- **L1 Domain / Formal / Simulation** — state-machine completeness and
  mutation/counterexample coverage.
- **L2 Integration / Browser** — real UI + persistence + routing behavior.
- **L3 Regression** — minimal reproductions of previously observed defects.

The canonical mapping is maintained in
`tests/verification/gate-manifest.json` and explained in
`docs/verification/GATE_MANIFEST.md`.

Behavior-changing work must update the relevant contract tests in the same
change. Tests are not maintained merely to make CI green; obsolete semantics
must be explicitly reclassified or removed.

## 7. Refactor direction

Current high-priority structural debt:

1. `tests/e2e/review-flow.spec.ts` is an oversized mixed-responsibility suite.
2. `tests/review/domain.test.ts` is an oversized mixed domain suite.
3. Review Gate duplicates several tests owned by specialized gates.
4. Historical phase documents can conflict with current semantics.
5. Legacy `.github/workflows/e2e.yml` uses a separate Node/npm stack and needs
   retirement or redefinition.

Refactoring must preserve behavior first, then move/split tests, then delete
proven duplicates. Test-count reduction without contract coverage evidence is
not acceptable.
