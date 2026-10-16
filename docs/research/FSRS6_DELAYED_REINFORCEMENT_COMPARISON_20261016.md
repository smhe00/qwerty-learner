# G6: Does a fixed 10-minute Delayed Reinforcement improve QWERTY Plus?

**Date:** 2026-10-16  
**Branch:** `research/fsrs6-full-model-20261016` (isolated research).  
**CI:** [shared-baseline experiment 21/21 PASS](https://github.com/smhe00/qwerty-learner/actions/runs/38859574380), [Hint-rescue sensitivity 22/22 PASS](https://github.com/smhe00/qwerty-learner/actions/runs/38859787636).  
**Implementation:** `tests/fsrs/g6-closed-loop.test.ts`; actual `ts-fsrs@5.4.2` is invoked, not an FSRS approximation. No production code changed.

## Hypothesis

Does adding one non-FSRS 10-minute delayed spelling practice **after a valid Again** improve independent recall when QWERTY's existing short-interval reinforcement still happens?

Contrast **A** (FSRS-6 r0.84, `enable_short_term=false`, no FSRS steps), **X** (identical long-term FSRS + one scheduled 10m delayed practice after Again, never scores its outcome into FSRS), and **C** (short-term enabled + native FSRS Relearning 10m; independently eligible subsequent rating changes the native card).

All three receive a **common approximate QWERTY reinforcement** following a failed canonical review, only after four intervening learning completions and without a second FSRS rating. This is **closer to production than the first G6-3 experiment**, but remains an abstract approximation of the real 3–7-word reinsertion/Hints/Acquisition/session rules.

## Simulation setup

- 125 days, 64 words, 4 synthetic personas × 5 paired seeds = **20 runs per arm and memory hypothesis**.
- Two alternative invented learning functions: spacing-sensitive versus repetition-sensitive; same 9-minute/day maximum **active** study budget and two study windows per day.
- Student recall outcomes come from a separate latent-strength process; FSRS only schedules cards. The model is not calibrated against human data.
- Independent nontraining recall probes at 1/7/30/90 days; probes don't update memory.
- **A/X/C may differ in admission cohorts, actual active minutes and reinforcement counts.** Identical maximum daily budgets are not identical realized study effort. Cohort-level percentages are not a causal estimate.

## Shared four-word reinforcement: A vs X vs C

| Memory hypothesis | Arm | 7d independent spelling | 30d independent spelling | Avg actual active minutes / 125 days | Common reinforcement attempts | Extra 10m non-FSRS practices | Native short-term rated attempts |
|---|---|---:|---:|---:|---:|---:|---:|
| Spacing-sensitive | A | 74.44% | 57.20% | 723.65 | 105.50 | 0 | 0 |
| Spacing-sensitive | X | 65.90% | 55.22% | 716.10 | 70.15 | 195.80 | 0 |
| Spacing-sensitive | C | 78.45% | 61.93% | 719.47 | 178.50 | 0 | 155.30 |
| Repetition-sensitive | A | 76.38% | 56.69% | 656.50 | 87.00 | 0 | 0 |
| Repetition-sensitive | X | 74.06% | 54.01% | 611.32 | 57.75 | 153.60 | 0 |
| Repetition-sensitive | C | 80.86% | 58.78% | 607.68 | 100.70 | 0 | 132.10 |

**Observed, for this synthetic design:**
- X vs A, 7d: **−8.54 pp** (spacing) / **−2.32 pp** (repetition).
- X vs A, 30d: **−1.98 pp** / **−2.68 pp**.
- C vs A, 7d: **+4.01 pp** / **+4.48 pp**.
- C vs A, 30d: **+4.73 pp** / **+2.09 pp**.

At these parameter choices, X executes ~154–196 extra 10m drills on average but 30–35 *fewer* common same-session reinforcement attempts; their time and queue interactions are material. It also spends fewer actual total minutes than A, so **do not claim that these experiments already compare exactly equal total learning time**. Nor is C's extra practice time or event incidence held constant with X. Native FSRS's advantage could be due to both scheduling **and** changed number, classification and timing of recalls; this experiment cannot isolate the value of w17–w19 alone.

## If the failed 10m practice is immediately followed by effective Hint remediation

**Unknown latent memory benefit** after failing X's delayed drill, represented by a fictional multiplicative *rescue gain*, applied AFTER the event's forgetting/again effect. For example +20% is an arbitrary model strength multiplier, **not 20% higher recall in a real student**.

| Hypothesis | 10m failed-attempt Hint rescue | X 7d | X 30d |
|---|---|---:|---:|
| Spacing-sensitive | 0% | 65.90% | 55.22% |
| Spacing-sensitive | 20% | 67.09% | 55.64% |
| Spacing-sensitive | 50% | 68.31% | 56.65% |
| Spacing-sensitive | 100% | 69.78% | **59.98%** |
| Repetition-sensitive | 0% | 74.06% | 54.01% |
| Repetition-sensitive | 20% | 73.67% | 55.24% |
| Repetition-sensitive | 50% | 76.09% | 55.96% |
| Repetition-sensitive | 100% | **77.66%** | 54.73% |

Baseline A at 7d/30d: spacing 74.44%/57.20%, repetition 76.38%/56.69%. Even generous modeled Hint-rescue gains do **not** make X consistently beat A at **both** observation horizons under **both** memory hypotheses. X could improve particular horizons in some assumptions; the data therefore **do not prove X universally ineffective**. The absence of real calibration blocks any production recommendation.

## Interpretation and decision boundary

1. **Do not implement fixed 10m Delayed Reinforcement as the next product feature solely for expected retention gain.** No robust value is demonstrated by these synthetic tests; repeating after a short same-session reinforcement may be redundant.
2. **Native C merits further research** because it uses FSRS short-term card states and eligible ratings, rather than adding an unscored timer. Its simulated gains are encouraging but confounded by workload and uncalibrated learner mechanics.
3. A lower-cost candidate worth testing is **conditional delayed reinforcement only when the common same-session reinforcement could not occur** (session exit / sparse queue) instead of scheduling it on every Again. It should also be compared against a simple due-first resumption, with **zero forced waiting** and no extra FSRS rating. This candidate is distinct from X and has **not yet been simulated**.
4. An apples-to-apples product conclusion requires the real Rating Gate, actual Acquisition/Hint durations, time/correctness observations and equal-realized-effort experiments, ideally calibrated against consenting users' local anonymized aggregates. In the absence of user data, keep this research-only.

## Gate

- **Research simulation unit tests:** PASS, 22/22.
- **Complete production-behavior parity:** NOT YET.
- **Real-user educational benefit:** UNKNOWN.
- **Release / merge:** BLOCKED (no modification to main/etest/master).


## Follow-up: only use the delayed practice if four-word reinforcement did not happen (G6-3d)

**CI:** [G6-3d 23/23 PASS](https://github.com/smhe00/qwerty-learner/actions/runs/38860091653).  
This candidate does **not** replace existing practice. Instead, after Again it attempts common four-word reinforcement; if the current study window closes before the shared reinforcement executes, a saved fallback task becomes due no earlier than the original Again+10m timestamp. No FSRS Rating is written. If the common reinforcement is completed, the extra task is cancelled. Research-only synthetic mechanism; exact production session-termination/recovery logic not reused yet.

| Hypothesis | Arm | 7d | 30d | Extra delayed drills per run |
|---|---|---:|---:|---:|
| Spacing | A | 74.44% | 57.20% | 0 |
| Spacing | X always | 65.90% | 55.22% | 195.8 |
| Spacing | X missed-only | 67.48% | 55.07% | 150.35 |
| Spacing | X missed-only + assumed 50% strength rescue on failure | 70.01% | 56.35% | 131.0 |
| Spacing | C native | 78.45% | 61.93% | 0 (155.3 native same-day graded attempts) |
| Repetition | A | 76.38% | 56.69% | 0 |
| Repetition | X always | 74.06% | 54.01% | 153.6 |
| Repetition | X missed-only | 72.27% | 52.28% | 128.4 |
| Repetition | X missed-only + assumed 50% strength rescue on failure | 76.33% | 54.71% | 113.35 |
| Repetition | C native | 80.86% | 58.78% | 0 (132.1 native same-day graded attempts) |

Conditional rescue reduces the number of additional repetitions (by about 24–45 per run here), but **still does not robustly exceed the shared baseline A** at both 7 and 30 days, including the favorable 50% after-failure Hint rescue assumption.

### Research decision

The incremental **fixed-time and ungraded** reminder is not currently justified as a general feature. Retain it only as a possible option for a more targeted *missed-remediation recovery* policy if future task-completion telemetry or real recall data suggests unmet demand. The scientifically meaningful next focus remains **FSRS-native Relearning with properly validated independent ratings**, not an extra unconditional timer.

Even this improved study is **not** a matched actual-realized-time clinical A/B test. The simulated strengths, word cohort admissions, practice costs, missed due dates, and native state transition counts vary by arm. Test success means algorithmic invariants and deterministic reproducibility, not proven educational effect. Production code and all release refs remain untouched.
