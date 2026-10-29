# QWERTY Plus 1.0.0 release qualification

Status: PASS for required release gates and deployed production identity. Published 2026-10-29 23:40 (Asia/Shanghai).
Owner authorization: “按你的节奏来发布正式版”.
Execution base: 14b5a2b10ac0ca330e1c9545eb313aceda276d11.
Production candidate: f874b146875c507f6f30097059a47bb700c761bf.
Previous master: ad862b392c6a935ca49514fc9df146932aa02ed2.

## Released behavior

The core desktop Typing/Learn and mobile memory product is version 1.0.0. Current HTML/social metadata, visible release wording and active guides are aligned. No learning schema, ownership, merge identity, storage format, authentication implementation or sync kernel was changed by this release task. Existing startup behavior retains local edits when fresh cloud metadata matches the account baseline; explicit/Block synchronization retains the original full executor. Logout adds no automatic upload.

The remaining completion test incorrectly expected reload to upload the newly opened five-word extra round. It now proves upload-deferred, unchanged cloud revision/fingerprint and exact local preservation, then explicitly syncs and requires exactly one new V4 commit and fresh-profile exact readback. Last-answer conservation, complete backup hashes and no-duplicate assertions remain.

## Required exact-SHA qualification

All following runs belong to f874b146875c507f6f30097059a47bb700c761bf; no newer-SHA result substitutes for candidate evidence.

| Evidence | Run | Result |
| --- | --- | --- |
| Pages production matrices, actual deployment and public browser regression | [40897635144](https://github.com/smhe00/qwerty-learner/actions/runs/40897635144) | PASS |
| Source Cloud Sync Gate | [40897635004](https://github.com/smhe00/qwerty-learner/actions/runs/40897635004) | PASS; 1059 tests, 0 failures |
| Read-only etest admission | [40897634778](https://github.com/smhe00/qwerty-learner/actions/runs/40897634778) | PASS |
| Mobile P0 | [40897634752](https://github.com/smhe00/qwerty-learner/actions/runs/40897634752) | PASS |
| Published dual-site browser regression | [40897635090](https://github.com/smhe00/qwerty-learner/actions/runs/40897635090) | PASS |
| etest real browser, Blob transport, lost-ACK recovery and release-ready | [40899203864](https://github.com/smhe00/qwerty-learner/actions/runs/40899203864) | PASS |
| Historical six-table login and divergent recovery | [40899203880](https://github.com/smhe00/qwerty-learner/actions/runs/40899203880) | PASS |
| Completion, extra-round deferral/manual sync and new-profile readback | [40899203709](https://github.com/smhe00/qwerty-learner/actions/runs/40899203709) | PASS; both cases |
| Three-device offline forks and automatic adoption | [40899203796](https://github.com/smhe00/qwerty-learner/actions/runs/40899203796) | PASS on attempt 2; first-attempt failure retained below |
| M3 single-session device relay | [40899203865](https://github.com/smhe00/qwerty-learner/actions/runs/40899203865) | PASS |
| Segmented history resume | [40899203746](https://github.com/smhe00/qwerty-learner/actions/runs/40899203746) | PASS |
| Account deletion outcome/recovery | [40899203798](https://github.com/smhe00/qwerty-learner/actions/runs/40899203798) | PASS |
| Idle cleanup | [40899203820](https://github.com/smhe00/qwerty-learner/actions/runs/40899203820) | PASS |

Painted production UI: EdgeOne matrix 64 passed/8 device-inapplicable skipped; Pages 52 passed/20 inapplicable skipped. Each production build additionally passed 17 touch/refresh/audio checks. Pages account-only preview: 20 passed/4 inapplicable skipped, preserving zero authentication requests. The deploy job's public Pages browser regression passed all 6 cases. Skips are not failures converted to PASS.

Local production build passed in 35.31 seconds; physical SPA entries and global CSS ownership contract passed. Changed application files passed scoped ESLint. The formal-branding contract passed over 491 active source/public/document files; whitespace validation passed. Release branch policy contracts passed 14/14. Full-repository zero-error TypeScript is not claimed.

## Promotion and production proof

Readiness job 123547316905 independently rechecked candidate ancestry, historical exact-SHA Pages and source Cloud success, current etest marker, passing real browser/transport jobs and the HARD three-device result. Its proof named candidate f874b146875c507f6f30097059a47bb700c761bf, Pages run 40897635144, Cloud source run 40897635004 and three-device run 40899203796.

Master was fast-forwarded using force=false and expected old head ad862b392c6a935ca49514fc9df146932aa02ed2 to the identical etest-qualified candidate. No source was stripped or changed during promotion. At promotion, main and etest also pointed to the candidate. This release report is a subsequent documentation checkpoint on main, not a second production promotion.

[EdgeOne Production Verify 40903319543](https://github.com/smhe00/qwerty-learner/actions/runs/40903319543) passed at 2026-10-29T15:40:00Z: https://q.smhe.cn served source marker f874b14, gateway qwerty-sync-gateway was healthy, and /mobile, /mobile/history, /mobile/data and /mobile/achievements returned their expected application entries. This is an anonymous read-only production probe, not an authenticated production merge test.

[Maker V4 Migration Live Readiness 40903319579](https://github.com/smhe00/qwerty-learner/actions/runs/40903319579) also passed. Real account write/merge qualification was performed on etest, with disposable accounts.

## Preserved failures and limits

1. Three-device attempt 1 completed all application convergence assertions: each profile had exactly 3 records and no pending merge journal. Teardown then failed: the completed-deletion receipt Blob write returned PagesBlobError/COS_ERROR after 5089 ms, independent readback was missing and original-bearer read-only polling stayed pending. The original DELETE was never replayed. Its account deletion outcome remains unconfirmed in retained evidence; do not claim that original cleanup was subsequently proven. Attempt 2 used a distinct disposable identity, ran the unchanged full test and passed application convergence plus confirmed cleanup (HTTP 200, 27.482 s total cleanup). This is independent qualification, not a code fix for provider outages or rewriting the original failure.

2. Advisory Pages Explorer 40897634768 was cancelled at its workflow deadline after four setup timeouts. Its retained redacted traces have zero completed learning steps/blocks, zero page exceptions and zero auth/sync calls. Source inspection identifies an obsolete “记忆参数” tab selector while the current visible tab is “学习计划” in pages-daily-lifecycle-v3, pages-deferred-v3 and two pages-explorer-multiblock setups. It is NOT a passing suite; this advisory maintenance remains open. It was not weakened, removed or substituted for the passing mandatory public regression and painted-UI gates.

3. Physical Huawei/HarmonyOS/iOS/iPad Safari devices were unavailable. Automated Chromium evidence does not certify those devices or every soft-keyboard/OS/audio case. Prior 143 TypeScript baseline diagnostics remain documented. Subsecond startup and subsecond Circle performance are not measured or claimed.

4. Eventually consistent storage can return uncertain writes and provider errors. Existing journals, exact readback and account isolation remain essential. A Git source rollback does not restore user data.

## Coordination

This task did not take over the Circle CURRENT_TASK, modify other worktrees, rewrite shared history, change hosting branch bindings, touch real user accounts or bypass a release gate. Product/main may advance independently; master and etest remain pinned to the qualified production SHA.
