---
protocol_version: '1.1'
task_id: ADMIN-CONSOLE-20261030
status: REVIEW
executor: Codex-admin-console
target_branch: product/main
claim_base_commit: d5f286218a9b92c74da0a82545f563e92c0309de
start_commit: d5f286218a9b92c74da0a82545f563e92c0309de
implementation_commit: "The commit introducing this report; resolve with git log --diff-filter=A --format=%H -- interactive/reports/ADMIN-CONSOLE-20261030-report.md"
upstream_head_at_validation: d5f286218a9b92c74da0a82545f563e92c0309de
release_to_master: false
---
# Independent administrator console

Owner requested an independent mobile/PC administration interface instead of learning/sync controls. This separately assigned task leaves CURRENT_TASK and the Circle executor's task/report intact.

## Changes

- `/admin` and `/mobile/admin` boot a separate React application before the learning lease, workspace bootstrap, RecordDB or background publishers start. Shared ordinary account forms expose an administrator link; successful managed-admin login diverts before ownership switching or synchronization.
- Tab-scoped administrator credentials use a separate sessionStorage key and a transport that does not call learning/cloud activity scheduling. Direct admin login preserves ordinary credentials and learning settings. Verified legacy admin login moves only its credential pointer out of the ordinary-auth slot; no learning database or vault is read, moved, rewritten or deleted. Invalid/expired admin sessions return to management login. Administrator logout revokes the token using a server-authorized admin-only endpoint and always clears the local management session.
- Four visible destinations: operating overview, user usage, feedback/replies/status, and system maintenance (storage/idle-account preview and confirmation). PC uses a sidebar; short touch screens use a compact grid. Both system color themes are supported.
- Backend administrator role is emitted only for the environment-managed bound identity. All learning service entry points refuse that identity. Gateway upload preflight also refuses admin before raw/multipart staging. Ordinary `/auth/logout` behavior is preserved; `/admin/logout` authorizes the managed identity and persists the existing monotonic revocation marker.
- New read-only overview API authenticates before any scan and again before returning. It bounds scans to six pages of five account objects and twelve V2 event envelopes per examined user, skips unread auth/session keys, excludes admin, deduplicates immutable attempts, treats contradictory/missing history as unknown, and returns a continuation plus explicit eventual-consistency/coverage metadata. It does not decompress backups or return tokens, password hashes, Blob keys or learning content. UI labels partial counts and excludes known test-account prefixes by default.
- Feedback conversation UI accepts an explicit transport and an all-feedback initial scope. Normal feedback defaults are preserved. Administrator operations use the separate management session and existing server privacy/idempotency checks. Rejected edits stay editable; uncertain responses keep the existing operation ID.
- Destructive maintenance keeps server policy checks and a preview/confirmation flow. A failed next-page preview does not change the cursor associated with the displayed page.
- EdgeOne emits physical SPA entries for both admin routes. Pages offers explicit fictional previews only; no authentication, real statistics, replies or maintenance are performed there. The mandatory UI-visible production gate now includes administrator journeys.

## Validation executed

| Check | Result | Evidence |
| --- | --- | --- |
| `node --test --test-concurrency=2 tests/cloud/*.test.mjs` | 1065 passed, zero failures/skips | Includes admin/overview, real bundled gateway, ordinary auth, sync, ownership, multipart and handoff contracts. Initial run exposed a stale account-UI mock; source transport now uses the standalone admin client. |
| Added normal-login-to-admin isolation contract, `tests/cloud/login-event-warning.test.mjs` | 10 passed | Administrator diverts before workspace switching, credential replacement or V4/M3/M4 execution; existing nine learning login contracts preserved. Run after adding the new case. |
| Production EdgeOne admin UI matrix | 24 passed | Phone 320px light/390px dark, tablet 1024px both, desktop 1440px both. Login/reload/logout, legacy credential migration, forged local-role rejection, metrics/error retry, feedback/reply/status, failed next maintenance preview, dismissed/accepted confirmation, expired session. Checks zero IDB opens, zero learning/sync/maintenance-background requests, unchanged student credentials/sentinel. Synthetic API only. |
| Ordinary account login/register UI | 6 passed | Existing production-bundle journey in all six profiles. |
| Production Pages UI | 12 passed, 18 intentionally skipped | Six admin-preview and six ordinary account journeys. Zero API requests and unchanged ordinary credentials/data. Authenticated actions skipped because Pages disables cloud. |
| Existing feedback browser regression | 8 passed, 1 Pages-only test skipped | Real UI with existing synthetic feedback service: private recovery, lost responses/retry, editable rejection, identity changes, clipboard and both themes. |
| EdgeOne and Pages production builds | passed | Locked installed dependencies; existing bundle-size/library-directive warnings only. |
| UI CSS ownership | passed for both builds | Global resets remain solely in document entries. No feature imports of index.css. |
| Scoped ESLint and `git diff --check` | passed | New admin UI/API, changed account/feedback modules and backend tests. Existing index.tsx non-null warnings predate task. E2E TypeScript is executed by Playwright; repository ESLint overrides do not cover tests/e2e. |
| Full TypeScript check vs baseline | baseline failure, identical diagnostics | Both current and unchanged release source produce byte-identical 149-line diagnostic output; no new admin/change-file diagnostics. Not reported as a passing repository typecheck. |
| Manual painted review | reviewed | Narrow phone overview and PC dark login screenshots with Chinese fonts; automated audits cover painted contrast and touch hit testing at each state. Fixed the discovered wrapped mobile brand link hit area. |

Local evidence logs are under `/workspace/scratch/4c3b6e25c0cf/admin-*`. CI retains per-state JSON, screenshots and traces through the existing visible-UI artifacts. Full unchanged suites were not repeated after adding the focused login-only test.

## Limits and next verification

This implements cloud-authenticated account usage, not anonymous visitor analytics or an online-person counter. Legacy V4-only history and not-yet-uploaded offline learning are not counted. Overview numbers describe examined ranges; listing visibility is eventually consistent. To continue a partial account scan use its explicit continuation button. Histories beyond twelve envelopes remain partial. No user is deleted or modified by statistics reads.

These are production-build UI and actual-handler synthetic-storage tests, not proof of a deployed privileged admin session or real EdgeOne Blob behavior. No maintenance was executed on a deployed site. Real administrator login, statistics against the staging Blob namespace, replies and server environment configuration still require etest acceptance. Real iOS/HarmonyOS devices are untested. Existing ordinary accounts named admin in a pre-binding deployment still follow the existing name-conflict rejection rather than being promoted.

## Git / handoff

Execution base and final pre-push remote check: product/main `d5f286218a9b92c74da0a82545f563e92c0309de`, unchanged. Publish by non-forced expected-SHA lease through the GitHub connector. This report belongs to the implementation commit; remote SHA and CI are discoverable in that commit's checks. Do not overwrite another writer if the lease rejects. No etest/master ref is advanced by this task.

Next: review the published Pages admin demonstration, then qualify this exact source on etest for real administration/Blob behavior before considering a production promotion under AGENTS.md. Production still requires the exact qualified etest SHA and owner release authorization. No blocker for development review; cloud/device acceptance is explicitly outstanding.
