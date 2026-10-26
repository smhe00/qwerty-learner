# Admin and feedback etest acceptance
Status: COMPLETE for requested admin/feedback scope; NOT a production or all-CI qualification.
Executor: Codex-admin-feedback-live. Date: 2026-10-27 (Asia/Shanghai).

## Exact source and authority
- Live candidate: `e2d7185252250495e4dac4d92fd134ac98e4c57b`; canonical test site `https://t.smhe.cn`, source marker `e2d7185` checked before each operation and at final readback.
- User authorized CI, etest, admin direct login and anonymous/account feedback lifecycle. No master promotion. Master remains `15fffa2c762037d8b29d1e5b953c729001ad5f0e`.
- Circle executor already advanced etest through `4b4228df`, `5322fb8b`, then `e2d71852`. Preserved all concurrent code; our guarded promotion attempt stopped when etest was ahead. No force push or rollback. User explicitly authorized coordination; Circle executor confirmed etest held at e2d71852 during this acceptance. Main can continue ahead (95da82a7 documentation at final verification).
- Ref discovery correction: origin fetch refspec tracked only product/main. Explicitly fetched main/etest/master and checked ls-remote; stale tracking refs are not deployment evidence.

## Required CI and targeted repair
Original ab10a933 passed Cloud/Pages and several source suites; Mobile P0 was cancelled after its functional steps passed and Pages Explorer was cancelled. Those are not exact-current passing substitutes.
At 4b4228df, Mobile Menu Completion expected six entries although Circle made seven. Commit `1f82691c71f997aa1121676cf6a98290867e3c74` now asserts exact seven labels, two legitimate subtitles, and disabled Circle access when logged out. Local targeted test 1/1 (12.7s); exact 1f CI Mobile Menu 40413230680, Cloud 40413274525 and Pages 40413230727 PASS. No application code changed for this repair.

Final e2d71852 CI:
- Cloud Sync Gate 40414535220 PASS: **950/950**, lint/build, exact-SHA Pages + Cloud admission. Explicit workflow_dispatch was needed for this Circle CSS commit because Cloud path filters did not trigger it.
- Pages deployment/regression 40414080497 PASS.
- Circle UI 40414080310 PASS; Published Dual-Site Explorer 40414080309 PASS.
- Deployed automatic idle cleanup qualification 40414109613 PASS. Administrator exclusion also remains covered by Cloud contracts; no real admin deletion was attempted.

## Real browser acceptance
Used real EdgeOne Cloud/Blob, no mocked API or injected auth state. Guest and ordinary-account isolated browser contexts retained legitimate test identities. Administrator used a fresh visible Chrome context; human entered credentials. Passwords, bearer tokens and anonymous private links were not collected into evidence.

| Flow | Anonymous | Signed-in account |
| --- | --- | --- |
| Submit marked feedback, response 200, waiting status | PASS | PASS |
| Admin sees exact submitted record | PASS | PASS |
| Admin replies and sets handling | PASS after one known pre-body rejection recovery | PASS |
| User refreshes and sees reply + handling | PASS | PASS |
| Admin changes status only to resolved | PASS | PASS |
| User refreshes and sees reply + resolved | PASS | PASS |
| User has no administrator status control | PASS | PASS |
| User list excludes other identity's fixture | PASS | PASS |
| Fresh admin refresh reads persisted resolved record | PASS | PASS |
| Final reply count exactly one | PASS | PASS |

Fixtures: `反馈完整验收-guest-mvpuf2v2`, `反馈完整验收-account-mvpuf2v2`. Both explicitly synthetic, resolved, retained as evidence; no real feedback edited. Administrator directly logged in as `admin`, no public registration or smhe account creation UI required.

## Diagnosed harness issue and actual transient
- Initial admin requests returned 200 but UI said 已取消登录. Root cause was the Playwright driver: without a dialog handler it automatically dismissed the site's normal workspace confirmation. Fixed driver to accept only the exact authorized admin login confirmation. It used the already human-filled form, without reading password values. Also narrowed duplicate /admin/ link selector to exact 账号：admin. These were harness corrections, not product authentication failures.
- First anonymous admin reply returned 503 `request_body_unavailable`. Paused immediately and read user record: still waiting, zero replies. The same deployed code throws this error while reading request body before computing/saving the message; UI preserves original pending operation. One explicit retry via 重试发送 returned 200. Final refreshed user readback contained exactly one reply. No new operation ID or blind unknown-write replay. Original 503 is retained in evidence.
- One human attempt using legacy smhe received 400 `administrator_login_name`; expected direct-admin guidance, not a failing admin-password check.

## Other CI failures retained, not hidden by feedback PASS
- M3 relay 40414109638: final DELETE /api/auth/account timed out at tests/cloud/etest-multi-device-pilot.mjs:116. Stack trace is cleanup, not evidence of a 180-second UI recovery failure. Underlying relay completion was not established by these logs; do not claim it passed. Unknown delete was not replayed by this task.
- Branch Cloud E2E 40414109616: browser job functional test completed, cleanup reported HTTP401 for one disposable identity and ambiguous deletion for another; V4 transport expected stale409 but received 503 `snapshot_body_read_failed`, with additional cleanup timeouts. Not a green workflow.
- Historical Login Full-V4 40414109636: initial history upload returned 503 `v4_direct_body_read_failed`, revision remained0/local three rows retained; cleanup timeout also occurred. Not a passing historical-login qualification.
- Pages Explorer 40414080334 cancelled after main documentation advanced. Three-device 40414109697 and completion journey 40414109707 were still running at evidence snapshot; not counted as passes.
- Prior 4b handoff 40412164639 returned `handoff_write_unverified`503; retained separately and never replayed or mixed into this candidate's evidence.

## Artifacts and remaining boundary
- Committed sanitized evidence: `interactive/reports/ADMIN-FEEDBACK-LIVE-20261027-evidence.json` (exact target, operation/status records, CI snapshot).
- Local ignored evidence: `blob-report/admin-direct-login/live-result.json`, `ci-e2d71852.json`, `live-acceptance.cjs`, and guest/account submitted/handling/resolved screenshots. Persistent browser driver session43513 was retained for review; visible admin browser remains logged in for owner inspection.
- This completes the requested login/feedback acceptance, not full release readiness. Do not publish master based on this report. Administrator production concurrent initialization/lost-receipt qualification from the prior task remains separate. Never delete administrator binding to reset a password.
- End-of-run coordination will release the temporary etest pause; development and subsequent authorized testing may proceed. A later deployed SHA requires its own live evidence.
