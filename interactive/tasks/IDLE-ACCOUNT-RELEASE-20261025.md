---
task_id: IDLE-ACCOUNT-RELEASE-20261025
status: IN_PROGRESS
target_branch: product/main
release_to_master: true
---
# Owner-authorized idle cleanup/admin release

Owner explicit latest instruction: now merge into the main production line. product/main already contains the feature, so the authorized action is the standard exact-SHA etest -> master release. The original candidate was 8da7e5fa1b3986d227de3d3c8804ae17efc89080. Additional Mobile CI exposed a real pre-login request regression; the next fix commit recorded in the release report becomes the frozen candidate. Do not alter its application code while validating. Existing implementation reports remain historical development evidence.

One executor Codex. Freeze product/main at the candidate until required evidence and release-ready complete. Before staging promotion require same-SHA Cloud and published Pages admission. Then fast-forward edgeone-test without force, observe real Maker deployment, require real browser/Blob and hard three-device/release-ready. After all pass, fast-forward master to the identical SHA and verify canonical q.smhe.cn source marker, health and new read-only account policy endpoint. Re-read branch heads before mutations.

Only isolated disposable staging users; no production user login, SMHE enrollment, cloud-account cleanup, environment password or enablement changes. Keep default destructive execution disabled. Existing etest functions may create/delete synthetic accounts via required test jobs; retain failed/ambiguous cleanup evidence. Do not claim live physical erase or real administrator auto-enrollment from local tests alone.

Record exact workflow/job evidence, failures, source markers, pre/post refs and final git state in interactive/reports/IDLE-ACCOUNT-RELEASE-20261025-report.md. Commit the report/task pointer on product/main AFTER the frozen candidate has been released; documentation-only checkpoint is not a different production candidate. No force push or history rewrite. Do not rerun unchanged passing checks except required release gates.

Release attempt 8da7e5fa passed required gates but additional Mobile CI found an unintended pre-login policy GET (API count expected0/actual1 in native/fallback lease retry tests). Fix actual UI, preserving zero-request assertions, and requalify a new exact SHA. Two optional real staging jobs also failed (history expected revision1/actual0 with verified cleanup; relay login HTTP500). Do not infer their root causes or discard them. Add retries to new maintenance/admin Blob reads consistent with existing adapter retry behavior, and qualify again.

Queued owner request: after this fix/release completes, inspect historical PR #17 for the Circle typing-system work. Do not switch implementation or start parallel Circle edits before finishing current release.


Owner additionally requested a systematic investigation of repeated HTTP500s before release. Pause master promotion until failure-stage evidence is collected. Two local isolated clients issued14 successful requests total and confirmed both disposable accounts deleted; this does not exonerate intermittent paths. Add metadata-only request diagnostics and failure capture without changing body-reader/auth semantics, then observe staging.

For this diagnostic-only staging iteration, local contract/privacy/syntax qualification is completed before advancing etest; Pages/Cloud admission and real staging run concurrently instead of waiting for Pages before the diagnostic build. This is an implementation sequencing exception to this task's own pre-staging order, not a waiver of AGENTS.md production gates: master still requires matching published Pages, Cloud, real browser/Blob, three-device and release-ready for the final SHA. Only the independent disposable-data test site is affected. No runtime cleanup enablement or customer account access.

Diagnostic staging captured a live login500 at request-body with validated request ID. The next remedy commit replaces the common text receiver with native bytes and proves a before-business503 boundary; one shared transport retry only for that proof, never an ambiguous write. Local80 contracts+2 Chromium tests/build pass. Detailed finding: docs/operations/HTTP500_INVESTIGATION_20261025.md. Requalify the remedy exact SHA; do not promote the diagnostic-only or older candidates.

Qualify E2E loader changes using Node20.18.0, not just the workspace's Node24. Static ESM imports from CommonJS-emitted TS specs failed; native dynamic imports now list successfully on the actual target runtime. No application-source change is needed for this correction, but exact-SHA release gates still apply.

Node20 correction follow-up: Playwright rewrites dynamic TS import at execution too. Use the test-only native loader; require body-policy-runtime.spec.ts to actually execute on Node20 before any further CI push. Listing alone is insufficient. The366 V4 timeout is retained; add redacted path/error metadata only, no timeout/assertion relaxation.
