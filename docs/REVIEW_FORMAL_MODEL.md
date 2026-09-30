# Review Formal Model v1

> Status: active verification contract for `product/main`.
>
> This document defines the finite abstraction that the Review Gate exhaustively
> model-checks. It is intentionally narrower and stronger than ad-hoc UI tests.

## 1. Why this exists

Review now combines:

- per-key input;
- retry-after-error;
- loop-word training;
- same-session reinforcement;
- adaptive targeted masks;
- diagnostic audio withdrawal probes;
- asynchronous raw-record persistence;
- derived scheduler persistence;
- queue cursor persistence.

These transitions must not be distributed as independent React conditions. The
production decision functions live in `src/review/machine.ts`; the formal test
executes those same functions over a bounded exhaustive state space.

## 2. State variables

### Attempt input state

```text
inputLength
targetLength
hasWrong
isFinished
automaticAudioEnabled
automaticAudioAlreadyPlayed
```

### Review progression state

```text
queue[]
currentIndex
currentExerciseCount
loopWordTimes
priorAccumulatedWrongCount
attemptWrongCount
currentReinforcementGap
attemptReinforcementGap
```

### Exercise condition state

```text
purpose
source
audio
meaning
phonetic
letters.mode
visiblePositions[]
maskedPositions[]
probeDimension
policyVersion
```

## 3. Production transition functions

```text
decideWordInput()
shouldPlayAutomaticPronunciation()
decideReviewProgress()
chooseTargetedMaskPlan()
chooseAudioWithdrawalShadow()
chooseNextExerciseShadow()
```

React may execute returned commands, but must not independently recreate their
decision rules.

## 4. Safety invariants

The model checker asserts:

1. **Input bound** — no accepted key has index < 0 or index >= targetLength.
2. **Terminal input lock** — after targetLength is reached, extra keys cannot
   become typo evidence for the completed word.
3. **One automatic audio play per attempt** — automatic playback cannot be
   emitted twice before a retry/new attempt boundary.
4. **Total progression decision** — every valid Review completion state produces
   exactly one of: LOOP_CURRENT, ADVANCE, FINISH.
5. **Monotonic cursor** — ADVANCE moves exactly one queue position forward.
6. **Loop locality** — LOOP_CURRENT never changes queue cursor.
7. **Finish validity** — FINISH is allowed only at the final queue item, after
   loop obligations are satisfied and with no new reinforcement insertion.
8. **Reinforcement bounds** — insertion occurs strictly after the current item
   and within the session queue.
9. **Mask bounds** — targeted-mask indexes are inside the word and visible/masked
   sets are disjoint.
10. **Single adaptive action** — spelling remediation wins arbitration over an
    audio diagnostic probe; the two are never combined in one exercise.
11. **Single-variable audio probe** — audio withdrawal preserves meaning,
    phonetic and letter conditions.

## 5. Liveness properties

Under the explicit assumption that the user eventually completes presented
attempts:

1. any finite clean Review queue reaches FINISH;
2. one finite failure/reinforcement followed by clean attempts also reaches
   FINISH;
3. derived scheduler persistence is **not a prerequisite for UI progression**.

The UI progression boundary is:

```text
final correct input
  -> raw WordRecord captured (SSOT)
  -> Review progression released
  -> derived ReviewWordState persistence may continue asynchronously
```

This prevents an IndexedDB scheduler/profile update from leaving a completed
word visually stuck.

## 6. Bounded exhaustive domain

CI explores all combinations in these finite ranges:

- target length: 0..12;
- input length: 0..target+2;
- Review queue length: 1..5 for full transition cross-product;
- loop count: 1..3;
- wrong counts: 0..2 per modeled component;
- reinforcement gap: 3..7;
- targeted-mask word length: 1..12;
- cue booleans for audio-probe condition preservation.

The cross-product is exhaustive **inside this abstraction**. It is not a proof
of the browser, React scheduler, IndexedDB implementation or JavaScript engine.

## 7. Runtime/UI boundary

The following remain integration obligations rather than mathematically proven
properties:

- React invokes the transition commands it receives;
- IndexedDB eventually resolves or rejects raw record writes;
- browser audio APIs behave as specified;
- deployment serves the intended bundle.

For that reason Review Gate still runs lint/build/domain tests in addition to
formal model checking, and production releases retain browser acceptance gates.

## 8. Change-control rule

Any new Review action or condition must:

1. be represented in the formal state/action vocabulary;
2. declare its invariants;
3. extend the exhaustive checker;
4. pass Review Gate before activation.

No future adaptive policy should be added only as a React `if` branch.


## 9. Browser execution gate

The formal model proves the production decision functions inside the bounded
abstraction. A separate Chromium integration test seeds a real three-word Review
session and verifies the React/Jotai/IndexedDB execution boundary:

```text
cancel -> analyse -> numerous -> FINISHED
```

The test deliberately sends an extra key immediately after the final character
of the first word and verifies that no out-of-range typo is persisted.

A release therefore needs both:

```text
formal model checker PASS
+
multi-word browser execution PASS
```


## 10. Keyboard-listener continuity invariant

The real-browser gate exposed a lifecycle property outside the pure transition
model: remounting WordComponent on every Review index change also remounted the
global keydown listener. The next word could already be visible before the new
effect installed the listener, causing fast leading keystrokes to disappear.

The corrected lifecycle rule is:

```text
queue index changes
    -> same WordComponent / same keyboard listener
    -> synchronous per-word attempt reset in layout lifecycle

explicit same-word loop reload
    -> reloadKey changes
    -> component remount allowed
```

No time-based debounce is used. Browser progression is the executable
integration proof for this UI-boundary invariant.


## 11. Pure-reducer / atomic-persistence invariant

The browser trace proved that a completed second word could have its raw
WordRecord persisted while the live queue cursor stayed unchanged. The remaining
architectural hazard was an external Jotai write executed from inside the
Typing reducer through `NEXT_WORD.payload.updateReviewRecord`.

That pattern is prohibited.

The production rule is now:

```text
Review completion
  -> decideReviewProgress()            pure
  -> projectReviewProgress()           pure
  -> one atomic ReviewRecord write     effect boundary
  -> pure Typing reducer command
```

The reducer no longer calls external persistence callbacks. The formal checker
exhaustively verifies that the projected persistent queue/index matches each
bounded transition decision.
