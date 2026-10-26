# Minimal PC and mobile Circle UI
Status: REVIEW. Executor: Codex-circle-ui.
Base: a82f9d95b1fb4c3dc24d77a4951d234fd43d9955.

User asks for simplest usable UI: replace a grey PC button; enable after login; design mobile UI. Owner correction: use the top-toolbar ErrorBook slot only in Learn mode for PC Circle entry; preserve ErrorBook in Typing and leave the footer WeChat/community button unchanged, and add a Circle menu row to the mobile home. Reuse desktop auxiliary overlay navigation so Learn/Typing remains mounted and paused. Mobile uses a single-column page and existing return navigation. Direct routes must work.

MVP: create/join by code, list own circles, view members and seven days, explicit self-reported daily check-in, per-member clap, copy saved invitation, member leave and owner remove/close. No rankings, chat, monthly data or automatic publishing of learning records. Preserve backend contracts and V4/FSRS/local learning data.

Reuse current session; gate expired/logged-out/Pages/cloud-disabled use. Same-origin Circle API only, no automatic mutation retries. Serialize writes, stable create retry ID, discard stale account/circle/day responses. Store only account-scoped Circle invitation/creation retry hints; do not modify auth, learning or workspace witness schema. If storage is unavailable, fail before an ambiguous creation can lose its retry ID. Personal identifiers use a short non-name label since API exposes immutable member IDs, not usernames.

Test focused request lifecycle and real browser interactions with isolated mocked API: auth disabled/expiry/401, PC entry and preserved background, mobile 320/390 px and dark mode, create/join/reload/invite, seven-day selection, duplicate-click guard, unknown writes, account switch, leave/remove/close. Verify no learning writes, no horizontal overflow and keyboard access. Run scoped lint/type diagnostics/build and route-emission checks. Local mocked evidence is not live Blob qualification. Update report, normal commit/push product/main; never promote master/etest.

## Owner-authorized etest promotion
On 2026-10-26 the owner explicitly requested deployment to etest. This supersedes the earlier no-etest scope for this promotion only. Repair the existing login-warning test mocks required by merged account deletion, verify focused contracts, push development and fast-forward edgeone-test to the same candidate. Check the published source marker and health. No master promotion.

## Follow-up: creation failure and UI repair
Owner reported creation failure and awkward UI on etest. Diagnose the real receiver with isolated synthetic data, fix Circle-only transport/UI issues, preserve creation identity on unknown writes, simplify empty/create layout using available container width. Verify real etest creation rather than only mocked UI; continue the already authorized etest delivery, never master. Workspace qwerty-circle-create-fix, base 33011a55.
