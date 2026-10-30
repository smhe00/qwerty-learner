---
protocol_version: '1.1'
task_id: ANONYMOUS-UV-20261030
status: REVIEW
executor: Codex-admin-console
claim_base_commit: 750e346b3ce58c638f0cf6177a04c58fa0839f7f
target_branch: product/main
release_to_master: false
source_commit: da0e02f695c051393559651630e22c719549bfcb
etest_source_commit: da0e02f695c051393559651630e22c719549bfcb
---
# Daily access IDs and seven-day daily accumulation

## Final owner requirement

Only two counters. Count access IDs, not people or page requests. Each ID contributes at most once per Beijing calendar day. The same ID visiting on two days contributes twice. Last seven days includes today plus the preceding six days and SUMS the daily unique counts; it does not union IDs across the whole week. Reporting is invisible to the learner, fire-and-forget, and failures are ignored. No learning-duration, retention, per-word or per-user activity analysis.

## Implementation

- A random 128-bit first-party statistical cookie, qp_uv, supplies the access ID. It is independent of account IDs and anonymous learning-workspace ownership. It slides for 24 hours, uses SameSite=Strict and Secure on HTTPS, and is intentionally not an authentication credential. No IP, fingerprint, username, word, answer or learning snapshot is recorded. Clearing/blocking the cookie can change/omit an ID; this is not real-person identification.
- The cookie is synchronously established before the after-load/idle request, so first-visit S1 initialization/reload and subsequent refreshes retain the same ID even if the request fails. This cookie avoids introducing any localStorage/sessionStorage/IndexedDB keys into S1's pristine-origin/ownership checks. Blocked cookies or unavailable RNG omit analytics.
- One background POST /api/visits per document. No body, auth header, referrer, response parsing, retry, UI state or console message. No learning/login flow waits for it. Pages/cloud-disabled builds and automation are excluded; administrator entry/return does not invoke the reporter. Inherited external/Mixpanel learning analytics remain disabled.
- The dedicated public gateway branch is before authentication/handoff/idle work. Same-origin empty POST + a valid opaque ID are required; all outcomes are empty, no-store 204. It writes only metrics/visitors/v1/YYYY-MM-DD/SHA256(day:ID).json with constant {v:1}. Repeated/concurrent requests overwrite the identical marker; there is no shared increment or assumed atomic Blob/KV operation. Raw IDs are not stored and different days have different digests.
- GET /api/admin/visits requires the existing fresh live administrator session, admin role, and a fresh session check after the read. It lists only seven owned day prefixes, deduplicates within each day, and sums their sizes. It never reads learning/account objects. Scans are bounded (128 pages and a 10-second scan budget); errors/partial scans are not returned as zero.
- Admin overview adds 今日访问 ID 数 and 近7日累计 ID 数. Counts load separately from account statistics; failure is silently unknown (—) or retains the last known value, without an alert or auth-state mutation. Pages has explicit sample values only. Existing cloud-account/learning explanations are scoped to those metrics so they do not incorrectly exclude anonymous access IDs.
- Cloud/admission path filters now cover src/metrics/** so a future reporter-only change still gets exact-source network qualification. No auth, S1, merge, sync or learning record algorithm/schema changed. CURRENT_TASK/Circle and all incoming responsive UI work remain intact.

## Validation observed

| Check | Result |
| --- | --- |
| Focused native gateway/admin/counter/client contracts | 26 PASS. Daily repeats, Beijing midnight, same ID across two days counting twice, seven-day window cutoff, malformed/missing IDs, wrong origins/methods/body, storage failure, namespace restrictions, pagination and scan failure, ordinary/anonymous/revoked-admin denial, no learning-storage access, disabled Pages/automation, no retry/unhandled errors. |
| Production EdgeOne build + CSS ownership | PASS; existing package/chunk advisory output only. |
| Production UI on 320px light phone and 1440px dark PC | 6 PASS. Counts/formula, unknown-on-error, fully functioning ordinary login under failed analytics, ID continuity across first initialization and explicit reload, no learning-storage keys, private admin loading and zero management learning-sync calls. |
| Scoped ESLint | PASS, zero errors; three pre-existing non-null warnings in index.tsx. |
| Global TypeScript diagnostics | Same 149 diagnostic lines as the unchanged baseline after removing yarn wrapper lines; no metrics/admin/index diagnostic. Repository-wide tsc is not represented as passing. |

The first browser failure test exposed two document loads during first-use S1 initialization. Server-issued IDs would race response completion, so the final implementation establishes the opaque cookie before requesting, verifies cookie availability, and tests unchanged IDs across document reloads. The final browser assertions check ID continuity, not an incorrect assumption that a whole first-use navigation contains only one document. No S1 guard or test assertion about learning safety was disabled.

Focused evidence: /workspace/scratch/4c3b6e25c0cf/uv-*. Tests retain screenshots and visible-UI audits under test-results/ui-visible. Phone screenshot reviewed: both ID counts are clear; no person-count claim. Exact-source CI and real-network acceptance are recorded below.

## Limits

Statistics is best effort and Blob listing is eventually consistent, so newest counts may lag and failed reports are omitted. Daily marker objects are isolated from user learning data; historical markers outside seven days are not queried. No automatic deletion or unbounded historical scan is added. Cookie IDs can be changed/forged and are never used for authentication, billing or anti-abuse claims. Privileged real-admin credentials are unavailable to this executor; local native-handler tests and intercepted private API UI tests are distinguished from real-cloud acceptance. Physical iOS/HarmonyOS devices are not exercised.

Source and etest deployment are complete. No new master promotion is authorized by this task; the earlier explicit release request applied to 7eb3631 only.

Runtime references consulted (not copied): https://pages.edgeone.ai/document/middleware and https://pages.edgeone.ai/document/cloud-functions. Static-CDN traffic is not routed through the learning gateway just to count visits; the single idle request keeps statistics outside page delivery and learning critical paths.

## Exact-source CI and deployed checkpoint (2026-10-30)

Source commit: **da0e02f695c051393559651630e22c719549bfcb**, tree **4d0d3b0108132ca943d61395336e2637f696b359**, parent **750e346b3ce58c638f0cf6177a04c58fa0839f7f**. Changed files: new visitor-counts.js, visitor-count.ts, two focused native test files; updated gateway, Admin app, app entry, two workflow path filters, administrator-console.spec.ts, and this task/report (13 files total).

| Exact da0e02f evidence | Observed result |
| --- | --- |
| [Pages deployment and published regression](https://github.com/smhe00/qwerty-learner/actions/runs/41031994947) | SUCCESS before staging. Pages visible UI: 78 PASS / 120 expected skips; EdgeOne companion: 186 PASS / 12 Pages-only skips. Both learning matrices: 17 PASS each. Pages account matrix: 20 PASS / 4 expected skips. |
| [Cloud Sync Gate](https://github.com/smhe00/qwerty-learner/actions/runs/41031994882) and [read-only etest admission](https://github.com/smhe00/qwerty-learner/actions/runs/41031994955) | SUCCESS before staging, same source SHA. |
| [S1 Workspace Browser Gate](https://github.com/smhe00/qwerty-learner/actions/runs/41031994914) and [Mobile P0](https://github.com/smhe00/qwerty-learner/actions/runs/41031994976) | SUCCESS, same source SHA. |
| Actual etest deployment identity | t.smhe.cn/source-commit.txt = da0e02f; verify-edgeone-source.mjs PASS after deployment and again after HTTPS browser checks. edgeone-test was advanced once from 7eb3631 to the qualified source. |
| Actual deployed public endpoint, isolated Chromium profiles | Desktop PASS; phone PASS on focused rerun. Guest account page remains usable; real same-origin empty POST /api/visits returns 204; ID remains unchanged across document refreshes; Secure/Strict/root cookie; no auth header/body or learning mutation. Exactly one distinct synthetic ID per successful isolated profile/day; repeated requests do not imply additional IDs. |
| Actual deployed UI, intercepted private APIs | 6 PASS, phone-light 320 and desktop-dark 1440. Two ID cards/formula, silent unknown-on-error, ordinary login remains usable under aborted analytics. This verifies deployed UI behavior, not privileged real-cloud reads. |

### Retained failures and interpretation

- First real HTTPS two-profile attempt: desktop PASS, phone FAIL before the account screen appeared. Screenshot showed the safety gate with “Failed to fetch dynamically imported module: https://t.smhe.cn/assets/workspace-coordinator-60a586bb.js”. A targeted phone rerun on the unchanged deployed SHA passed (1 PASS, 10.8s). No application source, safety gate or assertion was relaxed. Root cause of that initial asset fetch failure is unproven; it remains a recorded intermittent failure, not a claim that the first run passed.
- The diagnostic phone rerun also observed aborted best-effort visits requests during document replacement. Explicit stable-document reload reports returned 204 and retained the same ID, as intended. The client does not retry a failed request.
- [Deployed automatic idle cleanup qualification 41033524289](https://github.com/smhe00/qwerty-learner/actions/runs/41033524289) FAILED at real-login-with-independent-maintenance. Its redacted receipt reports runtimeExecutionObserved=true, testAccountCleanupVerified=true and verdict=FAIL. It does not identify a proven root cause. Preserve this failure; this feature checkpoint is not whole-version or release-ready approval.
- [Branch EdgeOne Cloud E2E 41033524253](https://github.com/smhe00/qwerty-learner/actions/runs/41033524253): full run completed SUCCESS on the final status read, including real browser cloud login and real V4 transport. Frozen release readiness was SKIPPED, so this does not override the separate idle qualification failure or constitute release approval.
- Review Gate / Pages Explorer / Published Dual-Site Explorer on the candidate were CANCELLED; their absence is not counted as a pass. Other observed candidate etest journeys (historical login, offline/device relays, learning completion, handoff, segmented history, cleanup outcome and safe merge pilot) succeeded, but do not replace the missing/failed release checks.

### Scope and remaining verification

An empty 204 is deliberately returned even if storage fails, so the real public response proves browser/endpoint compatibility, not successful Blob persistence or privileged aggregate readback. Correct per-day persistence, deduplication, seven-day sum and fresh-admin access were verified by native gateway/storage contracts; the private deployed UI used synthetic API fixtures. A real administrator should verify aggregate readback before relying on these numbers operationally. Live tests intentionally introduced synthetic access IDs into etest; these are test IDs, not people, and stats start with this implementation.

Main independently advanced through c74f8ff581742fd6d7233da0acd9df5f018e7d69 to 88ce61d361fba8434bdbe9f3a8aa8f15372d98d6 (account-flow and revoked-session work). The compare is a clean forward ancestry and does not change these two task/report files. This documentation-only checkpoint is based on 88ce61d361fba8434bdbe9f3a8aa8f15372d98d6 and preserves all its source and tests. etest stays pinned to da0e02f; the evidence above does not certify the newer account source. Master remains **7eb3631f1614c8c78352a13bcbcae84ba165a290**. No production deployment was made for this feature. Before any future explicitly authorized master release, qualify an exact candidate and resolve the failed/missing release checks.

Local supplementary logs: uv-live-final.log (retained 1 PASS / 1 FAIL), uv-live-phone-final.log (1 PASS), uv-admin-deployed-ui.log (6 PASS), uv-deployed-source.log. The live acceptance used HTTPS with certificate validation enabled, fresh guest profiles and no privileged account, tracing or cookie-value logging.
