---
protocol_version: "1.1"
task_id: "TASK-20261023-mobile-stability"
status: "REVIEW"
executor: "Codex (independent mobile UI stability)"
target_branch: "product/main"
claim_base_commit: "94f71b527b64d08495b8dbf0d00fd2eed6aa25c1"
last_commit: "4b7bb63e5bb71c395277219593399cd6fb594fa6"
upstream_head_at_integration: "812955c8379c7e681a2da752f314461952b91138"
---

# Mobile local learning stability

Owner selected mobile stability wrap-up, with cloud synchronization reserved for another thread. This task did not edit src/sync, cloud-functions, account UI, CURRENT_TASK, remote data formats, or FSRS/progression policy. No cloud accounts or live cloud API writes, etest promotion, master update, dependency/runtime changes, or data clearing. Saving failures mentioned in this task were deliberately injected local test faults, not observed incidents on the owner's phone.

## Confirmed problems and changes

1. Failed Again/Hard saves left the card showing a saving message without a retry. All frozen recall grades now expose retry; the original pre-reveal condition/grade is retained and one durable answer is written when retry succeeds.
2. The mobile card discarded partial spelling, pending verification and saved feedback on SPA back/menu navigation. Added bounded document-memory draft atoms keyed by dictionary, session ID/create time, queue position and persisted exercise condition/phase. In-flight async saves update the same atom after remount; already saved feedback is reused rather than writing another WordRecord. Cache is limited to 24 cards and removed after successful progression. It never touches localStorage, IndexedDB formats or cloud settings. Transient React reload counters are excluded from identity. The currently mounted reducer reattaches an existing restored record ID without writing another raw event.
3. Header exit previously waited for checkpoint writes but could leave before an in-flight raw answer resolved. The existing saveWordRecord operation is now registered with trackLearnPersistence before waiting. The existing header barrier waits for it and any subsequently scheduled projection writes. Native SPA back is separately tested for draft/pending-answer recovery. The shared static commit contract was strengthened to require the raw-save tracking wrapper while retaining the existing raw-before-FSRS assertions.
4. Audio ownership previously survived pause and reused shared request metadata. Extracted an owner-per-playback hook; pause, hidden/pagehide, blur and unmount invalidate ownership and stop media immediately. Late playing/error callbacks cannot update playback evidence. Blocked playback offers a tap, failed loading expires after 8 seconds, and manual replay creates a fresh owner. Exposure remains usable after sound failure; the existing audio-task fallback remains available. No rating/FSRS rules changed.
5. 100dvh alone does not follow the soft keyboard on browsers that resize only the visual viewport. The mobile study shell follows visualViewport height/offset, uses compact controls when necessary, cleans up listeners, and stops applying this fit during pinch zoom. IME composition Enter is prevented from submitting an answer. Pagehide pauses study; ordinary foreground focus does not resume it automatically.
6. The root and 404 fallback allowlists omitted the new library/settings routes. Both now recognize those existing local routes. Tests exercise the actual 404 script and root restoration, preserving the query without a redirect loop.

## Validation

Windows, installed Chrome, Node 22, Yarn 1.22. Isolated localhost browser profiles and synthetic records only. No test-only product hooks.

| Check | Result | Evidence |
| --- | --- | --- |
| Main mobile/desktop regression (before final barrier refinement) | 80/80 passed, 280.69s | .review-test/mobile-stability-regression.txt; mobile P0, prior loop, external keyboard, stability, desktop tap, shared pause, Typing lifecycle |
| After first FF integration and stable-key/blur refinement | 59/59 passed, 209.08s | .review-test/mobile-stability-final-browser.txt; all mobile surfaces plus desktop tap/external keyboard |
| Final raw-answer exit barrier + local stability | 17/17 passed, 67.55s | .review-test/mobile-stability-barrier.txt; real IDB failure/slow write, saved feedback, pending Good correction, keyboard fit, IME, audio, BFCache guard, next-card draft isolation, header waiting |
| Actual 404 script routing after strengthening fixture | 2/2 passed, 17.31s | .review-test/mobile-stability-fallback.txt |
| Existing shared commit contracts, final wrapper asserted | 6/6 passed | .review-test/mobile-stability-contracts.txt |
| Final scoped ESLint | 0 errors / 2 pre-existing WordPanel warnings | .review-test/mobile-stability-lint-final.txt |
| Scoped TypeScript | No diagnostics in changed Mobile/Typing components/hooks/store | .review-test/mobile-stability-tsc-final.txt; whole repository still has 141 diagnostics outside this scope |
| Architecture | Passed | 62 Learn/Review modules + 3 low-level files |
| Normal build, final integrated tree | Passed, 26.15s Vite | .review-test/mobile-stability-build-integrated.txt; physical route entries present |
| Cloud-disabled Pages build, final integrated tree | Passed, 26.34s Vite | .review-test/mobile-stability-pages-build-integrated.txt |
| Final local Pages browser smoke | 5/5 passed, 14.31s | .review-test/mobile-stability-pages-integrated.txt; local routes/reload and existing disabled/read-only account previews, zero cloud API requests |
| Patch whitespace / staged-file scope | Passed | git diff --check; only local mobile UI, route fallbacks and test/doc changes |
| Visual review | Passed in Chrome emulation | keyboard viewport screenshot: 320–460px visible heights, offset adjustments, input and confirmation visible, native zoom retained |

The audio tests include both controlled delayed/blocked callbacks and real HTMLAudioElement playback with an intercepted local MP3. They do not certify the real Youdao endpoint or a physical speaker. Keyboard viewport tests model visual viewport resizing; they do not emulate a real vendor keyboard.

Initial lifecycle tests wrongly assumed persisted pageshow preserves the app context. The existing S1 entry deliberately reloads on BFCache restoration; that code was not changed. Tests were split into same-document pause/recovery and actual guarded reload preserving durable records. A further draft test used a training decision as though it requested canonical retry, but the existing bounded policy correctly defers it; the fixture was replaced with reachable next-card isolation, without changing policy or weakening its assertions. The initial static source contract required a direct save call; it now explicitly requires the added tracking wrapper. All final results are listed above; no full-repository TypeScript PASS is claimed.

## Integration / Git state

Base was 94f71b527b64d08495b8dbf0d00fd2eed6aa25c1. Parallel cloud development advanced through 3dbca6e49bce7afec9c21c21b02b9a665d4b1ec7 and 71b88c49583c3c3c9915af2ce1442ea0269b2b6a to 812955c8379c7e681a2da752f314461952b91138. All integrations were fast-forwards with disjoint UI edits retained. Last two upstream commits only added private staging scratch diagnostics; both builds and Pages smoke were rerun after the final integration. Their cloud files were not modified by this task.

Implementation: 4b7bb63e5bb71c395277219593399cd6fb594fa6. Report, task and device checklist accompany it in a documentation commit. Normal push targets product/main only; no force push. Pages publication/CI must be distinguished from the local checks above and verified against the final pushed source marker.

## Remaining acceptance and limits

- Physical Huawei browser, phone Chrome and iOS Safari tests are NOT RUN. Follow docs/mobile/MOBILE_DEVICE_ACCEPTANCE_2026-10-23.md and record actual versions/results.
- Current-document drafts restore SPA navigation only. Refresh, process destruction, account document replacement and the existing S1 BFCache reload discard them. Do not promise preservation of unsubmitted half-words across those boundaries. Durable records and guarded reload compatibility were tested separately.
- No router-wide POP interception or cloud lease change was introduced. In-app header return now waits for raw answers; native back reuses a current-document draft.
- No cloud suite or live sync certification was attempted. Keep those acceptance decisions with the other thread. A master release remains unauthorized.

## References consulted

- MDN visual viewport: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- MDN page lifecycle: https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event
- MDN browser storage quotas (explains local QuotaExceededError, not an incident diagnosis): https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
