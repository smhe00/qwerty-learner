# Unified account UI release

Status: IN_PROGRESS. Owner explicitly replaced the earlier independent UI exclusion and confirmed fast-forward-only promotion of the exact etest-qualified SHA. This candidate includes direct account entry, PC sync dropdown and mobile quick sync. Production currently serves98697131, whose old intermediate account overview was preserved by the earlier independent-release scope; that scope is now superseded.

## Existing verified work

- Synchronization timeout/root cause, 98697131 exact-SHA release and live production evidence: COMMIT-OUTCOME-INDEPENDENT-RELEASE-20261026-report.md. No old or mixed deployment result substitutes for this candidate's required published gates.
- UI integration and local verification: STAGING-UI-RESTORE-20261026-report.md. 15 account continuity cases, 22 account flows, 7 quick-sync contracts, 4 Pages account previews, 42 full workspace entry cases, and 2 HTTP safety cases PASS. Native/fallback writer leases, expired sessions, no intermediate overview, history preservation and keyboard menu focus covered.
- UI runtime8356b50d: Published Pages40275127323, Cloud40275127293, admission40275127304, Mobile P0, Review, toolbar, completion and recovery gates PASS.
- 751bec7d only removes10 obsolete second-click test actions in4 files. Ownership, auth, data retention and recovery assertions retained. No runtime or backend change. Full S1 CI must use this aligned test revision or newer; 8356b50d contains obsolete steps.
- New task uses the same runtime as8356b50d and same tests as751bec7d, adds explicit owner scope and persistent AGENTS promotion rule. Freeze resulting SHA, obtain its own Pages/Cloud admission, then etest Cloud/Blob/browser/hard-three-device/release-ready before master fast-forward. No production push yet for the UI candidate.
