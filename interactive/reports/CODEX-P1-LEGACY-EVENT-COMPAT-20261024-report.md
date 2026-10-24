# Legacy event compatibility repair

Status: DONE. Released application05e5e8f0 is live and healthy on canonical q.smhe.cn.
Base: 4982e53700c507d457444108799ad12b81e92c25. Owner authorizes product/main -> edgeone-test -> master, targeted verification, no existing customer data operations.

## Root cause and boundary

WordRecord historically made attemptId and sourceMode optional. Each login rescans all historical rows, so no new study is needed to hit the combined legacy-or-corrupt M3 recovery error. The same assumption independently blocked the read-only witnessed receiver and M4 candidate. The owner supplied the exact recovery code; private row field counts were NOT read. Computer Use stopped because it could not confidently identify Chrome's URL, and no alternate UI access was attempted.

Missing UUID/provenance alone now classifies a row as snapshot-only. It stays byte-for-byte in full V4; we do not invent UUIDs, infer absent sourceMode, delete history or modify user databases directly. Eligible new events can publish and be received alongside it. Invalid present identity, mode, timestamp or review baseline, UUID contradictions, unverified cloud receipts, account/lease changes and export/readback mismatch still fail closed.

M4 replays the complete applicable local review history, including pre-UUID negative reviews. Sparse historical archives retain their richer persisted scheduler state instead of downgrading it, following existing full-V4 policy. Original six-table evidence, exact immutable events, scratch audit, durable before/after journal and post-restore fingerprint checks remain mandatory.

Successful handled compatibility is silent. Genuine incomplete sync has a short plain-language notice. The settings incident package now includes fixed field-issue counts, M3/witness/M4/V4 statuses, retained richer-state counts and timing; this new section contains no credentials, identifiers or learning payload. The existing incident bundle still explicitly includes relevant local learning data under its existing export disclosure.

## Targeted local evidence

- 45 focused recovery/outbox/M4/login/UI contracts passed.
- 7 witnessed receiver contracts and 3 diagnostic sanitation contracts passed (55 distinct unit tests total). Subsequent changes to diagnostic type narrowing and receiver iteration were rerun: 10/10 passed.
- Real isolated browser: mixed legacy source -> independent lossless materialization -> durable M4 journal restore -> exact old rows/all durable tables -> repeated prefix no-op -> read-only incident export passed. Existing guarded seal and crash-after-staging recovery also passed (3 distinct browser contracts). Final mixed-history case rerun after formatting: 1/1 passed.
- Scoped ESLint: zero errors; existing-style non-null assertions and ignored destructured metadata yield warnings. etest spec loads successfully via Playwright --list.
- Repository-wide TypeScript has a known baseline (144 errors); two new diagnostics found during implementation were fixed. Final run returned exactly 144 baseline errors and no diagnostics in the two new compatibility/diagnostic modules.
- Expanded the existing etest historical-login test, reusing its disposable account: mixed missing-ID/missing-mode rows, real Learn attempt, M3-only publication with unchanged V4 revision, witnessed M4 reception, real logout/login without study, and exported diagnostic counts. The complete live scenario passed independently against 05e5e8f0, using the corrected route assertion described below.

## Validation/release operations

Owner explicitly authorized making production-three-device-sync.yml manual-only on 2026-10-24 after automatic approval requested clarification. Its tests and workflow_dispatch remain; etest qualification and production read-only source/health verification remain automatic. No production test account is needed for this release.

Pre-commit now runs only lint-staged with formatter and ESLint on staged source files. Removed the two whole-repository mutation commands. A local package script alias unexpectedly expanded an attempted scoped formatting command; execution was interrupted, all changed files backed up and hash-verified, and precisely 116 unrelated formatter-only paths restored. All intended changes were preserved; no unrelated files are included in this commit. Direct node_modules binaries are used for scoped checks.

No manual edits to customer records.


## Exact deployed application and evidence

Application commit: 05e5e8f0d4b734e4463d71ad0577c38c165e1241. Fast-forwarded into product/main first, then edgeone-test. After the checks below and full mixed-history acceptance, fast-forwarded master from d218a8398fb80e70cdb96d38f70df4b92f807798 to the identical application commit.

- Pages published regression: [40081470854](https://github.com/smhe00/qwerty-learner/actions/runs/40081470854) PASS.
- Cloud backend/lint/build: [40081470988](https://github.com/smhe00/qwerty-learner/actions/runs/40081470988) PASS, 615/615 unit contracts in existing automatic CI. These were not duplicated as a full local run.
- etest actual V4 Blob upload/readback/conflict, three-profile account browser, exact-SHA release-ready: [40081483350](https://github.com/smhe00/qwerty-learner/actions/runs/40081483350) PASS. All disposable cleanup assertions passed. Release-ready reports sameCommit=05e5e8f0..., Pages run40081470854, etestCloudJobsPassed=true; its releaseAuthorized=false intentionally means the CI itself never grants owner authorization. The owner explicitly authorized this release in chat.
- etest three real Learn offline forks: [40081483397](https://github.com/smhe00/qwerty-learner/actions/runs/40081483397) PASS; disposable cleanup HTTP200.
- M3 relay [40081483360](https://github.com/smhe00/qwerty-learner/actions/runs/40081483360) and safe V4 writeback [40081483349](https://github.com/smhe00/qwerty-learner/actions/runs/40081483349) PASS.
- **Independent complete historical/mixed acceptance:** isolated local Playwright against deployed etest05e5e8f0, 1/1 PASS in3.2minutes. Proof: [legacy-event-compat-etest-20261024.json](evidence/legacy-event-compat-etest-20261024.json). The synthetic fixture includes1,472,401bytes of Unicode history,700original review sessions, exact six-table startup restoration and fork preservation; five historical rows remain exact while one real Learn event crosses M3 then M4 with no V4 revision change before reception. Ordinary logout clears authentication and restores the empty anonymous workspace; re-login returns all six rows unchanged, without a legacy warning. UI incident export is read-only and reports eligible1/snapshotOnly5/rejected0, missing-attempt-id4/missing-source-mode4. These are fixture counts, NOT the owner's private account counts. Disposable account cleanup returned200 and accountDeleted=true.

### Retained failures and test-only correction

Historical Actions [40081483351](https://github.com/smhe00/qwerty-learner/actions/runs/40081483351) remains FAILED: attempt1 received a login HTTP500 before compatibility assertions; cleanup verified200. Attempt2 passed all original V4 proof plus mixedLegacyM3Publication, mixedLegacyM4Adoption and legacyRowsUnchanged, then its new logout assertion incorrectly required the exact root URL while the app legitimately redirected to /learn; cleanup again verified200. Corrected only that test/helper to accept the known root or Learn route, and strengthened independent logout-state assertions. No application bytes or data assertions were relaxed. The independent complete passing run above used this correction against the SAME deployed05e5e8f0 application; do not describe the original Actions run as green.

S1 full automatic suite [40081471044](https://github.com/smhe00/qwerty-learner/actions/runs/40081471044) passed126/127, with one post-acknowledgement-loss fingerprint assertion failure. Only that exact scenario was rerun locally against05e5e8f0:1/1 PASS in18.8seconds (test15.2seconds). No production sync code for that S2 path was altered to mask the failure. This one CI observation remains recorded; it is not represented as a completely green run.

The unrelated old-alias mobile Explorer [40081470952](https://github.com/smhe00/qwerty-learner/actions/runs/40081470952) passed11/12 and failed its old mobile-shell expectation at qwerty-plus.edgeone.dev. Development base4982e537 run[40079180495](https://github.com/smhe00/qwerty-learner/actions/runs/40079180495) had the same11/12 failure and exact missing-heading assertion. Canonical q.smhe.cn and qualified t.smhe.cn remain the release targets.

## Source locations at the application commit

- src/sync/learning-event-compatibility.ts:27 and48: exact wire predicates vs harmless missing historical fields.
- src/sync/multi-device-recovery.ts:17: full historical scan, fixed aggregate audit, eligible immutable events only; all original rows retained.
- src/sync/m3-witnessed-receiver.ts:187: event-only preview with full local UUID conflict checks before M4.
- src/sync/m4-witnessed-prefix-candidate.ts:121,183,202: preserve legacy source, replay complete applicable history, retain richer state; original six-table/journal/lossless contracts remain.
- src/sync/workspace-account-ui.ts:151 and src/sync/learning-sync-diagnostics.ts:6: quiet successful compatibility; plain genuine pending notice and fixed diagnostic-only reasons.
- src/dev/incident-snapshot.ts:111: read-only all-dictionary field counts included in the existing exported diagnostic package.

The follow-up product/main commit contains only the test landing-route correction, task status and release evidence. Application source remains exactly the qualified05e5e8f0 release; etest/master are not redeployed for these maintenance files.


## Production confirmation

[Read-only production run40082649297](https://github.com/smhe00/qwerty-learner/actions/runs/40082649297) PASS at2026-10-24T09:39:28Z. Canonical https://q.smhe.cn returned source05e5e8f for expected05e5e8f0d4b734e4463d71ad0577c38c165e1241, gateway=qwerty-sync-gateway, apiVersion=1. Only source/health GETs were performed after release. The production account-writing three-device workflow did not auto-run; its complete test remains manually available as explicitly authorized by the owner.

No real customer account, local learning record or production cloud snapshot was directly inspected or mutated during this task. Existing data remains protected by all source/roundtrip/fingerprint/journal checks. The user's exact historical field distribution can now be obtained from the existing Settings -> Developer diagnostics -> Export incident package UI without console commands.
