# FSRS Phase G

> Product milestone: P5
>
> Status: G0 CLOSED / G1 CLOSED / G2 CLOSED / G3 CLOSED / G4 ACTIVATED
>
> Active scheduler: **FSRS-6 r0.84**
>
> Analysis comparator only: `basic-v2`
>
> Canonical current product semantics live in
> `docs/SPECIFICATION_V1.md`. This document retains the Phase-G rollout
> history and benchmark rationale; pre-activation wording below is historical.

## Objective

Historical rollout objective: integrate FSRS-6 as a versioned, deterministic
shadow scheduler behind the Learn Rating Gate, collect comparable evidence, and
activate it only after G4. That activation is complete; production scheduling
now uses FSRS-6, while Basic-v2 remains only an analysis comparator.

## Phase sequence

```text
G0  ts-fsrs dependency / compatibility
 ↓
G1  historical shadow replay
 ↓
G2  historical Basic-v2 + FSRS dual-track comparison
 ↓
G3  calibration / retrievability / workload analysis
 ↓
G4  activation decision
```

## G0 — compatibility gate

Pinned candidate:

```text
library package: ts-fsrs
package version: 5.4.2 (official latest stable verified 2026-10-03)
algorithm family: FSRS-6
pre-release excluded: 6.0.0-beta.x
```

G0 deliberately installs the candidate only inside CI. It is not yet a
production dependency.

Required checks:

1. Node.js 20.18 runtime import;
2. project TypeScript 4.9.5 parses package declarations with
   `skipLibCheck=false`;
3. `repeat()` previews Again / Hard / Good / Easy;
4. `next()` returns finite Difficulty / Stability and a non-negative due
   interval;
5. esbuild Node bundle succeeds;
6. Vite 4 browser bundle succeeds;
7. the existing Qwerty production build remains green.

G0 has **zero product behavior change**.

### Stable-version policy

Phase G uses the latest **stable** `ts-fsrs` release, pinned exactly for
reproducibility. As verified on 2026-10-03, the stable npm/GitHub release is
`ts-fsrs@5.4.2`. The contemporaneous `6.0.0-beta.x` line is pre-release and
is deliberately excluded from production/shadow evidence.

Package major version and algorithm generation are different concepts:
`ts-fsrs 5.x` implements the **FSRS-6 algorithm** (introduced in
`ts-fsrs 5.0.0`).

### G0 closure

FSRS Phase G Gate #2 passed on Node 20.18 with the repository's resolved
TypeScript 4.9.5 and Vite 4 toolchain.

Validated:

- pinned `ts-fsrs@5.4.2` installation;
- strict declaration parsing with `skipLibCheck=false` for the FSRS/Node type
  universe;
- Node runtime and esbuild bundle;
- Vite browser bundle;
- existing Qwerty production build.

The first G0 run also exposed an unrelated pre-existing
`@types/react-router-dom@5` vs React Router 6 declaration conflict when the
entire legacy ambient type universe was forced through `skipLibCheck=false`.
The G0 probe was corrected to isolate the dependency under test instead of
mistaking that legacy project issue for an FSRS incompatibility.

## G1 — historical shadow replay

G1 is active after G0 closure. It remains offline/shadow-only: no DB writes and
no active scheduler mutation.

Replay source must be durable Learn history, ordered chronologically. Only
`reviewRatingDecision.eligible === true` events may advance FSRS state.

Forbidden inputs:

- Acquisition (`rating=null`);
- training;
- reinforcement;
- diagnostic probes;
- attention-uncertain / invalid Rating Gate events.

FSRS state must be rebuilt from eligible historical events. It must not infer
Difficulty/Stability from `basic-v2.stage` or `basic-v2.intervalDays`.

## G2 — live dual-track shadow

Target ownership:

```text
Rating Gate
   ├─ basic-v2 ACTIVE → owns nextReviewAt
   └─ FSRS-6 SHADOW  → observation only
```

Shadow persistence must distinguish:

- library version;
- algorithm model;
- shadow schema version;
- parameter-set identity;
- retrievability immediately before the Review;
- Difficulty / Stability before and after;
- selected interval/due for the actual rating;
- counterfactual Again / Hard / Good / Easy intervals;
- corresponding basic-v2 interval/due.

The shadow state must be type-separated from the active
`schedulerState` during G0-G3.

## G3 — analysis

G3 is a pure read-only analysis layer over event-level `WordRecord.fsrsShadow`
observations. It does not write scheduler state or alter Learn behavior.

Implemented metrics:

- retrievability calibration with fixed R buckets;
- Brier score and expected calibration error;
- discrimination via remembered-vs-forgotten R and pairwise AUC;
- 1/7/30-day **next-due projection** from the latest shadow event per word;
- FSRS/basic-v2 interval ratio P50/P90/P95/max;
- absolute interval divergence;
- explicit <=0.25x and >=4x interval outliers;
- provenance rejection so different package/model/parameter generations are
  never mixed silently.

Data-readiness gates are intentionally separate from algorithm acceptance:

```text
< 50 usable pre-review-R samples
  → collecting

>= 50
  → descriptive analysis allowed

>= 200 AND remembered >= 20 AND forgotten >= 20
  → eligible for G4 review
```

These thresholds only mean "enough evidence to inspect". They do **not** mean
FSRS passes the activation decision.

Initial binary calibration interpretation:

```text
remembered = Hard | Good | Easy
forgotten  = Again
```

### G3/G4 production baseline — r0.84

The active Qwerty scheduler uses:

```text
algorithm          FSRS-6
weights            ts-fsrs 5.4.2 default weights
request retention  0.84
fuzz               disabled
short-term steps   disabled
parameterSetId     fsrs6-default-r0.84-no-fuzz-long-term-v1
```

This parameter set owns `nextReviewAt`. The official/default r0.90 strategy
remains available as the benchmark control. Older r0.90/r0.88 observations are
historical evidence and are not mixed with r0.84 observations; provenance
filtering groups evidence by `parameterSetId`.

The current test-stage cutover starts from native FSRS state. Pre-FSRS
persisted scheduler state is intentionally not migrated or bridged; stale
Review state may be discarded because current data is test-only. `basic-v2`
remains available only as a reconstructed benchmark/comparator trajectory from
eligible raw ratings. Future optimized weights must receive a new immutable
parameter-set identity rather than silently replacing this baseline.

## G4 — activation decision

FSRS cannot become active solely because integration works. Activation requires
explicit gates for:

- sufficient eligible Review history;
- acceptable calibration;
- acceptable workload;
- bounded interval outliers;
- deterministic replay;
- clean-state cutover and rollback/comparator coverage;
- backup/restore compatibility;
- Review formal gate;
- browser gate.

If activated, the initial topology should reverse the shadow relationship:

```text
FSRS-6    ACTIVE
basic-v2  SHADOW
```

so rollback evidence remains available.

## Version provenance

Never store an ambiguous `version=6`.

Persist separate concepts:

```text
libraryVersion
algorithmModel
shadowSchemaVersion
parameterSetId
```

This prevents a future ts-fsrs package version from being confused with the
FSRS algorithm generation.


### G1 replay contract

The G1 replay implementation is deliberately test-side/offline until its
semantics are closed.

For each `dict+word`:

1. sort durable records by timestamp, then record id;
2. use Acquisition only as optional card-birth provenance;
3. accept only Learn Review records with
   `reviewRatingDecision.eligible === true`;
4. replay those ratings into the current deterministic FSRS-6 production baseline:
   - request retention 0.84;
   - default FSRS-6 weights;
   - fuzz disabled;
   - short-term steps disabled;
5. record retrievability immediately **before** each eligible Review;
6. preview all four rating counterfactuals;
7. apply only the actual eligible rating;
8. never infer Difficulty/Stability from basic-v2 stage or interval.

Historical completeness is never silently assumed. When the current durable
`reviewCount` exceeds the number of replayable eligible events, replay output
is explicitly marked `partial-history`.


### G1 closure

Historical replay is CLOSED. Verified properties:

- eligible Learn Review events only;
- deterministic chronological replay;
- no conversion from basic-v2 state into FSRS D/S;
- pre-review retrievability captured;
- four-rating counterfactual intervals captured;
- incomplete durable history explicitly marked `partial-history`.

### G2 closure

Live dual-track shadow is CLOSED for data collection.

Runtime ownership remains:

```text
basic-v2  ACTIVE  → sole owner of nextReviewAt
FSRS-6    SHADOW  → event-level observation only
```

Each eligible Review first commits the basic-v2 result, then FSRS shadow work
runs in a separate failure-isolated transaction and annotates the source
WordRecord. A shadow failure cannot roll back or replace the active scheduler
state.

Verified by FSRS Phase G Gate #11 and Review Gate #133.


### G3 workload interpretation

The 1/7/30-day comparison is deliberately named **next-due projection**. It
counts at most the next scheduled Review for each word under basic-v2 and FSRS.
It is not a recursive simulation of all future Reviews and therefore must not
be presented as total future workload.

A full counterfactual workload estimate is not identifiable from basic-v2
shadow data without assumptions about future ratings and review timing. G4
must therefore use next-due exposure, interval divergence, observed user effort
and calibration together rather than treating this projection as a complete
workload forecast.

### G3 user-visible observability

Learn 数据统计 exposes a read-only FSRS-6 Shadow block with:

- homogeneous current-version shadow count;
- calibration sample count and readiness;
- ECE;
- discrimination AUC;
- median FSRS/basic interval ratio and outlier count;
- 30-day next-due projection.

The page explicitly states that basic-v2 still owns `nextReviewAt`.


### G3 implementation checkpoint

G3 analysis infrastructure is implemented and gated. The implementation can
compute calibration, discrimination, interval divergence, outliers and
next-due projection, and the Learn statistics page exposes those metrics.

Verification checkpoint:

```text
FSRS Phase G Gate #18  PASS
Review Gate #141       PASS
```

`G3 ACTIVE` now means **real evidence collection**, not unfinished analysis
code. G4 remains blocked until the data-readiness gate is reached and the
resulting calibration/workload evidence is actually reviewed.


## G4 strategy benchmark bootstrap — 2026-10-05

The first activation experiment is now a deterministic strategy benchmark, not
a direct production switch.

Compared schedulers:

```text
A  basic-v2 ACTIVE baseline
B  FSRS-6 default, request retention 0.90
C  FSRS-6 default weights with request-retention sweep
   0.84 / 0.86 / 0.88 / 0.90 / 0.92 / 0.94
```

The learner-memory model remains independent from FSRS. It uses the existing
latent strength/difficulty/fatigue simulator, while FSRS controls only review
timing. This prevents an FSRS candidate from being evaluated against itself as
the simulated ground truth.

The benchmark is paired across the same learner personas and random seeds. It
reports long-term mastery per interaction, 30-day observed retention, daily
workload, P95 workload, backlog and per-persona efficiency.

A candidate is marked promotable only when all of these hold relative to the
FSRS-6 r0.90 default:

- mastery-per-interaction improves by at least 5%;
- 30-day retention loses no more than 0.5 percentage point;
- mean P95 daily workload is no more than 1.05x;
- no persona loses more than 3% efficiency;
- it also matches or beats basic-v2 efficiency without exceeding the same
  retention-loss bound.

A simulation promotion decision selects a G4 candidate; it does not by itself
grant production write authority. Real G3 evidence readiness, deterministic
migration/rollback, backup compatibility, formal gates and browser gates remain
required before FSRS replaces basic-v2.


### G4 simulation-selected candidate

The 120-day paired benchmark on 2026-10-05 selected:

```text
candidate: fsrs6-default-r0.88-no-fuzz-long-term-g4-v1
request retention: 0.88
weights: ts-fsrs 5.4.2 FSRS-6 defaults
```

Selection does not change the active scheduler. The candidate is represented
explicitly in code so subsequent replay, long-horizon simulation and real-data
validation refer to the same immutable parameter identity.


### G4 r0.88 long-horizon rejection

The initial 120-day sweep selected r0.88, but the required 365-day confirmation
rejected it without changing the predeclared gate.

Observed over 365 days (4 personas x 3 paired seeds):

```text
FSRS r0.90 retention30d = 0.416925
FSRS r0.88 retention30d = 0.410419
delta                    = -0.006506
allowed                  = >= -0.005000

efficiency gain vs r0.90 = +19.36%
P95 workload ratio       = 0.9906
worst persona efficiency = -0.08%
```

Therefore r0.88 is not a production promotion candidate. The refinement search
moves inside the 0.88-0.90 interval while keeping the same promotion thresholds.


## G4 activation — FSRS-6 r0.84

The product owner selected FSRS-6 with default weights and
`request_retention=0.84` as the mainline production scheduler.

```text
Rating Gate
   ├─ FSRS-6 r0.84 ACTIVE → owns nextReviewAt
   └─ basic-v2 REPLAYABLE → comparator / rollback baseline
```

Cutover contract:

1. current native Review state uses state version 5 and FSRS-6 r0.84;
2. pre-FSRS persisted scheduler state is disposable test data and is not
   migrated or bridged;
3. stale state may be cleared during bootstrap;
4. native FSRS history is reconstructed only from current eligible Review
   evidence when needed;
5. explicit ineligible/training/reinforcement attempts do not mutate the
   long-term scheduler;
6. basic-v2 remains a benchmark/comparator trajectory, not a persisted
   migration target;
7. r0.84 provenance is immutable in scheduler state/observations.

The existing `fsrsShadow` storage field remains for schema compatibility.
After activation it is an observational mirror of the active FSRS trajectory
paired with a basic-v2 comparator; the field name no longer implies that FSRS
lacks write authority.
