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

The hint system has three escalation paths:

1. **Automatic Hint 0** — during the canonical cold probe, if the first wrong
   position of a spelling attempt is the same position twice, Hint 0 appears
   automatically at that position.
2. **Automatic level escalation** — once Hint 0/1/2 is active, two failed
   spelling attempts at the current Hint level advance to Hint 1/2/3
   respectively. The per-level failure counter resets after every advance.
3. **Manual escalation** — at input position zero, pressing **Space** means
   “give me the next hint.”

If a prior spelling attempt exists, manual Hint 0 targets the first wrong
position from the latest failed attempt. If there is no prior error evidence,
manual Hint 0 falls back to position 0.

Space is a hint-control key only while a stronger hint exists.

## 2. Hint ladder

```text
COLD
  meaning visible
  English hidden
  audio off
  phonetic hidden
        |
        | same first-wrong position twice
        | OR Space at input position 0
        v
HINT 0
  correct letter at target error position visible in red
  audio off
  phonetic hidden
        |
        | Space at input position 0 OR 2 failed attempts at Hint 0
        v
HINT 1
  same target-position letter remains visible
  pronunciation enabled/played
  phonetic visible
        |
        | Space at input position 0 OR 2 failed attempts at Hint 1
        v
HINT 2
  deterministic partial spelling
  pronunciation available
  phonetic visible
        |
        | Space at input position 0 OR 2 failed attempts at Hint 2
        v
HINT 3
  full English answer visible
  pronunciation available
  phonetic visible
  MUST type the full word correctly
```

For Hint 2 the deterministic V1 mask shows positions `0,2,4,...` **plus the
Hint 0 target position**, so cue strength never decreases.

Example, if `cancel` was repeatedly misspelled first at index 3:

```text
cold:   ______
hint0:  ___c__   <- target c is red
hint1:  ___c__   + pronunciation + phonetic
hint2:  c_nce_   <- deterministic partial cue retains index 3
hint3:  cancel
```

The first-wrong position is attempt-local: because a failed attempt stops at
its first wrong key, the position is unambiguous.

Position evidence is cumulative across the word attempt sequence. Any spelling
position that reaches two errors is added to a forced-reveal set and remains
visible in Hint 0, Hint 1, and Hint 2. Hint 3 already reveals the full word.
This position-level rule is independent of the per-Hint-level two-failure
counter used for automatic escalation.

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

### Automatic Hint 0 memory semantics

Automatic Hint 0 does **not** set `coldProbeSurrendered`.

It records spelling evidence instead:

```text
same first-wrong position twice
→ auto Hint 0
→ targeted training cue
```

The automatic cue must not manufacture an `Again` event merely because the
UI supplied a hint. The original independent cold-probe errors remain in raw
telemetry/classification evidence and later Rating Gate logic decides the
scheduler-compatible result.

The position-specific cue is training evidence; later clean typing under the
cue must not be interpreted as an unaided clean retrieval.

## 5. Persisted hint trace

`LearningContextV1.reviewHint` stores:

```ts
{
  version: 1
  maxLevel: 0 | 1 | 2 | 3
  coldProbeSurrendered: boolean
  advanceCount: 1 | 2 | 3 | 4
  hintPosition?: number
  autoHint0Triggered?: boolean
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
cold ──Space────────────────────────────→ h0
  │
  └──same first-wrong position twice───→ h0
                                          ↓
                                          h1 → h2 → h3
```

Automatic escalation is bounded at every non-terminal stage:

- `cold → h0` requires the same first-wrong position twice;
- `h0 → h1`, `h1 → h2`, and `h2 → h3` each require two failed attempts
  at the current Hint level;
- every stage transition resets the per-level failure counter.

Hint 3 has no automatic or manual escalation edge. No backward transition
exists.

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
4. one cold-probe wrong attempt does not auto-trigger Hint 0;
5. the same first-wrong position twice auto-triggers Hint 0 exactly once;
6. any spelling position wrong twice is forced visible in Hint 0/1/2;
7. two failed attempts at Hint 0 automatically enter Hint 1;
8. two failed attempts at Hint 1 automatically enter Hint 2;
9. two failed attempts at Hint 2 automatically enter Hint 3;
10. every Hint transition resets the per-level failure counter;
11. manual Hint 0 uses the latest first-wrong position when available;
12. Hint 1 introduces audio + phonetic without removing prior forced cues;
13. Hint 2 exposes deterministic partial spelling while retaining forced cues;
14. Hint 3 exposes the full answer and never auto-escalates;
15. Hint 3 blocks skip/navigation and requires correct full typing to finish;
16. persisted hint trace records target position and whether Hint 0 was automatic;
17. cold surrender produces `Again` even when final copy is clean;
18. bounded formal enumeration proves strict hint-variant descent;
19. exhaustive target-position checks prove Hint 0 → Hint 1 → Hint 2 → Hint 3 cue monotonicity.

## 10. Next gate

After this interaction layer is verified in production, the next change is to
make `decideReviewRating()` the sole scheduler mutation gate for all Review
paths, including `null → bounded retry/defer`, before enabling all-learned
admission.
