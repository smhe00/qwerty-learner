---
protocol_version: "1.1"
task_id: "TASK-20261006-002-trace-replay-minimizer"
status: "REVIEW"
executor: "chat"
start_commit: "2dbc32e1d47578bff4837f33d27de32559f83d3b"
last_implementation_commit: "a16402c4b08a660505c610e19113021c153e722a"
target_branch: "product/main"
release_to_master: false
---

# TASK-20261006-002 — P0 Diagnostic Replay / Minimizer Report

## Status

**REVIEW**

P0 implementation is complete on `product/main` and the mandatory Review Gate is green.

No release to `master` is authorized or performed by this task.

## Objective Result

Implemented the P0 field-debug pipeline:

```text
Qwerty-Plus-Incident-*.json
or Qwerty-Plus-Developer-Trace-*.json
        ↓
schema-aware loader
        ↓
normalized diagnostic replay events
        ↓
core structural oracles
        ↓
stable anomaly signature
        ↓
deterministic ddmin
        ↓
same-schema replayable .min.json
```

The UI-exported Incident format is now consumed directly by the same P0 loader in Playwright regression coverage.

## Commits

### Task protocol

- `e615274f4065fff0159b66814c99ca3117957739`
  - dispatch P0 task
- `2dbc32e1d47578bff4837f33d27de32559f83d3b`
  - claim task under single-writer protocol

### Implementation

- `9e165c7dfabd82456210c3cf24f36d7bb358c242`
  - loader
  - replay
  - core oracles
  - anomaly signatures
  - ddmin
  - CLI
  - synthetic tests
  - Review Gate integration
- `5b5da002ae890f38ee13e87893fd0d37ae543817`
  - minimized output changed to same-schema replayable artifact
  - one-click Incident export → loader browser compatibility test
  - CLI CI smoke
  - P0 documentation
- `a16402c4b08a660505c610e19113021c153e722a`
  - move CLI into existing linted `src/dev` module boundary

## Changed / Added Areas

- `src/dev/replay.ts`
- `src/dev/replay-cli.ts`
- `tests/simulation/field-replay.test.ts`
- `tests/e2e/review-flow.spec.ts`
- `docs/DIAGNOSTIC_REPLAY_P0.md`
- `.github/workflows/review-gate.yml`
- `package.json`

No real field Incident/Trace/backup/database file was committed.

## Supported Input

### Developer Trace

```text
qwerty-developer-trace-v1
```

### Incident Snapshot

```text
qwerty-developer-incident-v1
```

Unknown envelope schemas fail with a deterministic `DiagnosticReplayError`.

## Core P0 Oracles

Implemented:

1. `terminal-ui-divergence`
2. `finished-session-evidence-after-terminal`
3. `finished-checkpoint-regression`
4. `invalid-session-index`
5. `audio-owner-lifecycle-violation`
6. `oversized-acquisition-classification`

### Evidence provenance

Each anomaly is marked as:

- `observed`
- `derived`
- `mixed`

P0 intentionally avoids positive claims when required evidence is absent.

Examples:

- audio owner mismatch requires explicit owner key + displayed word;
- metadata-less >20-word data is not automatically classified as oversized Acquisition;
- pure Review >20 is legal;
- mixed Review+Acquisition total >20 is legal when Acquisition logical count <=20.

## Learn Trace IR Reuse

The loader projects supported field evidence into the existing
`LearnTraceEnvelope` / `LearnSystemTraceEvent` model with source:

```text
historical-replay
```

Current projection covers:

- terminal word durable;
- terminal UI finished;
- session checkpoints.

P0 does not yet project every browser diagnostic event into the simulation IR.

## Delta Minimizer

Implementation:

- deterministic chunk-removal ddmin;
- deterministic single-event cleanup;
- preserves event order;
- does not mutate retained event payloads;
- preserves the target anomaly signature;
- reports original/minimized counts and retained sequence numbers.

Guarantee is documented as practical / 1-minimal with respect to the implemented deletion pass, **not** a mathematical global-minimum proof.

### 800-event benchmark

CI evidence from Review Gate:

```text
P0 800-event diagnostic minimizer runtime: 3ms
```

The test bound is 5 seconds.

## Replayable Minimal Artifact

The initial P0 implementation emitted a custom minimized schema. During review this was identified as insufficient because the resulting file was not directly replayable by the normal loader.

Corrected behavior:

- Trace input → minimized `qwerty-developer-trace-v1`;
- Incident input → minimized `qwerty-developer-incident-v1`;
- same CLI can replay the resulting `.min.json`.

This is covered by regression tests.

## CLI

Documented command:

```bash
yarn diagnostic:replay ./Qwerty-Plus-Incident-....json
```

Exit codes:

- `0` — valid, no anomaly;
- `1` — parse/schema/tool failure;
- `2` — anomaly found.

An anomaly run writes a sibling `.min.json` artifact.

No network access or upload is used.

## Incident Export Compatibility

Playwright now performs the real UI path:

```text
Settings
→ 开发诊断
→ 导出现场诊断包
→ browser download
→ read downloaded JSON in test process
→ parseDiagnosticExport()
→ replayDiagnostic()
```

This protects the contract between the production diagnostic export and P0.

## Synthetic Regression Coverage

Covered structural cases:

- healthy terminal completion;
- terminal UI divergence;
- finished checkpoint → stale unfinished checkpoint;
- Learn evidence after terminal;
- invalid active index;
- pure Review >20 — legal;
- mixed total >20 / Acquisition <=20 — legal;
- explicit Acquisition >20 — anomaly;
- audio owner mismatch only with sufficient owner evidence;
- missing audio owner evidence — no fabricated anomaly;
- deterministic minimization;
- replay of minimized same-schema artifact;
- 800-event minimizer bound;
- real UI incident export compatibility.

Fixtures are generated synthetic data; no user vocabulary/history/database dump is included.

## Validation Evidence

### Review Gate

Run:

```text
37407820528
```

Result:

```text
SUCCESS
```

Passed steps include:

- Lint Review code
- Bundle Review verification tests
- Review domain tests
- Acquisition backup regression
- Review formal model checker
- TLA trace bridge tests
- Diagnostic replay CLI bundle + smoke
- Learn control stability
- Learn async ownership race
- Longitudinal learner simulation
  - includes `field-replay.test.mjs`
- Typing audio lifecycle formal
- FSRS shadow contract
- FSRS G3 analysis
- Typing lifecycle browser gate
- Build Qwerty
- Production navigation smoke
- Multi-word Review browser gate
  - includes UI Incident export compatibility

### Other triggered gates

- Achievement Gate: SUCCESS
- Cloud Sync Gate: SUCCESS
- FSRS Phase G Gate: still running at report-write time; all observed steps through G3 passed and G4 benchmark was in progress. This gate was triggered by `package.json`; it is not a mandatory P0 acceptance dependency, but final reviewer should record its eventual result.

## Acceptance Criteria Review

- [x] AC1 both export schemas load
- [x] AC2 unknown schema fails clearly
- [x] AC3 order/sequence/timestamps preserved in normalized events
- [x] AC4 healthy terminal no terminal anomaly
- [x] AC5 terminal resurrection shape → `terminal-ui-divergence`
- [x] AC6 evidence after finish detected
- [x] AC7 finished→unfinished checkpoint detected
- [x] AC8 pure Review >20 not misclassified
- [x] AC9 mixed total >20 / Acquisition <=20 not misclassified
- [x] AC10 >20 explicit Acquisition detected
- [x] AC11 stale audio owner requires sufficient evidence
- [x] AC12 absent optional evidence does not create false positive
- [x] AC13 minimizer preserves signature + event order
- [x] AC14 minimizer deterministic
- [x] AC15 800-event runtime measured: 3 ms
- [x] AC16 real one-click Incident export directly consumed
- [x] AC17 no real user diagnostic/backups committed
- [x] AC18 Review/Simulation/Formal gates green
- [x] AC19 no Learn/Typing product semantics changed by P0
- [x] AC20 proof/inference limits documented here and in P0 doc

## What P0 Can Prove

When sufficient evidence exists, P0 can establish structural contradictions such as:

- terminal state persisted but terminal UI absent in captured Incident;
- checkpoint terminality regressed;
- Learn evidence occurred after terminal immutability;
- active index is outside queue bounds;
- explicit audio owner contradicts displayed word;
- explicitly classified Acquisition cohort exceeds the configured logical-word boundary.

## What P0 Only Infers

P0 may derive a session id for an event from an unambiguous active Incident/session context when the event itself did not store the id.

Such anomalies are marked `derived` or `mixed`.

## What P0 Cannot Determine

P0 does not fabricate answers for evidence that was never captured.

Examples:

- it cannot prove an audio owner mismatch when no owner id/key exists;
- it cannot classify metadata-less historical words as Review vs Acquisition with certainty;
- a Trace-only file cannot prove final DOM/result-screen visibility;
- P0 is not a full browser emulator;
- P0 does not reconstruct every React internal transition.

## Remaining Risks / Technical Debt

1. `src/dev/replay.ts` currently reuses the existing Trace IR type from `tests/simulation/trace-ir.ts`. This satisfies P0 reuse but leaves a layering debt. P1 should move the shared IR into a neutral source module rather than let production-side diagnostic tooling import a test-path type.
2. Envelope validation is strict at the schema level but intentionally tolerant of partially missing event fields; this supports legacy traces. Future schema evolution may benefit from an explicit versioned runtime validator.
3. The minimizer can retain sensitive field evidence in the local `.min.json`. Documentation forbids committing these artifacts; a future option could produce a separately sanitized support bundle.
4. Terminal UI divergence requires an Incident snapshot. Trace-only exports cannot observe final DOM visibility.
5. P0 currently analyzes captured evidence; it does not proactively generate browser lifecycle schedules. That belongs to P1/P3.

## P1 Handoff

Recommended next task:

**Production-aligned virtual Learn session model**

Priority:

1. move shared Trace IR to a neutral module;
2. make `VirtualLearnApp` use the current unified mixed-session path;
3. model route/reload/refresh as first-class actions;
4. feed minimized P0 traces back as deterministic simulation seeds;
5. then expand mutation scorecard around those structural failure classes.

This closes the loop:

```text
field incident
→ P0 replay/minimize
→ deterministic minimal trace
→ P1/P2 simulation seed
→ proactive bug discovery
```
