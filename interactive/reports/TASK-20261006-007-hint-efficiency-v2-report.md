---
protocol_version: "1.1"
task_id: "TASK-20261006-007-hint-efficiency-v2"
status: "PASS"
executor: "chat"
target_branch: "product/main"
claim_base_commit: "4a84a49e93fc71b55e40984e83eecd43d10613c5"
accepted_candidate_head: "735f394bacb572a35e1c22e98a8d0e267458e37f"
release_to_master: true
---

# TASK-20261006-007 — Hint Efficiency V2 Report

## Result

**PASS**

The Review Hint flow is now optimized for bounded retrieval effort:

```text
Cold Probe
  fail #1 -> Minimal Hint
  fail #2 -> Strong Hint
  fail #3 -> Full Answer
```

A third failed spelling attempt is the hard maximum before full-answer
corrective training.

## Final product semantics

### Space

First-character Space is no longer a surrender command.

Space follows the ordinary spelling path, including phrase spaces.

### ESC

ESC is the only explicit surrender shortcut.

From Cold / Minimal / Strong:

```text
ESC -> Full Answer
```

Cold ESC preserves an independent `Again` result.

### Minimal Hint

After failure #1:

- reveal the observed wrong position;
- no automatic pronunciation;
- phonetic remains hidden.

### Strong Hint

After failure #2:

- reveal roughly half the orthography;
- retain all known wrong positions;
- automatic pronunciation;
- phonetic visible.

### Full Answer

After failure #3, or explicit ESC:

- reveal the entire spelling;
- pronunciation + phonetic available;
- learner must still type the answer correctly once;
- completion is corrective training, not proof of independent retrieval.

Legacy Hint level 2 remains a compatibility alias; the V2 automatic path is:

```text
cold -> hint-0 -> hint-1 -> hint-3
```

## Evidence integrity

The first independent Cold Probe failure is frozen in:

```text
learningContext.coldProbeEvidence
```

before assisted presentation changes the condition.

The final WordRecord therefore retains both:

- independent Cold Probe evidence;
- assisted Hint/training context.

Scheduler rating uses the frozen independent evidence and cannot be upgraded
merely because the learner later copied/typed the visible full answer.

This closes the main pedagogical integrity risk of the shorter Hint flow.

## Main implementation commits

- `df920b03` — three-failure Hint state machine
- `b08d8c50` — frozen Cold Probe evidence
- `30d85099` — Word integration / global failure budget
- `409ffe4c` — domain specification
- `7053f75d` — formal three-failure termination tests
- `3de91bd2` — browser Hint/ESC semantics
- `75d11b05` — remaining formal Hint V2 invariants

The concurrent Learn audio regression fix was integrated safely rather than
overwriting the shared Word implementation.

## Verification

Final release candidate validation:

```text
Review Gate 37442500149: SUCCESS
```

Passed layers include:

- Review domain tests
- Acquisition backup regression
- Review formal model
- TLA trace bridge
- Learn control stability
- async ownership race gate
- longitudinal simulation / Mutation 2.0
- Typing audio formal model
- FSRS shadow + G3
- sound URL guard
- dictionary URL guard
- Typing lifecycle browser gate
- Learn audio regression browser gate
- P3 browser stateful fuzz
- production build
- production navigation smoke
- multi-word Review browser gate

Additional resource validation:

```text
Dictionary Gate 37442500060: SUCCESS
```

## Acceptance criteria

- [x] first-character Space never acts as surrender
- [x] ESC directly enters Full Answer from Cold/Minimal/Strong
- [x] failure #1 enters Minimal Hint
- [x] failure #2 enters Strong Hint
- [x] failure #3 enters Full Answer
- [x] no fourth retrieval-failure stage
- [x] Full Answer still requires correct typing
- [x] first Cold failure evidence freezes before assistance
- [x] assisted completion cannot upgrade frozen Cold evidence
- [x] explicit Cold ESC remains Again
- [x] Acquisition all-visible behavior remains separate
- [x] phrase spaces remain ordinary spelling input
- [x] domain/formal/browser regressions updated
- [x] full final Review Gate green
- [x] no master change occurred before final approval

## Release decision

The integrated candidate at `735f394bacb572a35e1c22e98a8d0e267458e37f` is approved for release after this
task/report closure metadata is committed to `product/main`.
