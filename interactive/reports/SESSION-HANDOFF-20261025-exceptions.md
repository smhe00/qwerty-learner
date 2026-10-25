# Etest exceptional handoff qualification — completed live PASS

Status: ISOLATED EXCEPTION JOURNEY PASS / general rollout remains PARTIAL.
Executor: ChatGPT; owner authorized continuation after first live qualification.
Resume base: 27e2f9b6c664ab2e3d830f559e53d9d2dc4e53fc.
Unchanged deployed runtime: 34a3d15f35ede8dec073fa88deaa5f3125f2ee95.
Final tested harness: c008507fb83e5b98de55f45c896673237494a402.
No runtime edit, Maker rebuild, ordinary-account enrollment, database change,
production deployment or modification of the independent CURRENT_TASK.

## Implemented and tested

Added tests/cloud/handoff-exceptions.mjs, its real-TCP actual-gateway contract
test and .github/workflows/session-handoff-exceptions.yml. The workflow uses
read-only repository permissions, only the fixed t.smhe.cn endpoint, one NEW
random reserved account, and all the unchanged production service/Blob code.
It verifies cloud-functions source equality with the exact deployed commit and
pins both the remote etest ref and source marker before AND after the live run.
No unknown POST is replayed, no operation is forcibly released, and uncertain
fixtures are retained. Same-input retry remains limited to the previous proven
pre-write body-rejection helper with exact unchanged cloud metadata.

The contract test uses a real loopback HTTP server and a native fetch connection
abort; only Blob provider I/O is simulated. It imports/bundles the actual public
onRequest handler. Both local final run and final CI contract passed 1/1, zero
failed/cancelled/skipped. This is one end-to-end contract, not 32 unit tests.
The first local native-readback variant failed because the loopback transport
adapter dropped URL.search; preserving the query fixed the test adapter. No
application/runtime fix is claimed for that local harness defect.

## Actual live runs

1. Run 40184183249 / job121141366957 / harness64982236: SUCCESS.
   30 assertions, 38 HTTP responses, artifact12595805219.
2. Run 40184449856 / job121142161563 / harnessc008507f: SUCCESS.
   32 assertions, 38 HTTP responses, artifact12595228921. This adds native
   manifest/part download, byte-for-byte gzip comparison and verifyCompressedV4.
   Archive SHA256:c6c01a9a31243afc0bd1d462859dbc6d3882ea60803c5515cbd68ad1b5a301d3.

The second run repeats the first journey plus readback; do not add counts and
claim 62 distinct scenarios. Both runs used ZERO pre-write retries, exactly ONE
intentional client-response abort, and ZERO replays of that aborted upload.
Both deleted their known-clean synthetic account. Immutable coordinator audit
receipts remain intentionally retained; not every test Blob key was removed.

### What the final 32 assertions establish

- Wrong password returned401/incorrect_password, did not add a pending operation
  or change the session, and A remained authenticated.
- A was held at final manifest publication. The service actually reported
  activeWriters=1, heldWriters=1, pendingHandoffs=1. Only THEN the client aborted
  A's HTTP connection. The caller received AbortError; no success was invented
  and the upload was not retried. B subsequently logged in and observed A's
  exact revision1, payload SHA and logical fingerprint. Late old A upload401.
- B's next publication was held while C and D logged in concurrently. Status
  actually showed activeWriters=1, heldWriters=1, pendingHandoffs=2, unresolved=3.
  Both serialized login requests finished, but only ONE resulting token remained
  valid once both completed. The other and the prior writer token were revoked.
  Network response ordering was not used to infer server commit ordering.
- Two further device switches, explicit logout and relogin preserved revision2.
  The final client downloaded the native binary manifest and part; all gzip
  bytes matched the expected alpha/beta fixture and V4 validation passed.
- Before cleanup, operations=19, pendingHandoffs=0, activeWriters=0,
  heldWriters=0, unresolved=0. No manual unblock was needed.

This is a controlled backup-preservation test. The alpha/beta union was created
by the harness, NOT automatically merged by the application/FSRS algorithm.
Client disconnect is NOT a server-process crash. Neither run qualifies safe
recovery after an orphaned or ambiguous server mutation. Those remain blocked.

## Broader V4 gate is still FAILED

Re-ran only the previously failed transport job via the GitHub job-retry action.
Run40182810018 latest attempt, transport job121141968729: FAILURE.
The previously failing legacy-to-binary migration now PASSED, including exact
SHA, bytes and idempotence. A263853-byte direct native upload and readback also
PASSED. The subsequent deliberately wrong declared-SHA case expected400 but
received503/v4_direct_body_read_failed BEFORE validation, so the gate failed.
Synthetic ordinary fixture cleanup passed. No assertions were relaxed and no
failed run was relabeled. The latest browser job121141970057 remains SUCCESS;
release-readiness job121142149533 is SKIPPED. Do not report overall release green.
This recurrence supports investigating request-body transport/lifetime; it does
not prove a lost-record race or justify replaying unknown commit outcomes.

## Provider documentation checked

Official Blob documentation explicitly describes strong get and strong list,
and manual single-page listing with cursor. The KV guide directs immediate
global-consistency use cases to Blob strong mode:
https://pages.edgeone.ai/document/blob-storage
https://pages.edgeone.ai/document/kv-storage
This supports the selected API options, not a universal proof of all failover
histories. Complete strong membership and durable writes remain protocol
assumptions; a stale/incomplete list negative control still fails exclusion.

## Scope, next steps and repository state

Still fixture-only; health handoffProductionReady=false. Server-crash/unknown
commit recovery, bounded receipt history, social/maintenance writers, old-code
cutover and user-facing waiting/recovery remain production blockers. Never add
TTL expiry or compare-only metadata recovery as proof an old writer is dead.
Investigate the reproducible body-read503 separately with bounded receive tests;
retain current strict expected status/SHA and no-ambiguous-retry assertions.

Last ref inspection: etest34a3d15; master5528f79c unchanged; product/main advanced
independently to279bd3bc1ff99c548ca515ebc373d3146db94f3b. This test-only work did
not merge unrelated newer UI work into staging. Feature changes are resumable
and all runtime sources remain equal to the tested deployed version.

Evidence summaries accompany this report. Full redacted responses and contract
TAP are in the two named GitHub artifacts. Run references:
https://github.com/smhe00/qwerty-learner/actions/runs/40184183249
https://github.com/smhe00/qwerty-learner/actions/runs/40184449856
https://github.com/smhe00/qwerty-learner/actions/runs/40182810018
