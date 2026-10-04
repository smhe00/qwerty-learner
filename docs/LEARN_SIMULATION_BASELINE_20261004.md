# Learn Simulation Baseline — 2026-10-04

## Status

Synthetic longitudinal simulation is operational on `product/main`.

This report records the first policy sweep. The numbers are **simulation results, not measured real-user learning outcomes**.

No production Learn parameter is changed by this report.

## Setup

- 4 learner personas:
  - strong-memory
  - balanced
  - weak-memory
  - high-fatigue
- 3 deterministic seeds per persona
- 120 simulated days
- 240-word synthetic dictionary
- production `buildLearnStatsSnapshot()`
- production `decideDailyAcquisitionQuota()`
- production `scheduleBasicReview()`
- production `countLongTermMasteredWords()`

## Candidate policies

### baseline

Review intervals:

```text
1, 3, 7, 14, 30, 60, 120, 180 days
```

Daily new-word quota:

```text
low=5, medium=10, high=20
```

### retention-first

Review intervals:

```text
1, 2, 5, 10, 21, 45, 90, 150 days
```

Daily new-word quota:

```text
low=4, medium=8, high=16
```

### load-first

Review intervals:

```text
1, 4, 10, 21, 45, 90, 150, 240 days
```

Daily new-word quota:

```text
low=5, medium=10, high=20
```

## First sweep result

| Candidate | Synthetic score | 30d retention | Mastery rate | Lapse rate | Mean daily interactions | Max due backlog |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 0.4110 | 53.3% | 64.4% | 38.3% | 9.48 | 25 |
| retention-first | 0.4091 | 57.2% | 57.7% | 36.0% | 8.30 | 23 |
| load-first | 0.3953 | 53.2% | 61.3% | 40.1% | 9.65 | 37 |

## Interpretation

### Baseline remains the current production recommendation

Under the provisional synthetic objective, baseline is narrowly first.

The margin over retention-first is small, so this is not evidence that the current production policy is globally optimal.

### Retention-first shows a real tradeoff

Compared with baseline, retention-first:

- improves simulated 30-day retention;
- lowers simulated lapse rate;
- lowers daily interaction load;
- but materially reduces long-term mastery rate over the same 120-day horizon.

The lower workload is mainly caused by the reduced acquisition quota, not only by the shorter review intervals.

Therefore interval and quota effects must be separated in future sweeps.

### Load-first is currently dominated

The initial load-first candidate does not actually reduce total daily interaction load in this closed loop.

Longer intervals create more lapses/backlog and do not compensate enough through fewer scheduled reviews.

This candidate should not be promoted.

## Debugging lesson

An early test incorrectly assumed:

```text
shorter intervals -> higher total workload
```

while simultaneously changing daily acquisition quota.

The sweep showed the opposite because quota reduction dominated the closed-loop workload.

The regression test was corrected to isolate interval direction while holding quota constant.

This is exactly the type of interaction the longitudinal simulator is intended to expose.

## Next calibration step

Before production tuning, synthetic personas should be fitted against real Qwerty Plus traces using the new Trace Signature:

- median first-key latency;
- hint-use rate;
- Review success rate;
- Acquisition attempts per admitted word;
- daily interaction distribution;
- Review success by elapsed interval bucket.

After calibration, rerun the policy sweep with:

1. fitted persona distributions;
2. held-out real-trace validation;
3. interval-only sweep;
4. quota-only sweep;
5. joint interval/quota sweep.

## Production decision

**Keep current production scheduler and quota parameters unchanged for now.**

The simulation infrastructure is mature enough to generate hypotheses, but the persona distribution is not yet calibrated strongly enough to justify a policy change.
