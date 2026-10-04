# Learn Acquisition Quota V3

> Status: Active
>
> Policy version: `learn-acquisition-quota-v3`
>
> Interaction Strain observer: `learn-interaction-strain-v2`

## Purpose

V3 controls the number of **first-time word introductions** entering Learn Acquisition each day.

The key correction from V2 is that workload and learning outcome are separate:

```text
introducedWordsToday
= first Exposure / first Acquisition encounter
= workload control input

acquiredWordsToday
= clean + unaided + spacing-valid Independent admission
= learning outcome metric
```

A word consumes daily new-word quota when it is first introduced, even if it later needs cross-session spacing before admission.

This prevents the historical loop:

```text
19/20 admitted
→ introduce 1 word
→ spacing insufficient
→ still 19/20 admitted
→ introduce another fresh word
→ ...
```

## Base quota tiers

```text
low     = 5 first introductions/day
medium  = 10 first introductions/day
high    = 20 first introductions/day
```

The tier decision still uses:

- 30-day eligible Again rate;
- today's valid Cold Probe pass rate;
- Interaction Strain as a one-way safety cap.

## Daily quota equation

```text
remainingDailyNewWords
  = min(
      targetDailyNewWords - introducedWordsToday,
      trulyUnseenWords
    )
```

`trulyUnseenWords` excludes:

- ACTIVE words;
- EXCLUDED words;
- words already introduced into Acquisition but not yet admitted.

Therefore a spacing-deferred word cannot be counted as both pending work and a fresh candidate.

## Pending Acquisition is not fresh workload

Pending acquisition completion is independent from fresh quota.

Priority after Due Review:

```text
ready pending Acquisition
    ↓
fresh introductions allowed by quota
    ↓
waiting spacing-deferred Acquisition
```

A spacing-deferred word whose minimum cross-session delay has expired may resume directly at Independent even when:

```text
remainingDailyNewWords = 0
```

because it is completing already-introduced work, not adding new cognitive load.

While the delay has not expired:

- the pending word remains blocked from fresh selection;
- it retains its acquisition state;
- other truly unseen words may still be introduced only if fresh quota remains.

## Admission boundary

Quota never decides mastery.

A persistent ACTIVE state may be created only by:

```text
Independent
+ clean
+ no Hint
+ independent retrieval evidence
+ spacing-eligible
```

Exposure, Supported Recall, and spacing-insufficient Independent attempts remain scheduler-neutral.

Bootstrap/rebuild must also enforce the same rule. Historical Review records created before a valid phased-admission event are treated as contamination and must not create or advance scheduler state.

## Due-first rule

```text
Due > 0
→ fresh allowedNow = 0
```

Existing long-term Review obligations still outrank new introductions.

Pending Acquisition state is preserved while Due work is handled.

## Interaction Strain safety cap

The V2 strain controller remains unchanged:

```text
recovery
→ quota tier <= low

elevated + high memory tier
→ quota tier <= medium

low
→ never raises quota
```

## Invariants

1. Daily target is always one of `5 / 10 / 20`.
2. `introducedWordsToday <= target` for quota-owned fresh work.
3. `acquiredWordsToday <= cumulative introduced words`.
4. A pending word cannot be selected again as fresh.
5. A previously introduced but non-admitted word cannot be selected as fresh.
6. Fresh quota does not block a ready spacing-deferred resume.
7. Exposure/Supported/spacing-insufficient evidence cannot create ACTIVE.
8. Review events before valid phased admission cannot affect scheduler or Review-quality statistics.
9. Due Review remains higher priority than fresh introduction.
10. Typing remains isolated from Learn quota/admission state.

## Regression origin

V3 was introduced after a real local backup exposed a deterministic one-word limit cycle:

```text
19/20
→ singleton fresh Acquisition
→ spacing-insufficient
→ still 19/20
→ another singleton fresh Acquisition
```

The repository now contains a dedicated backup-derived regression gate covering quota consumption, pending resumption, candidate blocking, premature ACTIVE repair, and Review contamination filtering.
