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
