---
protocol_version: "1.1"
task_id: "TASK-20261006-007-hint-efficiency-v2"
title: "Hint Efficiency V2: three-failure cap and frozen cold evidence"
status: "IN_PROGRESS"
target_branch: "product/main"
base_commit: "4a84a49e93fc71b55e40984e83eecd43d10613c5"
recommended_executor: "chat"
allow_parallel_executors: false
report_file: "interactive/reports/TASK-20261006-007-hint-efficiency-v2-report.md"
release_to_master: false
---

# TASK-20261006-007 — Hint Efficiency V2

## Product decision

Implement the agreed high-efficiency Hint policy.

### Input semantics

- First-character Space is **not** a surrender signal.
- Space remains ordinary spelling input, including phrase spaces.
- **ESC is the only explicit surrender shortcut.**

### Failure budget

One global failed-retrieval budget per word:

```text
Cold Probe
  fail #1 -> Minimal Hint
  fail #2 -> Strong Hint
  fail #3 -> Full Answer / copy training
```

No stage receives a fresh two-failure budget.

Hard invariant:

> Three failed spelling attempts is the maximum before the full answer is shown.

### Explicit ESC

ESC means the learner explicitly gives up retrieval.

From any non-terminal Hint stage:

```text
ESC -> Full Answer immediately
```

If ESC happens in Cold Probe, the long-term result remains an explicit retrieval failure (Again).

### Hint presentation

- Minimal Hint: reveal the observed wrong position only; no automatic audio/phonetic.
- Strong Hint: reveal approximately half the orthography, including known wrong positions; automatic pronunciation + phonetic.
- Full Answer: show the full spelling; automatic pronunciation + phonetic; learner must type the answer correctly once.
- Legacy level 2 APIs may remain for compatibility, but the V2 automatic path does not need an extra retry stage.

### Evidence integrity

The first independent Cold Probe failure must be frozen before any assisted Hint presentation.

Later assisted/full-answer completion must not overwrite it as successful independent retrieval.

Target:

```text
cold independent evidence
        ↓ freeze
Hint-assisted training
        ↓
final WordRecord contains both the training context and the frozen cold evidence
        ↓
scheduler rating uses frozen cold evidence
```

## Acceptance criteria

- [ ] first-character Space never acts as surrender;
- [ ] ESC directly enters Full Answer from Cold/Minimal/Strong;
- [ ] first failed attempt enters Minimal Hint immediately;
- [ ] second failed attempt enters Strong Hint immediately;
- [ ] third failed attempt enters Full Answer immediately;
- [ ] no fourth unassisted/hinted failed-retrieval stage exists;
- [ ] Full Answer requires correct typing before completion;
- [ ] first Cold failure evidence is frozen before assistance;
- [ ] assisted final completion cannot upgrade the frozen Cold scheduler result;
- [ ] explicit Cold ESC remains Again;
- [ ] existing Acquisition all-visible behavior is not forced into Review Hint escalation;
- [ ] phrase spaces continue to behave as ordinary characters;
- [ ] domain/formal/browser regressions are updated;
- [ ] full Review Gate is green;
- [ ] master is untouched.

## Coordination

The existing P0 audio-regression task is temporarily `QUEUED` because it touches the same Word input/audio implementation. Restore it to `READY` after this task is accepted.
