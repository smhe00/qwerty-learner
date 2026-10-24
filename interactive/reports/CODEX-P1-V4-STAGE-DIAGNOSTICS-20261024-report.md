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
