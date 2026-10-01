# Review Rating Contract V1

> Status: **Design Contract / implementation target**
>
> Scope: Qwerty Plus long-term Review rating semantics, evidence gating, and scheduler boundary.
>
> Target branch: `product/main`
>
> This contract is deliberately scheduler-agnostic. It defines **when a typing event is allowed to become a long-term memory rating** and how that rating is derived. The scheduler may be `basic-v2` today and FSRS-6 later without changing the observation/evidence semantics.

---

## 1. Purpose

Qwerty Plus mixes several activities that look similar in the UI but have very different meanings:

- keyboard practice;
- initial vocabulary acquisition;
- spelling remediation;
- same-session reinforcement;
- adaptive diagnostics;
- true long-term memory retrieval.

A correct keystroke sequence is therefore **not automatically evidence of long-term memory**.

For example:

```text
necessary is fully visible
        ↓
user types necessary correctly
```

This is useful training evidence, but it does not prove that the user can independently recall the spelling later.

The system MUST separate:

```text
Raw Typing Observation
        ↓
Evidence / Diagnosis
        ↓
Rating Gate
        ↓
Again / Hard / Good / Easy / null
        ↓
Scheduler Adapter
        ├─ basic-v2
        └─ FSRS-6
```

The four ratings are a **scheduler interface**, not a generic label for every typing event.

---

## 2. Primary long-term memory objective

V1 defines the primary scheduled skill as:

> **Given the meaning, independently recall and type the English orthography without seeing the English answer and without relying on pronunciation.**

Canonical direction:

```text
meaning
   ↓
orthographic recall
   ↓
typed English word
```

The canonical long-term probe therefore uses:

```text
letters = all-hidden
meaning = visible
audio = none
purpose = probe
probeDimension = none
coldAttempt = true
```

Other conditions are still useful, but they measure or train different things.

Examples:

```text
full English visible
    → visual copying / keyboard training

targeted mask
    → local spelling remediation

audio on + English hidden
    → audio-assisted spelling retrieval

audio withdrawal experiment
    → audio-dependence diagnosis
```

V1 MUST NOT silently treat these different conditions as equivalent long-term tests.

---

## 3. Core terminology

### 3.1 Observation

An immutable factual record of what happened.

Examples:

- first-key latency;
- inter-key latency;
- wrong key;
- wrong position;
- wrong-attempt count;
- answer visibility;
- meaning visibility;
- pronunciation state;
- reveal actions;
- focus/background pauses;
- current exercise condition.

Observation is source-of-truth data and MUST be retained independently from later policy changes.

---

### 3.2 Training event

An event whose main purpose is acquisition, repetition, remediation, or motor practice.

Typical cases:

- full English answer visible;
- targeted-mask spelling drill;
- immediate retry after an error;
- same-session reinforcement;
- typing after answer reveal;
- ordinary repetition intended to deepen familiarity.

A training event:

```text
MAY update:
- orthography profile
- motor profile
- cue-dependence profile
- raw WordRecord history

MUST NOT directly advance:
- long-term review stage
- FSRS state
- nextReviewAt
```

Its scheduler rating is:

```text
rating = null
```

---

### 3.3 Cold probe

The first valid retrieval attempt for a scheduled review item before remediation or answer exposure.

Only a cold probe can normally generate a long-term scheduler rating.

Once the user has:

- seen the answer;
- entered remediation;
- repeated the word in the same item;
- received targeted scaffolding;

later attempts are no longer cold probes.

---

### 3.4 Canonical probe

A cold probe under the fixed V1 long-term condition:

```text
letters hidden
meaning visible
audio off
no prior reveal
probeDimension = none
```

Canonical probes are the primary source of Again / Hard / Good / Easy.

---

### 3.5 Diagnostic probe

A controlled experiment that changes one variable to identify a weakness.

Examples:

- withdraw automatic audio;
- hide a previously visible orthographic cue;
- test a specific cue dependency.

Diagnostic probes use:

```text
purpose = probe
probeDimension != none
```

In V1, diagnostic probes are **not scheduler events**.

They update weakness/evidence profiles but return:

```text
rating = null
```

This conservative rule prevents an experimental condition from corrupting the long-term memory schedule.

A future contract may allow carefully validated diagnostic evidence to promote a rating, but that requires explicit versioning.

---

### 3.6 Same-session reinforcement

A word reinserted a few items later after an error.

It is short-term remediation, not another spaced-repetition event.

Therefore:

```text
same-session reinforcement
        ↓
rating = null
        ↓
long-term scheduler unchanged
```

---

## 4. Scheduler-neutral rating interface

The long-term Review layer MUST expose a narrow interface.

```ts
type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

type RatingDecision =
  | {
      eligible: false
      rating: null
      reasonCodes: string[]
    }
  | {
      eligible: true
      rating: ReviewRating
      reasonCodes: string[]
      confidence: number
    }
```

The scheduler consumes only a valid `ReviewRating`.

Conceptually:

```ts
interface SchedulerAdapter<State> {
  review(
    state: State,
    rating: ReviewRating,
    now: number,
  ): State
}
```

The scheduler MUST NOT inspect:

- raw key events;
- UI visibility;
- audio state;
- reveal state;
- targeted-mask state;
- motor-error heuristics.

Those belong above the scheduler boundary.

This is the compatibility contract for a future FSRS-6 adapter.

---

## 5. Rating eligibility gate

Eligibility is evaluated **before** rating classification.

The checks are ordered. The first blocking rule wins.

### Rule G1 — training never rates

If:

```text
exerciseCondition.purpose == training
```

then:

```text
rating = null
reason = training-event
```

---

### Rule G2 — only cold attempts rate

If the user is already in:

- retry;
- loop-current;
- same-session reinforcement;
- post-reveal completion;
- remediation;

then:

```text
rating = null
reason = non-cold-attempt
```

---

### Rule G3 — full answer visibility blocks rating

If the full English spelling is visible before the first key:

```text
rating = null
reason = orthographic-answer-visible
```

A correct copy is not independent memory retrieval.

---

### Rule G4 — answer reveal invalidates the current rating event

If the user reveals the answer before completing the cold probe:

```text
rating = null
reason = answer-revealed
```

The failed retrieval remains diagnostic evidence, but the resulting correct typing is training.

The word stays due or is re-queued according to the invalid-probe retry policy.

---

### Rule G5 — diagnostic probes do not rate in V1

If:

```text
probeDimension != none
```

then:

```text
rating = null
reason = diagnostic-probe
```

The result may update:

- audio dependence;
- spelling weakness;
- cue dependence;
- future exercise policy.

It MUST NOT directly mutate long-term scheduler state.

---

### Rule G6 — unreliable attention does not rate

If evidence is marked `attentionUncertain` because of unexplained extreme pauses:

```text
rating = null
reason = attention-uncertain
```

V1 prefers “unknown” over inventing a memory judgment.

The item remains due and may be retried later.

---

### Rule G7 — canonical probe is fully rateable

If all canonical conditions are satisfied, the event may produce any of:

```text
Again / Hard / Good / Easy
```

according to Section 7.

---

## 6. Why `null` is necessary

Forcing every attempt into one of four FSRS ratings is semantically wrong.

Examples:

| Event | Correct scheduler result |
|---|---|
| full word visible, typed cleanly | `null` |
| targeted-mask drill | `null` |
| same-session retry | `null` |
| answer revealed then typed correctly | `null` |
| audio withdrawal diagnostic | `null` |
| attention evidence unreliable | `null` |
| canonical independent cold probe | rating allowed |

`null` means:

> This event contains useful learning evidence, but it is not a valid long-term spaced-repetition judgment.

It does **not** mean the event is discarded.

---

## 7. Canonical probe rating semantics

Only after the eligibility gate passes do we map evidence to the scheduler vocabulary.

### 7.1 Again

Meaning:

> Independent retrieval failed.

Typical evidence:

- clear recall failure;
- unable to begin meaningful recall;
- multiple unrelated spelling positions fail;
- explicit inability to recall;
- canonical probe cannot be completed without assistance.

Required interpretation:

```text
memory retrieval failure
→ Again
```

A keyboard slip alone MUST NOT produce Again.

---

### 7.2 Hard

Meaning:

> Retrieval succeeded or partially succeeded, but memory evidence is weak or unstable.

Typical evidence:

- stable spelling weakness at one/few positions;
- slow but successful independent recall;
- repeated orthographic hesitation;
- ambiguous memory/spelling evidence that is still reliable enough to judge;
- multiple motor errors where “pure slip” is no longer credible.

Hard MUST NOT be used merely because the user typed slowly due to an attention-uncertain event; that case is `null`.

---

### 7.3 Good

Meaning:

> Normal independent retrieval.

Typical evidence:

- canonical cold probe;
- no reveal;
- no audio;
- no material spelling/recall failure;
- normal first-key latency;
- normal typing progression.

A single high-confidence motor slip MAY still result in Good when memory retrieval itself is clearly intact.

---

### 7.4 Easy

Meaning:

> Strong independent retrieval evidence.

Easy has a deliberately strict gate.

Initial V1 requirements:

```text
canonical probe
+ all English letters hidden
+ audio off
+ no reveal
+ no material error
+ firstKeyLatency < 500 ms
+ fluent completion
+ no attention uncertainty
```

Easy MUST NOT be emitted from:

- visible-answer typing;
- targeted mask;
- audio-assisted retrieval;
- same-session reinforcement;
- diagnostic probes.

The 500 ms threshold is a policy constant, not a permanent universal truth. It may later become user-adaptive, but the semantic contract remains unchanged.

---

## 8. Motor error vs memory error

Typing mistakes MUST NOT automatically imply poor memory.

The classifier may use:

- QWERTY adjacency;
- first-key latency;
- average inter-key latency;
- repeated wrong-position ratio;
- number of wrong attempts;
- historical dominant wrong positions.

Example:

```text
fast start
+ one adjacent-key typo
+ immediate correction
+ otherwise fluent spelling
```

may be classified as:

```text
cause = motor
memory result = Good
motor weakness += evidence
```

By contrast:

```text
same spelling position fails repeatedly
```

is more consistent with:

```text
cause = spelling
rating = Hard
```

And:

```text
long retrieval delay
+ multiple unrelated wrong positions
```

is more consistent with:

```text
cause = recall
rating = Again
```

The raw telemetry remains authoritative; classifier policy is replaceable.

---

## 9. Condition × result decision table

This table is normative for V1.

| Exercise condition | Result | Long-term rating | Other effect |
|---|---|---|---|
| Full English visible | clean | `null` | training evidence |
| Full English visible | typo(s) | `null` | motor/spelling profile |
| Targeted mask | clean | `null` | remediation success |
| Targeted mask | fail | `null` | spelling weakness |
| Same-session reinforcement | clean | `null` | reinforcement evidence |
| Same-session reinforcement | fail | `null` | weakness evidence + requeue |
| Diagnostic audio withdrawal | clean | `null` | audio dependence decreases |
| Diagnostic audio withdrawal | fail | `null` | audio dependence increases |
| Canonical probe | clear recall failure | Again | scheduler event |
| Canonical probe | stable spelling weakness | Hard | scheduler event |
| Canonical probe | high-confidence motor slip | Good | motor evidence |
| Canonical probe | normal independent success | Good | scheduler event |
| Canonical probe | fast fluent independent success | Easy | scheduler event |
| Canonical probe | attention uncertain | `null` | retry later |
| Canonical probe + answer reveal | eventually clean | `null` | training after failed probe |

No UI branch may override this table with an independent ad-hoc scheduler decision.

---

## 10. Adaptive condition changes

Adaptive Review is allowed, but changing conditions MUST NOT blur the scheduler semantics.

### 10.1 One-variable diagnostic rule

A diagnostic probe changes exactly one intended variable.

Example — audio dependence:

Baseline:

```text
letters hidden
meaning visible
audio automatic
```

Diagnostic:

```text
letters hidden
meaning visible
audio none
```

Only audio changes.

Other cue dimensions MUST remain fixed.

---

### 10.2 Diagnostic success

Example:

```text
audio removed
→ user still recalls quickly and cleanly
```

Update:

```text
audioDependence ↓
```

V1 scheduler effect:

```text
rating = null
```

The next canonical scheduled probe remains responsible for long-term rating.

---

### 10.3 Diagnostic failure

Example:

```text
audio removed
→ retrieval becomes slow or fails
```

Update:

```text
audioDependence ↑
```

V1 scheduler effect:

```text
rating = null
```

The failure MUST NOT be automatically converted to Again.

Reason:

> The system intentionally changed the test condition. A diagnostic failure identifies a dependency; it is not automatically equivalent to a canonical spaced-repetition failure.

---

## 11. Acquisition and all-learned admission

All completed learned words should eventually enter long-term Review, but ordinary learning is **not itself a scheduler review**.

### 11.1 Admission criterion

A word becomes eligible for long-term state after at least one completed ordinary-learning `WordRecord`.

```text
completed ordinary learning
        ↓
ReviewWordState exists
```

A word merely displayed on screen does not qualify.

---

### 11.2 Initial due seeding is not a rating

Initial acquisition may seed the first due date without generating Again/Hard/Good/Easy.

Recommended V1 seed policy:

| Acquisition evidence | Initial due |
|---|---:|
| any material error | +1 day |
| full-answer / strongly assisted clean practice | +1 day |
| independent hidden-answer clean acquisition | +3 days |

Seeding MUST NOT increment:

- `reviewCount`;
- `lapseCount`;
- `lastReviewedAt`.

Only a valid long-term scheduler event does that.

---

### 11.3 Ordinary relearning after maturity

If an existing mature word is encountered in ordinary learning:

#### clean ordinary practice

```text
record evidence
but
do not move nextReviewAt
```

#### new ordinary-learning error

```text
fresh weakness detected
→ nextReviewAt = now
```

This reactivates the word without fabricating a Review rating.

The existing implementation already follows this reactivation concept for error words and should retain it for all-learned mode.

---

## 12. Same-session remediation contract

After a rated canonical probe fails or shows weakness:

```text
canonical cold probe
      ↓
rating captured once
      ↓
training/remediation
      ↓
3–7 words later reinforcement
```

Current cause-based reinsertion policy may remain:

| Cause | Reinforcement gap |
|---|---:|
| recall | 3 |
| spelling | 4 |
| uncertain | 5 |
| motor | 7 |

All reinforcements after the first rated probe are training events.

They MUST NOT generate a second long-term rating in the same review item.

---

## 13. Invalid probe retry policy

A due card can produce `rating = null` because the observation is invalid or diagnostic.

Examples:

- attention uncertain;
- answer revealed;
- diagnostic probe;
- browser interruption.

The system MUST NOT mark the long-term review complete.

Recommended V1 behavior:

1. keep the card due;
2. allow at most one clean canonical retry later in the same session;
3. if no valid retry occurs, leave the card due for the next session;
4. do not loop indefinitely.

This gives `null` a safe operational meaning.

---

## 14. Basic-v2 scheduler compatibility

The initial scheduler may continue to use deterministic intervals:

```text
1 → 3 → 7 → 14 → 30 → 60 → 120 → 180 days
```

Example mapping:

| Rating | Basic-v2 behavior |
|---|---|
| Again | reset to 1 day |
| Hard | keep current stage |
| Good | advance 1 stage |
| Easy | advance 2 stages |

This table belongs to the scheduler adapter, **not** the evidence layer.

The rating contract remains valid if the interval algorithm changes.

---

## 15. FSRS-6 migration contract

Future migration should look like:

```text
Observation
    ↓
Evidence
    ↓
Rating Gate
    ↓
Again / Hard / Good / Easy
    ↓
FSRS-6 adapter
```

The following components MUST remain scheduler-independent:

- typing telemetry;
- learning context;
- exercise condition;
- error classification;
- weakness profiles;
- rating eligibility;
- rating semantics.

FSRS-6 should receive only:

- card/scheduler state;
- valid rating;
- timestamp;
- any FSRS-native metadata explicitly required by the adapter.

FSRS MUST NOT be asked to interpret whether the answer was visible or whether a typo was motor-related.

---

## 16. Required persistent data separation

Long-term Review data should conceptually separate three categories.

### 16.1 Raw facts

```text
WordRecord
typingTelemetry
learningContext
exerciseCondition
```

These are immutable evidence.

### 16.2 Derived diagnostic state

Examples:

```text
orthography weakness
motor weakness
audio dependence
classifier confidence
reviewPolicyShadow
```

These are rebuildable/replaceable.

### 16.3 Scheduler state

Examples:

```text
basic-v2 stage
nextReviewAt
reviewCount
lapseCount
FSRS difficulty/stability (future)
```

Only valid ratings may update this category.

---

## 17. Safety invariants

The implementation and formal tests MUST enforce at least these invariants.

### R1 — no training event advances scheduler

```text
purpose = training
⇒ rating = null
```

### R2 — no full-visible answer creates a rating

```text
letters = all-visible
⇒ rating = null
```

### R3 — at most one long-term rating per review item

After the cold probe is rated, all later attempts for that item are training.

### R4 — diagnostic probes do not mutate scheduler in V1

```text
probeDimension != none
⇒ rating = null
```

### R5 — attention-uncertain observations do not mutate scheduler

Unreliable evidence is not converted to Hard.

### R6 — motor evidence cannot independently produce Again

Again requires memory-retrieval failure evidence.

### R7 — Easy requires canonical independent retrieval

No assisted condition may emit Easy.

### R8 — ordinary clean learning cannot postpone a mature due date

Only a valid long-term rating advances the scheduler.

### R9 — fresh ordinary-learning failure may reactivate immediately

It may set `nextReviewAt = now` without incrementing review counters.

### R10 — scheduler implementation is replaceable

Rating semantics MUST remain valid if `basic-v2` is replaced by FSRS-6.

---

## 18. Formal verification matrix

The bounded checker should cover the Cartesian product of at least:

```text
purpose:
  training / probe

probeDimension:
  none / audio / orthography / meaning

letters:
  all-visible / all-hidden / partial / targeted-mask

audio:
  none / automatic

coldAttempt:
  true / false

revealedBeforeCompletion:
  true / false

attentionUncertain:
  true / false

cause:
  clean / recall / spelling / motor / uncertain

latency bucket:
  fast / normal / slow / extreme
```

Properties to prove:

1. every modeled state returns exactly one RatingDecision;
2. blocked conditions always return `null`;
3. training never rates;
4. diagnostic probes never rate;
5. full-visible answers never rate;
6. non-cold attempts never rate;
7. Easy is possible only for canonical independent clean retrieval;
8. Again is impossible for pure motor classification;
9. a valid canonical event maps deterministically to one rating;
10. scheduler mutation is invoked iff `eligible === true`.

---

## 19. Browser acceptance scenarios

At least the following real-browser tests should exist.

### Scenario A — visible-word training

```text
word visible
→ clean typing
→ WordRecord persisted
→ no scheduler rating
→ nextReviewAt unchanged
```

### Scenario B — canonical Good

```text
letters hidden
audio off
meaning visible
→ normal clean cold recall
→ Good
→ scheduler advances once
```

### Scenario C — canonical motor slip

```text
fast recall
→ one adjacent-key typo
→ correction
→ motor classification
→ Good, not Again
```

### Scenario D — spelling weakness

```text
canonical probe
→ repeated same-position spelling error
→ Hard
→ remediation
→ later same-session clean reinforcement
→ no second rating
```

### Scenario E — recall failure

```text
canonical probe
→ clear retrieval failure
→ Again
→ remediation
→ scheduler reset exactly once
```

### Scenario F — answer reveal

```text
canonical probe starts
→ user reveals answer
→ finishes cleanly
→ rating = null
→ card remains due / retryable
```

### Scenario G — audio diagnostic

```text
audio dependence suspected
→ audio-withdrawal diagnostic
→ success or failure
→ weakness profile changes
→ scheduler unchanged
```

### Scenario H — attention uncertain

```text
extreme unexplained pause
→ attentionUncertain
→ rating = null
→ scheduler unchanged
```

---

## 20. Current implementation gaps

The current code already contains much of the required vocabulary:

- `ExerciseConditionV1`;
- `purpose: training | probe`;
- `probeDimension`;
- `ReviewEvidenceV1`;
- `retrievalValidity`;
- `evidenceStrength`;
- `TypingErrorClassification`;
- `ReviewOutcome`;
- scheduler adapter abstraction.

However V1 implementation does not yet fully enforce this contract.

Known gaps include:

1. some current paths still map classification directly to `ReviewOutcome`;
2. current audio-withdrawal probe may directly produce a scheduler outcome;
3. attention-uncertain observations are currently often mapped to Hard rather than `null`;
4. the all-learned admission path is not yet active;
5. the current scheduler is `basic-v1` with shorter maximum intervals;
6. rating eligibility is not yet a single explicit pure decision function;
7. formal verification currently validates Review progression strongly, but not the complete condition × evidence → rating/null matrix defined here.

These gaps are implementation work, not ambiguities in the contract.

---

## 21. Required implementation shape

The next implementation should introduce one pure production function, conceptually:

```ts
decideReviewRating({
  observation,
  classification,
  evidence,
  exerciseCondition,
  attemptContext,
}): RatingDecision
```

React MUST NOT recreate the rules independently.

Expected effect boundary:

```text
raw attempt persisted
      ↓
classify / evaluate evidence
      ↓
decideReviewRating()        pure
      ↓
rating == null ?
   yes → diagnostic/training/retry handling
   no  → scheduler.review(rating)
      ↓
persist scheduler state
      ↓
review progression
```

The formal model checker must execute the same production decision function.

---

## 22. Change-control rule

Any future change that allows a previously non-rateable condition to affect the scheduler MUST:

1. change this contract version;
2. define the new semantic meaning;
3. add bounded formal properties;
4. add browser acceptance coverage;
5. preserve backward readability of raw observation data.

Examples requiring a contract revision:

- allowing audio-assisted probes to emit Good;
- allowing diagnostic probes to emit ratings;
- personalizing the Easy latency threshold;
- introducing multiple long-term skill tracks;
- changing the canonical retrieval objective.

---

## 23. Summary

The governing principle is:

> **Training teaches. Diagnostics identify weaknesses. Canonical cold probes measure long-term memory. Only valid measurements become Again / Hard / Good / Easy.**

This gives Qwerty Plus a stable interface:

```text
typing conditions may evolve
adaptive training may evolve
classifier may evolve
scheduler may change from basic-v2 to FSRS-6

but

Again / Hard / Good / Easy
retain one clean long-term-memory meaning.
```

That separation is the prerequisite for safely adding all-learned spaced repetition without confusing keyboard practice, spelling remediation, cue dependence, and true memory retention.
