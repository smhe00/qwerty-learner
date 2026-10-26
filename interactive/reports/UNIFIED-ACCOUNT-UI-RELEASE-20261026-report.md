# Unified account UI release

Status: REVIEW — unified release deployed and verified; retained test-only follow-ups are listed below. Owner explicitly replaced the earlier independent UI exclusion and confirmed fast-forward-only promotion of the exact etest-qualified SHA. This candidate includes direct account entry, PC sync dropdown and mobile quick sync. Production currently serves98697131, whose old intermediate account overview was preserved by the earlier independent-release scope; that scope is now superseded.

## Existing verified work

- Synchronization timeout/root cause, 98697131 exact-SHA release and live production evidence: COMMIT-OUTCOME-INDEPENDENT-RELEASE-20261026-report.md. No old or mixed deployment result substitutes for this candidate's required published gates.
- UI integration and local verification: STAGING-UI-RESTORE-20261026-report.md. 15 account continuity cases, 22 account flows, 7 quick-sync contracts, 4 Pages account previews, 42 full workspace entry cases, and 2 HTTP safety cases PASS. Native/fallback writer leases, expired sessions, no intermediate overview, history preservation and keyboard menu focus covered.
- UI runtime8356b50d: Published Pages40275127323, Cloud40275127293, admission40275127304, Mobile P0, Review, toolbar, completion and recovery gates PASS.
- 751bec7d only removes10 obsolete second-click test actions in4 files. Ownership, auth, data retention and recovery assertions retained. No runtime or backend change. Full S1 CI must use this aligned test revision or newer; 8356b50d contains obsolete steps.
- New task uses the same runtime as8356b50d and same tests as751bec7d, adds explicit owner scope and persistent AGENTS promotion rule. Freeze resulting SHA, obtain its own Pages/Cloud admission, then etest Cloud/Blob/browser/hard-three-device/release-ready before master fast-forward. No production push yet for the UI candidate.

## Frozen candidate and required gate evidence

Candidate: cbb20842a85c23c8a25ac02cebec79349b37e66c. Runtime matches8356b50d; tests match751bec7d; confirmed by git diff. The final docs commit adds the owner's promotion rule, not different runtime code.

- Published Pages40276774148 PASS; Cloud Sync40276824135 and its exact-source etest admission PASS.
- S1 Workspace40276832047/job121421452453 PASS:142 browser cases plus3 repeated lost-ACK safety cases.
- etest Cloud/Blob40277666148 PASS: transport121423766890, real-account browser121423767174, release-ready121429475821. Release-ready explicitly records sameCommit=cbb20842..., Pages40276774148 and hard-three-device40277666162.
- Blob transport covered256/512/1024/1536/2048/2700KiB. Natural Commit timeouts were proved committed by pinned full-byte/V4-digest readback and stable metadata: revision6/1,580,128bytes; revision7/2,106,620bytes; revision8/2,777,132bytes. All writesReplayed=0. Deliberately lost receipt: revision1/1,580,105bytes, headerCommitPosts=1. All transport fixtures cleaned PASS.
- Three-device40277666162/job121423766926 PASS. Nine login recoveries19803,17906,18602,67697,67314,67313,67829,67816,68133ms. Final A/B/C each3/3, all journal.pending=false; cleanup200; no180s boot timeout.
- Automatic idle-maintenance40277666191 PASS.
- Real anonymous Chrome on t.smhe.cn/cbb2084: PC and phone each single activation directly shows the login heading/password input; no account overview/tools; document replaced; history length unchanged; server mutations0. Local captures in ignored .review-test/unified-t.smhe.cn-desktop.png and mobile.png.

## Retained failures and limits

Not every optional workflow is green. Do not substitute old results or label all failures503.

- M3-only40277666147: event POST503 request_body_unavailable.
- SafeV4 pilot40277666205: deviceB independent ReviewSession native write503 v4_direct_body_read_failed.
- Completion40277666151 attempt1: both completed-page variants were visible but native upload503; local progress retained and next-round success correctly withheld; both disposable accounts cleaned200. One bounded fresh-fixture rerun: complete(today-finished) case PASS including real sync, five extra words, no duplicate after refresh and exact fresh-profile cloud readback. Unmastered case still503; cleanup200. Preserve1passed/1failed, not a fully green workflow. These explicit503 results use the owner's nonblocking exception.
- Historical40277666126: full six-table download, Unicode/shared references, divergent V4 convergence, M3 publication/M4 adoption, legacy preservation and logout isolation all proved. Final relogin has an additional non503 performance assertion failure: it expects all GET /events/v2 counts to be0, but one GET follows a new POST201. The ordered HTTP trace plus publishOneImmutableBatch's mandatory port.read(receipt) identifies publication readback; the receiver's later verify-set503 blocks before receiver reads. Thus the global count conflates mandatory publication verification with redundant remote downloads. Both local profiles retain6rows; no extra M4 capture/transaction assertion failed. Keep this test distinction as follow-up rather than deleting safety verification or claiming this workflow passed.
- The same historical run's disposable-account DELETE returned503 at request-body; cleanup was NOT confirmed. Fixture e2e_hist_40277666126_1 only, no customer account. Do not replay ambiguous deletion; its random password/token are not retained in this report. Retention/admin cleanup is a remaining test-environment housekeeping item.
- Earlier8356b50d S1 run was superseded after obsolete intermediate-button clicks were found; the current142-case suite passes. Pages Explorer was cancelled; published Pages regression itself passed. Parent UI Review/Mobile/Toolbar gates passed on byte-identical runtime; no claim that those parent runs certify a different deployment SHA.

## Promotion

2026-10-26 06:24UTC: fetched current refs, verified main=etest=cbb20842 and master98697131 is an ancestor, then normal non-force push cbb20842:master. Remote ls-remote confirms master and edgeone-test both exactly cbb20842a85c23c8a25ac02cebec79349b37e66c. No cherry-pick, new merge commit, UI stripping, or production-only code change. Production verification completed below.

## Actual production verification and final delivery

- Production verify [40279610374](https://github.com/smhe00/qwerty-learner/actions/runs/40279610374), job121429766473: PASS. Canonical q.smhe.cn source marker=cbb2084, gateway healthy, mobile route entries valid.
- Independent read at2026-10-26 06:28UTC: authMode=single-active-session, handoffCapabilities=[], handoffMode=null. Staging has the same source with reserved test-account handoff enabled by trusted branch=etest. No code difference is used for this policy.
- Actual production Chrome PC and phone: PASS, single activation opens the login form, no intermediate account overview/tools, guarded document replaced, history preserved, zero server mutation requests. Captures: ignored .review-test/unified-q.smhe.cn-desktop.png and mobile.png; machine output .review-test/unified-production-account.txt. The matching etest checks also PASS.
- Final remote fetch: master=edgeone-test=cbb20842a85c23c8a25ac02cebec79349b37e66c. Production was a normal fast-forward from98697131. This task's final development commit only records evidence/status; it does not change deployed application code or move master/etest again.
- Owner rule is recorded in AGENTS.md for future agents: qualify one etest SHA, promote master only by fast-forward to that exact SHA, with identical UI/source; use branch=etest for server experiment policy. No release-only UI exclusion or cherry-pick.

Release delivery is complete. Remaining non-release housekeeping is explicit: distinguish event-publication readback from receiver downloads in the historical performance test, and verify cleanup of its disposable fixture after the recorded503. No test guard was weakened, no unknown Commit was replayed, and no customer account was used. The previous scheduled follow-up remains paused.

Key exact-candidate evidence: [Pages](https://github.com/smhe00/qwerty-learner/actions/runs/40276774148), [Cloud/Blob + release-ready](https://github.com/smhe00/qwerty-learner/actions/runs/40277666148), [three devices](https://github.com/smhe00/qwerty-learner/actions/runs/40277666162), [142-case S1 browser suite](https://github.com/smhe00/qwerty-learner/actions/runs/40276832047). Completion and historical failures above remain visible; this report does not claim every optional CI workflow passed.
