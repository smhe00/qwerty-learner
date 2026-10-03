# FSRS Phase G

> Product milestone: P5
>
> Status: G0 CLOSED / G1 CLOSED / G2 CLOSED / G3 RUNNING
>
> Active scheduler: `basic-v2`
>
> FSRS authority: **shadow only; no scheduler write authority**

## Objective

Integrate FSRS-6 as a versioned, deterministic shadow scheduler behind the
existing Learn Rating Gate. No FSRS result may change `nextReviewAt`,
lifecycle, Review queue selection, P3 quota, or P4 workload planning before the
G4 activation decision.

## Phase sequence

```text
G0  ts-fsrs dependency / compatibility
 ↓
G1  historical shadow replay
 ↓
G2  live basic-v2 + FSRS dual-track shadow
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

## G4 — activation decision

FSRS cannot become active solely because integration works. Activation requires
explicit gates for:

- sufficient eligible Review history;
- acceptable calibration;
- acceptable workload;
- bounded interval outliers;
- deterministic replay;
- migration and rollback;
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
4. replay those ratings into a deterministic FSRS-6 scheduler configured with:
   - request retention 0.90;
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
