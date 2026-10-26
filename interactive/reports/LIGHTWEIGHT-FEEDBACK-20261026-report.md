# Lightweight private feedback — implementation report

Status: REVIEW — implementation complete, development push and scoped CI passed. No release promotion. Independent of the Circle task.
Base: 875c82a2c404b441dc582aa3a018288edeed1f9a.
Task: interactive/tasks/LIGHTWEIGHT-FEEDBACK-20261026.md.

## Scope
PC account dropdown and settings, mobile home menu; shared responsive dialog. Submitters see private conversations and can follow up. Existing server-verified SMHE administrator can list all feedback, reply, and set waiting/handling/resolved. User follow-up returns status to waiting. No attachments, public wall, notifications, email, account migration, or learning-sync calls.

Anonymous visitors retain a 256-bit random private credential in browser storage. A recovery URL carries it only in the fragment, removes it through the router after opening, and lets the visitor continue their anonymous conversations on another device. Credentials are not saved in Blob; the server derives a SHA-256 owner selector. Recovery preserves existing browser anonymous credentials rather than overwriting them. Losing both browser credentials and the link loses access; UI explains this. Anyone holding the private link can access that anonymous inbox. Account and anonymous inboxes remain separate.

## Storage and safety
- Account content: users/<verified-user-id>/feedback/v1/. Guest content: feedback/v1/guests/<derived-owner>/.
- Opaque list indexes: feedback/v1/index/<owner>/. No feedback text in the index. Manual and idle account deletion remove account content and indexes; guest content is separate.
- Content-addressed immutable thread/message keys, no shared mutable replies array or CAS. Before submission the browser persists the exact pending operation, and retries it after a timeout or refresh. Unknown writes receive a single strong readback rather than blind server retries. Retry IDs and bytes are retained until confirmation.
- Live account session validation and existing administrator identity verification occur server-side. Invalid account credentials do not downgrade to anonymous access. Unknown/foreign conversations are not exposed. No test-only bypass introduced.
- Input 16 KiB HTTP / 80-character title / 2000-character message; 20-thread pages; message writes stop at 200 (advisory under concurrency), reads tolerate concurrent overflow with a separate 1000-message safety bound. Bounded 5-way Blob reads. Existing best-effort distributed limiter: 10 writes / 60 reads per trusted client IP per minute. This is not a hard distributed quota.
- First version has manual refresh and loaded-page date ordering, no unread push/badge, keyword search, attachments, or anonymous expiry job. Pages provides an unavailable explanation and issues no feedback API requests.

## Validation
- 68 targeted backend/actual-route contracts passed: feedback isolation/recovery/permissions, repeated writes, lost ACK, offline recovery, concurrent replies, input/pagination/rate limits, actual signed admin/session revocation, Blob deletion, idle cleanup, and unchanged S2 route policy.
- Frontend full type check retains 147 existing diagnostics; no diagnostics in new feedback files or touched app/Header/mobile entry. No claim of whole-project type success.
- Browser verification uses real local Chromium + application UI with synthetic server/store, not real EdgeOne Blob or physical phones. Initial harness corrections: visible panel sizing, explicit select label, synthetic account remount, and waiting for the named feedback dialog after workspace initialization.
- Local Chromium: all 3 EdgeOne-mode UI journeys passed (anonymous creation/recovery/admin reply/follow-up, lost-response create/reply across reload, PC anonymous/account entries with zero learning-sync requests). Screenshots visually checked at 320px phone and 1280px desktop; fixed narrow close-button wrapping.
- Scoped lint: no errors; three pre-existing non-null assertion warnings in src/index.tsx.
- Pages-mode browser check passed: no /api requests. Local junction/cache serving needed an isolated test-only Vite config; no production Vite configuration changed.
- Added separate link helper regression: passed. Final feedback service/route contracts: 10/10 after bounded parallel-list optimization. Unknown, lost and malformed write responses retain pending bytes; definite non-auth/non-rate-limit 4xx rejection restores editing.
- Development CI results to be recorded after push.

## Delivery boundary
product/main only. Existing Circle task/current-task record preserved. No etest/master push, live account creation or live Blob writes. Real network/EdgeOne verification is still required before this feature's production promotion.

## Fresh-browser recovery finding
The fresh anonymous S1 bootstrap calls location.replace(location.href) after initialization. With a fragment this can become same-document navigation, leaving the initialization screen mounted. The feedback-only entry helper now captures a valid feedback fragment into sessionStorage and removes the fragment before guarded bootstrap. It has no auth/database imports, changes no learning storage, preserves other query/hash inputs, and survives the required reload. The UI consumes it only after preserving the anonymous key. A real fresh-browser journey and a separate pure helper regression cover this.

## Integration and CI checkpoint
Feature commit 42567bc0; accessibility follow-up bc37f2db. Integrated Circle backend and its newer UI task claim without changing that executor record. Pushed development integration 6cd2c38c9dd5d35e1b319d3548e174a5f41b1751. Local browser results now include the fourth rejection/editing journey, plus malformed ACK and lost ACK across refresh.
First feedback CI run 40315199257 failed before test collection: Playwright CommonJS required the ESM Cloud Functions service on Node 20. Local Node 22 accepts that require. The test now uses native dynamic import; application code and assertions are unchanged. Corrected CI passed; details below.

CI at integration 6cd2c38c: Cloud Sync Gate 40315199218 PASS (backend/lint/build), Pages deployment 40315199236 PASS, toolbar and Learn completion/journey PASS. Mobile Menu Completion had 22 passing cases and one stale menu-size assertion (expected five, now six with the authorized feedback entry). Updated that assertion to six and explicitly required the feedback button; remaining assertions retained.

## Final development verification
- Final test correction: 45f8faece80e549c3a84c208d97dfd648dabd766, pushed product/main. Application source is identical to integration 6cd2c38c (verified empty diff for src/ and cloud-functions/).
- Private Feedback UI: https://github.com/smhe00/qwerty-learner/actions/runs/40315741945 — PASS, 4 EdgeOne-mode synthetic-cloud browser journeys + 1 Pages no-API journey. Includes fresh browser recovery, admin replies, malformed/lost ACK across reload, definitive rejection/editing and PC/mobile no-sync navigation.
- Mobile Menu Completion: https://github.com/smhe00/qwerty-learner/actions/runs/40315741930 — PASS, 23/23.
- Application integration Cloud Sync Gate: https://github.com/smhe00/qwerty-learner/actions/runs/40315199218 — PASS, 924/924 contracts, lint and production build.
- Application integration Pages: https://github.com/smhe00/qwerty-learner/actions/runs/40315199236 — PASS.
- Integration toolbar, Learn completion, Learn real journey, Circle, achievement, P4b recovery and published dual-site explorer also passed. Broad review/S1/mobile-P0/startup runs were still in progress when this scoped delivery was recorded; no blanket all-CI or production qualification claim.
- Worktree: C:/Users/peter/Documents/Codex/2026-10-26/qwerty-lightweight-feedback. Local synthetic screenshots and validation logs are under ignored blob-report/feedback/.

Remaining before production: promote an authorized frozen candidate to etest, verify actual Feedback Cloud/Blob across guest/account/admin contexts (including private-link recovery, lost response, deletion and namespace isolation), then perform exact-SHA release gates. Local/CI synthetic storage results do not certify real EdgeOne or Huawei hardware. This task made no staging/production branch changes.

## Owner UI simplification and automatic identity follow-up
Base: 33011a55335d123f3094c1ef2f1e11a3d38faa3c; integrated 0026e8ac (Circle task documentation only). Owner found the dialog cluttered and requested account identity when signed in, anonymous otherwise, with no switch.

Removed account/guest switching and anonymous-key selectors. Lists now have one heading/refresh/write toolbar; composition has only back, fields and submit; detail keeps back/refresh in one row. Counts and submit align at opposite ends. Anonymous recovery is a secondary footer disclosure, absent while composing. No backend or learning-sync changes.

Account identity takes precedence even for an anonymous recovery URL. Its guest credential is still saved for later signed-out access; guest/account content is not migrated or merged. Every feedback request verifies that its captured identity still matches current local login, blocking stale-identity sends before network access. Expired server credentials remain an account error and never silently fall back to anonymous. Pending bytes and existing guest credentials are preserved.

Validation on final source:
- Scoped ESLint: PASS, zero errors/warnings in src/feedback.
- Local Chromium synthetic-cloud browser journeys: 6/6 PASS, 54.3 s. Covers guest/admin conversation and fresh-link recovery; slow reads and malformed/lost ACK across reload; desktop account/guest entries with no sync; rejected writes retaining editable content; account precedence over a recovery link then logout restoring anonymous inbox; changed/revoked login never sending as guest.
- Pages boundary: 1/1 PASS, 17.0 s, no feedback API requests. Six cloud-mode skips in Pages and one Pages skip in cloud mode are intentional.
- Earlier runs exposed text selectors matching both a displayed reply and the textarea during React updates, plus React StrictMode duplicate initial reads. Assertions now target rendered message articles and check every request identity rather than assuming one GET; no application behavior or safety assertion was relaxed.
- PC empty/form and 390/320px mobile screenshots inspected. Form/body overflow assertions PASS. Evidence: ignored blob-report/feedback/{desktop-empty,desktop-form,mobile-form,mobile-320-form,mobile}.png.
- Full typecheck retains 147 repository diagnostics (exit 2); no src/feedback diagnostics. This is not a clean full-repository typecheck.
- git diff --check: PASS. Upstream integration touched only the other executor's task records and requires no repeated application tests.

Delivery remains product/main only. No etest/master push or live Blob writes. CI result will be recorded after this development push. Existing release qualification boundaries remain unchanged.

### UI follow-up development delivery
Fix commit: c6690cb1. Normal development integration: 7c81e1208b037067eb3a4b61651c8d9bcb4de7da, pushed product/main. A concurrent Circle fix ac6777a4 was preserved by merge; its changes are isolated to Circle routing/body transport/layout and task records, leaving feedback source and tests unchanged.
Exact integration Private Feedback UI run https://github.com/smhe00/qwerty-learner/actions/runs/40322333923 — PASS (job 121570125963): scoped lint, 6 synthetic-cloud browser journeys, 1 Pages no-API journey and screenshot/trace artifact upload. This evidence is development UI qualification, not live EdgeOne Blob qualification.
Final task checkout clean after this evidence commit. No staging/production branch was changed by this task. PC logged-out entry remains the Settings dialog footer; signed-in entry is also available in the account dropdown.
