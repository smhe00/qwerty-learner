---
protocol_version: "1.1"
task_id: "TASK-20261006-006-learn-keystroke-audio-regression"
title: "Fix Learn keystroke and wrong-letter audio regression"
status: "READY"
target_branch: "product/main"
base_commit: null
recommended_executor: "workbuddy"
allow_parallel_executors: false
report_file: "interactive/reports/TASK-20261006-006-learn-keystroke-audio-regression-report.md"
release_to_master: false
---

# TASK-20261006-006 — Fix Learn keystroke and wrong-letter audio regression

## Objective

Fix a regression in the **latest `product/main`** where Learn mode has lost both:

1. the normal typing/keystroke sound; and
2. the wrong-letter / error-letter feedback sound.

The fix must restore both behaviors without regressing pronunciation/success audio, Learn progression, Typing behavior, or the recent audio completion/barrier fixes.

## User-observed symptom

In Learn mode, on the latest code:

- pressing normal letters no longer produces the expected typing sound;
- typing an incorrect letter no longer produces the expected error-letter sound.

Treat this as a real regression, not a preference change.

## Context / High-risk recent history

Recent audio-related commits that must be reviewed as possible regression sources include:

- `88663580de25447a4ee591a751f88091fb96c546`
  - `fix(audio): settle success playback from request-scoped completion`
- `aea78b3a88e27d73526775b0fd417b93cf2271c9`
  - `fix(audio): propagate playback completion through pronunciation ref`
- `3095bb8b7567368a831136af497b17a5c894647f`
  - `fix(audio): release success barrier on actual playback completion`
- `6f1e13a3f47d6464087c88acfbaae7b1b199e526`
  - `test(audio): gate request-scoped fallback completion`
- `23adab189ecb1fcfde51022066660ca80909fdec`
  - `fix(audio): avoid readiness and cleanup races in success playback`

These commits are **suspects, not conclusions**. Do not revert them blindly. Determine the actual causal path.

Also inspect later Learn/state changes on current `product/main` in case the regression comes from event ownership, lifecycle, focus, mute/config state, rendering/remount behavior, or key handling rather than the audio transport itself.

## Scope

### In scope

- reproduce the missing normal keystroke sound in Learn;
- reproduce the missing wrong-letter sound in Learn;
- trace the complete event path from Learn key input to audio request;
- identify the first broken invariant / causal regression;
- implement the smallest robust fix;
- add regression coverage that would have caught this exact failure;
- verify pronunciation/success audio still works after the fix;
- verify Learn progression is not delayed or blocked by feedback audio;
- verify shared audio changes do not regress Typing mode.

### Out of scope

- redesigning the whole audio subsystem;
- changing audio UX or sound assets without necessity;
- changing Learn scheduling/mastery semantics;
- unrelated UI changes;
- deployment or release to `master`.

## Required investigation

Do not patch by guessing. Establish the causal chain.

At minimum inspect:

1. Learn key event handling;
2. correct-letter feedback path;
3. incorrect-letter feedback path;
4. audio enable/mute/config state;
5. relevant hooks / audio refs / owner keys;
6. component mount/unmount and cleanup behavior;
7. any shared helper used by Typing and Learn;
8. recent changes that may call `stop()`, reset refs, invalidate ownership, suppress playback, or move playback behind a state transition;
9. browser autoplay/focus conditions only if evidence points there.

Record the root cause in terms of:
- expected event;
- actual event;
- broken invariant;
- exact commit/file/function where possible.

## Required regression coverage

Create targeted automated coverage for **both missing sounds**.

The test must fail on the broken baseline and pass after the fix, or otherwise demonstrate equivalent mutation/regression sensitivity.

Minimum cases:

### Case A — Learn normal keystroke sound

- enter Learn;
- reach a state where the learner is expected to type;
- type a correct non-terminal character;
- assert that the keystroke feedback audio request occurs.

### Case B — Learn wrong-letter sound

- enter Learn;
- type an incorrect character;
- assert that the wrong-letter/error audio request occurs.

### Case C — coexistence with pronunciation/success audio

- complete a word / exercise path that triggers pronunciation or success audio;
- assert the recent success-audio completion/barrier behavior still terminates correctly;
- ensure Learn advances normally.

### Case D — Typing mode smoke regression

If the same primitive/hook is shared with Typing, add or run a smoke assertion that Typing's normal/error sound behavior remains intact.

Prefer deterministic audio request interception/spies over relying only on audible hardware output.

## Acceptance Criteria

- [ ] Learn normal typing/keystroke sound is restored.
- [ ] Learn incorrect-letter/error sound is restored.
- [ ] Both behaviors are covered by targeted regression tests.
- [ ] Tests distinguish these sounds from pronunciation/success audio.
- [ ] Pronunciation/success audio still works.
- [ ] Recent request-scoped success-audio settlement/barrier behavior is not regressed.
- [ ] Learn still advances correctly after successful completion.
- [ ] No unrelated Learn scheduler/state-machine behavior changes.
- [ ] Typing mode is not regressed if shared audio code is touched.
- [ ] Root cause is documented with evidence, not just a symptom-level patch.
- [ ] No `master` change or deployment occurs.

## Validation

Inspect project scripts first and run the strongest relevant local checks.

At minimum:

1. targeted new regression tests for Case A + Case B;
2. relevant existing audio tests, including the recent success/fallback completion tests;
3. relevant Learn browser/integration test(s);
4. touched-file lint/type checks;
5. project build;
6. any existing Review/Learn gate materially affected by the changed code.

If a full gate is too expensive or unavailable locally, report `NOT_RUN` explicitly and explain why.

Do not report PASS for checks that were not actually executed.

## Patch discipline

- Do not simply revert the recent success-audio commits unless the root-cause evidence proves that is the correct fix.
- Prefer preserving request-scoped success completion while restoring independent per-keystroke/error feedback.
- Avoid coupling transient typing feedback to word-completion barriers.
- Avoid introducing timing sleeps as the primary fix.
- Do not silence or weaken tests to make the patch pass.

## Deliverables

- implementation on `product/main`;
- targeted regression tests;
- execution report at `interactive/reports/TASK-20261006-006-learn-keystroke-audio-regression-report.md`;
- root-cause explanation;
- exact validation results;
- implementation commit SHA(s);
- remaining-risk note.

## Git / Release Permissions

```text
development_branch: product/main
push_allowed: true
release_to_master: false
force_push: false
branch_deletion: false
```

## Reviewer Notes

Reviewer should explicitly verify that the fix restores **two independent feedback paths**:

1. normal keystroke sound;
2. wrong-letter sound.

A fix that restores only pronunciation/success audio is insufficient.

Also verify that any solution touching shared audio lifecycle does not reintroduce the previously fixed fast-playback / fallback-settlement / stale-owner races.
