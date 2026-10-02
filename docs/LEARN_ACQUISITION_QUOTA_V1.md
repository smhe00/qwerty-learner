# Learn Acquisition Quota V1

> Status: Active / P3 CLOSED
>
> Policy version: `learn-acquisition-quota-v1`

## Purpose

P3 converts Learn statistics into a conservative feedback controller for new
word admission. It changes only **how many UNSEEN words may enter Acquisition**.
It does not change Rating Gate, scheduler intervals, lifecycle semantics, or
Review priority.

## Decision

```text
Due > 0
  -> allowedNow = 0

otherwise
  -> choose daily target 5 / 10 / 20
  -> remaining = target - acquired today
  -> cap by UNSEEN
  -> allowedNow = remaining
```

### Low — 5/day

Any mature signal:

- 30-day Again rate >= 35%; or
- at least 5 valid Review Cold Probes today and pass rate < 60%.

### Medium — 10/day

If low did not match:

- 30-day Again rate >= 20%; or
- at least 5 valid Review Cold Probes today and pass rate < 80%.

### High — 20/day

Otherwise.

Fewer than 8 eligible 30-day ratings keep the bootstrap target at 20 unless a
5-probe current-day Cold Probe signal already justifies throttling.

## Signal validity

Cold Probe quality uses only Review records whose Rating Gate result is
`eligible=true`. Training, reinforcement, diagnostic-null and
attention-uncertain attempts cannot improve the Cold Probe pass signal.

## Invariants

1. Due Review always outranks Acquisition.
2. Re-entering Learn cannot reset today's quota.
3. Acquisition cannot exceed UNSEEN.
4. The controller is deterministic and pure.
5. Typing records cannot affect the controller.
6. The controller cannot mutate scheduler/lifecycle state.
7. P3 can only reduce admission workload relative to the 20-word bootstrap
   ceiling; it cannot raise the ceiling beyond 20.

## Verification

P3 closure requires domain tests for all tiers and quota exhaustion, explicit
invalid-evidence tests, browser coverage for the five-word weak-performance
path, Review formal model, production build and production navigation smoke.
