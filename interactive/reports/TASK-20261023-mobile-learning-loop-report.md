---
protocol_version: "1.1"
task_id: "TASK-20261023-mobile-learning-loop"
status: "REVIEW"
executor: "Codex (independent mobile UI task)"
target_branch: "product/main"
claim_base_commit: "e6c7800ba93c14d1f0443c66d5d0481a133e3fa6"
last_commit: "1699f0b88efc2220ddb34cc2ba785599e0fcaa5a"
upstream_head_at_integration: "d6c96086c2189f17d5c8f6a6754b53f98c396db7"
---

# Mobile local learning loop

Owner authorized the non-cloud mobile P0 implementation and explicitly reserved cloud work for another thread. CURRENT_TASK was not claimed or edited. No changes to src/sync, cloud-functions, authentication UI, cloud status, remote schemas, FSRS policy, or the other executor's task/report. No cloud account operations, etest promotion, or master update.

## Confirmed problems and implementation

- Mobile header exit previously caught a failed flush and still navigated. It now pauses, queues the latest existing checkpoint snapshot, and waits for the existing local persistence barrier. A failed write leaves the mounted word/input intact and opens a focus-managed retry/stay dialog. Retrying requeues the snapshot so the existing serialized writer can recover from a rejected queue. No new persistence protocol.
- Mobile completion previously bypassed local block settlement and immediately claimed success. The mobile result now subscribes to one stable local settleLearnBlockDurably promise, handles StrictMode replay, displays saved status and celebrations only after settlement, and offers retry after failure. It never calls syncCompletedLearnSettlement or any upload operation. Continue remounts the mobile Learn controller through the route key; local block settlement is idempotent.
- Returning from the menu with a warm dictionary could strand mobile preparation. The mobile landing omitted learnPageRootRef, so StrictMode cleanup revoked its own asynchronous preparation claim. Attaching the existing root ref fixes this local controller issue without changing cloud ownership.
- The homepage displays canonical persisted new/review/carry-over progress. Before today's first session, it derives a pure preview using the existing planner without saving a DailySession. Failed reads expose retry rather than false zero progress.
- Library and settings now have real mobile routes. Library reuses the display-only English/computing taxonomy and original resource IDs, confirms selection, flushes the old checkpoint before switching, and preserves per-dictionary records. Composite React keys handle the catalog's pre-existing duplicate IDs. Search operates across the selected section; choosing a section/category resets search.
- Settings reuse existing memory/audio/phonetic/theme atoms, preserve unrelated preferences, validate daily 1–200 and block 1–50 limits, and correctly hydrate saved values. Today's established cohort remains frozen. Settings are described as browser-local. No new remote setting fields.
- Mobile layout uses existing theme variables, safe-area padding, 44px controls and 16px form inputs. Added normal-build physical SPA entries for the two local routes; Pages retains its existing 404 routing.

## Changed files

- src/pages/Mobile/: MobilePageFrame, MobileDailyProgress, useMobileDailyProgress, MobileLibrary, MobileSettings, MobileResult; existing homepage, study wrapper and CSS.
- src/pages/Typing/index.tsx: mobile-only exit protection and local result wiring; desktop result/controls remain on their existing path.
- src/pages/Learn/index.tsx: attach existing async ownership root ref on mobile landing.
- src/app.tsx and scripts/emit-edgeone-spa-entries.mjs: local mobile routes.
- tests/e2e/mobile-learning-loop.spec.ts: 8 real-browser contracts. Added to the existing mobile config/workflow trigger. Existing placeholder count adjusted from four to two.

## Validation executed (Windows, Node 22, Yarn 1.22, installed Chrome)

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop tap keyboard, mobile external keyboard, mobile P0, new learning loop, session pause, Typing lifecycle | 65/65 passed, 243.01s | .review-test/mobile-loop-regression.txt; local temporary config used Chrome and desktop viewport, individual phone tests retained their phone viewports |
| After FF integration and final UI adjustment: mobile P0 + new loop | 24/24 passed, 104.85s | .review-test/mobile-loop-integrated.txt; 8 loop + 16 existing P0 cases |
| Cloud-disabled Pages preview | 5/5 passed, 12.06s | .review-test/mobile-loop-pages-browser.txt; new local menu/library/settings routes + reload, existing desktop/mobile account preview and legacy read-only guards; zero API requests |
| Existing mobile/desktop review-commit contracts | 6/6 passed | node --test tests/learn/mobile-review-commit-contract.test.mjs |
| Existing display catalog contracts | 4/4 passed | node --test tests/resources/dictionary-catalog.test.mjs |
| Scoped ESLint after integration | 0 errors, 1 existing Learn cleanup-ref warning | .review-test/mobile-loop-lint.txt |
| TypeScript after integration | No diagnostics in modified app/mobile/Learn/Typing entrypoints | .review-test/mobile-loop-tsc-integrated.txt; full repository remains non-green with 143 diagnostics outside this scope |
| Architecture boundaries | Passed | node scripts/validate-architecture-boundaries.mjs; 62 Learn/Review modules + 3 low-level files |
| Normal build after integration | Passed, 35.61s Vite | .review-test/mobile-loop-build-final.txt; new physical route entries present |
| Pages build after integration, cloud disabled | Passed, 29.71s Vite | .review-test/mobile-loop-pages-build.txt |
| git diff --check | Passed | Before implementation commit |
| Visual inspection | Passed for desktop Chrome emulation | Home/library/settings at 320px, result and failed-save dialog at 390px, dark settings; screenshots under ignored .review-test/ |

Fault tests intercept actual IndexedDB checkpoint writes or localStorage daily settlement writes in an isolated browser profile. They verify blocked navigation, unchanged word/input, retry, durable IndexedDB readback, no false saved status, and exactly one committed block. Other cases cover explicit dictionary cancel/switch/resume, native setting bounds/unrelated preferences/reload, read-only daily preview, saved independent review progress and a frozen target after changing the next daily target. No production test backdoors.

The initial 7-case run had three actionable failures (voice label, warm preparation restore/continuation). They were fixed in product code; the subsequent full runs above passed. An initial combined local run was stopped when its temporary config was found to apply a phone default viewport to desktop-only cases; it was restarted with the correct desktop default. No committed assertion/time-limit weakening. Local Chrome configs used 15-second expectation timeouts for cold Vite startup.

## Branch integration / Git state

- Execution base: e6c7800ba93c14d1f0443c66d5d0481a133e3fa6.
- Parallel main advanced by seven cloud-only commits to d6c96086c2189f17d5c8f6a6754b53f98c396db7. They were integrated with git merge --ff-only while preserving the disjoint UI working changes. Their cloud files were not edited. Mobile suite, lint/type/architecture and both builds were rerun after integration.
- Implementation commit: 1699f0b88efc2220ddb34cc2ba785599e0fcaa5a.
- Report/task accompany the implementation as a documentation commit. Normal push to product/main only; no force push. Published Pages propagation/CI are separate from local validation and should be checked against the final pushed source SHA.

## Remaining limits / handoff

- Physical Huawei browser/iOS keyboard, audio, suspension/force-kill and back gestures still need owner device acceptance. Automated audio calls are mocked; these results do not certify real-device audio delivery.
- Exit protection covers the in-app header return action. Browsers cannot guarantee an async IndexedDB flush after process termination; existing recovery remains in place. No router-wide navigation interception was introduced.
- Full repository TypeScript baseline is not green; it is not reported as passing. No cloud suite/live cloud acceptance was attempted for this excluded scope.
- Review on the development Pages mobile entry, then perform physical-device learning acceptance. Keep all cloud integration/etest decisions with the other thread. No master release is authorized by this task.
