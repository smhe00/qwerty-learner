# Etest account handoff continuation — first complete live PASS

Status: ISOLATED PILOT PASS / general rollout remains PARTIAL.
Executor: ChatGPT. Owner authorized continued Etest-only verification.
Deployed runtime: 34a3d15f35ede8dec073fa88deaa5f3125f2ee95.
Passing harness: b0ec4658f936a6ec2031996d15a4b814b76e664a.
Live run: 40183383995, job 121138966537, SUCCESS.
No production writes, database provisioning or learning-data migration.

## Confirmed live result

On https://t.smhe.cn/ the exact deployed source and feature capability were
verified, executing idle cleanup was confirmed disabled, and a NEW random
reserved fixture account entered the actual guarded HTTP gateway.

All 13 assertions passed. The retained status sample showed, simultaneously:
activeWriters=1, heldWriters=1, pendingHandoffs=1. Thus the contested handoff
checkpoint was actually exercised, not inferred from a sleep or two successful
serial logins. During that interval another old-session write returned HTTP409
handoff_draining. A's original publication returned HTTP200; B's guarded login
then returned HTTP200. B immediately read revision1 and A's exact payload SHA.
A's subsequent stale-token upload returned HTTP401 session_revoked. B published
the combined alpha/beta fixture as revision2. Explicit logout returned revoked;
the old token was rejected. C logged in and read revision2 with the exact
combined payload SHA. Synthetic account DELETE returned HTTP200. The reported
cleanup is synthetic-account-deleted. Immutable coordinator audit receipts are
intentionally retained; no claim is made that every fixture Blob key was deleted.

The successful run had 18 HTTP responses and ZERO pre-write retries. Its only
error responses were the deliberately expected 409/401 refusals. Timing in this
injected-delay scenario: A upload 9260ms, B login 5885ms. These include a deliberate
5000ms manifest hold and network/storage costs, NOT normal-login latency claims.

Artifact 12595240964 (handoff-response-diagnosis-40183383995) contains the exact
harness source, safe HTTP/status evidence and the 13-check verdict. Its archive
SHA256 is 9cbec794f458faaedbb7e9f7959e040f46442450aace61a1241deb33fe1cdefb.
A compact copy of the verdict and critical responses is retained under
interactive/reports/evidence/SESSION-HANDOFF-20261025/live-pass-40183383995.json.

## Root cause fixed and earlier failures retained

- 40182340999: diagnostic runner stopped before fixtures because the release
  source gate correctly requires edgeone-test. Added a separate diagnostic gate
  pinning the actual staging ref and published source. Release gate unchanged.
- 40182458368 against c9d30f23: registration HTTP503 with
  handoff_auth_body_unavailable, isolated to request.clone().arrayBuffer().
- Replaced auth cloning with ONE original body receive and a private WeakMap
  promise keyed by Request. The ordinary router reuses exact bytes; failed
  receive cannot fall through/retry internally. Size, length, JSON, credentials
  and in-gate reauthentication remain enforced. This fix is in deployed 34a3d15.
- 40182810020 and diagnostic 40183152304 against 34a3d15: registration succeeded,
  but A encountered v4_direct_body_read_failed BEFORE any snapshot commit.
  No held manifest was reached. Those runs remain FAILED, not relabeled passed.
  Uncertain fixture accounts were retained rather than forcibly unlocked/deleted.
- Added bounded qualification-client replay only for guarded HTTP503 with that
  exact PRE-WRITE code, after rereading unchanged remote revision AND payload SHA.
  At most three identical submissions. Unknown 5xx, lost responses, timeouts,
  conflicts, missing guarded completion, or changed/unknown evidence never retry.
  This mirrors the existing etest transport policy, not a relaxation of handoff
  assertions. No retry was needed in the eventual passing run.
- Corrected redacted enum handling to retain digits in v4 error codes. No bodies,
  credentials, usernames, private Blob paths or tokens were logged or committed.

## Source, tests and deployment evidence

The receive-once fix passed local actual gateway 12/12. Qualification run
40182735309 (job121137032110) passed110/110 without skips, on exact resulting
source34a3d15, after merging origin/product/main9824cc65. Artifact12594234347
contains that tested SHA and TAP. Etest advanced without force fromc9d30f23 to
34a3d15; deployed source confirmation completed2026-10-25T10:01:05Z.

The later test-only retry/diagnostic changes passed local18/18 (gateway+retry)
and full selected CI116/116, zero failures/cancellations/skips, run40183383915,
artifact12594673382, exact harnessSHAb0ec4658. The passing live diagnostic run
explicitly fetched34a3d15 and required git diff --exit-code against ALL
cloud-functions before network use: harness and deployed runtime are identical.
Only test/report/workflow changes differ. No extra Maker build was needed to
qualify the current deployed runtime. Do not confuse the harness SHA with the
website SHA or falsely claim the earlier staging workflow turned green.

Other auto-triggered checks on34a3d15: the ordinary-account three-browser cloud
login job121137263390 succeeded with fixture cleanup. The broader V4 transport
job121137263259 FAILED in legacy-to-binary migration with request_body_unavailable,
after fresh/stale/independent-account V4 checks passed. Therefore the overall
release gate is NOT green. This report does not claim release readiness.

## Boundaries and next work

This is one completed live A->B->C qualification using synthetic evidence.
Existing ordinary accounts are NOT enrolled. The website health still explicitly
says handoffProductionReady=false. This does not prove all provider consistency
behaviors or every crash/partition schedule, nor automatic FSRS merge: the test
constructed the combined payload itself and verified preservation across handoff.

Before general use: qualify provider strong-list/get assumptions, prove safe
crash/unknown-outcome recovery, bound receipt growth without resurrecting old
requests, cover social/maintenance writers and old-code cutover, add user-facing
pending/recovery behavior, and close broader transport/release failures. Never
use a timeout/TTL, fixed sleep or local mutex as permission to unlock old writes.

At final ref inspection: master remains5528f79c; edgeone-test34a3d15; product/main
advanced independently tod3d2a0c7 after the tested merge. No upstream history or
CURRENT_TASK was overwritten. Final checkpoint changes reports/task metadata
only on the feature branch; staged runtime remains the tested34a3d15.

Run references:
https://github.com/smhe00/qwerty-learner/actions/runs/40183383995
https://github.com/smhe00/qwerty-learner/actions/runs/40183383915
https://github.com/smhe00/qwerty-learner/actions/runs/40182735309
https://github.com/smhe00/qwerty-learner/actions/runs/40183152304
https://github.com/smhe00/qwerty-learner/actions/runs/40182810020
