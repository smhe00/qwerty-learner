# V4 failure stage diagnostics

Status IN_PROGRESS. Base 9a254569. Remaining real-account cause UNKNOWN. User-supplied Resource Timing: meta 200, binary manifest 200, one binary part 200. HTTP receipt does not prove hash validation, inflated JSON correctness, decoded merge or durable adoption.

Prepared scoped observability changes; validation pending. Existing account data remains untouched. No raw user log or backup is committed.

## Local qualification

Targeted diagnostics 38/38; full cloud 592/592; isolated Chromium full workspace 122/122 (5.6m); production build passed (51.67s). TypeScript current/baseline 144/144 with identical error lines, no introduced errors. Full lint initially 0 errors/135 warnings; closure narrowing subsequently removes the two introduced non-null assertions. Final lint/targeted rerun recorded before commit.

Tests cover HTTP-successful corrupt bytes, schema/record build failures, archive quota failure, ambiguous upload failure, no retries and no subsequent journal/restore. Original exception identity and result identity retained; private messages/details/codes are not exposed. A test-authoring regex escape and redundant-semicolon issue were fixed before qualification. Existing account values are never collected.

Live etest history now additionally requires successful download, cloud verification, local/cloud decode, record merge, candidate decode, archive, upload and journal stage records, plus a failed metadata-stage record from its existing synthetic 503 case. Real-account root cause remains unknown until these diagnostics are observed on that client.

Final precommit: targeted 38/38 passed; full lint 0 errors, 133 existing warnings. Type-only closure narrowing leaves merge execution semantics unchanged.
