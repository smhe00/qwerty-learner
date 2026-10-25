# Etest account handoff continuation

Executor: ChatGPT; owner authorized continued Etest-only qualification.
Resume feature f1c235e6 / etest c9d30f23 / product/main 2db65505.
No master or user-data migration; independent idle task remains untouched.

## Actual new evidence

Diagnostic run 40182340999 stopped before network/fixtures because the existing
release gate requires GITHUB_REF_NAME=edgeone-test. Retained as a failed run.
Diagnostic-only runner now independently pins the real remote edgeone-test SHA
and published staging source marker. Existing release gate is NOT changed.

Run 40182458368 verified etest c9d30f23, health capability and disabled executing
idle cleanup, then recorded POST /api/auth/register => HTTP503,
error=handoff_auth_body_unavailable, guarded=false. No registration succeeded.
This isolates the failing path to request.clone().arrayBuffer(), before
credentials, coordination or business writes. It does not demonstrate a drain
protocol failure or data loss. The previous combined assertion hid this detail.

## Fix under qualification

Receive the original authentication body once, retain only a private WeakMap
promise keyed by the Request, and reuse those exact bytes in the normal router.
No Request.clone/tee; no second read or unguarded fallback on failure. Size,
length, JSON, credential and takeover checks remain. Ordinary account dispatch
also reuses received bytes without enrolling that account into the pilot.

Local actual HTTP gateway: 12/12 PASS, zero failed/cancelled/skipped. New tests
cover an unusable clone, exact single receive for fixture and ordinary accounts,
failed first read with a hypothetically successful second read, and declared
length mismatch which must not revoke A or enter the barrier.
The reviewed compact patch is pinned to the four existing source blob hashes.
CI must commit actual source, run the selected full safety suite, publish the
exact feature SHA, and succeed before staging. The patch-only trigger SHA must
NOT be promoted. No live pass is claimed here.
