# Lightweight private feedback — implementation report

Status: implementation complete; local validation passed; CI and main integration pending. Independent of the Circle task.
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
