---
protocol_version: "1.1"
task_id: "TASK-20261006-002-trace-replay-minimizer"
title: "P0 diagnostic Trace/Incident replay and failure minimizer"
status: "READY"
target_branch: "product/main"
base_commit: "26e8454f519850374aaf9f3fd61c67c9a7222638"
recommended_executor: "high-reasoning-compatible-agent"
allow_parallel_executors: false
report_file: "interactive/reports/TASK-20261006-002-trace-replay-minimizer-report.md"
release_to_master: false
---

# TASK-20261006-002 — P0 Diagnostic Trace/Incident Replay + Failure Minimizer

## Objective

Build the first production-grade **P0 diagnostic replay pipeline** so a rare Qwerty Plus field failure can be exported from **Settings → 开发诊断 → 导出现场诊断包**, then deterministically analyzed without manually reading a multi-megabyte JSON file.

The P0 outcome must convert:

```text
Qwerty-Plus-Incident-*.json
or
Qwerty-Plus-Developer-Trace-*.json
        ↓
schema validation / normalization
        ↓
Trace IR
        ↓
state/invariant replay
        ↓
anomaly signature + first bad event
        ↓
delta minimizer
        ↓
minimal replayable failure trace
```

This task is diagnostic infrastructure. It must not change Learn scheduling semantics, Typing behavior, or release behavior.

## Context

Qwerty Plus now has:

- `qwerty-developer-trace-v1` Developer Trace export;
- `qwerty-developer-incident-v1` one-click incident snapshot export;
- simulation infrastructure under `tests/simulation/`;
- TLA/trace bridge infrastructure under `tests/formal/`;
- production trace events covering Learn terminal flow, persistence, audio ownership, navigation/runtime events;
- browser regression coverage for the recently fixed terminal-last-word resurrection bug.

A real field incident showed why P0 is necessary:

1. the final Learn word had already produced durable evidence;
2. the ReviewRecord was durably `isFinished=true`;
3. `ui-finish-dispatch` had occurred;
4. the UI nevertheless showed the final word again after a browser-level route/reload lifecycle event.

The root cause was found manually by correlating trace, route state, DOM state and persisted DB state. P0 must automate that class of analysis.

A second field-derived finding showed that an oversized-session compatibility rule could incorrectly rotate a pure Review session. P0 should be able to flag classification/invariant inconsistencies without requiring the operator to know the faulty source line.

## Privacy / Data Handling

**Do not commit any real user incident export, backup, database dump, word history or diagnostic JSON to Git.**

Tests must use synthetic/sanitized fixtures that preserve only the structural failure shape.

Generated minimized traces are local artifacts only unless they are synthetic test fixtures intentionally created in-repo.

## Scope

### In scope

- parser/loader for:
  - `qwerty-developer-trace-v1`;
  - `qwerty-developer-incident-v1`;
- explicit schema/version validation with useful errors;
- normalization to a stable replay IR;
- adapters into the existing simulation / trace infrastructure where practical;
- deterministic replay over ordered diagnostic events;
- invariant/oracle evaluation;
- anomaly signatures;
- first-bad-event identification;
- deterministic delta minimization that preserves an anomaly signature;
- a local CLI/script entry point for replaying exported JSON files;
- synthetic regression fixtures for representative failures;
- CI integration into the existing Review Gate or an equivalent non-release gate;
- report/documentation describing supported and unsupported evidence.

### Out of scope

- no new Learn algorithm;
- no FSRS tuning;
- no UI redesign;
- no new cloud upload of diagnostic files;
- no automatic submission of incident files to GitHub;
- no storage of real field incident JSON in repository fixtures;
- no `master` release;
- no general-purpose full browser/session emulator in P0;
- no attempt to reconstruct information that was never captured in the incident.

## Architectural Principle

P0 must distinguish three evidence layers:

```text
Observed evidence
  - trace events
  - incident DOM snapshot
  - route/localStorage snapshot
  - IndexedDB snapshot

Derived replay state
  - current session
  - current/terminal index
  - queue length
  - finished checkpoint state
  - observed audio owner lifecycle
  - terminal UI evidence

Anomaly/oracle result
  - invariant id
  - signature
  - first bad event
  - supporting event indexes
  - supporting incident fields
```

Do not silently treat inferred state as observed state.

Every anomaly must indicate whether it is based on:

- `observed`;
- `derived`;
- or `mixed` evidence.

## Required Work

### P0.1 — Input loader and schema normalization

Implement a loader that accepts a path to either export format.

Requirements:

1. identify the envelope type from its schema field;
2. reject unsupported future/unknown schema versions with a clear message;
3. normalize Developer Trace events into one internal replay representation;
4. when an Incident snapshot is provided, retain:
   - build SHA;
   - capture timestamp;
   - path/href;
   - relevant DOM attributes;
   - safe localStorage/sessionStorage snapshot;
   - embedded Developer Trace;
   - database snapshot metadata needed by oracles;
5. preserve original event sequence numbers and timestamps;
6. never reorder equal/ambiguous events implicitly.

Prefer extending/reusing `tests/simulation/trace-ir.ts` and the existing TLA trace bridge rather than creating a second unrelated trace model.

### P0.2 — Replay state and core anomaly oracles

Implement at least the following anomaly classes.

#### A. `terminal-ui-divergence`

Detect evidence equivalent to:

```text
same session:
  terminal/final progress became durable
  AND session checkpoint became isFinished=true
  AND ui-finish-dispatch occurred
  BUT captured UI/route state is non-terminal or renders the old active word
```

This is the structural class of the rare “last word resurrected / result page missing” incident.

The oracle must not require the exact historical word `opera`.

#### B. `finished-session-evidence-after-terminal`

Detect any new Learn evidence event for the same session after terminal completion became immutable.

This backs the new production guard:
`finished session => no additional Learn WordRecord / scheduler evidence`.

#### C. `finished-checkpoint-regression`

Once a session has a requested/committed finished checkpoint, a later checkpoint for the same session must not regress to `isFinished=false`.

#### D. `invalid-session-index`

Detect impossible index/queue relationships, including index outside the queue domain when the session is still presented as active.

#### E. `audio-owner-lifecycle-violation`

Use the existing audio owner concepts to detect stale-owner completion/start where sufficient trace evidence exists.

Do not claim an audio anomaly if the required owner evidence is absent.

#### F. `oversized-acquisition-classification`

Distinguish Review volume from Acquisition cohort size.

The replay/oracle layer must not call a pure Review session an oversized acquisition cohort solely because it contains more than 20 logical review words.

For mixed sessions, only acquisition-classified logical words count toward the acquisition cohort invariant when classification evidence exists.

### P0.3 — Replay result format

Define a stable machine-readable result, for example:

```ts
type ReplayAnomaly = {
  code: string
  signature: string
  evidenceKind: 'observed' | 'derived' | 'mixed'
  sessionId?: string
  word?: string
  firstBadEventIndex?: number
  eventIndexes: number[]
  summary: string
}
```

Exact type naming may differ, but the output must support:

- deterministic equality in tests;
- human-readable summary;
- minimizer signature matching;
- future CI consumption.

### P0.4 — Delta minimizer

Implement a deterministic minimizer for failing event traces.

Requirements:

1. input = normalized trace + target anomaly signature;
2. output = smallest practical subsequence found that still reproduces the same signature;
3. preserve event order;
4. never mutate event payloads during minimization;
5. deterministic output for the same input;
6. use a bounded algorithm so an 800-event Developer Trace is practical;
7. report:
   - original event count;
   - minimized event count;
   - anomaly signature;
   - retained original sequence/event indexes.

A standard ddmin/chunk-removal strategy is acceptable.

Do not define “minimal” as a mathematically proven global minimum if the implementation only guarantees a local/1-minimal result. State the actual guarantee precisely.

### P0.5 — Local replay CLI

Provide one documented local command, using the repository's existing Node/TypeScript toolchain.

Target UX:

```bash
# exact script name may differ
yarn diagnostic:replay ./Qwerty-Plus-Incident-....json
```

Expected console output should include:

```text
schema
build SHA (if present)
event count
sessions seen
anomalies
first bad event
minimal event count
path of minimized local artifact (optional)
```

Exit behavior must be documented and deterministic.

Recommended:

- 0 = valid trace, no anomaly;
- non-zero = anomaly or invalid input;
- if separate codes are used for parse vs anomaly, document them.

The CLI must not upload files or require network access.

### P0.6 — Synthetic regression fixtures

Create sanitized fixtures/tests for at least:

1. healthy terminal Learn completion;
2. terminal UI divergence after durable finish;
3. finished checkpoint followed by stale unfinished checkpoint;
4. duplicate Learn evidence after finish;
5. legal pure Review session with >20 logical words — must **not** produce oversized-acquisition anomaly;
6. mixed session where acquisition count is <=20 but total Review+Acquisition exceeds 20 — must **not** produce oversized-acquisition anomaly;
7. mixed/acquisition session with >20 acquisition logical words — should produce the relevant anomaly;
8. stale audio owner case when complete owner evidence is present;
9. trace missing optional evidence — should produce `unknown/not-provable` behavior rather than a false positive.

Do not copy the real field incident data or its vocabulary/history into fixtures.

### P0.7 — Incident snapshot compatibility test

Add a browser or integration test proving the currently exported
`qwerty-developer-incident-v1` can be consumed by the P0 loader without manual transformation.

This protects the contract between the UI export button and replay pipeline.

### P0.8 — CI integration

Integrate P0 tests into a non-release development gate.

Requirements:

- no EdgeOne deployment;
- no `master` update;
- replay unit tests must run on `product/main`;
- minimizer tests must be deterministic;
- existing formal/simulation/browser gates must not be weakened.

## Acceptance Criteria

- [ ] AC1: CLI loads both `qwerty-developer-trace-v1` and `qwerty-developer-incident-v1`.
- [ ] AC2: unsupported schema/version fails clearly and deterministically.
- [ ] AC3: normalized replay preserves event order, original sequence and timestamps.
- [ ] AC4: synthetic healthy terminal completion produces no terminal anomaly.
- [ ] AC5: synthetic final-word resurrection shape produces `terminal-ui-divergence`.
- [ ] AC6: new Learn evidence after finished session produces `finished-session-evidence-after-terminal`.
- [ ] AC7: finished→unfinished checkpoint regression is detected.
- [ ] AC8: pure Review >20 words is not misclassified as oversized Acquisition.
- [ ] AC9: mixed total >20 but Acquisition <=20 is not misclassified as oversized Acquisition.
- [ ] AC10: >20 Acquisition logical words is detected when evidence is sufficient.
- [ ] AC11: audio stale-owner anomaly is detected only when owner evidence is sufficient.
- [ ] AC12: missing optional evidence does not become a fabricated positive anomaly.
- [ ] AC13: minimizer preserves the target anomaly signature and event order.
- [ ] AC14: minimizer result is deterministic for identical input.
- [ ] AC15: a representative 800-event trace is minimized within a practical CI/local-test bound; record measured runtime in report.
- [ ] AC16: one-click Incident export format is directly consumable by replay tests.
- [ ] AC17: real user incident/backups are not committed to Git.
- [ ] AC18: existing Review/Simulation/Formal gates remain green.
- [ ] AC19: no Learn/Typing product semantics are changed by P0 infrastructure.
- [ ] AC20: report states what P0 can prove, infer, and cannot determine.

## Required Validation

The executor must inspect current scripts and use the repository's actual commands.

At minimum run:

- targeted replay parser/oracle tests;
- targeted minimizer tests;
- synthetic incident compatibility test;
- longitudinal simulation;
- relevant TLA trace bridge tests;
- Review Gate or equivalent full development gate if practical;
- lint/type/build checks for touched executable tooling.

Do not run or trigger an EdgeOne release build.

## Performance / Determinism Requirements

- Developer Trace currently retains at most ~800 events. P0 must comfortably handle this size.
- No randomness in minimization unless a fixed explicit seed is part of the API.
- No wall-clock time may affect anomaly identity.
- Event timestamps are evidence only; replay results must not depend on the current clock.
- Avoid O(2^N) minimization/search.

## Deliverables

1. replay loader / normalized IR;
2. core P0 oracles;
3. anomaly result/signature model;
4. delta minimizer;
5. local replay CLI;
6. synthetic regression fixtures;
7. CI/dev-gate integration;
8. execution report:
   `interactive/reports/TASK-20261006-002-trace-replay-minimizer-report.md`;
9. commit SHA(s);
10. concise remaining-risk / P1 handoff section.

## Git / Release Permissions

```text
development_branch: product/main
push_allowed: true
release_to_master: false
force_push: false
branch_deletion: false
real_user_incident_commit: forbidden
```

## Reviewer Notes

This is **P0**, not the entire Simulation 2.0 program.

The architectural priority is:

1. make real field evidence automatically analyzable;
2. preserve observed-vs-derived evidence provenance;
3. make failures reducible to minimal deterministic traces;
4. only then expand the virtual product model in P1.

The reviewer should reject implementations that merely regex-search the JSON for known historical strings. The replay must operate on structural events/invariants and generalize beyond the specific incident that motivated it.
