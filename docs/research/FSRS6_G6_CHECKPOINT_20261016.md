# FSRS-6 G6 Research Checkpoint — 2026-10-16

**Branch:** `research/fsrs6-full-model-20261016`, isolated from all release/development branches.  
**Tested package:** `ts-fsrs@5.4.2`, FSRS-6, target retention 0.84.  
**CI runs:** [G6-2 and 125d synthetic experiment](https://github.com/smhe00/qwerty-learner/actions/runs/38840252329) (16/16), [schedule switch oracle](https://github.com/smhe00/qwerty-learner/actions/runs/38840438902) (18/18), [two latent-memory hypotheses](https://github.com/smhe00/qwerty-learner/actions/runs/38840536039) (18/18).  
**Protection:** No production source code, deployment workflow, persistent schema, cloud endpoint or nonresearch Git ref was modified. New work comprises research-only test code, a branch-scoped CI workflow and documentation.

## What is proven by actual library tests (G6-0 / G6-1 / G6-2)

1. `enable_short_term=true` is NOT just an automatic ten-minute timer. Native `Relearning` after an eligible Again enters card state 3 and schedules a configured 10m step. A later independently eligible Good updates FSRS S and due, unlike a timer-only intervention.
2. Full native card history can be reconstructed deterministically from immutable source attempt IDs, timestamp ordering and a parameter-set identity. An event SHA and card projection detect missing or modified records; duplicate attempt IDs, conflicting same-ID payloads, cross-account/word/dict events and assisted Good are rejected. These are tests of a **research adapter**, not a full production sync implementation.
3. The production `decideReviewRating()` implementation correctly filters ordinary assisted training, diagnostic and invalid attention evidence in covered unit cases. Cold-probe failure can still be FSRS Again. New short-term independent probes would need a dedicated provenance/eligibility role, not silent reclassification of existing same-session reinforcement.
4. A surprising semantic hazard: a native D card still in Learning after missing its first 10m step can receive Again several days later but has **no Review lapse**. Long-term label and native card state cannot be inferred from a word's UI role.
5. **Short-term switch changes some long-term due dates even with empty steps and >24h-separated ratings.** With four grade events at days 0,2,5,9 across all 256 grade combinations, A/B native traces differ for 11 combinations (245 identical). In the first divergent trace D/S remained equal and due changed by one day. An isolated `enable_short_term` toggle is therefore not necessarily a pure same-day-stability experiment with this exact pinned implementation. See `tests/fsrs/g6-scheduler-switch.test.ts`. Upstream implementation selects different scheduler strategies based on the switch: https://github.com/open-spaced-repetition/ts-fsrs/blob/main/packages/fsrs/src/fsrs.ts

## What the CLOSED-LOOP SYNTHETIC experiment says — provisional, not empirical

**Experiment:** 125 virtual days, 64 words, 4 synthetic learner personas × 5 paired seeds = 20 runs per arm per hypothesis. **6 arms × 2 independently varied hypotheses** = 240 runs total. Hard cap 9 minutes **active** study time/day, two daily study windows, nontraining virtual independent probes at 1/7/30/90 days after admission. Rating → actual `ts-fsrs` scheduler; retrieval success comes from a separate, explicitly **invented** latent-strength model. `spacing-sensitive` rewards separated retrieval more than immediate repetitions; `repetition-sensitive` grants short-interval repetitions greater credit. Neither is fitted to real users.

| Candidate | 7d recall, spacing/repetition | 30d recall, spacing/repetition | Scope |
|---|---:|---:|---|
| A long-term-only baseline approximation | 70.96% / 70.94% | 56.66% / 54.90% | Existing FSRS strategy + simplified acquisition |
| B short-term switch, steps empty | 71.45% / 69.85% | 58.45% / 56.18% | Model and scheduler switch |
| C native 10m Relearning | 73.59% / 74.27% | 61.14% / 59.45% | Lapse → Relearning state → eligible recall |
| D native Learning + Relearning | **22.22% / 26.44%** | 67.87% / 62.01% | Introduces initial native Good; **non-equivalent acquisition** |
| X 10m assisted training, no FSRS rating | 64.93% / 69.51% | 54.84% / 54.38% | Timer-only foil |
| Y independent 10m FSRS rating, no native Relearning state | 71.03% / 71.90% | 59.03% / 57.89% | True short-term feedback; manual optional step |

These are aggregate pass rates among eligible virtual acquisition cohorts, not fixed-cohort RCT results. Cohort sizes and active minutes **vary** because policies influence due debt and new-word admission. Do not rank candidates solely from percentages. A/B diverged in all 40 paired runs despite zero *measured* sub-24h events; the fixed >24h oracle isolated scheduler switching as a real possibility.

**Red flags:**
- The synthetic model's baseline long-term Again/lapse ratio is much higher than the intended FSRS retention setting. These are **stress tests**, not calibrated efficacy forecasts.
- D has an alarming simulated 7-day retention collapse despite apparently high 30-day rates. This could be a real acquisition/step-policy pathology, a model artifact, or cohort/clock differences. **D must not be promoted** based on its 30-day result.
- C's average maximum due backlog rises from 18.8→20.15 (spacing hypothesis) and 19.5→20.65 (repetition hypothesis), despite better synthetic 7/30-day recall. Real workloads and failure recovery must be evaluated.
- X sometimes reduces successful reviews/lapses but worsens 7/30-day independent probes. Optimizing fewer recorded lapses is not equivalent to better memory.
- A/B/C outcomes are linked to synthetic opportunity windows and assumed learner response; two hypotheses agreeing in direction does not imply real-world causality.

**Provisional research ranking:** prioritize C (native FSRS Relearning) and possibly a narrower Y (short-term eligible independent feedback) for *empirical* evaluation. Retain A as production policy. D is high risk and should be reconsidered only after comparable acquisition and early retention issues are resolved. This is **not** a recommendation to merge C.

## V4 data model integration risk

The research branch contains both historical V3 modules (`src/utils/backup.ts`, `src/sync/snapshot.ts`) and the actual **Backup V4** workspace envelope (`src/sync/workspace-v4.ts`, `src/sync/manual-backup-v4.ts`). Do not mistake the historical V3 fallback for the active V4 contract.

- V4 uses a complete six-table Dexie workspace snapshot and a normalized fingerprint. It currently contains `wordRecords.attemptId` and `reviewWordStates` as potential replay inputs.
- The existing `src/sync/v4-event-convergence.ts` is explicitly a **read-only projection**, does not authorize six-table merge/upload and rebuilds FSRS from canonical history with synthesized numeric IDs. Native step replay cannot simply reuse a physical per-device row ID.
- The G6 adapter requires immutable attempt identity + **role and eligibility**. Existing `IWordRecord.learnItemKind` lacks a dedicated FSRS short-term independently scheduled recall provenance; this is a contract gap.
- A complete native Learning/Relearning transition needs versioned event provenance or full snapshot and replay audit, idempotent retry handling, account separation, correct due ownership and V4 import/export tests. *Appending a Card field without event compatibility cannot close G6-2.*
- `tests/fsrs/g6-v4-envelope.test.ts` checks generic V4 envelope JSON pass-through and logical fingerprint changes for an additive FSRS-card property. It does **not** exercise actual DB restore, EdgeOne writes, two-way sync or six-table conflict resolution.

## Evidence gates and requests for a product decision

**G6-0:** PASS (library behavior). **G6-1:** unit subset PASS; UI ESC/input/focus end-to-end remains.  
**G6-2:** pure replay/merge + V4 envelope **research-only PASS**; production persistence/merge migration not yet engineered.  
**G6-3:** synthetic stress PASS, **efficacy inconclusive**.  
**G6-4:** real-world calibration/data **NOT STARTED**; no private user data accessed.  
**G6-5:** promotion blocked by absence of real holdout evidence and incomplete native state integration.

**Suggested decision point:** approval of a privacy-preserving *opt-in* empirical validation design for QWERTY Plus; no raw student learning records should be uploaded or collected automatically. Any experimental arm must be reversible, opt-in, avoid destructive state migration, and have explicit rollout/stop conditions. Until then, keep research sandboxed and production A unchanged.
