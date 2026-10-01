# Review Hint Ladder V1

> Status: production interaction contract
>
> Parent contracts:
>
> - `REVIEW_RATING_CONTRACT_V1.md`
> - `REVIEW_STATE_MACHINE_V2.md`
> - `REVIEW_CANONICAL_PROBE_V1.md`

## 1. Goal

A canonical Review starts with no English spelling, no automatic pronunciation,
and no phonetic cue. When the learner cannot retrieve the word, the UI must
provide a finite, ordered cue ladder without confusing training success with
long-term memory success.

The control gesture is intentionally keyboard-native:

> At input position zero, pressing **Space** means “I cannot recall this under
> the current cue level; give me the next hint.”

Space is a hint-control key only while a stronger hint exists.

## 2. Hint ladder

```text
COLD
  meaning visible
  English hidden
  audio off
  phonetic hidden
        |
        | Space at first-letter position
        v
HINT 0
  first English letter visible
  audio off
  phonetic hidden
        |
        | Space at first-letter position
        v
HINT 1
  first English letter visible
  pronunciation enabled/played
  phonetic visible
        |
        | Space at first-letter position
        v
HINT 2
  deterministic partial spelling
  pronunciation available
  phonetic visible
        |
        | Space at first-letter position
        v
HINT 3
  full English answer visible
  pronunciation available
  phonetic visible
  MUST type the full word correctly
```

For Hint 2 the deterministic V1 mask shows positions `0,2,4,...`.

Example:

```text
cancel
→ c_n_e_
```

## 3. Hint 3 is mandatory training

Hint 3 is the terminal cue state.

At Hint 3:

- Space no longer advances the hint ladder.
- Space is treated as an ordinary typing key and therefore as an error for a
  normal English word.
- user-driven skip/navigation is locked;
- the skip affordance remains hidden even after repeated typing errors;
- the item can progress only after the displayed full word is typed correctly.

This creates a hard acquisition floor:

```text
forgotten word
→ eventually sees full answer
→ must execute one correct full spelling
→ only then may leave the item
```

## 4. Memory semantics

The first Space from the canonical cold probe is an explicit recall failure.

It is persisted as:

```text
reviewHint.coldProbeSurrendered = true
```

and has long-term meaning:

```text
Again
```

Later correct typing under Hint 0/1/2/3 is training success and MUST NOT erase
that original cold-probe failure.

The final WordRecord therefore preserves both facts:

```text
cold probe: failed / surrendered
training: eventually completed
```

## 5. Persisted hint trace

`LearningContextV1.reviewHint` stores:

```ts
{
  version: 1
  maxLevel: 0 | 1 | 2 | 3
  coldProbeSurrendered: boolean
  advanceCount: 1 | 2 | 3 | 4
}
```

This is raw evidence and is included automatically in local/cloud backups
because it lives inside WordRecord.

## 6. Rating compatibility

When `coldProbeSurrendered=true`, Review evidence is:

```text
memoryGrade       = Again
errorCause        = recall
retrievalValidity = independent
reason            = cold-probe-surrendered
```

The “independent” validity refers to the failed cold probe, not the later
assisted training completion.

This semantic maps directly to the scheduler-neutral FSRS-compatible rating
interface.

## 7. Audio and phonetic behavior

Hint 1 is the first cue level that introduces pronunciation and phonetics.

```text
Hint 0: audio off, phonetic hidden
Hint 1: audio on,  phonetic visible
Hint 2: audio on,  phonetic visible
Hint 3: audio on,  phonetic visible
```

Automatic pronunciation is re-armed when entering Hint 1. Later hint levels
retain the audio/phonetic cue rather than repeatedly treating them as new
memory probes.

## 8. Formal liveness

The hint state machine is:

```text
cold → h0 → h1 → h2 → h3
```

No backward transition exists.

A well-founded variant is:

```text
V(cold)=4
V(h0)=3
V(h1)=2
V(h2)=1
V(h3)=0
```

Every hint-escalation transition satisfies:

```text
V(next) < V(current)
```

Therefore the hint escalation itself cannot cycle.

Hint 3 has no escalation edge. Under the existing Review liveness assumption
that the learner eventually completes the presented mandatory typing task, the
item leaves Hint 3 only through correct completion.

## 9. Required tests

Production verification must include:

1. first-position Space advances exactly one hint level;
2. Space at a nonzero input position does not request a hint;
3. Hint 3 Space does not advance;
4. Hint 0 shows only the first letter;
5. Hint 1 introduces audio + phonetic;
6. Hint 2 exposes deterministic partial spelling;
7. Hint 3 exposes the full answer;
8. Hint 3 blocks skip/navigation;
9. Hint 3 requires correct full typing to finish;
10. persisted hint trace records `maxLevel=3` and four advances;
11. cold surrender produces `Again` even when final copy is clean;
12. bounded formal enumeration proves strict hint-variant descent.

## 10. Next gate

After this interaction layer is verified in production, the next change is to
make `decideReviewRating()` the sole scheduler mutation gate for all Review
paths, including `null → bounded retry/defer`, before enabling all-learned
admission.
