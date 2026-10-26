# Account passive return report

Status: IN_PROGRESS. Isolated worktree qwerty-account-passive-return, base95184f9f. Previous unified release cbb20842 preserved; PR45 administrator UI kept. Root cause: account return uses location.replace to a normal learning route, so guarded boot reruns V4 and M3/M4 and the background pump starts a new2s initial scan. Implement one-shot guarded navigation intent, retain all safety recovery, avoid immediate background scan on this specific return. No cloud backend change planned.

## Implementation and local evidence

- Added a five-minute, single-use, tab-local passive account visit ticket bound to the existing account, registry generation and integrity witness. No credentials are stored in the ticket. Returning consumes it before journal recovery. Every S1/S2/manual/M4 recovery branch, final journal/owner/witness check and session-revocation check remains active.
- Any authentication action invalidates the passive visit, including failed authentication. Unknown/pending startup outcomes do not enable the optimization. Explicit quick-sync intents, changed owner/witness/generation, expired/future-clock/malformed markers and reloads use normal startup.
- A passive return resumes the existing 45-second background cadence instead of starting a new two-second scan. Online/visible wakeups and subsequent periodic repair remain unchanged.
- Local cloud contracts: 880/880 PASS, including 35 focused startup/drain contracts.
- Local Chromium: 10/10 PASS (PC/mobile actual UI passive returns, successful/failed reauthentication, slow/offline/lost-ACK, real S2/M4 journal recovery, six-table union). After adding a valid passive marker to both real journal cases, those 2/2 passed again. Synthetic cloud only, not live deployment proof.
- Source ESLint: zero errors, three existing index.tsx non-null warnings. Default ESLint does not parse tests/e2e TS files (existing configuration); actual Playwright compilation/execution passed. Whole-repo tsc remains non-green with pre-existing diagnostics; none reported in changed source paths. Do not report whole-repo typecheck PASS.
- Added deployed real-account PC/mobile passive-return assertions to the existing etest Cloud E2E job, using only its disposable fixture. Pending execution on the candidate SHA.
- Before commit, upstream advanced to a11362de (PR46 architecture/persistence remediation). Fast-forwarded the isolated checkout; no overlapping source changes. All upstream UI, administrator tools and persistence changes are preserved. Architecture boundaries pass. Same-SHA CI will validate the integrated candidate; no old SHA evidence may satisfy release gates.

## Remaining release gates

Commit/push product/main; require candidate source CI, published Pages, etest actual source SHA, real Cloud/Blob/browser (including passive return), hard three-device 3/3, and release-ready. Only then fast-forward master to the exact tested SHA. Verify q.smhe.cn source and production test-feature policy. No master or etest push has occurred in this task yet. Keep historical unrelated cleanup ambiguity in its prior report; never replay unknown writes.

## CI correction before staging

First candidate1fbf48a4: Cloud Sync contracts passed880/880 but test-file ESLint failed (unused resolve import and seven bare synthetic storage globals). Corrected the fixture to use globalThis and removed the unused import; exact cloud lint and focused startup contracts pass locally. No production source/behavior changed. No staging/master promotion occurred. Initial Etest admission failed downstream of that Cloud Gate; not a live-cloud failure. TypeScript compiler comparison against integrated parent a11362de confirms147 baseline /147 candidate diagnostics, added0.

## Frozen candidate and same-SHA validation

Candidate:15fffa2c762037d8b29d1e5b953c729001ad5f0e (parent1fbf48a4 product fix). Working tree is frozen for release; evidence-only report updates do not enter the candidate.

- Cloud Sync Gate40284031256 PASS; contracts job121443413365, same-SHA admission121443866546.
- Pages deploy/published regression40284031281 /121443413817 PASS.
- Startup Sync Recovery40284031236 /121443413440 PASS, including actual account-return browser cases.
- Etest Pilot Admission40284031279 PASS.
- S1 Workspace Browser manually dispatched40284113546 /121443764377 pending. The unchanged lost-ACK test repeated3x has passed; full suite running.
- Local frozen candidate completion12/12 and newly integrated persistence fault6/6 PASS. Completion workflow does not expose workflow_dispatch (422); local candidate results used, not prior-SHA CI.

Do not use failed1fbf48a4 run as release evidence. master/etest remain cbb20842 at this checkpoint.

Staging promotion: normal fast-forward cbb20842 →15fffa2c completed after same-SHA Cloud/Pages/startup/admission PASS. No force push, no source changes at promotion. Live runs: Branch EdgeOne Cloud E2E40284711789 (transport121445545290, browser121445545548); hard three-device40284711719 /121445544836. Both wait for deployed source before creating fixture accounts. master stays cbb20842. Full S1 suite is still running; no production promotion until it and live mandatory gates pass.

S1 Workspace Browser Gate40284113546 /121443764377 PASS. Etest deployed candidate verified by live job source gates; Cloud/Blob, real-account PC/mobile passive return and hard three-device tests have moved past version admission and are executing. No master promotion yet.

## Live candidate evidence (in progress)

- Branch Cloud browser job121445545548 PASS4/4. Real disposable account passive-return request counts: PC0 at07:21:08Z, mobile0 at07:21:24Z. Login, exclusive writer and single-session checks passed. Fixture cleanup explicitly logged both accounts deleted. This is deployed15fffa2 evidence, not mocks.
- M3 single-session relay40284711643 PASS. Automatic idle cleanup qualification40284711761 PASS.
- Safe V4 writeback40284711753 /121445545427 FAIL: HTTP503 v4_direct_body_read_failed at07:22:22Z. Retain under owner's explicit occasional503 nonblocking instruction; do not present it as green or replay the ambiguous write. No source change made to bypass it.
- Real V4 transport and hard three-device continue; release-ready not yet passed.

- Actual completion cloud40284711780 /121445545519 PASS2/2: unmastered and complete, source15fffa2, networkMocked=false; completionPageVisible=true; cloud hash verified; extraWords5; reloadDidNotDuplicateExtension=true; independent freshProfileCloudReadbackExact=true; finalAttemptPresentExactlyOnce=true; cleanupStatus200/verified for both. This replaces prior release's503-only evidence with actual green results on this candidate.
- S1 total153/153 plus3/3 repeated lost-ACK. Optional Pages Explorer40284031308 cancelled; required published Pages regression40284031281 passed. Do not conflate optional cancellation with release proof.

## Hard three-device and historical diagnostic

- Hard three-device40284711719 /121445544836 PASS (10.8m). Final A/B/C each3 records and journal.pending=false. Nine login/recovery durations18374,19124,17718,67202,67896,67720,48583,67035,69282ms; no180s UI timeout. Intermediate503/expired network budgets were retained, final durable recovery met the unchanged assertions.
- Historical40284711715 /121445545019 retained existing non503 test classification defect: line633 expects ALL GET /api/sync/events/v2 count0, but same-login publication POST201 is followed by its mandatory exact GET200 readback (multi-device-outbox-publisher.ts:72), then verify-set200 and verified-prefix-already-local. No M4 capture/transaction stages, one full V4 check, one publication, one witness, one metadata read all passed before that assertion. The test conflates sender integrity readback with receiver redownload. Source unchanged by this task; do not remove integrity readback. Raw evidence: both profiles6 records, full six-table/Unicode/shared-reference pull, divergent fork merge, legacy/M3/M4 mixed history, retained archives and logout restoration assertions passed. This workflow is NOT green; subsequent assertions beyond line633 were not reached.
- Historical fixture cleanup returned503 request-body, outcome unconfirmed. New disposable fixture e2e_hist_40284711715_1; do not retry deletion without re-verifying ownership. Password not retained. Separate from user data and from prior historical fixture cleanup ambiguity. Preserve for housekeeping follow-up.

Transport121445545290 has completed the full real V4 upload/readback/stale-conflict/Blob-size stage and entered its final lost-commit-receipt probe. The latter must prove the committed payload by read-only reconciliation without replay. Waiting for explicit completion and release-ready; master remains unchanged.

## Transport runner deadline (not an application recovery timeout)

Transport job121445545290 was cancelled at its20-minute runner deadline, after spending~4 minutes waiting for deployment. Full large-payload endurance and first two fixture deletions passed. Natural20s Commit timeouts were independently proven committed: revision7/2106629 bytes and revision8/2777097 bytes, checks1, writesReplayed0. Final deliberate lost-ACK proof also passed at07:35:47Z: revision1/1580131 bytes, headerCommitPosts1, fullReadback=true. Runner cancellation at07:35:57Z interrupted final fixture cleanup; outcome unconfirmed, no credentials retained and no blind replay permitted. Therefore this run is NOT green and release-ready was skipped.

Rerunning only the cancelled transport job on the identical15fffa2 candidate is authorized and safe: script creates fresh identities using Date.now plus cryptographic random prefix per process, never reuses prior fixture credentials or commits. Current deployment is already ready, removing the~4-minute wait. Preserve cancelled-attempt evidence and unknown cleanup outcome. Browser and hard-three-device proofs remain same-SHA passes; master untouched.

Transport rerun job121452578967 failed early on GA stale revision CAS:503 snapshot_body_read_failed. Both disposable fixture deletions explicitly PASS before failure was reported. This is a retained owner-waived transient503, not a new application regression; release-ready still skipped. Requested one more isolated new-fixture job run on unchanged15fffa2 to satisfy the mandatory full-green transport/dependent release-ready gate. No ambiguous commit was replayed, no code/gate assertion changed. Other same-SHA required gates remain passed.

## Concurrent integration and final candidate preparation

During15fffa2 qualification, the user authorized another thread to merge PR47. product/main is now78d1515a80eeb0848928ef13627139d46ac54457 (record commit ports/completion receipts and shared review writer), including this account fix. Existing release-readiness requires current product/main/Pages/etest identical;15fffa2 can no longer be promoted using its old gates. Read the new task/report and diffs, fast-forwarded this isolated checkout without conflicts. New upstream source CI is green, but those results do not qualify a different SHA. No other thread messages sent; explicit coordination permission was requested and remains pending.

Observed infrastructure failure repaired: increase ONLY real-v4-transport runner wall limit20→30 minutes to accommodate up-to10-minute deployment admission plus full endurance/lost-ACK/cleanup. Every per-request/app deadline, assertion, account isolation and unknown-write safeguard is unchanged. Full new candidate qualification follows. Do not replace etest while the old transport attempt still executes real writes; retain its result separately. Earlier report's frozen15fffa2 evidence is historical and must NOT certify the new candidate.

## Authoritative owner update: independent branch responsibilities

Owner explicitly clarified: main continuously develops; etest independently validates a fixed candidate over the real network; master formally releases it. Ancestry is master -> etest -> product/main, equality allowed immediately after promotion. Main/Pages advancing MUST NOT invalidate completed candidate-SHA evidence. No coordination message was authorized or sent; no pause is needed. This supersedes the earlier report's assumption that advancing main requires replacing an already-qualified etest candidate.

Therefore application candidate remains etest15fffa2c762037d8b29d1e5b953c729001ad5f0e. PR47 and CI-only followups stay on main for subsequent staging, rather than being forced into this release. New policy independently verifies candidate Pages/source CI success, actual named Cloud workflow jobs, hard three-device run, deployed etest marker and branch ancestry. A read-only workflow on main can qualify an older etest SHA; policy SHA and application candidate SHA are reported separately. This does not mix application test evidence across SHAs, deploy anything automatically, waive tests or allow non-fast-forward master changes.

Transport attempt3 job121453539905 PASS, including final cleanup. Natural20s unknown Commit outcomes confirmed by full readback: revision7/2106635 bytes/checks1, revision8/2777084 bytes/checks2; writesReplayed0. Deliberate lost-ACK revision1/1580119 bytes, one Commit POST, fullReadback=true; cleanupPASS. Same-SHA real browser result is retained in121453542585 (original execution121445545548). Old release-ready121458632594 failed ONLY 'main and etest must contain IDENTICAL commit SHA'; no failed transport or browser assertion. Requalify with the owner-approved independent-branch policy, then promote the existing etest candidate.

Policy regression14/14 PASS: advance main safely, keep fixed etest, allow equal refs after promotion, reject divergence/backward promotion/staging changes, reject incorrect Pages/Cloud SHA and failed transport, verify actual deployed etest. Actual CLI entrypoints execute against synthetic API fixtures; current moving Pages is prohibited in those fixtures. Explicit module-parser lint and node syntax checks PASS. Initial fixture incorrectly labeled a backwards compare as ahead; fixed fixture, not production assertion. Latest main integrated source completion12/12/save-failure7/7 passed but is NOT used to qualify15fffa2.

GitHub default branch is master, so a newly introduced workflow filename on main cannot yet be manually dispatched (404). Use the EXISTING registered edgeone-branch-cloud-e2e workflow's new optional candidate inputs instead: a product/main dispatch runs only the read-only frozen-candidate qualification job; normal etest push/dispatch retains existing live jobs. Removed the redundant new workflow file. No master/default-branch change needed. YAML parse PASS; policy behavior/tests unchanged.
