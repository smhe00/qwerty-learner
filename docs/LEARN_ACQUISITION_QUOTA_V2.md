# Learn Acquisition Quota V2

> **Status: Historical / Superseded by [LEARN_ACQUISITION_QUOTA_V3.md](./LEARN_ACQUISITION_QUOTA_V3.md).**
>
> Policy version: `learn-acquisition-quota-v2`
>
> Interaction Strain observer: `learn-interaction-strain-v2`

## Purpose

V2 controls how many UNSEEN words may enter Learn Acquisition each day.

It is deliberately a **bounded workload controller**. It may slow new-word
admission when memory quality or recent interaction strain is weak, but it
cannot increase work above the global high tier.

It does not modify:

- Rating Gate;
- scheduler intervals;
- lifecycle semantics;
- Review priority;
- Independent admission criteria.

## Base quota tiers

```text
low     = 5 new words/day
medium  = 10 new words/day
high    = 20 new words/day
```

The memory-quality decision uses:

- 30-day eligible Again rate;
- today's valid Cold Probe pass rate.

### Low

Select low if either mature signal is weak:

- at least 8 eligible 30-day ratings and Again rate >= 35%; or
- at least 5 valid Cold Probes today and pass rate < 60%.

### Medium

If low did not match, select medium if:

- at least 8 eligible 30-day ratings and Again rate >= 20%; or
- at least 5 valid Cold Probes today and pass rate < 80%.

### High

Otherwise select high.

Fewer than 8 eligible 30-day ratings remain bootstrap-high unless today's
Cold Probe evidence already justifies throttling.

## Interaction Strain safety cap

Interaction Strain is a one-way safety controller layered on top of the
memory-quality tier.

```text
strain = recovery
→ quota tier <= low

strain = elevated
+ memory tier = high
→ quota tier <= medium

strain = low
→ never raises the memory-quality tier
```

Therefore recent interaction comfort alone cannot create more new work.

Strain V2 uses a bounded EWMA observer plus hysteresis. Current transition
thresholds are documented in `LEARN_ARCHITECTURE_V1.md` and verified by the
Learn Control Stability Gate.

## Due-first rule

```text
Due > 0
→ allowedNow = 0
```

Existing long-term obligations always outrank new-word admission.

When Due is zero:

```text
remainingDailyNewWords
  = min(
      dailyTarget - acquiredToday,
      unseenWords
    )
```

The P4 Daily Plan may reduce this further based on today's active-time budget.
P4 can never raise the V2 quota.

## Invariants

1. Target daily new words is always in `{5, 10, 20}`.
2. `allowedNow` is always between 0 and 20.
3. Due Review always pauses new Acquisition.
4. Strain may only reduce, never increase, the memory-quality quota tier.
5. Typing records cannot affect Learn strain/quota.
6. Invalid/non-cold training evidence cannot improve the Cold Probe signal.
7. Quota decisions do not mutate scheduler or lifecycle state.
8. Re-entering Learn cannot reset today's acquired-word count.

## Stability and efficiency

The controller is covered by the Learn Control Stability Gate:

- actuator saturation;
- due-first backlog behavior under bounded burst arrivals;
- closed-loop virtual learner regression;
- efficiency guardrails against excessive workload suppression.

The current 5/10/20 and threshold values are engineering Alpha parameters.
They are not claimed to be universal psychological constants.

Automatic per-user parameter calibration is intentionally not enabled in Alpha 1.
