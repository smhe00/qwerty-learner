# Short meaning choices — review handoff

Date: 2026-10-28 (Asia/Shanghai). Status: REVIEW.
Execution base: `d8fd93aa750857bdefb97960d228fa4fe81f33f4`.
Source commit: `47561146784a07a65e6ef8c515dc93b91dab7171`.
Source tree: `1efb6d2305c2aa2ec3192e3322917a49651a8c3a`.
Target branch: `product/main`. No etest/master promotion requested for this follow-up.

## Behavior

- Shared phone/tablet/desktop Learn choices use `shortMeaning` for both listening-to-meaning and word-to-meaning exercises. Audio title is now 听音选义, and its prompt asks for the meaning of the heard word.
- Missing, empty, whitespace-only, non-string or punctuation-only short glosses cannot form a meaning question. An unavailable target or no eligible distractor returns to existing recall; it never skips/marks the word complete.
- Missing short glosses are also excluded from distractors. Deterministic ordering and at most three distractors are retained. Normalized identical labels/shared semicolon/comma-separated senses are excluded between all choices. No long-translation fallback fills an incomplete pool. Two or three total choices remain valid as before; one target alone is not a choice exercise.
- Context cloze still shows English options and can operate without shortMeaning. Exposure, full-definition feedback, recall and independent spelling remain available. The selector keeps Review/Independent cold-probe logic separate from assisted choices.
- `WordPanel`'s post-completion queue copy now carries optional `shortMeaning`, preventing it from disappearing after the first answer.
- Audio evidence now correctly describes the UI: target spelling hidden, meanings visible. It remains assisted recognition/training evidence, not a cold spelling or memory proof. Playback failure switches to word-to-meaning without creating an attempt; attempts persist only through the existing commit service.
- Existing word records without the new field safely follow fallback behavior. No migration or dictionary data changes were needed in this follow-up; all earlier extraction data remains intact.

## Changed files

- `src/learn/choices.ts`: short gloss normalization, eligible pools and extracted unchanged cloze choice builder.
- `src/learn/task-selector.ts`: separate meaning-choice availability from cloze availability.
- `src/pages/Typing/components/WordPanel/components/MobileWordPractice.tsx`: shared choice rendering, labels and audio evidence.
- `src/pages/Typing/components/WordPanel/index.tsx`: preserve shortMeaning during queue projection.
- `tests/e2e/learn-short-meaning.spec.ts`: 23 focused contracts/browser tests across phone, landscape tablet and desktop.
- `tests/e2e/review-flow-harness.ts`: explicit short glosses in the eligible fixture and production-aligned guided-phase seed support.
- `tests/e2e/mobile-p0.spec.ts`, `tests/e2e/tablet-refresh.spec.ts`, `tests/e2e/desktop-tap-keyboard.spec.ts`: update eligible choice fixtures/assertions for short labels. Mobile successful-play mock also serves local audio bytes.
- `tests/e2e/mobile-p0.config.ts`, `.github/workflows/mobile-p0-gate.yml`: run and trigger the new regression spec in the existing gate.
- Dedicated task/report files; Circle CURRENT_TASK is untouched.

## Validation

1. New `learn-short-meaning.spec.ts`: **23/23 passed**, 1.2 min, Chromium. Covers missing/empty/whitespace targets after refresh, no phantom attempts, sparse/overlapping pools, actual short labels, full feedback, queue retention, assisted evidence, blocked audio fallback, context without short glosses and independent selectors. Each major flow is tested at 390×844, 1024×600 and 1440×900.
2. After aligning the newly supported guided fixture condition with production exposure policy: affected five tests rerun, **5/5 passed**, 13.4 s. No application changes followed the first successful build.
3. Focused existing mobile/tablet regressions: initial **8/9 passed**, with one external-audio fixture failure described below. All six selected tablet refresh/audio/short-height/hidden-document cases and unified selector passed.
4. After correcting the successful-audio fixture, single-tap advancement, wrong/Hard manual advancement, and Good→Again correction: **3/3 passed**, 35.7 s. The formerly failing wrong/Hard case passed without changing its persistence or timing assertions.
5. Desktop exposure Space/R and answer-choice keyboard tests: **2/2 passed**, 13.4 s. The choice test still requires four options and a correct persisted result. Used a temporary local Chromium config because Chrome channel is unavailable locally; temporary config removed.
6. `node --test tests/learn/mobile-review-commit-contract.test.mjs`: **6/6 passed**.
7. `yarn build`: passed, Vite 23.14 s (command 23.98 s), physical SPA entries emitted.
8. Scoped ESLint: no errors; two pre-existing warnings in WordPanel (unused TypingState and existing useCallback dependencies). `git diff --check`: passed.
9. `tsc --noEmit`: repository still has 143 diagnostics outside changed files; no diagnostics in changed source/test files. Whole-repository TypeScript cleanliness is not claimed.

### Investigated test failure

The old mobile successful-play helper replaced HTMLMediaElement.play() but allowed real external audio preloads. On the repeated wrong/Hard flow, trace showed `ability` in task=audio, audio-state=error, with the reachable “无法播放 · 改练词义” control. The test was waiting for choice buttons instead. Network records showed Youdao requests failing with `net::ERR_EMPTY_RESPONSE`, racing the mock's synthetic playing event. Reproduced once with trace, then served the existing local MP3 fixture for dictvoice requests. New blocked-play and existing pending/error recovery coverage remains intact; no product fallback, assertion, gate or timeout was weakened.

## Limits and delivery

The pool filter detects literal normalized shared senses, not all semantic synonyms. It does not certify arbitrary distinct Chinese strings as mutually exclusive meanings. Future dictionary additions should continue semantic review. No new real Huawei/iPad/HarmonyOS device verification is claimed; responsive behavior was tested in Chromium emulation.

Upstream was fetched after validation and remained at the execution base. Publish source plus this report through a single expected-SHA, force=false update of product/main. CI will run normally; local validation above is not a claim that remote CI has already passed. No staging/production release is part of this handoff.
