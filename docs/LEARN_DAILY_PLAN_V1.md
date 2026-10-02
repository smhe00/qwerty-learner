# Learn Daily Plan V1

> Status: Active / P4 CLOSED
>
> Policy version: `learn-daily-plan-v1`

## Purpose

P4 converts Learn's queue state and observed effort into one daily workload
plan. P3 decides the memory-quality-based new-word quota; P4 decides how much
of that remaining quota is reasonable after today's Review workload.

P4 does **not** change Rating Gate, scheduler intervals, lifecycle, or Due
priority.

## Inputs

```text
P2 LearnStatsSnapshot
  ├─ current Due
  ├─ difficult Due
  ├─ today acquired
  ├─ today active seconds
  ├─ recent Review median seconds/word
  └─ recent Acquisition median seconds/word

P3 LearnAcquisitionQuotaDecision
  ├─ daily new-word target
  └─ remaining daily new words
```

## Time model

Recent personal telemetry is preferred.

A record's active time is reconstructed from its attempt telemetry:

```text
Σ(start latency + active attempt duration)
```

Background pauses are not intentionally added.

For planning, the recent 30-day median is used because it is robust to isolated
slow attempts.

Fallbacks:

```text
Review       15 seconds / word
Acquisition  30 seconds / word
```

## Soft workload budget

V1 soft Acquisition budget:

```text
20 active minutes / day
```

It is deliberately asymmetric:

```text
Due Review > budget
→ still Review all Due

budget exhausted
+ Due == 0
→ admit no more new words
```

The budget is therefore a new-work admission guardrail, not a hard study timer.

## Planning equation

```text
projectedBeforeNew
  = todayActive
  + currentDue × reviewSecondsPerWord

newCapacityByWorkload
  = floor(
      max(0, softBudget - projectedBeforeNew)
      / acquisitionSecondsPerWord
    )

plannedRemainingNew
  = min(
      P3.remainingDailyNewWords,
      newCapacityByWorkload
    )
```

If Due exists:

```text
allowedNewWordsNow = 0
action = review-due
```

Otherwise:

```text
plannedRemainingNew > 0
→ action = acquire-new

plannedRemainingNew == 0
→ action = complete
```

## Difficult Due

A currently Due ACTIVE word is counted as difficult when:

```text
lastOutcome ∈ {Again, Hard}
OR
(lapseCount > 0 AND cleanStreak == 0)
```

This is a workload descriptor, not a new lifecycle or scheduler state.

## Evidence separation

All Learn activity with usable telemetry contributes to today's spent time.

However only primary Review/Acquisition samples are used to estimate the
per-word medians. Reinforcement and training therefore:

- count as real time spent;
- do not become a Review quality metric;
- do not inflate Rating Gate samples.

## Invariants

1. P4 never defers or drops a Due Review because of the soft budget.
2. P4 can only reduce new-word admission relative to P3.
3. P4 never increases the P3 quota.
4. Re-entering Learn cannot reset spent-time evidence.
5. Typing activity cannot consume the Learn workload budget.
6. Rating-null Learn activity consumes time but cannot improve memory-quality
   signals.
7. The same pure plan function feeds both the resolver and statistics UI.
8. P4 does not mutate scheduler or lifecycle state.

## Verification

Closure requires:

- fallback-time planning tests;
- personal-median planning tests;
- heavy-Due / difficult-Due tests;
- exhausted-budget tests;
- reinforcement-time isolation tests;
- browser E2E showing 15 measured Review minutes reduce 20 candidate new words
  to 10;
- formal Review model;
- production build;
- production navigation smoke.
