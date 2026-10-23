---
protocol_version: "1.1"
task_id: "TASK-20261023-mobile-ergonomics"
status: "REVIEW"
executor: "Codex (independent mobile UI)"
target_branch: "product/main"
claim_base_commit: "1a70bfe219af1fef187fcd4b71484332415a291f"
last_commit: "30cbb8436f86f5842e2322e102eaf3768b272dfc"
release_to_master: false
---

# Mobile ergonomics, ordered implementation

The owner authorized the six items from the mobile UI review. Work is limited to local mobile presentation and existing shared save/audio adapters. src/sync, cloud-functions, account UI, FSRS rules, learning progression, durable schemas, CURRENT_TASK and the cloud executor's reports were not edited. No cloud accounts/API writes, master/etest promotion, dependency or runtime changes. Intake and final fetch both observed upstream product/main at 1a70bfe219af1fef187fcd4b71484332415a291f.

## Result

1. Mobile Good verification now has explicit bottom-zone 48px correction and confirmation buttons instead of the reading-area 30px dot. The default verification window still preserves quick automatic learning; Stop to read is available before saving. Corrected grades continue to use the original frozen pre-reveal condition/context, including after answer replay. Desktop correction/keyboard behavior remains on its existing branch.
2. Stop to read, touching/focusing/scrolling the revealed reading area, expanding the example, or replaying an answer holds mobile automatic timers. A synchronous ref protects the event-to-timer-cleanup gap. A held Good requires explicit confirmation; an already durable success requires only Next, never a second save. Hold and expanded-example state share the bounded current-document UI draft; they are discarded on successful progression and do not add persistent/cloud schema. Untouched cards retain 2.6s verification / 1s feedback advancement.
3. Mobile has one bottom-zone mode switch, available at compact height and preserving partial spelling when switching back. It labels the actual cold spelling task even when the selector requested spelling automatically. The original preference metadata/keyboard intent remains intact. Desktop keeps its separate existing mode control.
4. Long examples retain a three-line default and offer an accessible expand/collapse control only on actual clipping. Native ResizeObserver measures clipping with a resize-listener fallback when unavailable. Expanded content scrolls in the reading area while actions stay below. Cold targets remain masked; dictionary coordinates and evidence are unchanged. Phone example text no longer shrinks to 11px; desktop font sizing is retained.
5. Revealed and saved mobile answers can replay pronunciation. Reading/replay stops automatic movement and uses the existing per-request audio owner. A pending Good keeps its frozen pre-reveal evidence; a saved row is never rewritten by replay. Replay/mode/expansion controls provide at least 44px touch height.
6. Settings previews unsaved voice, volume and rate with an isolated, non-automatic audio hook instance. Parameter edits and navigation dispose the prior owner. Preview does not persist settings or learning evidence. Save is sticky within the settings form; the mobile detail container no longer creates the overflow ancestor that prevented sticky positioning. Pending changes are explicit; display remains clearly labelled as immediate. No extra confirmation dialogs were added.

## Verification (Windows, installed Chrome, isolated local profiles)

| Check | Observed result | Local evidence |
| --- | --- | --- |
| Main phone/desktop regression before final mode-label and fallback refinement | 90/90 passed, Yarn 328.73s | .review-test/mobile-ergonomics-regression.txt; P0, local loop, stability, external keyboard, desktop tap, pause, Typing lifecycle; includes the first eight new ergonomics tests |
| Final affected UI/keyboard suite | 16 existing cases passed; newly added automatic-mode fixture failed before entering the tested UI | .review-test/mobile-ergonomics-final.txt; all eight ergonomic cases and eight external-keyboard cases passed on final app source |
| Automatic-mode fixture after using the actual mobile menu bootstrap | 1/1 passed, Yarn 15.57s | .review-test/mobile-ergonomics-auto-probe.txt; correctly labels automatic spelling and directly switches to recall without submitting |
| Shared raw-before-FSRS/frozen-evidence contracts | 6/6 passed | .review-test/mobile-ergonomics-contracts-final.txt |
| Scoped ESLint | 0 errors / 0 warnings | .review-test/mobile-ergonomics-lint-final.txt |
| Scoped TypeScript | No errors in changed Mobile components, shared mobile practice components or draft store | .review-test/mobile-ergonomics-tsc-final.txt; repository has 144 src diagnostics outside this scope; no full TypeScript PASS claimed |
| Architecture | Passed, 62 Learn/Review modules + 3 low-level files | .review-test/mobile-ergonomics-architecture-final.txt |
| Normal build, final app source | Passed, Vite 39.20s / Yarn 40.78s | .review-test/mobile-ergonomics-build-final.txt |
| Cloud-disabled Pages build, final app source | Passed, Vite 27.68s / Yarn 29.40s | .review-test/mobile-ergonomics-pages-build-final.txt |
| Local Pages browser smoke, final app source | 5/5 passed, Yarn 13.92s | .review-test/mobile-ergonomics-pages-final.txt; routes/reload plus existing read-only/disabled account previews |
| Whitespace/scope review | Passed | git diff --check; independent local UI only |
| Visual review | Held correction, 320x460 spelling and settings preview inspected in Chrome screenshots | New ergonomics suite screenshots; accessible bottom actions and input visible |

The initial new suite exposed a real sticky-save issue caused by the mobile overflow ancestor; the CSS was corrected and the case passed in the 90-case run and final affected suite. The extra automatic-mode case initially tried to import a module on about:blank, then used a desktop-only readiness control on a phone route. Its fixture now mounts the actual phone menu, seeds isolated local history through the real Dexie module, and enters study via its SPA link. No product bootstrap guard or learning-policy assertion was weakened. The existing static timer contract now requires the new reading-hold guard before calling the frozen save reference.

## Acceptance limits

Physical Huawei browser, phone Chrome and iOS Safari have NOT been run. Verify actual soft keyboard, rotation, screen-reader controls, reading/hold during background recovery and audio output on devices. The tests model viewport changes and use controlled audio callbacks; the earlier stability suite also exercises a real local audio fixture. This is not certification of the live pronunciation endpoint or cloud sync.

Current-document UI drafts do not survive refresh/process destruction or the existing guarded BFCache document reload. Durable records remain owned by existing persistence/S1 paths. Pages publication and CI for the final pushed SHA must be checked separately from local build results; no production release is authorized.
