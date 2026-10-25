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


Diagnostic candidate **24912ac9b9713c6fce57dcd22a8d455573ae70c8** pushed to main and etest under the staging diagnostic sequencing exception. Local69/69 contracts/privacy tests, scoped lint and E2E config syntax pass. Body reader is intentionally still unchanged for attribution. Staging Cloud40147850618, hard three-device40147850617, history40147850669, relay40147850687 and safe writeback40147850625 now gather validated stage/ID metadata on errors. Main Cloud40147849479 and Pages40147849471 run independently; production remains unchanged.


## Confirmed HTTP500 component and remedy

Live diagnostic24912ac9 captured POST/auth/login HTTP500, stage request-body, request ID8672541933357853724 (run40147850618/job121032940738, 2026-10-25T00:48:57Z). This is direct evidence of failure in the common request.text receiver before password/session business processing, not an idle-deletion failure. Redacted proof and detailed scope are in HTTP500-REQUEST-BODY-20261025-proof.json and docs/operations/HTTP500_INVESTIGATION_20261025.md. Other historical500s are NOT automatically attributed to this cause. Diagnostic hard three-device40147850617 passed; history40147850669 again saw first revision0 instead of1 and confirmed cleanup200; its separate cause remains retained.

Remedy: common auth JSON receiver now uses native bytes with UTF8/length/size validation. Explicit byte-receive failure is a typed PRE-business503 with a safe-retry proof. Browser and independent clients share a single one-retry transport policy for only that proof and only four auth operations. Generic500/503, lost responses, invalid credentials and all snapshot/merge writes are never newly replayed. Independent test clients reuse this production contract; existing required success, data-identity and cleanup assertions are retained, including final response checks after any pre-business rejection.

Local remedy evidence:80/80 focused contracts PASS; real bundled gateway proves a body-rejected DELETE preserves the original identity and a fresh proved-safe retry deletes once. Register executes once despite two transport sends. Chromium2/2 verifies same-body proof retry and no unknown500 replay with exact original local rows/owner/auth unchanged. Production build PASS; scoped lint zero errors/one existing api type warning. Full tsc again has the same147 baseline diagnostics, no new ones. All changed Node/E2E clients parse successfully. Final code still needs deployed remedy qualification; production unchanged.


Remedy candidate81e31cf1a70c90a216a1d99101f48ba380c10acd was pushed to main/etest. Its full backend tests passed, but Cloud gate40148950986 failed at E2E syntax/list on actual Node20.18.0: Playwright CommonJS output tried to require the new shared ESM policy via a static import. Local shell was Node24, which accepted it, so the initial local list was insufficient; no claim of a passed Cloud gate. Fixed only the two E2E adapters to use native dynamic import, then installed a temporary Node20.18.0 runtime outside the repository and successfully listed both real configs with that exact version. Application src/cloud-functions trees remain byte-identical to81e31cf1. This is a test-loader correction, not weakened data/cleanup assertions. The next commit will acquire fresh exact-SHA gates; production stays unchanged.


Final loader-corrected candidate **366e90d4a2e3166443ccd569244b3c4279058a9d** is on main/etest. Runtime src/cloud-functions source trees are identical to remedy81e31cf1; only Node20-compatible test imports and report changed. Main Pages40149279136 SUCCESS, Cloud40149279181 backend jobSUCCESS; admission finishing. Staging Cloud40149280808, hard three-device40149280807, history40149280786, relay40149280766 are pending actual final deployed source. Previous remedy81e31cf1 had real browser/Blob PASS and safe-writeback40148953078 SUCCESS; it is not a substitute for exact final-SHA release readiness. S1 workspace40148950956 SUCCESS on the identical application source.


## Real Node20 worker follow-up

366e90d4 passed list-only checks, but the live worker revealed Playwright1.40 also rewrites TS dynamic import to require at EXECUTION. Hard three-device40149280807 and history40149280786 therefore failed before creating their accounts. This is a test-adapter defect, not a verified application/data failure; the earlier list check was insufficient. Added a test-only fixed native-import loader and an actual worker-execution regression, then executed it with installed Node20.18.0:1/1 PASS (runtime explicitly logged), and both real configs still list. This execution check is now in Cloud Gate before listing so it cannot be missed again. Application source remains unchanged.

On the same366 runtime, actual cloud browser4-case login job121037382123 PASS. V4 transport121037382323 completed 256/512/1024/1536/2048-KiB writes with SHA/readback and both cleanup receipts, but then hit a client TimeoutError on a subsequent operation. The existing20s budget and all assertions remain unchanged; add only sanitized method/path/timeout diagnostics to identify its route if repeated. Large-part body reception also showed already-guarded v4_upload_body_read_failed503s and successful SHA-pinned part retries. These are distinct from unclassified internal500 and do not authorize replaying arbitrary writes. This transport failure remains a failure, not a release pass. master remains ea4ede53.
