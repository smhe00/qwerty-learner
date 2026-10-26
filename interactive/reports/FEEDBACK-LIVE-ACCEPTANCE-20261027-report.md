# Feedback real etest acceptance — checkpoint
Status: PARTIAL. Date: 2026-10-27 (Asia/Shanghai). This is not a passing end-to-end acceptance.
Site: https://t.smhe.cn. Owner requested both anonymous and logged-in feedback with administrator replies/status and submitter verification.

## Real evidence
All requests used the deployed application and real server, with fresh Chrome contexts. No request mocks or injected login state. The ordinary account was registered through the actual account form (HTTP 201), then returned through guarded initialization to the mobile home. Its password is generated test-only data retained in the running test process, not in reports. No learning events were intentionally created.

Initial deployed source 951f88ba2a9f6b6db81b45523b4ee1e998d503ab:
- Anonymous feedback submit HTTP 200, subsequent detail GET 200, title/body visible and status waiting.
- Account feedback submit HTTP 200, subsequent detail GET 200, title/body visible and status waiting.
- Fixtures: feedback titles ending guest-mvpqbzeh and account-mvpqbzeh.

Another executor then promoted etest to 7f5dd39045bde7229fd0bcb78e38941e68f5784a. The source guard detected this before the next write and stopped that phase. Evidence is not combined across deployments.
- Separate read-only persistence check on 7f5dd39: both earlier fixtures survived full-page reload. Each identity saw its own inbox and not the other identity's feedback. These are migration/persistence observations, not old-source full acceptance.
- Restarted creation phase entirely on 7f5dd39: anonymous POST 200 + detail GET 200; account POST 200 + detail GET 200; both waiting and visible. Current titles: 反馈实网验收-guest-mvpqrafz and 反馈实网验收-account-mvpqrafz.
- Latest feedback-only phase made no learning-sync requests. Account full-page reload separately made expected auth and sync metadata GETs; these are not attributed to feedback open/close.

Sanitized request evidence: interactive/reports/evidence/FEEDBACK-LIVE-20261027/. Local screenshots: ignored blob-report/feedback/live-guest-submit.png and live-account-submit.png (latest 7f5dd39 phase). No secrets, request bodies, recovery links or auth storage exported to tracked files.

## Administrator blocker
Automatic approval review rejected a proposed attempt to obtain the administrator password from environment/source and submit login. No administrator login request was sent by that attempt. Do not retry that credential acquisition indirectly. A safer manual-login handoff was opened at https://t.smhe.cn/mobile/account; user asked how to configure the password, and was instructed to set ADMIN_PASSWORD on the etest EdgeOne project, redeploy and log in as smhe. The password must not be sent to chat.

Still unverified on the pinned current source: administrator sees both feedbacks; administrator replies; handling/resolved changes persist; original anonymous/account submitters see replies and statuses after refresh. No full-pass claim until all of these complete.

## Resume
Worktree: C:/Users/peter/Documents/Codex/2026-10-26/qwerty-lightweight-feedback.
Running local Node REPL session 43513 holds Live.browser, Live.pages.guest/account/admin and isolated test identities. Setup is ignored blob-report/feedback/live-setup.cjs; it exports initLive, checkVersion, submitFeedback and saveEvidence. Do not print Live, authentication storage or credentials. The administrator page in this test process is logged out; the human handoff is a separate visible in-app browser tab. IAB tab inventory browser 2 / tab 1 pointed to the account URL, but binding/DOM reads timed out; re-inventory after the user finishes manual login and use documented CUA browser/native operations, not credential extraction.

Before continuing, read /source-commit.txt and refresh edgeone-test. If the candidate changed again, preserve this evidence and start a separately versioned complete run. Keep existing guest credentials and test-account state; do not replay an unknown write. All feedback writes so far have known successful acknowledgements. Leave the marked fixtures until verification finishes; anonymous feedback has no exposed deletion API, and account fixture cleanup has not yet been performed. No application code, etest branch or master branch changed in this task.
