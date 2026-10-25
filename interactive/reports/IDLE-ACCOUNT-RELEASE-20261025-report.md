# Idle account cleanup/admin release — in progress

Owner authorized production merge after development implementation. Candidate 8da7e5fa1b3986d227de3d3c8804ae17efc89080; pre-release master and edgeone-test both ea4ede5380dfdc899a94371a5bc5289cb036004e.

Exact candidate CI was already running on product/main. Cloud backend job passed; published Pages propagation/browser and staging admission remain in progress. No etest/master mutation yet. No runtime settings, real user records or real SMHE account accessed.

Release authority and frozen-candidate procedure: ../tasks/IDLE-ACCOUNT-RELEASE-20261025.md. Retain implementation report separately. Remaining actions: published Pages/Cloud admission; etest exact-SHA real tests/release-ready; master fast-forward; anonymous production proof; final documentation checkpoint.


## Exact-SHA admission and staging promotion

- Candidate 8da7e5fa1b3986d227de3d3c8804ae17efc89080 Cloud Sync Gate **40145495575 SUCCESS**, including full cloud-backend and exact-SHA staging admission jobs.
- Published Pages deployment/browser regression **40145495655 SUCCESS**; independent public marker read confirmed the full exact candidate SHA.
- Etest Pilot Admission **40145495551 SUCCESS**.
- Re-read remote heads: main=candidate, etest/master=ea4ede5380dfdc899a94371a5bc5289cb036004e; both old refs are ancestors of candidate. Non-force etest push succeeded ea4ede53 -> 8da7e5fa.
- Triggered required real staging Cloud browser/Blob/readiness **40145715384**, hard three-device **40145715381**, plus existing automatic relay/history/writeback workflows. Currently waiting for the actually deployed staging marker before any test credentials are created.
- Optional/local browser release gate **40145495689 SUCCESS**. S1/mobile gates still running, no success claimed yet. No production ref/runtime configuration/data mutation.


Staging actual deployment observed at 2026-10-25T00:14Z: public /source-commit.txt=8da7e5f, exact prefix of candidate; new GET /api/account-policy returned HTTP200 {ok:true,enabled:false,idleDays:180}. This read-only proof confirms new gateway route and disabled idle policy, without authenticating or enrolling SMHE. Real Blob/browser jobs proceeded only after the candidate frontend marker appeared.


## Candidate correction before production release

8da7e5fa required staging gates succeeded: Cloud browser job121026489222, real V4/Blob job121026489396 and release-ready job121027645486 in run40145715384 all SUCCESS. Hard three-device run40145715381 SUCCESS. S1 workspace gate40145495625 SUCCESS; safe writeback40145715424 SUCCESS. These are genuine passes, but are NOT used to certify the corrected later SHA.

Additional Mobile gate40145495548 FAILED 26/28 account tests. Both native/fallback live-writer retry cases reached their original line194 zero-API-request assertion with actual1. Root cause confirmed in current source: pre-mount `workspace-account-ui.ts` unconditionally queried the new public account-policy endpoint when rendering the sign-in form. Removed that network query and show a static conditional policy notice instead. No zero-request assertion, writer lease or account-transition guard was relaxed. New targeted real Chromium execution of the same two tests PASS2/2 (32.1s).

Two automatic optional staging jobs also failed and remain retained: history40145715402 expected first revision1/actual0; the redacted receipt confirms cleanup HTTP200/verified=true. Relay40145715393 hit POST/auth/login HTTP500/internal_error at line108. Their full causes are not established and they are not labeled as passes. New administrator/maintenance metadata paths had not shared the existing Blob adapter's transient retries; reuse its existing bounded retry helper for those reads and idempotent operations, and verify an ambiguous administrator-binding write by canonical readback rather than trusting its response.

Targeted post-correction contracts: `node --test tests/cloud/idle-accounts.test.mjs tests/cloud/backend-core.test.mjs tests/cloud/edgeone-blob-storage.test.mjs tests/cloud/s2-write-route.test.mjs tests/cloud/handler-cors.test.mjs tests/cloud/default-dictionary-registration.test.mjs tests/cloud/login-event-warning.test.mjs` PASS80/80; scoped changed-source/test ESLint PASS, git diff whitespace PASS. Added a transient metadata-read and lost durable binding-response regression. No blanket retry of failed cloud writes, test weakening or same-source failure relabeling.

Freeze the next commit containing these fixes as the new candidate; required Pages/Cloud admission, staging browser/Blob/three-device/readiness will all be acquired for that exact SHA before master changes. master still ea4ede53. A queued owner request after this release is to inspect historical PR17 (Circle typing system), without switching implementations mid-fix.
