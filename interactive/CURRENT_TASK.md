---
protocol_version: '1.1'
task_id: 'IDLE-ACCOUNT-RELEASE-20261025'
task_file: 'interactive/tasks/IDLE-ACCOUNT-RELEASE-20261025.md'
report_file: 'interactive/reports/IDLE-ACCOUNT-RELEASE-20261025-report.md'
target_branch: 'product/main'
status: 'IN_PROGRESS'
executor: 'Codex (single release executor)'
claim_base_commit: '8da7e5fa1b3986d227de3d3c8804ae17efc89080'
release_to_master: true
---

Owner authorized merging to production mainline after the feature was pushed to product/main. The 8da7e5fa candidate passed required staging gates but additional Mobile CI found a real pre-login policy query. The correcting commit becomes the frozen candidate for required same-SHA Pages, Cloud admission, etest browser/Blob/three-device and release-ready. No runtime enablement or real SMHE enrollment/deletion authorized. Implementation task IDLE-ACCOUNT-CLEANUP-20261024 is complete at REVIEW; retain its reports. The release pointer/report is committed together with the necessary runtime correction; further reporting waits until frozen-candidate release to avoid invalidating exact-SHA gates.

Correction locally qualified: original native/fallback zero-request writer cases2/2, relevant contracts80/80, scoped lint PASS. Preserve all failed run evidence. Owner queued PR17 inspection only after current fix/release.

Owner now requires systematic repeated-HTTP500 investigation before master. Add metadata-only phase/correlation diagnostics; do not call successful retries a remedy. Diagnostic staging may run concurrently with Pages/Cloud admission after local69-test qualification; all final production gates still apply. See latest release task/report sections.

HTTP500 live evidence now confirms one auth request-body receiver failure (proof/report linked above). Native-byte receiver+strict pre-business retry remedy locally qualified80 contracts/2 Chromium tests, no new TypeScript diagnostics; proceed with fresh exact-SHA deployed qualification. Historical unrelated/unknown failures remain in report. Production is still unchanged; PR17 remains queued.
