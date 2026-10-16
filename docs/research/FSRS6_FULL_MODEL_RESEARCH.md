# FSRS-6 Full-Model Research (G6) — QWERTY Plus

**Status:** Research / offline-only. **Owner branch:** `research/fsrs6-full-model-20261016`.  
**Base:** `product/main`, 2026-10-16. **Production state:** FSRS-6, `ts-fsrs@5.4.2`, target retention 0.84, no fuzz, `enable_short_term=false`, both steps empty.  
**Rule:** No modifications to `product/main`, `master`, `edgeone-test`, release configuration, persistent user data, or cloud API in this stage.

## 1. Research question

Can QWERTY Plus use **real FSRS-6 short-term stability updates** and **native Learning/Relearning card state** to improve durable, independent *meaning → English spelling* recall at equal (or lower) effective learner effort, while retaining QWERTY's Acquisition, hint, recovery, daily/session and cloud-safety contracts?

An extra 10-minute timer that never updates FSRS is **delayed reinforcement**, not native FSRS Relearning; it is *not* the target of this work.

## 2. Ground truth and current mismatch

Production adapter: `src/review/fsrs/strategy.ts`.  
Durable FSRS reconstruction: `src/review/fsrs/active.ts`.  
Durable write source: `src/review/repository.ts`.  
User-skill rating: `src/review/state-machine.ts` / `src/review/evidence.ts`.  
Current teaching states: `src/learn/acquisition.ts` and `src/learn/session.ts`.  
Current same-session reinforcement: `src/review/session.ts` and `src/review/progression.ts`.  
Existing simulator: `tests/simulation/learner-simulator.ts`.

1. Only long-term, scheduler-eligible Review events drive production FSRS state; Acquisition, practice, hint-assisted work, and diagnostic work are excluded.
2. Production persistent `Fsrs6SchedulerState` stores D, S and parameterSetId, not the full `ts-fsrs` card (state, learning_steps, reps, lapses, elapsed/scheduled days and last_review). The state is currently reconstructed by replay; advancing native step state requires **complete, versioned replayable events** or a verified persisted card snapshot.
3. `completeLearningAcquisition()` schedules a first Review at +24h. A terminal-probe path may schedule +4h. These are QWERTY policies, not `learning_steps`.
4. Current Review reinserts a difficult word after 3–7 intervening words. This reinforcement is not an independent spaced Review and should **not** silently become FSRS Good.
5. `ts-fsrs` learning/relearning steps define fixed due offsets; short-term stability calculations can additionally use w17–w19. Do **not** claim those weights optimize the 1m/10m offsets.
6. The `ts-fsrs` *library release version* (5.4.2) is distinct from the *algorithm family* (FSRS-6); pin both for repeatability.

Reference: https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm  
Reference: https://github.com/open-spaced-repetition/ts-fsrs/tree/main/packages/fsrs

## 3. Isolated candidate matrix

Keep `request_retention=0.84`, default FSRS-6 weights, fuzz disabled, and the **same validated rating events** across candidates. Record for each event: `state`, `learning_steps`, `difficulty`, `stability`, `last_review`, `due`, `reps`, `lapses`, and parameter-set identity.

| ID | FSRS short-term | Learning steps | Relearning steps | Purpose |
|---|---|---|---|---|
| A | false | [] | [] | Exact production baseline |
| B | true | [] | [] | Isolate model's short-term update logic |
| C | true | [] | ['10m'] | Native relearning after lapse |
| D | true | ['1m','10m'] | ['10m'] | Full native learning and relearning |

**Important:** Candidate A/B with the same human event sequence is a scheduler/model comparison, not a realistic workload comparison. C/D introduce additional opportunities for recall and therefore require a *closed-loop learner simulation with equal time budgets* to make efficacy claims. No result from the candidate matrix alone proves an improvement in learning.

## 4. Two separate integrations to assess

**Path S (smallest credible integration):** Keep QWERTY's exposure/guidance/assistance unchanged. Admit **only genuinely independent, scheduled short-term recalls** as durable, classified FSRS events, preserving event time and source ID. Feed them into FSRS-6 short-term dynamics. Do not upgrade masked/hinted typing into memory ratings. Prove that `enable_short_term=true` actually uses w17–w19 for the chosen events by comparing returned card S and due.

**Path N (native state-machine integration):** Use FSRS `State.Learning`/`State.Relearning`, `learning_steps` and `relearning_steps` for scheduling. QWERTY retains the exercise UI and Hint design, but one authoritative scheduler owns *due, step, card state*; QWERTY retains its daily workload/service policy. A native `Relearning` event must be durably identified as such and replay to precisely the same FSRS card.

For either path, the following is **not** acceptable: applying a Review Again to FSRS and treating every immediately assisted repeat as FSRS Good; this falsely inflates memory strength.

## 5. Persistence and single-owner contract (do not implement before Gate G6-2)

- Define a canonical append-only event with `eventId/sourceRecordId`, `dict+word+workspace`, `occurredAt`, `schedulerEligible`, `rating`, `eventRole` (long-term/short-term/assisted-training), `ratingPolicyVersion`, `parameterSetId` and ordered event tie-break.
- Ignore duplicate event IDs and reject cross-account/anonymous workspace contamination. One event may update a card at most once; retry, refresh, sync and import must preserve this.
- Encode the native card as **derived replay state** or persist a full versioned snapshot alongside the event log with replay-check hashes. Storing only D/S is insufficient for native FSRS learning steps.
- At any instant there must be exactly **one due owner** for a word. Existing `reviewWordStates.nextReviewAt` may remain the index, but the authoritative due must be derived from the same card/event state.
- Clock source, timezone boundaries, future/retrograde timestamps, long offline gaps and cloud workspace transitions require dedicated invariants.
- Failure to complete a 10-minute step must **never block today's Session completion**. An overdue event is considered on next study entry; a simultaneously due longer-term independent probe has an explicit precedence policy to prevent pre-test contamination.
- Version `parameterSetId` and schema; no silent reinterpretation of current r0.84 events. Maintain reversible offline experiments and no destructive migration.

## 6. Execution gates

- **G6-0 — baseline and exact library behavior:** Lock the current source/parameter set. Run `tests/fsrs/g6-short-term-research.test.ts` against `ts-fsrs@5.4.2`. Capture per-event native state, due and D/S. Independently verify the package's handling of New, Learning, Review and Relearning, including Again/Hard/Good/Easy and step-skipping edge cases.
- **G6-1 — rating eligibility:** Prepare timelines including canonical cold recalls, assisted copying, spell remediation, focus interruption, ESC failure, and same-day independently scheduled probes. Assert training/diagnostic attempts never advance FSRS. Measure classification disagreements rather than assuming perfect rating.
- **G6-2 — state and persistence:** Design a versioned, idempotent FSRS card/replay adapter, unit tests for refresh, session restore, same-time ordering, missing records, cloud import/export and concurrent workspace events. *Research branch only.*
- **G6-3 — closed-loop counterfactual simulation:** Extend the existing independent latent-strength learner. Paired seeds/personas, identical learning opportunity budgets, realistic minute-level time/word durations and next-day/7d/30d/90d probes. Distinguish model calibration from observed retention.
- **G6-4 — empirical confirmation:** On opt-in/privacy-respecting real data only, compare calibration (ECE/Brier), recall separation (AUC), correct words per active minute, 1/7/30/90-day independent spelling, P95 daily workload, backlog, tail completion, and frustration proxies. Data insufficiency means *inconclusive*, not PASS.
- **G6-5 — rollout decision:** Publish a written A/B/C/D report, exact regression commands, risk assessment and rollback plan. Do not merge any production scheduler change without an explicit product-owner decision.

Suggested **hypothesis**, not an observed result: path S may capture useful same-day memory evidence at lower integration cost than path N, while C might improve forgotten-word recovery. Either may also increase workload or create uncalibrated memory claims.

## 7. Initial experiment execution

Research test (not part of release Gate yet):

```bash
mkdir -p .diagnostic
npx esbuild tests/fsrs/g6-short-term-research.test.ts --bundle --platform=node --target=node20 --format=esm --outfile=.diagnostic/g6-short-term-research.test.mjs
node --test .diagnostic/g6-short-term-research.test.mjs
```

The test prints deterministic traces from the **actual pinned library** and checks replay repeatability and eligibility filtering. It is an exploratory probe, **not** a retention efficacy result. Existing production tests and models remain the release reference.

## 8. Required outcome

Decide, with evidence, among:
1. retain production r0.84 with no native short-term updates;
2. accept Path S (FSRS-based short-term state update driven by clean independent recall);
3. adopt C only (native lapse/relearning), with complete short-term card persistence;
4. adopt D (full FSRS learning/relearning states);
5. reject native short-term model for now due to weaker retention/efficiency or unsafe state complexity.

A true promotion result needs measured benefit and bounded downside relative to A; a new feature alone is not sufficient.
