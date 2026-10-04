# Learn Statistics V1

> Status: P2 implementation contract
>
> Product surface: `/analysis?from=learn`

## 1. Purpose

Learn statistics are long-term memory statistics, not a relabeling of Typing
statistics. The Learn view therefore uses Learn provenance and scheduler state
instead of chapterRecords, Typing WPM, or the Error Book.

## 2. Sources of truth

P2 reads:

- `WordRecord` for historical Learn observations;
- `reviewWordStates` for current lifecycle / due / scheduler state;
- the selected dictionary word list for UNSEEN count.

`reviewRecords` are intentionally not used as memory-quality truth. They are
session checkpoints and may contain unfinished or recovery state.

## 3. Learn provenance

A record is counted when:

- `sourceMode === 'learn'`; or
- it is a transitional legacy record with `chapter === -1` and explicit
  Learn/Review metadata such as `reviewRatingDecision`.

A record with `sourceMode === 'typing'` is never counted in Learn statistics.

Training/reinforcement records with Rating Gate reasons
`non-cold-attempt` or `training-event` are excluded from primary Learn
attempt counts.

## 4. V1 metrics

### Today

- reviewed words: unique words with a primary Review attempt today;
- acquired words: unique words that completed a spacing-valid, unaided Independent Acquisition admission today;
- Hint use rate: primary Learn attempts carrying `learningContext.reviewHint`;
- Cold Probe first-pass rate: primary Learn attempts completed with zero
  wrongCount, no Hint, and no Again result.

### Current lifecycle

- ACTIVE;
- due ACTIVE where `nextReviewAt <= now`;
- EXCLUDED;
- UNSEEN = selected dictionary unique words minus all persisted learning states.

If the dictionary payload is temporarily unavailable, UNSEEN is shown as
unknown while state/history metrics remain available.

### Scheduler / 30 day

- Again / Hard / Good / Easy counts include only `eligible=true` Rating Gate
  events;
- 30-day review success rate counts Hard / Good / Easy as completed retrieval
  and Again as failure;
- average interval is the mean `intervalDays` of ACTIVE basic-v1/basic-v2
  scheduler states;
- daily trends show unique reviewed words, unique acquired words, and eligible
  rating success rate.

The success rate is deliberately named "复习通过率", not retention probability.
P2 does not claim a calibrated forgetting probability.

## 5. Isolation invariants

1. Typing records cannot change Learn statistics.
2. EXCLUDED words are not ACTIVE or due.
3. Reinforcement/training cannot create a scheduler rating count.
4. Acquisition does not fabricate Again/Hard/Good/Easy.
5. Learn statistics never write scheduler or lifecycle state.
6. Existing Typing analysis remains behaviorally unchanged.

## 6. P2 closure gate

P2 is complete only when:

- pure aggregation tests pass;
- browser gate proves Learn opens the Learn-specific statistics surface and
  returns to the same Learn session;
- Review Gate lint/domain/browser/build/production smoke is green.
