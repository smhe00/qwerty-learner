---
protocol_version: "1.1"
task_id: "TASK-20261006-006-learn-key-wrong-audio-regression"
title: "Fix Learn typing-click and wrong-letter audio regression"
status: "READY"
target_branch: "product/main"
base_commit: null
recommended_executor: "workbuddy"
allow_parallel_executors: false
report_file: "interactive/reports/TASK-20261006-006-learn-key-wrong-audio-regression-report.md"
release_to_master: false
priority: "P0-regression"
---

# TASK-20261006-006 — Fix Learn typing-click and wrong-letter audio regression

## Objective

Fix a newly observed audio regression in **Learn mode**:

1. normal per-letter typing/click sound is no longer audible;
2. wrong-letter/error sound is no longer audible.

Restore both behaviors without regressing pronunciation audio, success-feedback audio,
Learn terminal progression, Typing mode, or the recent audio ownership/lifecycle fixes.

## User-observed symptom

On the latest `product/main`:

- enter Learn mode;
- type letters;
- the normal typing/key sound is missing;
- intentionally type a wrong letter;
- the wrong/error sound is also missing.

Treat this as a real field regression.

## Important existing code facts

Current `src/pages/Typing/components/WordPanel/components/Word/index.tsx`
still invokes:

- `playKeySound()` after a correct non-terminal character;
- `playBeepSound()` on a wrong character;
- both are returned by `useKeySounds()`.

Therefore do **not** assume the bug is simply a removed call site.

The current key/hint sound hook is:

- `src/hooks/useKeySounds.ts`

It gates playback from:

- `keySoundsConfigAtom`
- `hintSoundsConfigAtom`

Recent related pronunciation/audio-lifecycle work includes, among others:

- `3e494dd1764070d55a42f37e5934872d79ed568a`
  `fix(learn): enforce audio ownership and terminal lifecycle barriers`
- `7809f09ffbea47c90bcd0eff57122361883206e0`
  `fix(learn): enforce real 20-word cohorts and reliable pronunciation fallback`
- `88663580de25447a4ee591a751f88091fb96c546`
  `fix(audio): settle success playback from request-scoped completion`
- `aea78b3a88e27d73526775b0fd417b93cf2271c9`
  `fix(audio): propagate playback completion through pronunciation ref`
- `3095bb8b7567368a831136af497b17a5c894647f`
  `fix(audio): release success barrier on actual playback completion`
- `23adab189ecb1fcfde51022066660ca80909fdec`
  `fix(audio): avoid readiness and cleanup races in success playback`

These commits are investigation candidates, not predetermined root cause.
Do not revert them wholesale.

## Scope

### In scope

- reproduce the missing Learn key/click sound;
- reproduce the missing Learn wrong-letter sound;
- determine whether Typing mode is affected too;
- inspect audio configuration atoms/localStorage state and `useKeySounds`;
- inspect interaction with Howler / `use-sound` and pronunciation lifecycle;
- inspect Learn mount/unmount/owner-key behavior that may stop/unload/mute shared audio;
- implement the smallest robust fix;
- add regression coverage that would fail before the fix;
- validate real runtime behavior in a browser.

### Out of scope

- redesigning sound preferences UI;
- changing the intended sounds/resources;
- changing Learn pedagogy/hint semantics;
- broad audio architecture rewrite unless root cause proves it unavoidable;
- `master` release/deployment.

## Required investigation

### A. Reproduce first

Use a real browser/local dev build.

Verify at minimum:

1. Learn, correct non-terminal character:
   - expected: typing/key sound request actually reaches a playable audio instance;
2. Learn, wrong character:
   - expected: wrong/error sound request actually reaches a playable audio instance;
3. Typing mode equivalents:
   - determine whether this regression is Learn-only or global.

Do not claim success based only on function calls in source.

### B. Configuration sanity

Capture the effective values of:

```text
keySoundsConfigAtom:
  isOpen
  isOpenClickSound
  volume
  resource

hintSoundsConfigAtom:
  isOpen
  isOpenWrongSound
  volume
  wrongResource
```

Check persisted/localStorage migration/default behavior.
Do not "fix" the bug by blindly forcing preferences on if valid user preferences are off.

### C. Audio lifecycle

Inspect whether recent pronunciation ownership/cleanup causes collateral effects to
key/wrong sounds.

Pay particular attention to:

- `src/hooks/usePronunciation.ts`
- `src/components/WordPronunciationIcon/index.tsx`
- `src/hooks/useKeySounds.ts`
- `src/pages/Typing/components/WordPanel/components/Word/index.tsx`

Check for:

- Howl unload/stop side effects;
- WebAudio context state;
- stale/unloaded `use-sound` instances;
- remount timing;
- interaction between pronunciation and key/hint sounds;
- autoplay/user-gesture behavior;
- Learn-specific rapid owner-key/component lifecycle.

### D. Bisect / regression window

Use history/bisect or targeted checkout if useful to identify the first bad commit.
Record the first known good / first known bad boundary if determinable.

## Regression coverage requirement

This bug must gain executable coverage.

Add a focused regression test that proves both Learn feedback paths:

```text
correct non-terminal key -> key/click sound
wrong key                -> wrong/error sound
```

The test must detect a **real playback request/effect**, not merely assert that a wrapper
function exists.

Acceptable deterministic strategies include:

- controlled Howler/use-sound instrumentation;
- browser-side spy on the actual audio playback boundary;
- a narrowly introduced developer trace at the sound-request/playback boundary,
  if architecturally appropriate.

Avoid brittle assertions based solely on timing or human listening.

If Typing mode shares the same path, include a control proving Typing remains correct.

## Acceptance Criteria

- [ ] Learn correct non-terminal letters produce the configured typing/key sound again.
- [ ] Learn wrong letters produce the configured wrong/error sound again.
- [ ] Effective sound preferences remain respected.
- [ ] Typing mode sound behavior is not regressed.
- [ ] Word pronunciation still works.
- [ ] Success pronunciation / terminal progression does not hang or advance prematurely.
- [ ] Recent audio ownership/stale-owner protections remain intact.
- [ ] A deterministic regression test fails on the broken behavior and passes after the fix.
- [ ] Relevant existing audio/Learn tests pass.
- [ ] Build and touched-file lint/type checks are truthfully recorded.
- [ ] No change to `master`.

## Validation

Inspect existing scripts and run the strongest relevant subset.

At minimum:

1. new targeted regression test;
2. relevant existing Learn/audio lifecycle tests;
3. browser reproduction of key + wrong sound in Learn;
4. Typing control check;
5. build;
6. touched-file lint/type/static checks.

If project-wide checks have known baseline failures, compare before/after and report them
accurately; do not describe a failing baseline as PASS.

## Diagnostic evidence

The report must include:

- exact reproduction steps;
- root cause;
- whether Typing was affected;
- effective sound config during reproduction;
- files/commits implicated;
- before-fix regression evidence;
- after-fix evidence;
- test commands/results;
- any residual browser/autoplay uncertainty.

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

1. write `interactive/reports/TASK-20261006-006-learn-key-wrong-audio-regression-report.md`;
2. set task state to `REVIEW`;
3. update `interactive/CURRENT_TASK.md`;
4. commit and push to `product/main`;
5. do not self-approve; Chat/Reviewer will decide PASS or REWORK.
