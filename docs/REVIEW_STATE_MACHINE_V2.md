# Review State Machine V2

> Status: implementation + formal verification contract
>
> Related specification: `docs/REVIEW_RATING_CONTRACT_V1.md`
>
> Production decision code:
>
> - `src/review/state-machine.ts`
> - `src/review/machine.ts`
>
> Verification:
>
> - `tests/review/formal-model.test.ts`
> - `tests/review/domain.test.ts`

## 1. Objective

Review must remain finite even when the user repeatedly:

- fails the same word;
- reveals the answer;
- produces unreliable/attention-uncertain evidence;
- enters remediation;
- fails the later reinforcement;
- triggers adaptive diagnostic conditions.

The previous queue rule prevented duplicate *pending* reinforcement, but a word could be inserted again after its prior reinforcement had been consumed. Therefore a user who failed indefinitely could, in principle, extend the queue indefinitely.

V2 removes that class of livelock by making same-session work explicitly budgeted.

## 2. Layered machine

The Review system is modeled as four interacting finite machines:

```text
Attempt Machine
    ↓
Rating Gate
    ↓
Review Item Machine
    ↓
Session Queue Machine
```

### Attempt Machine

Owns:

- input bounds;
- wrong lock;
- terminal input lock;
- one automatic pronunciation event per attempt.

### Rating Gate

Owns the scheduler-neutral result:

```text
Again | Hard | Good | Easy | null
```

`null` means useful evidence that is not a valid long-term scheduler event.

### Review Item Machine

Owns:

- cold probe;
- one invalid retry;
- training/remediation;
- one reinforcement;
- deferred/done terminal states.

### Session Queue Machine

Owns:

- queue cursor;
- insertion of a bounded reinforcement item;
- final session termination.

## 3. Fixed V2 budgets

Production constants:

```text
MAX_INVALID_RETRY_PER_ITEM = 1
MAX_REINFORCEMENT_PER_WORD_PER_SESSION = 1
MAX_DIAGNOSTIC_PROBES_PER_WORD_PER_SESSION = 1
```

Consumed budgets are never replenished during a Review session.

The live Review record persists reinforcement consumption:

```ts
reinforcementCounts?: Record<string, number>
```

so page reload/remount cannot reset the reinforcement budget and recreate an infinite queue.

## 4. Review item states

```text
COLD_PROBE
    │
    ├── valid rating, no remediation ─────────────→ DONE
    │
    ├── valid rating, remediation needed ─────────→ TRAINING
    │                                                  │
    │                                                  ├── no reinforce → DONE
    │                                                  │
    │                                                  └── reinforce
    │                                                       ↓
    │                                                 REINFORCEMENT
    │                                                       ↓
    │                                                     DONE
    │
    ├── retryable null + retry budget ─────────────→ INVALID_RETRY
    │                                                   │
    │                                                   ├── valid → DONE/TRAINING
    │                                                   └── null  → DEFERRED
    │
    ├── diagnostic null ───────────────────────────→ DEFERRED
    │
    └── other invalid/non-rateable event ──────────→ DEFERRED
```

Terminal states:

```text
DONE
DEFERRED
```

Terminal states accept no further transitions.

## 5. Long-term rating gate

The pure production function is:

```ts
decideReviewRating(...)
```

V2 models the contract:

- training attempt → `null`;
- non-cold/reinforcement attempt → `null`;
- diagnostic probe → `null`;
- attention-uncertain evidence → `null`;
- answer reveal → `null`;
- visible/partial orthography → `null`;
- audio-assisted probe → `null`;
- canonical cold independent probe → one of Again/Hard/Good/Easy.

The rating machine is deliberately scheduler-neutral. It is suitable for a deterministic `basic-v2` adapter or a future FSRS-6 adapter.

The V2 rating core is implemented and formally checked. Activation of the new rating gate in the live scheduler is a separate rollout step because the current production Review UI still inherits ordinary-learning presentation defaults (visible spelling, pronunciation, phonetics). The contract must not be activated by silently relabeling those assisted conditions as canonical probes.

## 6. Reinforcement termination rule

The previous behavior was conceptually:

```text
failure
→ insert same word
→ reinforcement fails
→ word is no longer pending
→ insert same word again
→ ...
```

V2 production progression receives:

```ts
reinforcementRemaining
```

and may insert only when:

```text
accumulatedWrongCount > 0
AND
reinforcementRemaining > 0
```

When an insertion happens, the Review session persists:

```text
reinforcementCounts[word] += 1
```

With the V2 constant:

```text
reinforcementCounts[word] <= 1
```

therefore a word can add at most one extra queue occurrence in one session.

For an initial queue of N unique words:

```text
QueueLength_max <= N × (1 + 1) = 2N
```

This is a hard structural bound, not a statistical expectation.

## 7. Termination variant

`src/review/state-machine.ts` defines a non-negative well-founded integer:

```ts
reviewItemTerminationVariant(state)
```

It combines:

- phase rank;
- remaining invalid-retry budget;
- remaining reinforcement budget;
- remaining diagnostic budget.

Phase order:

```text
cold-probe
    >
invalid-retry
    >
training
    >
reinforcement
    >
done/deferred
```

Every legal Review-item transition must satisfy:

```text
V(next) < V(current)
```

No transition is allowed to replenish a consumed budget.

Because:

1. V is a non-negative integer;
2. every legal transition strictly decreases V;

the item machine has no cycle and must reach `DONE` or `DEFERRED` after finitely many completed user actions.

## 8. Session liveness argument

Assumptions:

1. initial Review queue is finite;
2. user eventually completes each presented attempt;
3. asynchronous persistence eventually resolves or rejects;
4. each word has finite reinforcement budget.

Then:

```text
initial queue length = N
max inserted items    = N
max queue length      = 2N
```

Each queue item has finite loop count and the cursor advances after the finite local work.

Therefore:

```text
SESSION_START
    → finitely many attempt completions
    → SESSION_DONE
```

Persistent failure does not violate liveness. A reinforcement failure is recorded, but after its one session budget is consumed the queue advances rather than inserting the word again.

## 9. Formal properties

The bounded executable checker validates production functions directly.

### Safety

1. accepted input index is always in range;
2. terminal input cannot create an out-of-range typo;
3. automatic pronunciation fires at most once per attempt;
4. Review progression is total for every legal bounded state;
5. cursor advance is exactly +1;
6. reinforcement insertion is after current cursor and in range;
7. per-word reinforcement count never exceeds the session budget;
8. training/non-cold/diagnostic/assisted conditions cannot emit a long-term rating;
9. motor classification cannot independently emit Again;
10. Easy is possible only under canonical clean independent conditions;
11. a Review item can emit at most one long-term rating.

### Liveness

1. finite clean queue terminates;
2. one failure + finite reinforcement terminates;
3. **persistent failure of every word terminates**;
4. repeated retryable `null` reaches `DEFERRED` after one retry;
5. reinforcement reaches `DONE` after one bounded reinforcement;
6. every legal item transition strictly decreases the termination variant.

## 10. Exhaustive domains

Current bounded model includes:

### Progress machine

- queue length: 1..6;
- loop count: 1..3;
- wrong counts: bounded representative values;
- reinforcement gap: 3..7;
- reinforcement budget: 0..1.

### Rating machine

Cartesian product over:

- purpose: training/probe;
- probe dimension: none/audio/orthography/meaning;
- letters: all-visible/all-hidden/partial/targeted-mask;
- audio: none/automatic;
- meaning: hidden/visible;
- attempt role: cold/training/reinforcement;
- cause: clean/recall/spelling/motor/uncertain;
- attention uncertainty: false/true.

### Item machine

All legal branches from the initial state are recursively explored until terminal. Each edge is checked for strict variant descent.

## 11. Persistence boundary

The V2 no-loop guarantee requires reinforcement budget to survive React remount and browser reload within an unfinished Review session.

Therefore the budget is part of `ReviewRecord`, not a component-only `useState`.

This is intentional:

```text
ReviewRecord
├── words
├── index
├── exercisePlans
└── reinforcementCounts
```

Old Review records remain valid because the field is optional and absence means zero budget consumed.

## 12. Async persistence rule

Scheduler/profile persistence is derived state and MUST NOT indefinitely block UI progression.

The established boundary remains:

```text
attempt complete
→ raw WordRecord persistence attempted
→ pure progression decision
→ UI progression released
→ derived state persistence may complete asynchronously
```

Failure of derived persistence must be diagnosable but must not create a UI livelock.

## 13. Rollout boundary

This V2 change activates the live **reinforcement budget / finite-queue guarantee**.

It does **not** yet activate the new scheduler rating gate for every live Review attempt.

Reason:

the existing UI currently allows ordinary user presentation settings such as:

- full English visible;
- pronunciation automatically enabled;
- phonetics visible.

Those conditions are useful training, but the Rating Contract says they must not be silently treated as canonical independent probes.

The safe next rollout is:

1. implement explicit canonical-probe presentation;
2. pass attempt role to the rating gate;
3. wire `decideReviewRating()` to the scheduler adapter;
4. add browser scenarios for rating/null behavior;
5. then enable all-learned admission.

## 14. Change-control rule

Any future transition that:

- adds a retry;
- adds a reinforcement;
- adds a diagnostic loop;
- returns from a later phase to an earlier phase;
- replenishes a consumed budget;

must update:

1. this document;
2. the production pure transition function;
3. the termination variant;
4. exhaustive formal tests;
5. browser acceptance tests if the transition crosses the React/persistence boundary.

No unbounded Review loop may be introduced only as a UI condition.


## 15. Canonical Hint Ladder submachine

The canonical cold probe now owns a finite cue-escalation submachine:

```text
cold → hint0 → hint1 → hint2 → hint3
```

The only escalation input is Space at input index zero.

Hint meanings:

```text
hint0 = first letter
hint1 = first letter + pronunciation + phonetic
hint2 = partial spelling + pronunciation + phonetic
hint3 = full spelling + pronunciation + phonetic
```

Hint 3 is terminal for cue escalation and is a mandatory training state.
Space at Hint 3 is an ordinary typing key, not a skip operation. The Typing
reducer also holds `isSkipLocked=true` while Hint 3 is active, so explicit
skip/navigation actions cannot bypass the required correct copy.

The hint termination variant is:

```text
4,3,2,1,0
```

for `cold,hint0,hint1,hint2,hint3` respectively. Every escalation strictly
decreases it.

The first cold-probe Space is persisted as an explicit recall failure and maps
to `Again`; later hint-assisted successful typing is training and cannot
overwrite that memory result.

See `REVIEW_HINT_LADDER_V1.md`.
