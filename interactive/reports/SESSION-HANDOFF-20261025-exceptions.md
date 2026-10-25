# Etest exceptional handoff qualification — in progress

Owner authorized continuation after the first isolated live pass. Feature base
27e2f9b6; inspected product/main d3d2a0c7; pinned Etest runtime 34a3d15.
Preserve independent CURRENT_TASK and all previous failed evidence. No master,
ordinary accounts, database migration, provider settings or runtime edits.

New bounded journey uses one fresh reserved synthetic account only:
- Incorrect credentials must not create a pending handoff or revoke A.
- Hold A at manifest publication, observe B pending, then abort A's client HTTP
  connection. Never retry the unknown upload. B must later read exact revision,
  payload SHA and logical fingerprint; stale A must be refused.
- Hold B's next publication and actually observe two concurrent takeover requests
  pending. After serialization exactly one resulting token remains current.
- Repeated switching, explicit logout and relogin retain exact combined records.
- Finish with zero unresolved operations and safely delete the synthetic account;
  any uncertain failure retains it, never force-unlocks. Audit receipts remain.

Local actual gateway over a real loopback TCP server passed the new journey;
Blob is simulated locally. CI must first run that exact test and then require all
cloud-functions equal pinned deployed runtime before any live account creation.
Before/after source gates detect staging drift. Live results are not yet claimed.
This is client-disconnect/competing-login qualification, NOT server-crash recovery,
provider global consistency proof, automatic FSRS merge or all-user readiness.
