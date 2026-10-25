# Account handoff: Etest promotion evidence

Status: STAGED; real-Blob qualification is not yet claimed as passed.
Candidate/source SHA: c9d30f23a46bae6b4022ea1dd4118585edf62144.
Feature trigger SHA: 89a62cbb9e61cb865941567bed4a57492be6cdb9.
The trigger is NOT the final tested candidate: CI applied the reviewed gateway
wiring, committed actual source, and merged current product/main first.

## Completed evidence

- GitHub CI run 40172568290, job 121106326696: SUCCESS.
- Artifact 12590961350 names the exact tested SHA c9d30f23a46bae6b4022ea1dd4118585edf62144.
- Combined selected tests: 108/108 PASS, zero failures/cancellations/skips.
- Includes actual HTTP gateway, 27 service integration tests, bounded Blob-only
  admission, three independent OS processes, finite three-contender schedules,
  original backend/storage regression and local workspace isolation tests.
- Finite model explored 672225 states; incomplete membership negative control
  correctly demonstrates why globally complete strong listing is required.
- Confirmed the committed public onRequest actually invokes withHandoffGateway.
- edgeone-test advanced without force from 5fa75746678eccd217a81e9e9a02ca12d6dd6ce9
  to the tested candidate. It is a fast-forward; no upstream history overwritten.
- master remains untouched at 5528f79c700548e174fa153b96ff4599d7326aee.
- product/main's independent task is preserved; no database provision/migration.

## Live run

Etest account handoff qualification: run 40172660989, job 121106604873.
At this checkpoint it is verifying deployment of the exact candidate before
creating any synthetic account. Do NOT interpret job creation or the unit-test
results as real-Blob completion. The live job requires matching source marker,
new gateway capability and disabled executing idle maintenance.

The live scenario holds A before final manifest publication, observes B pending,
rejects new A writes, verifies B sees exact A data, rejects late A, publishes
combined alpha/beta, confirms logout revocation, then checks C sees both records.
Unknown fixtures are retained rather than force-unlocked/deleted. No real user
account or production endpoint is used. Credentials are not logged.

## Scope is intentionally bounded

Only NEW random usernames matching ^qh26[0-9a-f]{24}$ are protected by this pilot.
Existing accounts retain previous behavior. The health endpoint explicitly says
handoffProductionReady=false. Receipts are immutable and never pruned; 128
operations per fixture and one complete listing page. Unknown writes/crashes
can strand a disposable account. This does NOT certify final production safety
or availability. See experimental/session-handoff/BLOB-QUALIFICATION.md.

Run links:
https://github.com/smhe00/qwerty-learner/actions/runs/40172568290
https://github.com/smhe00/qwerty-learner/actions/runs/40172660989
