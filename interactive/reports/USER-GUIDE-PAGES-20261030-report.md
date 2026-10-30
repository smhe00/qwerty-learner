# User-facing guide / Pages proof
Status: LOCAL_VALIDATED; published proof pending. Executor: Codex-user-guide. Base f2892841fa3faa48b6d48d17c7ac34a5ef2b3ad9.

## User result
Shared user-level guide with one-minute three-step start, phone/computer instructions, learning/review, account/records/backup, settings and FAQ. Details expand on demand; no automatic popup or required login. Desktop toolbar/footer open the existing-style guide overlay; settings jump directly to its section. Phone home adds one menu row; settings/data provide contextual links with explicit return. Direct links/reloads have safe local return routes. Phone reading scrolls independently beneath its fixed return header. Pages copy explicitly identifies disabled cloud functions.

The guide is presentation/routing only. No learning/review/sync/merge/account/ownership/storage-schema algorithms changed. Existing Typing pause action is reused before opening a guide. Reading/device-switching/close/reload is tested against native RecordDB rows and session/account storage with zero Pages API calls. No etest/master push authorized or performed.

## Validation checkpoint
- Production Pages build and global CSS ownership PASS; scoped frontend ESLint zero errors.
- Seven SPA/Pages fallback contracts PASS, including guide/phone-guide hashes/deep links.
- Initial six-device/theme UI proof PASS after fixing header occlusion: phone 320x568/390x844, tablet 1024x600, desktop 1440x900, light/dark. Zero axe violations and touch-geometry failures across start and expanded sections. Device/contextual return, keyboard isolation and no durable data changes verified.
- Extended direct-link/reload/focus-trap coverage: five passed, one tablet-light click stalled in Chromium's scroll-into-view action while the header was visibly unobscured; targeted unchanged tablet-light rerun PASS (6.9 s). Fresh CI will reconfirm the full matrix. No assertion narrowed or forced click added.
- Screenshots manually reviewed for phone light/dark and desktop start/expanded reading. Axe incomplete items retained: Headless UI focus guards (verify Tab containment) and text clipped outside the modal scroll region (not a confirmed contrast violation); visible text uses existing theme tokens.
- Whole-tree TypeScript has existing unrelated diagnostics; no diagnostics in the changed guide, app or mobile source. Published regression syntax collection passes with seven Chromium journeys, including new guide proof.

## Remaining
Complete targeted tablet/direct/focus and active-word checks, integrate current upstream safely, push development main only, then wait for the exact-SHA Pages UI matrix, actual published source marker and published guide regression. Retain run IDs and evidence. Real Android/iOS/HarmonyOS devices not tested; no cloud behavior certified from Pages.

## Final local checkpoint
Final production Pages build + CSS ownership PASS (31.63 s); frontend ESLint PASS. Extended phone/tablet/desktop light/dark guide journeys pass, including direct links, reloads, contextual returns, device switch and desktop Tab containment. One initial tablet action stalled in Chromium scroll-into-view; the focused unchanged rerun passed. Active-word light/dark tests PASS (2/2, 7.8 s): practice keys and Enter within guide do not commit an attempt or move the word index, and closing/resuming retains the exact word. The active-word test explicitly focuses a device-reading button before Enter; Enter on the close button is correctly a close action, not a learning keystroke. No product behavior changed for that test preparation.

Existing mobile menu-copy assertions updated for the newly approved guide row/subtitle; no other menu expectation removed. Scoped TypeScript has no diagnostics in new guide/app/mobile sources; whole-tree pre-existing errors remain. Published Pages syntax collection: 7 Chromium journeys. Only main will be pushed; Pages CI must build with the actual basename and cloud disabled, then verify exact published SHA, reading/return/data preservation and zero API calls.
