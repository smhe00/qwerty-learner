---
protocol_version: "1.1"
task_id: "LEARN-COMPLETION-FEEDBACK-COPY-20261027"
status: "REVIEW"
executor: "Codex"
target_branch: "product/main"
claim_base_commit: "37631f68be481635ab0f4987abae526f67260cfc"
start_commit: "37631f68be481635ab0f4987abae526f67260cfc"
last_commit: "9017ac2f944760d94f64b878384f5e4d058b8e10"
upstream_head_at_handoff: "37631f68be481635ab0f4987abae526f67260cfc"
dirty_worktree: false
---

# Completion continuity and feedback copy

## Executive status
REVIEW. Implementation and focused local validation complete. Development delivery only; no etest/master promotion or real Cloud/Blob qualification in this task. Circle-owned CURRENT_TASK and cloud/provider diagnosis are unchanged.

## Confirmed root cause
- LearnResultScreen immediately replaces its document after durable settlement to enter the guarded sync executor. That safety handoff is necessary, but the old DOM-only screen retained only a heading and synchronization status, losing the six completion statistics.
- Before guarded boot, the screen was rendered with null context, briefly showing a generic Block heading. The post-recovery result route also used generic boot screens.
- Feedback detail had no content-copy action; global body user-select:none prevented convenient manual selection.

## Changes
- A small optional presentation summary is derived from durable settlement and shared by the React result and DOM-only sync screen. Title, description, dictionary, progress and six metrics persist through boot, slow sync, failure/retry and recovery return.
- Display data is bounded and remains inside the existing tab-local account-bound, 20-minute handoff. Malformed optional display data is discarded without invalidating a valid sync intent. It is not a data source or authorization signal.
- Preserve document replacement, exclusive writer lease, journal/owner checks and existing sync outcome/action gates. No React/RecordDB runtime is imported to render the summary; the only settlement import in the shared helper is type-only.
- Six metrics use complete rows: three columns on wide screens, two at narrow widths.
- Feedback detail has an icon and “复制反馈” button for all identities, copying the displayed title/status/body/replies as plain text. It never copies credentials or the anonymous recovery link. Text remains selectable if clipboard permission is denied.
- Automatic signed-in/anonymous identity and feedback write/retry behavior are unchanged.

## Executed validation
All below exercised the implementation in 9017ac2f; subsequent changes are documentation only.

| Check | Result | Evidence |
| --- | --- | --- |
| Learn completion browser suite | 12/12 PASS | learn-completion-journey.config.ts, final run 58.2s |
| Feedback browser coverage | 7/7 PASS across relevant runs | Four unchanged cases passed initially; the two copy journeys passed after native Windows CRLF expectation correction (45.6s); Pages no-API case passed separately (16.1s) |
| Handoff and guarded bootstrap contracts | 39/39 PASS | node --test tests/cloud/learn-block-auto-sync.test.mjs tests/cloud/startup-sync-boot.test.mjs |
| Scoped ESLint | 0 errors | Three existing non-null assertion warnings in unchanged sync outcome lines of src/index.tsx |
| Architecture boundaries | PASS | 66 Learn/Review modules, 5 low-level files, ReviewRecord adapter |
| Pages-mode production build | PASS | vite build; 25.87s; bundle-size/library-directive warnings retained |
| Full repository typecheck | NOT CLEAN | 143 diagnostics outside this change's source files; no diagnostics in modified source modules |
| git diff --check | PASS | No whitespace errors |

The first strengthened completion run caught an implementation defect: summary was attached to boundary classification instead of staging. Corrected and reran all 12 cases. Other initial test issues were Windows clipboard CRLF normalization and the existing mobile auto-route; the narrow layout test now resizes the completion document itself, without claiming a native mobile study journey.

Browser evidence includes:
- Actual final typed word, both daily completion and retained-unmastered end state.
- Held metadata response: six metrics stay visible, no continue/exit buttons or upload before resolution.
- DOM mutation history across guarded entry and result-return boot: no intermediate generic completion title or missing metrics.
- Failed sync and explicit retry: summary retained, exactly one final record set/upload.
- Post-recovery result route: same summary, no duplicate upload, then exactly five extra words and idempotent refresh.
- Administrator copies a real synthetic-service conversation after reply/status change; anonymous and signed-in users also use the native browser clipboard.
- Clipboard permission denied: actionable message, visible text can be selected; no new API requests from copy.
- Pages feedback stays unavailable and makes zero feedback API calls.

Local artifacts (ignored, reproducible):
- blob-report/completion-feedback-copy/desktop-syncing.png
- blob-report/completion-feedback-copy/mobile-syncing.png (390px viewport, not physical-device evidence)
- blob-report/completion-feedback-copy/admin-copy.png (permission-denial/manual-selection case)
- blob-report/completion-feedback-copy/typecheck.txt
- blob-report/completion-feedback-copy/build.log

## Limits and remaining work
- Browser requests used synthetic cloud responses/storage. The result-return check exercises guarded UI restoration, not an actual cloud pull/journal commit. No claim of fixing provider 503s, history timeouts, or real-network synchronization qualification.
- Safety-blocking errors may still replace the completion display with the required blocking notice; they must not be hidden by cosmetic continuity.
- Existing achievement acknowledgement behavior is unchanged; this change preserves the completion summary and statistics, not a new achievement ceremony flow.
- Changes await the normal next staging batch before production release. Branches etest/master were not pushed by this task.
- Rechecked upstream product/main immediately before committing; still 37631f68. No integration conflict.


## 2026-10-28 follow-up: contrast and staging authorization
Owner explicitly requested: commit fixes, require passing CI, fast-forward etest, verify completion display during real sync and administrator copy; NEVER master.
Base/upstream at resume: 9e8d5037c68009a5d1a462e6ebbfd9b6e445ae17. etest/master both ad862b392c6a935ca49514fc9df146932aa02ed2; neither changed in this checkpoint.
Circle thread's latest completed turns are design-only with explicit no-development/no-push, so its old active-task lane note does not describe ongoing deployment work.

Confirmed CI on 9e8d5037:
- Learn Completion Journey 40533085172 PASS, Private Feedback UI 40533083574 PASS, Cloud Sync Gate 40533083781 PASS, Browser Recovery 40533083874 PASS, Pages deployment 40533083162 PASS.
- Toolbar 40533083638 and Review 40533083759 both fail at the same outdated learn-shell-ui assertion: it searches for the old disabled error-book button, but Learn now renders CircleEntry. Fix checks the old entry is absent and the anonymous Circle entry is disabled; other disabled controls and navigation assertions remain.
- Local corrected toolbar contract: 1/1 PASS (16.4s). Updated deployed journey loads both cases without contacting cloud.

Contrast root cause: feedback used undefined --focus-text-primary and --focus-surface-hover, falling back to dark text/light hover colors in dark mode. Use existing --focus-text, --focus-surface-muted and accent/ink tokens. Explicit placeholder and disabled-state colors stay readable; dark error text is brighter. Includes title, body, replies, labels, status, copy/close controls and hover, not only the close button.
Local final contrast tests: 2/2 PASS (23.7s), every rendered text/placeholder checked at ratio >=4.5 in both themes. A deliberately foreground=background heading MUST fail the checker, then normal styling is restored; invalid parsed color/NaN cannot silently pass. Earlier first draft color parser was corrected before this checkpoint.
Screenshots manually reviewed: blob-report/feedback/contrast-{dark,light}-{empty,thread}.png. Scoped formatting and git diff --check PASS.

Deployed completion test now observes every completion-card mutation from first paint through actual sync, requiring the correct title and six metrics throughout and identical summary after success; retains real Blob readback and fresh-profile assertions, no response mocking.
Browser admin verification not yet complete: native Windows Computer Use was stopped because its current-URL policy could not determine the browser URL. Do not bypass that guard. Prefer an identifiable in-app browser tab; ask the user to log in there if needed after deployment.
Status: source fix ready for fresh CI; etest promotion and exact-SHA live proof pending.

## 2026-10-28 fixed-candidate CI follow-up
Candidate a25eb51d3a21320a73a1bc502af95cf0fbcbfc81 passed Completion 40594508849,
Feedback 40594509033, Toolbar 40594509038 and Pages deployment 40594509008.
Main advanced to bcb7a38; cancelled main-ref Review and exploratory runs are NOT passes.
A same-SHA branch-pinned Review run 40595390966 completed all contracts/build/navigation,
then failed 1/118 final browser cases: focus-ui wrapped Learn toolbar geometry.
Original test passed 6/6 local repeated cases. Injecting a temporary 150ms ResizeObserver
delivery delay reproduced the same width assertion failure. Waiting up to two seconds
for the complete unchanged geometry contract passed 2/2 with that injected delay.
Removed injection before commit. Product layout unchanged; no relaxed tolerances or
skipped assertions. Add this test to Review path filters; enable manual Feedback and
Completion workflows so a candidate can be checked independently of moving main.
Integrated bcb7a38 by fast-forward, preserving its landscape-tablet entry change.
This supersedes a25 as the next candidate; new-SHA CI/live evidence remains required.
Admin browser is blocked by an explicitly revoked session (another-device login);
owner was asked to reauthenticate in the current t.smhe.cn tab without sharing passwords.
Do not substitute local synthetic admin proof for real deployed verification.

## Next design requested by owner: separate administrator workbench
After this repair round, plan a dedicated /admin application and entry flow.
The current src/index.tsx runs guarded learning bootstrap before its account route;
administrator UI is nested in learning-facing components, so admin navigation inherits
learning workspace/sync startup. This is an architectural observation, not a change in this release.

First phase should deliver a light responsive shell with Feedback, Account maintenance,
and an on-demand Overview. Move existing reply/status/copy and protected cleanup tools
into these pages; reuse server authorization. Do not load dictionaries, Learn/Typing,
RecordDB, writer lease, history reconciliation or cloud learning synchronization for
an authenticated administrator-only route. Server-verified role chooses the destination;
the literal username or client cache must never grant admin access. Keep mandatory
session validity/revocation and password-rotation checks, and fail closed on network errors.

Preserve the immutable legacy administrator identity and 180-day deletion exemption.
Do not erase existing local/admin learning records or silently merge an ordinary user's
workspace when changing role. Existing unfinished ordinary-user transactions must remain
recoverable when the ordinary learning application is entered again. Plan the login/session
storage boundary explicitly before coding; avoid automatically reusing ordinary learning
handoffs for the admin console.

Load counts/statistics only when requested, with pagination and freshness labels;
do not add startup-wide Blob scans or invent unsupported figures. Defer rich charts,
role management and broader statistics until their definitions and costs are agreed.
Acceptance must prove direct login/refresh goes to admin, no learning sync or RecordDB
writes/lease on admin startup, ordinary/anonymous accounts denied both UI/API access,
revoked sessions and offline failures handled, protected cleanup still enforced, and
feedback workflow/copy works in both themes on desktop/mobile. Measure actual startup
latency and request counts before promising a time target. No implementation or master
publication of this redesign is included in the current fix.
