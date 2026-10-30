---
protocol_version: '1.1'
task_id: ANONYMOUS-UV-20261030
status: IN_PROGRESS
executor: Codex-admin-console
claim_base_commit: 750e346b3ce58c638f0cf6177a04c58fa0839f7f
target_branch: product/main
release_to_master: false
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
| Focused native gateway/admin/counter/client contracts | 26 PASS. Daily repeats, Beijing midnight, same ID across two days counting twice, seven-day expiry/window, malformed/missing IDs, wrong origins/methods/body, storage failure, namespace restrictions, pagination and scan failure, ordinary/anonymous/revoked-admin denial, no learning-storage access, disabled Pages/automation, no retry/unhandled errors. |
| Production EdgeOne build + CSS ownership | PASS; existing package/chunk advisory output only. |
| Production UI on 320px light phone and 1440px dark PC | 6 PASS. Counts/formula, unknown-on-error, fully functioning ordinary login under failed analytics, ID continuity across first initialization and explicit reload, no learning-storage keys, private admin loading and zero management learning-sync calls. |
| Scoped ESLint | PASS, zero errors; three pre-existing non-null warnings in index.tsx. |
| Global TypeScript diagnostics | Same 149 diagnostic lines as the unchanged baseline after removing yarn wrapper lines; no metrics/admin/index diagnostic. Repository-wide tsc is not represented as passing. |

The first browser failure test exposed two document loads during first-use S1 initialization. Server-issued IDs would race response completion, so the final implementation establishes the opaque cookie before requesting, verifies cookie availability, and tests unchanged IDs across document reloads. The final browser assertions check ID continuity, not an incorrect assumption that a whole first-use navigation contains only one document. No S1 guard or test assertion about learning safety was disabled.

Focused evidence: /workspace/scratch/4c3b6e25c0cf/uv-*. Tests retain screenshots and visible-UI audits under test-results/ui-visible. Phone screenshot reviewed: both ID counts are clear; no person-count claim. Required source CI will rebuild both Pages and EdgeOne at the exact commit before a real-network etest acceptance.

## Limits / next step

Statistics is best effort and Blob listing is eventually consistent, so newest counts may lag and failed reports are omitted. Daily marker objects are isolated from user learning data; historical markers outside seven days are not queried. No automatic deletion or unbounded historical scan is added. Cookie IDs can be changed/forged and are never used for authentication, billing or anti-abuse claims. Privileged real-admin credentials are unavailable to this executor; local native-handler tests and intercepted private API UI tests are distinguished from real-cloud acceptance. Physical iOS/HarmonyOS devices are not exercised.

Push source to main, qualify its exact SHA on Pages + Cloud admission, then perform authorized network-dependent etest acceptance with isolated synthetic access IDs and a fresh browser. No new master promotion is authorized by this task; the earlier explicit release request applied to 7eb3631 only. Record deployment evidence and remaining limits in a follow-up checkpoint.

Runtime references consulted (not copied): https://pages.edgeone.ai/document/middleware and https://pages.edgeone.ai/document/cloud-functions. Static-CDN traffic is not routed through the learning gateway just to count visits; the single idle request keeps statistics outside page delivery and learning critical paths.
