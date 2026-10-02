# Learn Architecture V1

> Status: **Active architecture — Phase A/B implemented; Phase C+ pending**
>
> Product: Qwerty Plus
>
> Target branch: `product/main`
>
> Related lower-level contracts:
>
> - `REVIEW_RATING_CONTRACT_V1.md`
> - `REVIEW_STATE_MACHINE_V2.md`
> - `REVIEW_CANONICAL_PROBE_V1.md`
> - `REVIEW_HINT_LADDER_V1.md`
>
> This document defines the product-level boundary between **Typing** and
> **Learn**, the long-term learning lifecycle, manual exclusion semantics,
> session ownership, persistence boundaries, migration rules, and rollout
> order.

---

## 0. Implementation status

As of the Phase A/B rollout:

```text
Phase A — Typing / Learn product boundary     IMPLEMENTED
Phase B — ACTIVE / EXCLUDED lifecycle         IMPLEMENTED
Phase C — unified Learn Session               PARTIAL
Phase D — Rating Gate owns live scheduler     IMPLEMENTED (D1 gate + D2 bounded null/reinforcement flow)
Phase E — all-word admission                  PARTIAL
Phase F — basic-v2                            PENDING
Phase G — FSRS-6                              PENDING
```

Current acquisition rollout:

- Learn dictionary selection reuses the Typing gallery UI, but Learn selection
  is direct at dictionary level and never opens chapter selection.
- Normal Learn start first builds a due Review session.
- Only when no due ACTIVE word exists does Learn open a new-word Acquisition
  session.
- Acquisition V1 is bounded to 20 UNSEEN words in dictionary order.
- Acquisition uses full spelling + meaning + phonetic + automatic audio.
- Acquisition completion creates ACTIVE state with `nextReviewAt = now + 1 day`.
- Acquisition creates no Again/Hard/Good/Easy rating and does not increment
  review/lapse counters.
- Session records now carry transitional `sessionKind = review | acquisition`.

Current Phase D1 rollout:

- every live Learn Review completion now executes `decideReviewRating()`;
- the resulting `reviewRatingDecision` is persisted on the WordRecord;
- only `eligible=true` may call `applyReviewOutcome()` and mutate scheduler state;
- `eligible=false` remains durable evidence but leaves due date/counters unchanged;
- acquisition remains rating-free;
- same-session reinforcement is explicitly `attemptRole='reinforcement'` and cannot rate.

Phase D2 is now wired into the live Learn queue:

- retryable null results enter one persisted `invalid-retry` and remount the
  same word with a fresh canonical probe;
- a second retryable null, diagnostic null, or other non-rateable result is
  deferred without mutating the scheduler;
- eligible failure can request exactly one persisted reinforcement;
- reinforcement runs with `attemptRole='reinforcement'`, cannot rate, and
  terminates the logical item as `done`;
- the item-machine state is persisted in the unfinished ReviewRecord so reload
  cannot replenish retry/reinforcement budgets.

Current Phase B persistence uses an additive compatibility model:

- no `reviewWordStates` row means `UNSEEN`;
- legacy rows without `lifecycle` are interpreted as `ACTIVE`;
- `lifecycle='excluded'` means manually removed from Learn;
- restore preserves scheduler history and sets `nextReviewAt=now`.

The internal `isReviewMode` and Review naming remain temporarily in code as
implementation details. Product-level navigation is already Typing / Learn.

---

## 1. Product model

Qwerty Plus has two top-level modes:

```text
Qwerty Plus
├── Typing
│   └── upstream-compatible typing / vocabulary practice
│
└── Learn
    └── long-term memory system
        ├── Acquisition
        ├── Due Review
        ├── Hint / Remediation
        ├── Reinforcement
        └── Scheduler
```

The key product rule is:

> **Review is no longer a top-level product mode. Review is an internal activity
> inside Learn.**

The user-facing primary modes are:

```text
Typing
Learn
```

The internal spaced-repetition domain may continue to use the word
`Review` where that is technically correct.

---

## 2. Typing mode

Typing exists to preserve the original Qwerty Learner experience with minimal
behavioral intrusion.

Typing owns:

- chapter selection;
- upstream word progression;
- loop count;
- visible/hidden word settings;
- vowel/consonant/random hiding;
- pronunciation settings;
- translation/phonetic display;
- keyboard practice;
- typing speed and accuracy;
- ordinary `WordRecord` telemetry.

Typing MUST NOT own or directly mutate:

- long-term admission;
- long-term due dates;
- `Again / Hard / Good / Easy`;
- FSRS/basic scheduler state;
- Learn lifecycle;
- Hint Ladder;
- long-term reinforcement queue;
- manual exclusion or restoration.

Canonical boundary:

```text
Typing
   ↓
Typing Engine
   ↓
WordRecord
```

but:

```text
Typing
   ✗
LearningState scheduler mutation
```

Typing history can later be used as prior evidence by Learn, but it is not a
scheduler rating.

---

## 3. Learn mode

Learn is the only product mode allowed to change long-term memory state.

Learn owns the complete lifecycle:

```text
UNSEEN
   ↓
ACQUIRING
   ↓
ACTIVE
   ↓
scheduled / due / review
```

and the internal learning flow:

```text
Acquisition
    ↓
Canonical Cold Probe
    ↓
Rating
    ├── Again
    ├── Hard
    ├── Good
    └── Easy
    ↓
Scheduler
    ↓
next due
```

When retrieval fails, the existing finite training flow remains inside Learn:

```text
Cold Probe
    ↓
Hint 0
    ↓
Hint 1
    ↓
Hint 2
    ↓
Hint 3 mandatory copy
    ↓
optional bounded reinforcement
```

---

## 4. Meaning of “all words enter long-term learning”

V1 defines this precisely.

For a dictionary selected as a Learn plan:

> Every word is eligible for Learn unless the user manually excludes it.

However, Typing alone does not automatically activate a word.

The lifecycle is driven by Learn:

```text
dictionary word
    ↓
UNSEEN
    ↓ first completed Learn acquisition
ACTIVE
```

Therefore:

```text
Typing record exists
≠
automatically ACTIVE
```

This prevents Typing and Learn from becoming coupled again.

Typing history may influence:

- acquisition priority;
- exercise choice;
- confidence bootstrap;
- first canonical probe context;

but MUST NOT fabricate a historical scheduler rating.

---

## 5. Learning lifecycle

The product-level lifecycle is distinct from temporary session phases.

V1 lifecycle:

```text
                   ┌────────────┐
                   │   UNSEEN   │
                   └─────┬──────┘
                         │ start Learn acquisition
                         ↓
                  ┌─────────────┐
                  │ ACQUIRING   │
                  └──────┬──────┘
                         │ acquisition complete
                         ↓
                   ┌───────────┐
              ┌───→│  ACTIVE   │─────┐
              │    └───────────┘     │
              │                      │ manual exclude
              │ restore              ↓
              │               ┌───────────┐
              └───────────────│ EXCLUDED  │
                              └───────────┘
```

V1 intentionally does not expose `SUSPENDED` yet.

It may be added later if the product needs “temporarily pause this word” as a
separate semantic from “I do not need to memorize this word”.

---

## 6. Lifecycle is not session state

These concepts MUST remain separate.

### Lifecycle

Long-lived product state:

```text
UNSEEN
ACQUIRING
ACTIVE
EXCLUDED
```

### Session state

Ephemeral/bounded work inside one Learn session:

```text
cold-probe
hint-0
hint-1
hint-2
hint-3
training
reinforcement
done
deferred
```

A word can be:

```text
lifecycle = ACTIVE
session phase = hint-2
```

but `hint-2` is never a lifecycle value.

---

## 7. Manual “do not review this word”

The user must be able to remove an obviously unnecessary word from long-term
memory work.

User-facing action:

```text
移出学习计划
```

or equivalently in compact UI:

```text
不再复习
```

Internal transition:

```text
ACTIVE
   ↓ manual exclude
EXCLUDED
```

This action MUST NOT:

- delete historical records;
- rewrite old ratings;
- mark the word as algorithmically mastered;
- erase scheduler history;
- erase typing evidence.

It only removes the word from future Learn queue selection.

---

## 8. EXCLUDED is not MASTERED

This distinction is normative.

```text
EXCLUDED
```

means:

> The user has chosen not to spend long-term Learn time on this word.

It does not mean:

> The memory model proved permanent mastery.

Examples include words that are:

- already trivially familiar;
- not relevant to the learner;
- proper names or low-value vocabulary;
- intentionally outside the learner's current goal.

Therefore no hidden conversion is allowed:

```text
EXCLUDED ≠ EASY
EXCLUDED ≠ MASTERED
EXCLUDED ≠ infinite interval
```

---

## 9. Restore an excluded word

The Learn UI must provide an “excluded words” view.

User action:

```text
恢复学习
```

Transition:

```text
EXCLUDED
   ↓
ACTIVE
```

The old scheduler/history state is preserved.

Recommended V1 restoration behavior:

```text
restore
→ ACTIVE
→ nextReviewAt = now
→ next Learn session uses canonical cold probe
```

The scheduler is then updated from actual memory evidence instead of assuming
either mastery or forgetting.

---

## 10. Typing must not undo EXCLUDED

If:

```text
word.lifecycle = EXCLUDED
```

and the learner later encounters that word in Typing:

```text
Typing
→ WordRecord may be written
→ lifecycle stays EXCLUDED
```

Typing MUST NOT silently perform:

```text
EXCLUDED → ACTIVE
```

Likewise, Typing mistakes MUST NOT force an excluded word back into Learn.

This is a hard cross-mode isolation rule.

---

## 11. Proposed LearningState

The current `ReviewWordState` already contains much of the required scheduler
state. The target conceptual model is:

```ts
type LearningLifecycle =
  | 'unseen'
  | 'acquiring'
  | 'active'
  | 'excluded'

type LearningState = {
  dict: string
  word: string

  lifecycle: LearningLifecycle

  createdAt: number
  updatedAt: number

  lastReviewedAt?: number
  nextReviewAt?: number

  reviewCount: number
  lapseCount: number
  cleanStreak: number
  lastOutcome?: 'again' | 'hard' | 'good' | 'easy'

  schedulerState?: SchedulerState

  exclusion?: {
    reason: 'manual'
    excludedAt: number
  }
}
```

The exact TypeScript/database migration may remain additive during rollout.

The important contract is that lifecycle and scheduler state are separate
dimensions.

---

## 12. Source of truth hierarchy

V1 distinguishes historical facts, current derived state, and session recovery.

### 12.1 WordRecord — historical fact/event stream

```text
WordRecord
├── source mode
├── typing telemetry
├── learning context
├── exercise condition
├── raw mistakes
└── evidence snapshot
```

Raw observations remain the durable evidence source.

### 12.2 LearningState — current long-term state

```text
LearningState
├── lifecycle
├── next due
├── scheduler state
├── review count
├── lapse count
└── exclusion state
```

This is the current long-term state projection.

### 12.3 LearnSessionRecord — unfinished session recovery

The current `ReviewRecord` should conceptually become a Learn session
checkpoint:

```text
LearnSessionRecord
├── queue
├── index
├── item kind
├── exercise plans
├── reinforcement budgets
└── recovery metadata
```

It is not the long-term memory truth.

---

## 13. WordRecord mode provenance

A future additive field is recommended:

```ts
sourceMode?: 'typing' | 'learn'
```

This makes historical queries unambiguous.

Rules:

```text
sourceMode = typing
→ may contribute telemetry/prior evidence
→ cannot directly produce scheduler mutation

sourceMode = learn
→ may contain valid cold-probe evidence
→ may produce a scheduler rating if Rating Gate approves
```

Old records without `sourceMode` remain readable and are treated according to
legacy context, never guessed into a valid long-term rating.

---

## 14. Learn item model

A Learn session may contain two primary item kinds:

```ts
type LearnItem =
  | {
      kind: 'acquisition'
      word: Word
    }
  | {
      kind: 'review'
      word: Word
    }
```

### 14.1 Acquisition item

Purpose:

> First deliberate Learn-mode acquisition of an UNSEEN word.

It may use:

- visible answer;
- pronunciation;
- phonetic;
- repetition;
- targeted training.

Acquisition itself is training:

```text
rating = null
```

On successful acquisition completion:

```text
UNSEEN
→ ACQUIRING
→ ACTIVE
```

and an initial due date is seeded without fabricating a rating.

### 14.2 Review item

Purpose:

> Measure a due ACTIVE word.

It starts with the canonical cold probe and is governed by:

- Rating Contract V1;
- Hint Ladder V1;
- bounded Review State Machine V2;
- scheduler adapter.

---

## 15. Admission and initial scheduling

Admission is a lifecycle event, not a fake review.

Recommended bootstrap:

| Acquisition evidence | Initial due |
|---|---:|
| material error / strong assistance | +1 day |
| visible-answer practice | +1 day |
| independent hidden-answer clean acquisition | +3 days |

Admission MUST NOT increment:

- `reviewCount`;
- `lapseCount`;
- `lastReviewedAt`.

Only a valid scheduled Learn review does that.

---

## 16. Queue ownership

Typing queue and Learn queue are separate.

### Typing queue

Derived from upstream chapter flow.

### Learn queue

Derived only from Learn lifecycle and due state.

Conceptually:

```text
selectLearnQueue()
    ↓
filter lifecycle == ACTIVE
    ↓
select due cards
    ↓
priority ordering
    ↓
optional new acquisition quota
```

EXCLUDED words are filtered before scheduling.

---

## 17. Learn queue priority

For ACTIVE due words, V1 may preserve the existing priority logic:

1. newly reactivated memory failure;
2. larger lapse count;
3. weaker scheduler stage / stability;
4. larger historical error burden;
5. longer overdue time;
6. ordinary mature due word.

New acquisition is a separate quota, not mixed into due priority by pretending
new words are overdue cards.

---

## 18. Daily Learn plan

Recommended product model:

```text
Learn — 中考核心词

今日
────────────────
到期复习        34
新词            20
困难词           8

学习计划
────────────────
长期学习中      842
尚未学习       1184
已移出          114
```

Primary action:

```text
开始学习
```

The user does not need to choose “Review” for normal operation.

Learn composes:

```text
due Review items
+
new Acquisition items
```

according to plan quotas.

---

## 19. Manual exclusion UI

V1 should support three surfaces.

### 19.1 Current Learn word

A secondary menu:

```text
…
└── 移出学习计划
```

It should not be the dominant primary action.

### 19.2 Learning-plan word management

Allow multi-select exclusion for words the learner already knows or does not
need.

### 19.3 Excluded list

```text
Learn
→ 已移出
→ 恢复学习
```

Batch restoration may be added if useful.

---

## 20. Typing/Learn capability matrix

| Capability | Typing | Learn |
|---|---:|---:|
| Keyboard practice | yes | yes |
| WordRecord / telemetry | yes | yes |
| Upstream chapter progression | yes | no |
| Acquisition lifecycle | no | yes |
| Canonical cold probe | no | yes |
| Hint Ladder | no | yes |
| Again/Hard/Good/Easy | no | yes |
| Scheduler mutation | no | yes |
| Due queue | no | yes |
| Same-session reinforcement | no | yes |
| Manual exclude/restore | no | yes |
| FSRS/basic scheduler | no | yes |

This matrix is normative.

---

## 21. Routing

Target route model:

```text
/typing
/learn
```

During migration, the existing route structure may remain temporarily for
compatibility.

The architectural requirement is not the literal URL on day one; it is that
two different controllers own policy:

```text
TypingController
LearnController
```

Shared lower-level input/rendering components are allowed.

---

## 22. Shared engine boundary

Typing and Learn should reuse mechanics where practical:

```text
shared
├── key input
├── word rendering
├── audio playback
├── telemetry
├── IndexedDB access
└── import/export
```

But they must not share policy ownership.

Target conceptual structure:

```text
src/
├── typing/
│   ├── controller
│   └── upstream-policy
│
├── learn/
│   ├── lifecycle
│   ├── admission
│   ├── session
│   ├── queue
│   ├── hints
│   ├── rating
│   └── scheduler
│
└── shared/
    ├── typing-engine
    ├── telemetry
    └── persistence
```

V1 does not require an immediate physical directory move.

Behavioral boundaries should be established first; file moves can happen after
the architecture is stable.

---

## 23. Internal Review terminology

The following internal names remain valid:

- `ReviewOutcome`;
- `reviewEvidence`;
- `ReviewScheduler`;
- `ReviewItem`;
- `ReviewWordState` during migration.

A Learn session contains Review items.

Therefore the migration should avoid a cosmetic mass rename that creates code
churn without improving behavior.

Only product-level labels and ownership change first.

---

## 24. Current-to-target migration

The current system is “ordinary learning + error-word Review”.

Target is “Typing + Learn”.

Migration must be staged.

### Phase A — product boundary

- introduce explicit Typing / Learn concepts;
- relabel user-facing Review entry toward Learn;
- create Learn controller boundary;
- leave current Review internals operational.

### Phase B — lifecycle

Add lifecycle semantics:

```text
UNSEEN
ACTIVE
EXCLUDED
```

`ACQUIRING` may initially be session-local if persistent acquisition recovery
is not yet required.

Implement:

- manual exclude;
- restore;
- excluded list;
- queue filter.

### Phase C — Learn session model

Unify:

- Acquisition item;
- Review item;
- unfinished Learn session recovery.

Keep the existing bounded Review/Hint state machines as Review-item internals.

### Phase D — Rating Gate ownership

Make:

```text
decideReviewRating()
```

the sole long-term scheduler mutation gate.

Remove legacy direct:

```text
classification → scheduler
```

paths from Learn.

### Phase E — all-word Learn admission

All non-excluded words in a selected Learn plan become eligible for acquisition.

Completed acquisition creates ACTIVE long-term state.

### Phase F — basic-v2

Extend deterministic intervals to:

```text
1 / 3 / 7 / 14 / 30 / 60 / 120 / 180 days
```

### Phase G — FSRS-6 adapter

Replace scheduler implementation while keeping:

- observations;
- evidence;
- Rating Gate;
- lifecycle;
- Hint Ladder;
- Learn session semantics.

---

## 25. Migration of existing ReviewWordState

Existing Review states must not be discarded.

Recommended migration:

### Existing word with ReviewWordState

```text
ReviewWordState exists
→ lifecycle = ACTIVE
→ preserve nextReviewAt
→ preserve reviewCount/lapseCount
→ preserve schedulerState
```

### Historical error word without ReviewWordState

It may be admitted ACTIVE using the existing legacy bootstrap semantics, but
must not invent a clean scheduler confirmation from ordinary Typing history.

### Historical clean-only Typing word

```text
Typing history only
→ lifecycle remains UNSEEN
```

until Learn acquisition occurs.

### Existing unfinished ReviewRecord

Migrate/interpret as an unfinished Learn session containing Review items.

Do not create duplicate active sessions.

---

## 26. Exclusion migration and backup

Exclusion state is durable long-term product state.

It MUST be included in:

- IndexedDB export;
- cloud backup;
- cloud restore;
- conflict fingerprint.

Because the current backup exports the whole database, additive lifecycle
fields/tables will naturally be included, but fingerprint and restore tests
must explicitly cover exclusion semantics.

Required restore invariant:

```text
EXCLUDED before backup
→ restore
→ still EXCLUDED
→ absent from Learn due queue
```

---

## 27. Cross-mode invariants

These must be formally or executably verified.

### M1 — Typing never mutates scheduler

For any Typing attempt:

```text
LearningState.schedulerState(next)
=
LearningState.schedulerState(current)
```

### M2 — Typing never changes lifecycle

For any Typing attempt:

```text
lifecycle(next) = lifecycle(current)
```

### M3 — EXCLUDED never appears in Learn queue

```text
lifecycle = EXCLUDED
⇒
not selected
```

### M4 — restore reactivates exactly once

```text
EXCLUDED → ACTIVE
```

must not duplicate scheduler/card/session state.

### M5 — only Learn Rating Gate mutates scheduler

```text
scheduler mutation
⇒
sourceMode = learn
AND
RatingDecision.eligible = true
```

### M6 — acquisition does not fabricate Review rating

```text
acquisition completion
⇒
rating = null
```

### M7 — exclusion preserves history

```text
ACTIVE → EXCLUDED
```

must not delete prior WordRecords or scheduler history.

### M8 — Typing cannot reactivate an excluded word

Even a Typing failure leaves:

```text
lifecycle = EXCLUDED
```

---

## 28. Formal lifecycle model

The lifecycle transition function should be pure:

```ts
decideLearningLifecycleTransition(state, event)
```

Legal events:

```text
start-acquisition
complete-acquisition
exclude
restore
```

Legal transitions:

```text
UNSEEN    + start-acquisition    → ACQUIRING
ACQUIRING + complete-acquisition → ACTIVE
ACTIVE    + exclude              → EXCLUDED
EXCLUDED  + restore              → ACTIVE
```

All other combinations must be either:

- explicit no-op; or
- explicit invalid transition.

React components MUST NOT recreate lifecycle rules independently.

---

## 29. Formal queue model

Queue selection should be a pure function:

```ts
selectLearnQueue({
  learningStates,
  now,
  dueLimit,
  newLimit,
})
```

Required properties:

1. every Review item has lifecycle ACTIVE;
2. no EXCLUDED item appears;
3. every due Review item satisfies `nextReviewAt <= now`;
4. no duplicate `dict+word+kind` item exists;
5. new acquisition count does not exceed quota;
6. due Review priority is deterministic;
7. excluding one word cannot reorder unrelated words except by removing that word;
8. restoring a word with `nextReviewAt=now` makes it due on the next queue build.

---

## 30. Product semantics for “all learned”

Avoid ambiguous wording.

V1 preferred wording:

> **Learn manages long-term memory for every word you choose to learn.**

Not:

> Every word ever typed automatically becomes a Review card.

This preserves the two-mode architecture.

---

## 31. Rollout safety

Do not combine all architecture changes into one deployment.

Every phase must independently pass:

```text
domain tests
+
bounded formal properties
+
browser acceptance
+
build
+
production verification
```

A bounded **acquisition-only admission** may ship before the full Rating Gate
migration if and only if it is scheduler-rating neutral:

- it may create ACTIVE state and an initial due date;
- it must not fabricate Again/Hard/Good/Easy;
- it must not increment review/lapse counters;
- acquisition WordRecords must never replay as spaced-review ratings.

Full all-word scheduler rollout still requires:

1. Typing/Learn ownership boundary exists;
2. exclusion/restore works;
3. excluded words are proven absent from queue;
4. Rating Gate becomes the sole Learn scheduler mutation path;
5. current error-word users migrate without losing state.

---

## 32. Non-goals for V1

V1 does not require:

- automatic “mastered forever” status;
- cross-dictionary word identity merging;
- machine-learned exclusion suggestions;
- temporary Suspend UI;
- record-level multi-device merge;
- immediate physical directory reorganization;
- immediate FSRS-6 activation.

These can be added later without changing the product boundary.

---

## 33. Architectural decision summary

The V1 decisions are:

1. **Typing and Learn are the only top-level learning modes.**
2. **Typing preserves upstream behavior and cannot mutate long-term memory state.**
3. **Learn exclusively owns acquisition, due Review, hints, rating and scheduler.**
4. **Review remains a technical concept inside Learn, not a top-level product mode.**
5. **Every non-excluded word in a Learn plan is eligible for long-term learning.**
6. **A word enters ACTIVE long-term state through Learn acquisition, not merely by being typed.**
7. **Users can manually move ACTIVE words to EXCLUDED without deleting history.**
8. **EXCLUDED is a user choice, not a mastery judgment.**
9. **Restoring an excluded word preserves history and schedules an immediate canonical probe.**
10. **Learning lifecycle, session state, raw evidence and scheduler state remain separate.**
11. **The existing Review Rating/Hint/State-Machine contracts become internal Learn Review contracts.**
12. **FSRS-6 remains an interchangeable scheduler behind the same Rating Gate.**

This architecture is the prerequisite for safely moving from an error-word
Review feature to an all-word long-term Learn system while preserving the
original Typing experience.
