# Canonical Review Probe V1

> Status: production rollout contract
>
> Parent contracts:
>
> - `REVIEW_RATING_CONTRACT_V1.md`
> - `REVIEW_STATE_MACHINE_V2.md`

## 1. Objective

Every newly created long-term Review item must begin with one comparable,
scheduler-eligible memory test. Ordinary learning UI settings must not silently
change what the Review scheduler is measuring.

V1 canonical skill:

```text
meaning
  ↓
independent orthographic recall
  ↓
typed English word
```

## 2. Canonical presentation

Every new Review session freezes this plan for each initial word:

```text
purpose        = probe
source         = adaptive-policy
probeDimension = none

meaning        = visible
letters        = all-hidden
phonetic       = hidden
audio          = none
```

Policy version:

```text
canonical-review-probe-v1
```

The plan overrides ordinary-learning preferences for the cold probe.

Examples of settings that cannot change the cold probe:

- normal mode showing the full word;
- Word Dictation off;
- automatic pronunciation on;
- phonetic display on;
- translation display off.

## 3. UI execution boundary

The frozen `ExerciseConditionV1` is authoritative for adaptive Review
presentation.

The UI must therefore obey it for:

- letter visibility;
- translation visibility;
- phonetic visibility;
- automatic audio.

Explicit user assistance remains possible. For example, revealing the answer or
requesting pronunciation is recorded as assistance and makes that observation
ineligible for long-term scheduling under the Rating Contract.

## 4. Historical adaptive plans

A historical targeted-mask or audio-withdrawal shadow cannot replace the next
session's canonical cold probe.

The order is:

```text
new Review session
    ↓
canonical cold probe
    ↓
raw evidence
    ↓
optional remediation/diagnostic proposal
    ↓
later same-session exercise
```

This prevents a training scaffold from being mistaken for the long-term memory
measurement.

## 5. Manual pronunciation

Canonical `audio = none` disables automatic pronunciation.

If the user explicitly requests pronunciation, the raw learning context records
it and Review evidence includes:

```text
requested-audio-cue
retrievalValidity = assisted
```

The rating gate must return:

```text
rating = null
reason = assisted-retrieval
```

when it is activated in the live scheduler.

## 6. Formal invariants

The verification suite checks:

1. canonical presentation is invariant to all ordinary baseline cue booleans;
2. canonical plan always has letters hidden;
3. canonical plan always has audio off;
4. meaning is visible;
5. phonetic cue is hidden;
6. the probe dimension is none;
7. requested pronunciation creates assisted evidence;
8. assisted evidence cannot reach the scheduler rating interface.

## 7. Browser acceptance

A production-browser Review flow must prove:

```text
session plan = canonical-review-probe-v1
+
rendered word begins as underscores
+
data condition = canonical
+
automatic pronunciation count = 0
+
persisted WordRecord.exerciseCondition = canonical
```

This bridges the pure plan model to React rendering and IndexedDB persistence.

## 8. Rollout boundary

This phase activates canonical presentation for newly created Review sessions.

It does not yet make `decideReviewRating()` the sole live scheduler gate.
The next gated rollout is:

1. persist/derive the live item attempt role;
2. call `decideReviewRating()` after the cold probe;
3. mutate scheduler state only for eligible ratings;
4. make null outcomes follow the bounded invalid-retry/defer machine;
5. verify browser scenarios for Again/Hard/Good/Easy/null;
6. then enable all-learned admission.
