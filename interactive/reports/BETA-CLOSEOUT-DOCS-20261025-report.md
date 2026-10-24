# Beta closeout documentation audit — 2026-10-25

Status: DONE within documentation scope. Base product/main: 35293b818d476628d553b1bf9e0d3a9707038031. Previously verified runtime release: ea4ede5380dfdc899a94371a5bc5289cb036004e. Parent-to-release comparison contains only task/release-report changes.

## Findings

- README and both user guides incorrectly described 32 new words, a browsing-only phone surface and no automatic fork reconciliation.
- Runtime defaults in src/store/index.ts, src/learn/block-size.ts and src/resources/defaultDictionary.ts are 20 new words, block 10 (range 1–50), UK voice and Shanghai 2027.
- Account login V4 check, automatic six-table merge and approved-origin M3 paths are implemented. Single-active-session remains distinct from multi-device sequential use. Unsupported evidence can still block automatic handling.
- The architecture document still described V3/Base64 and cloud-enabled Pages. It was replaced by a current source-linked overview; the original blob c2adb6cb3e6c4a773622348823846c13b1bc4f81 is retained unchanged under docs/history/.
- Branch strategy omitted staging; documentation now records main -> Pages -> eTest -> same-SHA master and explicit authorization.
- package.json test is still an echo placeholder; scoped static-check PASS is not repository-wide cleanliness. No test script or workflow was changed here.
- Circle is documented API-only with outstanding lifecycle boundaries; it is not silently counted as completed frontend functionality.

## Changes

README, current user/cloud guides, documentation index, architecture and branch strategy are refreshed. A dated closeout ledger separates verified functionality, retained incidents, cleanup candidates, protected safety mechanisms and later features. Current task/report pointers are updated without deleting the prior release evidence.

## Validation and limits

The audit directly read GitHub source and documentation at the pinned base and reviewed source-linked claims. Planned changes are Markdown only; compare/runtime-tree equality must be checked before moving the branch. Historical architecture is copied by its original Git blob SHA rather than reconstructed.

No application tests were rerun for these documentation changes. The prior Mobile/Review/S1/Pages/eTest results remain prior release evidence with their original SHAs and scope. Local shell network access and direct public-site fetches were unavailable in this session; no fresh production-browser success is claimed.

## Open items, not executed here

REL-01 registration HTTP500/uncertain test-identity cleanup; REL-02 historical revision mismatch; MOB-01 physical devices/PWA; ENG-01 full-project static diagnostics; CI-01 real test entry and risk-based suite consolidation; CODE-01 reference-verified legacy/naming cleanup; OPS-01 operational/rollback runbook consolidation. See docs/release/BETA_CLOSEOUT_2026-10-25.md for acceptance criteria.

No customer data, production account, master/etest pointer, runtime module, package/dependency, safety gate or research branch is changed by this task. This checkpoint is not a release authorization or a claim that follow-up work is running asynchronously.
