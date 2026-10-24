# V4 completed-session reference repair and release evidence

Status REVIEW. Source-reproduced completed-session reference defect fixed and released at d218a839. The exact exception in the original real-account incident remains unobserved; no claim that every possible cause is resolved. User-supplied Resource Timing: meta 200, binary manifest 200, one binary part 200. HTTP receipt does not prove hash validation, inflated JSON correctness, decoded merge or durable adoption.

Initial observability work is recorded chronologically below; final functional repair and release evidence supersede earlier pending checkpoints. Existing account data remains untouched. No raw user log or backup is committed.

## Local qualification

Targeted diagnostics 38/38; full cloud 592/592; isolated Chromium full workspace 122/122 (5.6m); production build passed (51.67s). TypeScript current/baseline 144/144 with identical error lines, no introduced errors. Full lint initially 0 errors/135 warnings; closure narrowing subsequently removes the two introduced non-null assertions. Final lint/targeted rerun recorded before commit.

Tests cover HTTP-successful corrupt bytes, schema/record build failures, archive quota failure, ambiguous upload failure, no retries and no subsequent journal/restore. Original exception identity and result identity retained; private messages/details/codes are not exposed. A test-authoring regex escape and redundant-semicolon issue were fixed before qualification. Existing account values are never collected.

Live etest history now additionally requires successful download, cloud verification, local/cloud decode, record merge, candidate decode, archive, upload and journal stage records, plus a failed metadata-stage record from its existing synthetic 503 case. Real-account root cause remains unknown until these diagnostics are observed on that client.

Final precommit: targeted 38/38 passed; full lint 0 errors, 133 existing warnings. Type-only closure narrowing leaves merge execution semantics unchanged.

## Main checkpoint

PR #37 merged into product/main at 9b101be1774f6f9f6b84e46b34476ccebdc6269b (application commit 18d2422c0fd3ac6dcbfcbcef16ee284a8b3fe051). Exact-SHA Pages 40065589970, Cloud 40065590094, S1 40065590079, recovery 40065590033 and admission 40065590004 are running. etest/master remain 9a254569; live acceptance and deployment have not occurred for this diagnostic change.

## Performance gate race reproduced and repaired

PR gate 40065567434 job 120787969943 failed before any application assertion: page.evaluate context destroyed during the documented first anonymous-workspace reload. Unchanged local three-repeat run reproduced 2/6 failures, same line. Test-only correction moves its existing mounted-settings-button wait before the first sessionStorage evaluation; all original timing, bootstrap, privacy and export assertions remain. This synchronizes with the intended reload rather than adding retries or weakening acceptance. No application behavior changed. etest/master have not advanced.

The corrected performance smoke passes 6/6 across three fresh browser contexts (12.5s). Diagnostic module documentation now explicitly describes the new allowlisted outcome/error fields. No runtime change in this follow-up.

## Confirmed source defect / repair in progress

Development base 55cc1d52 (PR #38 merged); etest and master remain 9a254569. Two synthetic ReviewRecords have numeric id=1 and different session UUIDs. The real producer assigns both achievement session IDs review:1; the real merge throws auto-merge-achievement-identity-conflict on their session:review:1:completed events. Review-row numeric maps were discarded while only word references were rebased. Daily completedBlockIds are also affected. The supplied HTTP 200 evidence is consistent with, but does not prove, this exact real-account failure. Functional regression and repair now replace diagnostic-only deployment. No real account or backup was accessed.

## Functional repair and current validation

- Preserve numeric review ID maps alongside word maps; rebase achievement sessionId, completion/continue eventId, firstTriggerEventId (including pruned triggers), queued awards and daily completedBlockIds. Record UUIDs and live event producers remain unchanged.
- Same-session completion/continue summaries may carry independently observed timestamps; deterministically select an existing summary and preserve the existing union of evidence/grants. Immutable word-event timestamp conflicts, UUID contradictions, missing references, account/schema gates and original archive requirements still reject candidates.
- RED before repair: 11 original contracts passed, 3 new valid-data regressions failed (two identity collisions and one stale grant reference). GREEN: 16/16 merge contracts; full Cloud 597/597.
- Real Chromium integration uses the actual completion and continue producers, then full V4 capture, isolated candidate import/export, original archives and durable restore. Both session UUIDs and daily reference preserved, exact restored fingerprint, inverse/repeated merge stable, repeated completion does not award again; passed.
- Build passed (36.59s), repository lint 0 errors/133 existing warnings. TypeScript 144 current / 144 prior with identical error lines. An explicit ESLint invocation on an e2e file is unsupported by repository parser configuration; application scoped lint and Playwright test discovery both pass instead.
- Full isolated workspace browser suite passed 122/122 (5.7m); etest live historical fixture now adds same-number/different-UUID completed sessions and verifies both event and grant references plus all original historical facts. No etest or master update yet.
- Previous main diagnostics' independent Explorer run 40065590057 failed only the OLD production mobile shell 5s visibility assertion (job 120788035806); its Pages cases and other production cases passed. This does not certify the new candidate and is not hidden by a retry.

## Main integration / release candidate

PR #39 merged into product/main at d218a8398fb80e70cdb96d38f70df4b92f807798; application fix a50fbe616f2c8bc7695dc5a7403755582a0bf14d. PR performance gate 40066997026 and Learn Block gate 40066997040 both pass. Same-SHA main checks started: Pages 40067119427, Cloud 40067119355, admission 40067119364, S1 browser 40067119409, recovery 40067119411, Review 40067119329. etest/master remain 9a254569 pending admission.

Source references at this candidate: session producer src/achievement/session.ts:3 and src/achievement/engine.ts:310; repaired foreign keys src/sync/automatic-v4-records.ts:153, review mapping returned at :205, same-session summary policy :335; daily references src/sync/automatic-v4-browser.ts:137. Download and full verification precede merge construction in src/sync/v2-manual-executor.ts:119-121. Original archive / upload / durable restore follow candidate construction, so this valid-data identity exception occurs after download but before writeback; the generic failure is caught in src/sync/account-login-v4-check.ts:60. HTTP 200 alone cannot distinguish transport validation failure from this merge failure.

## Staging promotion

Exact d218a839 Pages deployment/published browser regression 40067119427, Cloud 40067119355, admission 40067119364 and recovery 40067119411 PASS. Verified remote main=d218a839 and staging=9a254569, then fast-forwarded edgeone-test to d218a839 with expected-head protection. Production master remains 9a254569. Staging live acceptance is running; do not publish production before all required evidence succeeds.

## etest functional evidence

Historical Full V4 E2E 40067376888 / job 120793354895 PASS (1.7m), actual deployed source d218a83. 1,472,401-byte Unicode history, 700 original review rows, ordinary authenticated startup download/recovery, both independent completed-session UUIDs, correctly rebased event/grant references, original fork archives, six-table convergence and repeated-startup no-write all passed. New disposable account cleanup HTTP 200 and verified. Redacted proof: CODEX-P1-V4-SESSION-REFERENCES-20261024-etest-history.json.

Other passed jobs: real V4 Blob upload/readback/stale conflict/size 120793354962, browser account isolation 120793355152, M3 relay workflow 40067376883, safe writeback job 120793354923, main S1 40067119409. Three-device convergence and release-ready are still pending; master remains unchanged. Current independent Explorer 40067119347 repeats the old-production mobile heading failure at published-dual-site-explorer.spec.ts:356 (11 passed, 1 failed); exact-SHA Pages tests passed. That separate failure has not been relabelled as passing.

## Authorized production promotion

Three-device offline convergence 40067376882 / job 120793355120 PASS (4m): all three profiles contain exactly three real learned facts, no pending journal, disposable account cleanup 200. Release-ready job 120794526644 PASS explicitly confirms identical d218a839 main/etest and Pages run 40067119427 plus three-device run 40067376882. Redacted proof: CODEX-P1-V4-SESSION-REFERENCES-20261024-etest-three-device.json.

After confirming remote main/etest=d218a839 and master=9a254569, advanced master to identical d218a839 with expected-head protection under existing user release authorization. Production deployment/version confirmation pending. No existing account data was read or modified by the executor.

Production push triggered three-device run 40067998615 and read-only version verification 40067998656. Automatic approval review rejected a proposed credential-in-memory cancellation of the new three-device run because prior owner approvals named older runs. The command did not execute; no credential was accessed by that attempt. A new exact-run authorization question is pending. Cancellation remains conditional on the disposable-account step not having started; never interrupt cleanup after account creation. Read-only deployment verification continues.

## Final closure (2026-10-24 06:00 UTC)

- Application fix a50fbe616f2c8bc7695dc5a7403755582a0bf14d, PR #39. Identical main / etest / master release d218a8398fb80e70cdb96d38f70df4b92f807798.
- Production read-only verification 40067998656 / job 120795180980 PASS: q.smhe.cn deployed marker d218a83, healthy qwerty-sync-gateway API v1.
- Exact-run cancellation authorization was not received before the auto-triggered production account step began. The rejected cancellation was never bypassed or executed; once account creation started, the existing test was left to finish cleanup. This is not a second user-data experiment launched by the executor.
- Existing production acceptance 40067998615 / job 120795180714 PASS (3.4m): browser version verified, 34 loaded scripts checked, three-device convergence passed; disposable account cleanup HTTP 200 with accountDeleted assertion passing. No pending cleanup remains. The cancellation question is no longer actionable.
- Main Review Gate 40067119329 and Pages Explorer 40067119322 PASS. Independent dual-site Explorer 40067119347 remains FAILED on the pre-release production mobile-heading assertion (11 pass/1 fail). Its failure is reported separately; no retry or assertion weakening was used. All required identical-SHA Pages/Cloud/staging/release-ready gates passed before master promotion.
- Local validation: 597/597 Cloud, 122/122 isolated Chromium, 16/16 merge contracts, build PASS, lint 0 errors/133 baseline warnings, TypeScript 144 unchanged baseline diagnostics. The browser test uses actual session producers and verifies archive preservation, exact restore, reference integrity and repeat stability.
- Existing user accounts, browser records and backups were not inspected or manually changed. Only synthetic profiles and disposable test-created accounts were used. Lossless export/roundtrip checks, UUID conflict protection, ownership, archives, CAS, durable recovery and ambiguous-write no-replay remain enabled.
- Owner follow-up requires only normal startup on Version d218a83. If the original account still fails, the fixed allowlisted stage/code now identifies the remaining failure; do not infer full convergence from HTTP 200 alone or ask for private backup contents.

Final report, task state and the two redacted etest proof JSON files are saved on the independent documentation branch codex/v4-session-report-20261024, preserving the identical tested application SHA on all three delivery branches. Status REVIEW means implementation, qualification and authorized release are complete; final owner acceptance remains separate.
