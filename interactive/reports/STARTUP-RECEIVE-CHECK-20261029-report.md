# Startup metadata-only receive check
Status: SOURCE_VALIDATED; etest deployment pending. Executor: Codex-startup-receive.
Base/source: `613e954a46847604dd64ffb1de5eb954f678b6df`; initial etest: `513b7d61d691f4edfdc47729ee4dd6d666e1746d`.

## Result
Fresh authenticated cloud metadata matching the same account's positive V4 baseline revision and valid logical fingerprint returns `upload-deferred` before any local digest/proof/row read, snapshot export, compression, download or upload. No baseline/proof writes and no false equality/synced result. Both clean and locally edited workspaces use this path. Skip alternate pre-mount M3 publication/M4 observation and post-mount immediate publication; resume existing 45-second idle cadence plus online/visibility triggers. Explicit and Block sync still perform audited transfer; changed, missing, incompatible or regressed remote state retains the original audited sync and recovery protocol. All final owner/token/witness and pending-journal mount checks remain.

Logout remains the existing local durable workspace operation, with no cloud preflight added. Current Circle task/implementation and master are untouched.

## Verification
- 124 focused unit contracts PASS: positive and invalid baseline matching, zero digest/proof reads (including never-resolving local readers), local edits retained, old baseline preserved, later explicit upload, remote-new download and recheck, divergence, regression, ownership, recovery journal, periodic drain and deferred checkout.
- 9 additional native gateway / login M4 / diagnostic safety tests PASS.
- 22 real IndexedDB Chromium startup and passive-return journeys PASS (2.6 minutes): phone/desktop, native same-count row edits, settings/session edits, unchanged metadata-only reload, explicit upload, alias topology, corrupt disposable cache, offline/slow metadata, revoked auth, lost ACK and cross-reload Pull/M4 journals. The 60-second stalled-network case remains intentionally bounded and is not a 1-second case.
- Production `yarn build` PASS; `verify:ui-css` PASS (2 document entries, Tailwind 3.3.2). Scoped source/cloud ESLint: zero errors; 3 unchanged non-null warnings in index.tsx.
- Whole-tree `tsc --noEmit`: baseline and candidate have identical 149 diagnostics; no new diagnostics. Existing compiler configuration/type errors are not claimed fixed. Default ESLint does not parse TS E2E files; Playwright/esbuild handles their syntax.

## Live acceptance changes
Historical E2E now asserts metadata-only unchanged startup with zero local scan/export, zero startup M3/M4 and zero POSTs; locally edited settings survive startup and explicit sync advances the cloud revision. Historical fork fixture explicitly publishes its first branch (startup intentionally no longer does), while the changed-cloud second branch must still automatically merge and preserve all six tables/session identities. M3-only remote events must still arrive via existing idle reconciliation with no extra user action. Three-device test retains strict event union/own-record conservation and waits for automatic deferred publication before revoking each session.

## Limits and next action
No real-cloud latency measured yet for this candidate. Fresh session validation and cloud metadata requests still dominate network time; 1 second is a target, not a guaranteed or measured outcome. The snapshot checkpoint does not encompass the independent immutable-event stream: when the snapshot baseline matches, that stream is handled by the retained idle/online/visibility triggers rather than blocking startup. Real-device iOS/HarmonyOS checks not performed. Push source to main, run its required CI, fast-forward authorized etest to the exact candidate, verify deployed source and relevant real-cloud E2E; record run IDs, measured stages and remaining failures. No master release.
