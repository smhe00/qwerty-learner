# V4 failure stage diagnostics

Status IN_PROGRESS. Base 9a254569. Remaining real-account cause UNKNOWN. User-supplied Resource Timing: meta 200, binary manifest 200, one binary part 200. HTTP receipt does not prove hash validation, inflated JSON correctness, decoded merge or durable adoption.

Prepared scoped observability changes; validation pending. Existing account data remains untouched. No raw user log or backup is committed.

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
- Full isolated workspace browser suite running; etest live historical fixture now adds same-number/different-UUID completed sessions and verifies both event and grant references plus all original historical facts. No etest or master update yet.
- Previous main diagnostics' independent Explorer run 40065590057 failed only the OLD production mobile shell 5s visibility assertion (job 120788035806); its Pages cases and other production cases passed. This does not certify the new candidate and is not hidden by a retry.
