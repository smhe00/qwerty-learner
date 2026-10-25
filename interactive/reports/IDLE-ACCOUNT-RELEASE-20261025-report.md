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


Corrected candidate is **2d92d5a89fb3bb8311c991aebbdd81c5b222b9b7**, committed and pushed to product/main. Frozen for the next exact-SHA gates. Its Pages workflow40146504155, Cloud40146504141, admission40146504115 and Mobile40146504135 are in progress. No production mutation. Current etest remains prior8da7e5fa; master remains ea4ede53.


Corrected candidate admission: Pages40146504155 SUCCESS and public full marker2d92d5a89fb3bb8311c991aebbdd81c5b222b9b7 verified; Cloud40146504141 SUCCESS; admission40146504115 SUCCESS. Non-force etest promotion8da7e5fa ->2d92d5a8 succeeded. New exact-SHA staging runs: Cloud/Blob/readiness40146678218, hard three-device40146678200, history40146678231, relay40146678208, safe writeback40146678212.

Retained old relay failure detail: line108 is the finally-block reauthentication used for test-account cleanup. HTTP500 there means that old disposable account's cleanup is UNCONFIRMED, not a deletion success. No password was recovered from CI or existing account data, and no force-delete was attempted. The new release candidate is independently validated using fresh per-run identifiers.


## Systematic HTTP500 investigation requested by owner

Corrected-candidate Mobile40146504135 and S140146504131 PASS. Corrected first staging Cloud browser attempt1 hit registration HTTP500; its cleanup could not authenticate the attempted identities, so creation/cleanup remains UNKNOWN. Failed-only attempt2 used fresh `_2_` identities and passed browser and Blob, but release-ready failed because hard three-device40146678200 failed its cleanup reauthentication (HTTP500), despite completing the application convergence assertions. Historical40146678231 likewise completed full six-table/Unicode/history/merge assertions but failed final DELETE HTTP500. These failures are retained; no master push occurred.

Owner requested systematic root-cause diagnosis rather than retrying until green. Historical reports show auth/deletion500s before this feature. Two isolated staging probes (Python urllib and Node fetch with environment proxy) each completed register,2 logins,2 authenticated reads, fresh cleanup login and verified DELETE:14/14 responses successful, both generated credentials removed after verified cleanup. No existing account/SMHE/customer data was used. This demonstrates intermittency, not a fix or root-cause conclusion.

High-priority hypothesis: ordinary auth still uses request.text(), whereas prior Maker evidence documented body-reader errors and V4 routes have specialized receivers. No actual auth failure stage was available to confirm this. Add a per-request diagnostics observer and redacted E2E capture BEFORE changing the body reader: fixed stage labels for JSON body/auth limiter/account operations/admin enrollment/idle activity/storage methods, optional validated platform request ID, original status/exception preserved, no body/key/credential/provider message in logs/responses. Error-keyed stage association prevents swallowed retention failures from mislabeling unrelated errors.

Local diagnostic qualification:69/69 backend/storage/route/privacy tests PASS; changed-source/test ESLint PASS;3 staging browser test configs parse/list successfully with all existing assertions retained. New deterministic test injects a body-read exception containing a private marker and proves HTTP500 identifies request-body without leaking its message. Diagnostic helper also preserves sync returns/receivers/original exceptions and rejects unsafe correlation IDs. This diagnostic-only version is not claimed as a remedy for500s.

Diagnostic etest rollout will run in parallel with normal Pages/Cloud admission under the explicit sequencing exception in the release task; final production gates are not waived. Production remains ea4ede53. PR17 stays queued after the current fix/release.
