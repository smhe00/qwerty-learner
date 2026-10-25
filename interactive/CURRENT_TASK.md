---
protocol_version: '1.1'
task_id: 'IDLE-ACCOUNT-RELEASE-20261025'
task_file: 'interactive/tasks/IDLE-ACCOUNT-RELEASE-20261025.md'
report_file: 'interactive/reports/IDLE-ACCOUNT-RELEASE-20261025-report.md'
target_branch: 'product/main'
status: 'REVIEW'
executor: 'Codex (single release executor)'
claim_base_commit: '8da7e5fa1b3986d227de3d3c8804ae17efc89080'
release_to_master: true
---

Owner-authorized release complete; ready for review. Production master and staging edgeone-test both5528f79c700548e174fa153b96ff4599d7326aee. Required identical-SHA Pages/Cloud/real-browser/Blob/three-device/readiness passed; one failed-only historical CI retry also passed, with attempt1 retained. Canonical production source, gateway, policy and mobile entries were independently verified. Idle cleanup enabled=false; no runtime setting change or real-user/SMHE operation. Existing automatic production smoke passed both generated-account cleanup receipts.

HTTP500 diagnosis confirmed a live request-body-stage login failure before account business operations. Native-byte receiver and narrowly proved-safe one-retry remedy locally qualified80 contracts/2 Chromium tests and deployed gates. Other historical failures and ambiguous cleanup are not retrospectively resolved. Full TypeScript retains147 baseline diagnostics, no additions. See linked report/proof for exact workflows and remaining limits.

The closing product/main checkpoint contains reports/evidence and one test-harness correction, not a new application release: the obsolete legacy-readiness probe used an empty profile, which now correctly initializes without migration. Canceled that invalid read-only run; corrected its populated synthetic local-IDB fixture/canonical origin and verified actual production consent, disabled confirmation and exact retained row. No src/cloud-functions change or second master promotion.

Queued PR17 inspection completed after production verification: OPEN, not Draft, unmerged, no Circle frontend. Status is in interactive/reports/CIRCLE-PR17-STATUS-20261025.md. No Circle writes, implementation or merge. Implementation task IDLE-ACCOUNT-CLEANUP-20261024 and its reports remain preserved at REVIEW. No blocking dependency; final acceptance belongs to Chat/Reviewer.
