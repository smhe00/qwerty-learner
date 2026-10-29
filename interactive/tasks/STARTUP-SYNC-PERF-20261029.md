# Startup synchronization performance
Status: IN_PROGRESS. Executor: Codex. Base: `c6bab4ebe6c82f665745fa7e9f70579ee05e3ada`.

Owner requests careful analysis and optimization of startup sync. Independent of Circle task; leave CURRENT_TASK unchanged. Develop on product/main, qualify exact candidate and use etest for real cloud performance and integrity acceptance; no master release.

Baseline: unchanged relogin 31.346 s, guarded bootstrap 23.678 s, V4 metadata 5.951 s, observed receipts 5.573 s, witnessed history 11.169 s. Zero redundant event POST/GET already fixed in d094a45. Existing proof caches avoid full transfer but not repeated server authorization/SDK setup.

Scope: narrow existing transport reuse, independent strong authentication reads and request-local positive activity evidence to the three startup verification endpoints; remove duplicate unchanged-checkpoint authorization without removing any I/O boundary recheck. Preserve all real network session/revocation/fence checks, account isolation, data digests, journals and exact write readback. No authorization cache or early app mount. Analyze further changes only from measured evidence.

Validation: deterministic route scoping and storage concurrency, native gateway revoked-token/cleanup-during-checkpoint cases; full Cloud safety suite and existing Pages/UI gates; etest historical unchanged login and ordinary cached reload timings, zero transfers, data/fork preservation. Report exact measurements and unmet targets in interactive/reports/STARTUP-SYNC-PERF-20261029-report.md.
