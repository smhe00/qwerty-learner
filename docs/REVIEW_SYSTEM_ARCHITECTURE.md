# Qwerty Learner Review System Architecture

## 1. Baseline

Repository: `smhe00/qwerty-learner`

Upstream: `RealKai42/qwerty-learner`

Baseline branch: `master`

Baseline commit: `1182426f2bd0a28c95302c33f9e19136b1262a70`

At the time this document was created, the fork's `master` is byte-for-byte aligned with upstream `master`.

Development branch:

```text
feature/spaced-review
```

The goal is to extend the existing project with a real review system while keeping the fork easy to synchronize with upstream and keeping the implementation suitable for an upstream pull request where possible.

---

## 2. Existing review capability already present upstream

The upstream project already has an experimental review path. Important existing components include:

- `src/utils/db/review-record.ts`
- `src/utils/db/record.ts`
- `src/store/reviewInfoAtom.ts`
- `src/pages/Gallery-N/ReviewDetail/index.tsx`
- `src/pages/Gallery-N/hooks/useErrorWords.ts`
- `src/pages/Typing/hooks/useWordList.ts`
- `src/pages/Typing/components/WordPanel/index.tsx`

Current flow:

```text
normal typing
    ↓
wordRecords
    ↓
wrong words grouped by dictionary
    ↓
Gallery → 错题回顾
    ↓
generateNewWordReviewRecord()
    ↓
ReviewRecord.words[]
    ↓
existing Typing page
    ↓
index persisted for resume
```

This is a useful foundation and should be extended rather than replaced.

---

## 3. Current limitations

### 3.1 Review generation is only a one-shot ranked list

`generateNewWordReviewRecord()` creates a list from historical error statistics and stores the entire list in `ReviewRecord.words`.

There is currently no concept of:

- next review time
- interval
- mastery state
- consecutive correct answers
- lapse count
- due queue
- daily review queue
- review history per word
- relearning after a mistake

### 3.2 A wrong answer during review does not change scheduling

During review, the normal typing recorder still saves a new `WordRecord`, but the current review item simply advances after the word is eventually entered correctly.

Therefore:

```text
wrong 3 times → finally correct
```

and

```text
correct first try
```

both advance to the next word without changing the current review queue.

### 3.3 No same-session reinforcement

A word answered incorrectly is not automatically reinserted later in the current session.

For reinforcement learning, a minimal behavior should be:

```text
wrong
  ↓
finish current attempt
  ↓
reinsert after N other words
  ↓
must become correct again
```

### 3.4 No spaced repetition

The existing system has no persistent per-word schedule. A finished review is simply marked `isFinished=true`.

### 3.5 ReviewRecord stores complete Word objects

Current structure:

```ts
ReviewRecord {
  dict
  index
  createTime
  isFinished
  words: Word[]
}
```

This tightly couples review sessions to dictionary payload shape and duplicates dictionary data in IndexedDB.

Long-term review state should instead primarily reference:

```text
dictId + word
```

and load the current dictionary entry when needed.

### 3.6 Current ranking deserves correction

The current implementation ranks:

- error count ascending
- latest error time ascending
- combined score ascending

This means low-error words can be placed before high-error words. Older errors are also favored over newer ones.

That behavior does not match the intended "harder / more urgent words first" interpretation and should be replaced by an explicit priority function.

---

## 4. Design principles

1. Keep upstream code changes small.
2. Reuse the existing Typing UI, pronunciation, phonetics, dictation and word-recording pipeline.
3. Add review logic as a separate domain module.
4. Keep persistent review state independent from ephemeral review sessions.
5. Preserve backward compatibility with existing IndexedDB data.
6. Do not alter dictionary JSON formats unless strictly necessary.
7. Prefer generic functionality suitable for upstream contribution.
8. Keep Shanghai / school-specific policy outside the generic core.

---

## 5. Proposed architecture

```text
src/
├── review/
│   ├── types.ts
│   ├── scheduler.ts
│   ├── priority.ts
│   ├── session.ts
│   ├── repository.ts
│   └── policy.ts
│
├── pages/
│   ├── Typing/          # minimal integration only
│   ├── Gallery-N/       # review dashboard / entry
│   └── ErrorBook/       # optional quick-start entry
│
└── utils/db/
    ├── existing files
    └── review state migration / adapter
```

The existing `review-record.ts` should initially be adapted rather than deleted.

---

## 6. Persistent model

Introduce a per-word persistent state:

```ts
type ReviewWordState = {
  id?: number

  dict: string
  word: string

  createdAt: number
  lastReviewedAt?: number
  nextReviewAt: number

  intervalDays: number

  consecutiveCorrect: number
  lapseCount: number
  totalReviews: number

  mastery: 'learning' | 'reviewing' | 'mastered'

  lastResult?: 'again' | 'hard' | 'good'
}
```

A compound identity should be based on:

```text
[dict + word]
```

Do not persist a second copy of the complete dictionary word payload as the authoritative long-term state.

---

## 7. Session model

A review session is ephemeral/persistable progress over a generated queue:

```ts
type ReviewSession = {
  id?: number
  dict: string
  createdAt: number
  updatedAt: number

  index: number
  isFinished: boolean

  queue: ReviewSessionItem[]
}
```

Each queue item should minimally contain:

```ts
type ReviewSessionItem = {
  word: string
  reason: 'due' | 'recent-error' | 'reinforcement'
}
```

The dictionary's current `Word` object should be resolved when the session loads.

---

## 8. P0 behavior: reinforcement review

Before implementing a full spaced algorithm, provide a useful minimal loop.

### Queue creation

Select wrong words from the current dictionary and prioritize by a transparent score.

Suggested inputs:

- historical wrong count
- most recent error
- first-try failure rate
- response time if available

### During review

First-try correct:

```text
advance normally
```

Wrong at least once:

```text
complete the word
    ↓
mark as failed-first-try
    ↓
reinsert 3–7 positions later
```

A repeated item leaves the active queue only after a clean first-try success.

This directly solves the main practical weakness of the current review mode.

---

## 9. P1 behavior: spaced review

After P0 is stable, add scheduling.

Initial conservative schedule:

```text
new / failed → same session reinforcement
clean success → +1 day
next clean success → +3 days
next clean success → +7 days
next clean success → +14 days
next clean success → +30 days
```

On a lapse, reduce the interval and return the word to learning state.

The scheduling API should be policy-driven so that the interval model can later be replaced without rewriting the UI.

---

## 10. Priority model

Avoid hidden or ambiguous ranking.

An initial normalized priority function can be:

```text
priority =
    w1 * errorRate
  + w2 * recency
  + w3 * overdue
  + w4 * responseTime
```

For P0, if some features are unavailable, use only observable data.

The direction of every term must be explicit: higher score means higher review priority.

---

## 11. Upstream compatibility strategy

### Keep these areas minimally modified

- Typing reducer
- word rendering
- pronunciation code
- dictionary resources
- normal chapter flow

### Prefer adapters at these integration points

- `useWordList()`
- `WordPanel.onFinish()`
- `ReviewDetail`
- IndexedDB review tables

### Avoid

- large refactors of existing Typing components
- replacing Jotai globally
- changing dictionary JSON schema for review metadata
- embedding school-specific logic into the generic scheduler

---

## 12. Suggested delivery sequence

### P0-A — Baseline tests and review-domain interfaces

- define review types
- isolate ranking logic
- add unit tests for priority ordering
- preserve current behavior

### P0-B — Same-session reinforcement

- record first-try success/failure
- reinsert failed words
- ensure session resume works
- ensure no infinite loop

### P0-C — Review UI cleanup

- show remaining words
- show words pending reinforcement
- direct entry from ErrorBook
- retain current Gallery review entry

### P1 — Persistent spaced review

- add ReviewWordState table
- migration
- due-word query
- interval policy
- daily review entry

### P2 — Learning dashboard

- due today
- learning
- mastered
- recent lapses
- review history

### P3 — School-specific extension

Keep this as an optional layer:

- Shanghai textbook dictionaries
- unit-based review
- exam-stage policy
- parent-facing summaries

---

## 13. Definition of done for the first implementation milestone

P0 is complete when:

1. Existing normal study behavior is unchanged.
2. Existing pronunciation / phonetics / dictation continue to work.
3. Review can start from current historical wrong-word data.
4. A word wrong on first attempt is automatically scheduled again in the same session.
5. A word leaves the reinforcement queue only after a clean attempt.
6. Review progress survives page refresh.
7. Existing IndexedDB users do not lose data.
8. Automated tests cover queue mutation and ranking.
9. Changes are localized enough that upstream `master` can still be merged with low conflict risk.
