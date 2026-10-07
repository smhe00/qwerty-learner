---
protocol_version: "1.1"
task_id: "TASK-20261007-008-learn-live-stats"
title: "Add Learn-only live stats while preserving Typing stats"
status: "PASS"
target_branch: "product/main"
base_commit: "8b2c04ee0a336d3be696b7adb9438ac6c6df7ae1"
recommended_executor: "workbuddy"
allow_parallel_executors: false
report_file: "interactive/reports/TASK-20261007-008-learn-live-stats-report.md"
release_to_master: false
priority: "P1"
---

# TASK-20261007-008 — Learn-only live stats

## Objective

Replace the Typing-oriented live statistics **only when the user is in Learn mode**.

Typing mode must keep its current statistics, labels, semantics, layout and reducer behavior unchanged.

Learn mode should display exactly five low-pressure, cumulative statistics:

```text
学习时间 | 本轮进度 | 新学 | 已复习 | 独立回忆
```

The design goal is to show progress and accumulated achievement without exposing
error rate / failure pressure during active learning.

## Critical non-regression requirement

### Typing is frozen for this task

The current Typing statistics are:

```text
时间 | 输入数 | WPM | 正确数 | 正确率
```

They must remain exactly as they are in Typing mode.

Preferred architecture:

- leave `src/pages/Typing/components/Speed/index.tsx` unchanged;
- create a Learn-specific component/selector;
- at the shared page integration point render:
  - Typing -> existing `<Speed />`
  - Learn -> new Learn stats bar

Do not repurpose the existing Typing statistic fields to mean something different in Learn.

Do not change:

- `TypingState.timerData.wpm`
- `TypingState.timerData.accuracy`
- Typing input/correct/wrong counters
- Typing ChapterRecord semantics
- Typing statistics labels

If a touched shared file is unavoidable, prove Typing behavior is bit-for-bit/DOM-equivalent for the stats bar.

## Existing data that should be reused

No new database schema field should be introduced for this task unless proven absolutely necessary.

Relevant existing sources:

### Session timer

`TypingContext.state.timerData.time`

The existing page timer increments only while `state.isTyping` is true and stops on blur/pause through existing page behavior.

Use this for V1 Learn "学习时间".

### Current Learn session

`IReviewRecord` already contains:

- `index`
- `words`
- `sessionKind`
- `itemKinds`
- `itemStates`
- `acquisitionStates`
- `createTime`
- `isFinished`

Existing helpers in `src/learn/session.ts` include:

- `countLearnSessionLogicalWords()`
- `countLearnSessionAcquisitionWords()`
- `resolveLearnItemKindForWord()`

### Persisted Learn word evidence

`IWordRecord` already contains:

- `sourceMode`
- `learnItemKind`
- `timeStamp`
- `reviewEvidence`
- `reviewRatingDecision`
- `learningContext`
- `exerciseCondition`

Existing evidence vocabulary:

`reviewEvidence.retrievalValidity`:
- `independent`
- `assisted`
- `uncertain`
- `unknown`

and:
- `reviewEvidence.errorCause`

### Existing Learn analytics

`src/learn/stats.ts` already derives Learn-only statistics from WordRecord + ReviewWordState.

Reuse its existing concepts/helpers where semantically appropriate, but do not overload daily/history analytics to fake a current-session counter if a clean session selector is clearer.

## Required Learn metric semantics

### 1. 学习时间

Display the current session active timer:

```text
MM:SS
```

Source:

`TypingContext.state.timerData.time`

Do not introduce WPM/accuracy semantics into Learn.

### 2. 本轮进度

Display:

```text
completedLogicalWords / totalLogicalWords
```

Rules:

- count unique logical word names, never raw physical queue occurrences;
- reinforcement/retry/repeated occurrences must not inflate total or completed;
- total should prefer `countLearnSessionLogicalWords(reviewRecord)`;
- completed should use authoritative per-item terminal state when present:
  - review item terminal: `done` or `deferred`;
  - acquisition item terminal: `complete` or `deferred`;
- provide a conservative legacy fallback using current queue prefix/index only when item state metadata is absent;
- clamp to `0 <= completed <= total`.

The display must not jump backward during an ordinary active session.

### 3. 新学

Meaning:

> Unique acquisition words that have actually entered learning activity in the current Learn session.

Do **not** count physical attempts or repeated phases.

Prefer persisted Learn evidence for the active session:
- `sourceMode === 'learn'`;
- `learnItemKind === 'acquisition'`;
- record belongs to current dictionary;
- record time is at/after current `ReviewRecord.createTime`;
- word belongs to the current session's logical word set.

Count unique word names.

If current architecture provides a stronger canonical acquisition-introduction predicate
(e.g. existing admission helpers), use it rather than inventing a looser heuristic.

### 4. 已复习

Meaning:

> Unique Review-kind words completed/processed in the current Learn session.

Rules:

- only logical words whose Learn kind is `review`;
- count unique names;
- prefer authoritative terminal `itemStates` or a completed persisted Review attempt;
- do not count acquisition words;
- retries/reinforcement do not increment the count again.

### 5. 独立回忆

This metric must be strict and positive-only.

Count unique current-session words for which at least one persisted Learn WordRecord satisfies:

```ts
record.reviewEvidence?.retrievalValidity === 'independent' &&
record.reviewEvidence?.errorCause === 'clean'
```

Additional rules:

- `sourceMode === 'learn'` (or strong backward-compatible Learn provenance);
- current dictionary;
- current session time window;
- current session logical word set;
- dedupe by exact word name;
- assisted success must NOT count;
- independent failure must NOT count;
- multiple independent successes for one word still count as +1.

This metric is intentionally **not** "correct attempts".

## UX / emotional design constraints

Learn live stats should only expose neutral/positive cumulative metrics.

Do NOT show in the five live slots:

- 错误数
- 错误率
- 正确率
- Hint 次数
- Again/lapse
- overdue/backlog
- WPM
- failure percentages

Those may exist in analysis/statistics pages, but not in this active Learn strip.

All five Learn metrics should be non-negative and should normally be monotonic within the active session.

## Architecture recommendation

Introduce a pure selector, for example:

```text
src/learn/live-stats.ts
```

with a type conceptually like:

```ts
type LearnLiveStats = {
  elapsedSeconds: number
  completedLogicalWords: number
  totalLogicalWords: number
  newLearnedWords: number
  reviewedWords: number
  independentRecallWords: number
}
```

Keep data derivation separate from rendering.

Then add a Learn-only presentation component, for example:

```text
src/pages/Learn/components/LearnLiveStats/
```

It may reuse the visual primitive `InfoBox`, but should not alter Typing Speed semantics.

## Data refresh

The Learn live bar must update during the session, not only after page reload.

Use the existing reactive session state where possible.

If persisted WordRecords must be queried for "新学 / 已复习 / 独立回忆":

- refresh after a word result becomes durable / current session state advances;
- avoid high-frequency polling;
- do not add a database read per keystroke.

A single refresh per completed logical attempt/word is acceptable.

## Legacy / recovery behavior

Handle unfinished/recovered Learn sessions conservatively:

- no negative values;
- no double counting after reload;
- dedupe by word;
- current session stats should reconstruct from persisted records + reviewRecord state;
- reload should not reset already-earned counts to zero if evidence has been persisted.

## Tests required

### Pure selector tests

At minimum cover:

1. duplicate physical occurrences count once;
2. review vs acquisition separation;
3. assisted clean attempt does not count as 独立回忆;
4. independent failure does not count;
5. independent + clean counts exactly once;
6. multiple independent clean records for same word still count once;
7. legacy/missing item-state fallback;
8. completed progress never exceeds total.

### UI tests

Learn mode:

- exactly five labels:
  `学习时间 / 本轮进度 / 新学 / 已复习 / 独立回忆`;
- no `WPM`, `正确率`, `错误` label in the live strip;
- values update after Learn progress;
- reload/recovery reconstructs persisted counts.

Typing mode control:

- existing labels remain exactly:
  `时间 / 输入数 / WPM / 正确数 / 正确率`;
- existing value semantics remain unchanged;
- existing `Speed` component should ideally have zero diff.

## Acceptance Criteria

- [ ] Learn displays exactly five live metrics:
      学习时间 / 本轮进度 / 新学 / 已复习 / 独立回忆.
- [ ] Learn does not display WPM/accuracy/error-pressure metrics in this strip.
- [ ] Learn metrics use existing SSOT/evidence; no unnecessary new persisted schema.
- [ ] 本轮进度 counts unique logical words and ignores retries/reinforcement duplication.
- [ ] 新学 counts unique acquisition words actually entered in current-session learning evidence.
- [ ] 已复习 counts unique review words for the current session.
- [ ] 独立回忆 requires `retrievalValidity=independent AND errorCause=clean` and dedupes by word.
- [ ] Reload/recovery reconstructs Learn values without double counting.
- [ ] Typing still displays exactly:
      时间 / 输入数 / WPM / 正确数 / 正确率.
- [ ] Typing statistics calculation semantics are unchanged.
- [ ] Relevant pure tests + browser/UI regression tests pass.
- [ ] Build and touched-file lint/type results are recorded truthfully.
- [ ] No change to `master`.

## Validation

At minimum:

1. selector/unit tests for Learn live stats;
2. Learn browser test for labels + dynamic value change;
3. reload/recovery browser check;
4. Typing statistics control test;
5. relevant existing Learn/Typing gates;
6. build;
7. touched-file lint/type checks.

Do not weaken existing gates to make this task pass.

## Git / release permissions

```text
development_branch: product/main
push_allowed: true
release_to_master: false
force_push: false
branch_deletion: false
```

## Handoff

When complete:

1. write `interactive/reports/TASK-20261007-008-learn-live-stats-report.md`;
2. set task to `REVIEW`;
3. update `interactive/CURRENT_TASK.md`;
4. commit and push to `product/main`;
5. do not touch `master`;
6. do not self-approve.


## Reviewer Result

**PASS**

Accepted implementation: `17c427c15b0998fdd732231d612c66374e9b4a12`.

Typing statistics remain unchanged; Learn receives a separate five-slot live
statistics selector/presentation using existing session and persisted evidence.
No release to `master` is implied.
