---
protocol_version: "1.1"
task_id: "LEARN-COMPLETION-FEEDBACK-COPY-20261027"
status: "PARTIAL"
executor: "Codex"
target_branch: "product/main"
claim_base_commit: "37631f68be481635ab0f4987abae526f67260cfc"
start_commit: "37631f68be481635ab0f4987abae526f67260cfc"
last_commit: "0d82e3192b5f8be86506c677ab38498f77b59f57"
upstream_head_at_handoff: "0d82e3192b5f8be86506c677ab38498f77b59f57"
dirty_worktree: false
---

# Completion continuity and feedback copy

## Executive status
PARTIAL acceptance as of 2026-10-28. Source fixes committed and source CI passed;
etest is pinned to 0d82e319. Real completion continuity passed 2/2, including Blob
readback, five-more and fresh-profile restore. Administrator live copy/reply verification
needs owner reauthentication. Historical-login performance check has a separate
non-503 failure (one event read vs expected zero); production is NOT qualified or authorized.
See the final checkpoints below; earlier validation sections describe their original dates.

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

## Staging checkpoint 2026-10-28
Candidate: 0d82e3192b5f8be86506c677ab38498f77b59f57.
Final non-injected local toolbar geometry cases: 2/2 PASS (21.1s).
Exact-SHA source CI:
- Review Gate 40597411832 PASS, including 118/118 final browser cases.
- Learn Completion Journey 40597421968 PASS: 12 journey and 7 save-failure browser cases,
  plus architecture/persistence/retention contracts.
- Private Feedback UI 40597418816 PASS: 8 cloud-mocked UI cases and 1 Pages no-API case.
- Mobile P0 40597414822 PASS: 63 mobile learning, 57 account, 4 Pages browser cases.
- Pages deployment 40597367515 PASS; Pages Explorer 40597367532 PASS.
Duplicate main-ref Review/Feedback/Completion runs also passed; no cancelled run is
counted as evidence. This candidate preserves the main-integrated tablet change.

After these necessary source gates passed, fast-forwarded edgeone-test from ad862b39
to the exact candidate (no merge/release-only commit, no force push). Public t.smhe.cn
source marker confirmed 0d82e31. Cloud-functions tree is unchanged between ad862b39
and this candidate. Production master was not pushed and remains ad862b392c6a935ca49514fc9df146932aa02ed2.

Same-SHA deployed account cleanup run 40598807110 PASS:
acknowledged deletion uses one delete, confirmed by response; intentionally lost response
uses one delete, confirmed through a read-only receipt. Automatic idle cleanup
qualification 40598807237 PASS. These are separate checks, not proof of completion UI.

Live completion run 40598807165 was started automatically on this staging push.
Final live result is recorded in the next checkpoint; do not infer success from dispatch.
Admin live copy/reply acceptance is still blocked by a revoked session. The existing IAB
tab was taken to /?s1-account=manage&s1-reauth=1 and shows the admin reauthentication
form with an empty password. Owner must manually sign in and avoid simultaneous admin
login in another window. No administrator credential was read, stored, guessed or submitted by the agent.
The old loaded account page is not new-build UI evidence. Reload only after confirming
there is no user form input to lose. The tab is marked for handoff.

## Final live result and handoff
- etest completion 40598807165 PASS 2/2 (7.1m), networkMocked=false.
  Both daily-complete and unmastered-end preserve their correct title and all six
  metrics from sync-card first paint through sync completion. Actual uploads return
  200; immutable Blob hash/readback matches; five-more creates exactly five extras;
  refresh does not duplicate; fresh browser restores the exact rows; fixture cleanup confirmed.
- Three-device relay 40598807055 PASS: A/B/C each actually saved three rows (3/3,
  3/3, 3/3), with safe adoption and confirmed fixture cleanup.
- M3 relay 40598806955, safe V4 merge 40598807181, segmented history 40598807162,
  account cleanup 40598807110 and idle cleanup qualification 40598807237 PASS.
- Historical login 40598807216 FAIL at etest-login-v4-history.spec.ts:634:
  expected zero GET /api/sync/events/v2 during unchanged re-login, observed one.
  Six-table restore, Unicode fidelity, fork convergence and mixed legacy adoption
  succeeded earlier in that run; later assertions/export are not claimed. Cleanup confirmed.
  This failure is NOT the deliberately injected synthetic 503 earlier in the test.
  A post-adoption V4 request-aborted diagnostic also remains in its raw run evidence.
  No blind retry/replay or assertion relaxation was made.
- Read-only source triage: the relevant test and sync modules are unchanged from
  previous staging ad862b39. Trace shows re-login M3 POST followed by event GET,
  with uploaded-events-only diagnostic and verified-prefix-already-local result.
  flushOneWitnessedOutboxBatch explicitly reads its newly published immutable batch;
  the test counts that same endpoint without separating publisher readback from
  receiver history download. This is a likely classification/pending-publication
  issue, not yet a fully proven root cause. Next diagnosis should distinguish both
  callers and explain why publication was still pending before asserting no requests.
  Never remove the mandatory immutable readback merely to pass this performance gate.
- Branch EdgeOne Cloud E2E 40598807261: real-v4-transport and live-browser-cloud
  jobs PASS. Its release-readiness job FAILS because Source Cloud Sync Gate has
  no passing run for this exact candidate SHA. This source workflow did not trigger
  for these UI/test-only changes; prior-SHA passes are not substituted. No global
  release qualification is claimed, and no production promotion is requested.
  The separate historical-login failure above also remains unresolved.
- Final public markers: t.smhe.cn=0d82e31, q.smhe.cn=ad862b3. Master unchanged.
- Redacted durable evidence:
  interactive/reports/evidence/LEARN-COMPLETION-FEEDBACK-COPY-20261028-live.json.
- Remaining owner action: enter the administrator password in the preserved IAB
  reauthentication form and confirm login; reply only '已登录', never the password.
  Then verify deployed dark/light administrator detail copy contains title/body/replies,
  and confirm response/status persistence on test-only conversations. Local 8+1
  feedback browser cases do not substitute for this pending real-admin acceptance.
- Only after this repair round, continue the separate administrator workbench design
  above. Keep source CI, exact deployed evidence and independent product/main development
  separate; no master push.
