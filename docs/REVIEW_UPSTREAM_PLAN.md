# Review Upstream Integration Plan

## Goal

Develop the review feature in `smhe00/qwerty-learner` so that mature, generic pieces can be proposed back to `RealKai42/qwerty-learner` without requiring the upstream project to adopt fork-specific school or product customizations.

## Current baseline

- Upstream baseline: `1182426f2bd0a28c95302c33f9e19136b1262a70`
- Development branch: `feature/spaced-review`
- First implementation commit: `386fc6e5639bee18df249f71bf30fd4dd440d9a2`

The current implementation intentionally does **not** change:

- dictionary JSON schema
- pronunciation providers
- phonetic rendering
- IndexedDB schema
- normal chapter selection
- normal chapter progression

## P0 implementation now present

### Review priority

Review candidate ordering is isolated in:

```text
src/review/priority.ts
```

Current rule:

1. higher historical error count first;
2. for equal error count, more recent error first.

This replaces the previous ordering whose sort direction placed lower-priority items first.

### Same-session reinforcement

Queue policy is isolated in:

```text
src/review/session.ts
```

Current behavior:

```text
clean attempt
    → advance

attempt contains an error
    → finish the current word
    → schedule one pending copy after 3-5 intervening words
    → the repeated attempt must be clean to avoid another reinforcement
```

The scheduler allows at most one pending reinforcement for the same word, preventing accidental duplicate queue growth.

Near the end of a session, the failed word is appended when there are not enough remaining words to satisfy the normal spacing.

### Persistence

The existing `ReviewRecord` is reused. No database migration is introduced in P0.

When the live review queue changes, the updated queue and index are persisted through the existing `reviewModeInfoAtom` / `reviewRecords` path so browser refresh can resume the modified queue.

`useWordList()` rehydrates the review queue only when the review-session identity changes. This prevents persistence updates from resetting the active Typing reducer.

## Automated tests

Pure review-domain tests were added at:

```text
tests/e2e/review.spec.ts
```

They cover:

- priority ordering;
- bounded reinforcement spacing;
- normal reinsertion;
- end-of-session reinsertion;
- prevention of duplicate pending reinforcement.

The repository's existing GitHub Action runs only for pushes to `master` and `dev/e2e`. No CI workflow was changed in this feature branch solely to force a run, because CI-only changes would increase the upstream diff surface.

## Recommended upstream PR sequence

Do **not** send the entire mature review project as one large PR.

### PR 1 — Review priority correctness

Scope:

- `src/review/priority.ts`
- small change to `src/utils/db/review-record.ts`
- priority tests

Purpose:

- correct review ordering;
- introduce a small pure-function review domain seam.

This should be the easiest change for upstream to review.

### PR 2 — Same-session reinforcement

Scope:

- `src/review/session.ts`
- minimal Typing integration;
- queue tests

Purpose:

- a failed review word reappears later in the same review session;
- reuse the existing Typing and ReviewRecord infrastructure.

### PR 3 — Persistent spaced scheduling

Only after P0 has been exercised in real usage.

Scope:

- per-word review state;
- next-review time;
- interval policy;
- IndexedDB migration;
- due-word query.

This PR should remain generic and should not include school-specific scheduling policy.

### PR 4 — Review UI / analytics

Optional and separable:

- due count;
- mastery states;
- review history;
- progress display.

## Fork-only extensions

The following should remain outside the generic upstream PR unless the upstream maintainer explicitly wants them:

- Shanghai textbook-specific dictionaries or tags;
- Zhongkao-specific review policy;
- parent-facing reports;
- school/unit-specific dashboards.

## Merge discipline

Before each new review milestone:

1. fetch current upstream `master`;
2. compare it with the fork baseline;
3. rebase/merge upstream into the feature branch using a normal non-force workflow;
4. resolve conflicts before adding the next feature;
5. keep review-domain logic in `src/review/`;
6. avoid unrelated formatting or refactors;
7. keep each upstream candidate PR independently understandable and testable.

## Implemented data foundation (v0.1)

The feature branch now contains the storage foundation required for later adaptive scheduling:

- `WordRecord` keeps all legacy fields unchanged and adds optional raw telemetry only.
- telemetry v1 records first-key latency plus failed/clean attempt timing and error position/key.
- Dexie schema v4 adds `reviewWordStates` with a unique `[dict+word]` identity and a `[dict+nextReviewAt]` due-query index.
- `reviewRecords` and `chapterRecords` remain structurally unchanged.
- old WordRecord rows without telemetry remain valid.
- importing a backup without `reviewWordStates` clears any stale derived review state so it can later be rebuilt from imported WordRecords.
- scheduler state is versioned and separated from raw typing evidence; no FSRS behavior is enabled yet.

This keeps `wordRecords` as the historical source of truth and `reviewWordStates` as rebuildable scheduler state.


## Adaptive typing classification

The current feature branch now classifies a failed typing attempt using transparent raw evidence:

- first-key latency;
- number of failed attempts;
- repeated wrong position;
- QWERTY-adjacent wrong key ratio;
- inter-key timing;
- historical failure rate;
- historical dominant wrong position.

The classifier produces probabilistic `recall / spelling / motor` scores plus an `uncertain` state. Same-session reinforcement now uses the classification:

- recall-like failure -> return after 3 words;
- spelling-like failure -> return after 4 words;
- uncertain failure -> return after 5 words;
- motor-like slip -> return after 7 words.

Historical evidence is loaded asynchronously and sample-count weighted. A single historical record therefore has limited influence, while repeated same-position errors become stronger spelling evidence.

A scheduler adapter boundary is defined separately from the classifier. The branch intentionally does not add `ts-fsrs` yet: the currently maintained package requires Node.js 20+, while the upstream project's existing CI still targets Node 18. A runtime/toolchain upgrade should be handled separately before adopting the maintained FSRS package.


## Basic cross-session scheduler

The feature branch now contains a working `basic-v1` cross-session scheduler backed by `reviewWordStates`.

Current intervals:

```text
1 day -> 3 days -> 7 days -> 14 days -> 30 days
```

Key semantics:

- `again` resets the state to the 1-day stage and increments `lapseCount`;
- `hard` keeps the current stage;
- `good` advances one stage only when the word is actually due;
- `easy` can advance two stages only when the word is actually due;
- same-session reinforcement or normal immediate word loops do not advance the spaced interval;
- early practice does not push the existing due date later;
- current typing classification maps recall-like errors to `again`, spelling/uncertain errors to `hard`, and motor-like slips / clean attempts to `good`.

Every completed word now writes the original `WordRecord` first, then updates the derived `reviewWordState`. If no state exists, historical WordRecords for that `[dict+word]` are replayed before applying the current adaptive outcome, so imported legacy history is not silently discarded.

Starting a new Review session now:

1. lazily bootstraps missing per-word states for the dictionary;
2. queries `reviewWordStates` where `nextReviewAt <= now`;
3. intersects those due states with the dictionary's historical error words;
4. builds the existing virtual ReviewRecord only from due error words.

The existing Gallery/Review entry point and unfinished-session resume behavior remain unchanged.


## Development diagnostics and rebuildability

Development builds expose a read-only browser-console API:

```js
await window.__qwertyReviewDebug.inspect('cet4', 'receive')
await window.__qwertyReviewDebug.due('cet4')
await window.__qwertyReviewDebug.stats('cet4')
```

The API is loaded dynamically only when `import.meta.env.DEV` is true. Production builds do not install the global debug object.

`inspect(dict, word)` reports:

- current scheduler state and due status;
- next-review timestamp;
- historical failure summary;
- latest-record telemetry availability;
- latest classifier scores and derived behavior features;
- evidence tags such as `long-first-key`, `repeated-same-position`, `adjacent-key-errors`, and `multiple-varied-failures`.

`stats(dict)` reports telemetry coverage, latest per-word classification distribution, due count, and basic scheduler stage distribution. This is intended for threshold calibration with real user data before replacing the transparent classifier with a learned model.

Scheduler state is explicitly rebuildable. New telemetry records are replayed through the full classifier and scheduler mapping; legacy rows without telemetry fall back to conservative `wrongCount` mapping. `rebuildReviewWordStatesForDictionary(dict)` can therefore reconstruct the derived table from `wordRecords` without treating `reviewWordStates` as irreplaceable source data.


## P1 scheduling semantics

The basic scheduler now distinguishes immediate learning repetitions from independent long-term reviews using a 30-minute learning window.

- immediate reinforcement does not advance interval stage;
- immediate reinforcement does not inflate `reviewCount`, `cleanStreak`, or `lapseCount`;
- early successful practice preserves the existing due date;
- an early failure outside the learning window is treated as meaningful forgetting and resets the schedule to the 1-day stage;
- raw `WordRecord` events are still preserved for every completed attempt.

Due-session ordering is scheduler-aware and intentionally uses lexicographic rules rather than opaque weights:

1. higher `lapseCount`;
2. weaker current basic stage;
3. higher historical error count;
4. earlier `nextReviewAt` (more overdue);
5. more recent historical error as the final tie breaker.

This ordering is designed to remain explainable until real telemetry volume is sufficient to justify learned weights.
