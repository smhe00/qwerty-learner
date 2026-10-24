---
protocol_version: "1.1"
task_id: "CODEX-P2-STARTUP-UNLOAD-20261024"
task_file: "interactive/tasks/CODEX-P2-STARTUP-UNLOAD-20261024.md"
report_file: "interactive/reports/CODEX-P2-STARTUP-UNLOAD-20261024-report.md"
target_branch: "product/main"
status: "REVIEW"
executor: "Codex (single executor)"
claim_base_commit: "d218a8398fb80e70cdb96d38f70df4b92f807798"
release_to_master: false
---

Owner confirms cloud sync works. Investigate and remove the startup unload permissions-policy warning without weakening single-writer ownership. Owner explicitly requests proportionate validation for small maintenance: focused lease/browser checks and scoped lint, no repeated full Cloud/workspace regression. This maintenance task targets development; preserve production d218a839 and batch deployment into the next authorized release. Prior successful sync release report is retained on codex/v4-session-report-20261024 at 44cfa543.

Implementation ready: unload listener removed; 7 focused lease/lifecycle checks and scoped lint pass. One existing full-app UI test times out on both unchanged release and patch and remains documented. No full regression or cloud-account testing was added. Existing CI configuration is unchanged. Maintenance is development-only and will ship with the next authorized release.
