# Reviewed study content release

Status: PASS. Owner authorization: “直接更新到etest+master”. Date: 2026-11-01 (Asia/Shanghai).

Both edgeone-test and master were fast-forwarded to the identical qualified commit `fba0d8de2e14225844be10fb1778825ff6c8c585`. The actual eTest and production /learn footers both show `fba0d8d`. Production gateway and mobile-route verification passed. This final documentation checkpoint advances product/main only; it must not be promoted to either release branch without new qualification.

The released batch contains 216 reviewed supplementary daily examples and 92 compatible image pairs. Of 219 reviewed headwords, three examples remain deferred; 2,653 dictionary entries remain unreviewed. All 2,207 original image assets remain in the repository. The 2,872 authoritative entries have zero changes to name, trans, ukphone, usphone, example, tags or notation compared with previous master `7eb3631f1614c8c78352a13bcbcae84ba165a290`. The authoritative JSON SHA-256 remains `ffcbfcf7950f824c4d0666facd028171520ab9baf0b59e7fc91f5f9e7f3ab9b5`.

Release preparation changed only a YAML comment in cloud-sync.yml and the release task/report from application base `c5781c84d5b19a4a8981314ced75326604d0a706`. No runtime, dictionary, tests, dependencies, gate assertions or job behavior changed for release preparation. The unrelated Circle task pointer remains untouched.

## Exact-SHA qualification

All required current V4 release checks passed at the released SHA:

- Published Pages workflow [41286675822](https://github.com/smhe00/qwerty-learner/actions/runs/41286675822), attempt 2: 21 dictionary contracts, 22 dictionary journeys, 50 image/example journeys, 86 full UI journeys, 17 primary-action journeys, 20 offline-account journeys and CSS ownership passed. EdgeOne companion build passed 200 full UI journeys plus its dictionary/image/primary-action checks. Actual published Pages regression passed 9 journeys; artifact commit `9ad1ee83447febcdef3d766038e3db6f811f6d1c`.
- Source Cloud workflow [41286675828](https://github.com/smhe00/qwerty-learner/actions/runs/41286675828), attempt 2: 1,077 backend tests passed; source build and admission passed.
- Branch Cloud workflow [41286686245](https://github.com/smhe00/qwerty-learner/actions/runs/41286686245), attempt 2: real browser cloud, actual V4 transport, large HTTP multipart, lost-ACK full readback and release-ready passed. Final readiness job: `124793908357`.
- All seven companion staging workflows passed, including hard three-device offline convergence [41286686174](https://github.com/smhe00/qwerty-learner/actions/runs/41286686174), historical login, Learn completion, segmented history resume, M3 relay and both cleanup qualifications. Exact IDs and outcomes are retained in the acceptance JSON.

One initial Pages assertion sampled a 44px attribution link during the About dialog's scale(0.95) entrance animation, measuring 41.8px. The same unchanged 44px assertion passed on a targeted rerun. Source admission and release-ready initially observed the unfinished/failed Pages workflow; only those read-only checks were rerun once Pages qualified. Already-passed live browser/transport jobs were retained. No thresholds, assertions or application behavior were weakened.

## Production verification

After all required checks passed, master advanced from `7eb3631f1614c8c78352a13bcbcae84ba165a290` to the exact eTest candidate with an expected-head, non-force update.

[Production Verify 41288351673](https://github.com/smhe00/qwerty-learner/actions/runs/41288351673), job `124794196902`, passed the exact deployed marker, gateway identity/health/capability and four mobile entry routes. [Maker V4 read-only readiness 41288351642](https://github.com/smhe00/qwerty-learner/actions/runs/41288351642) also passed.

Manual anonymous browser verification at https://q.smhe.cn/learn confirmed the footer `fba0d8d`, ability's repair sentence without the incompatible riding picture, and able's swimming picture with its swimming daily sentence. Expanding 考纲例句（1）still displays the original reference-book sentence and Chinese translation. No real user account was used. The browser tab was closed after evidence capture.

Evidence: `interactive/evidence/production-study-content-fba0d8d-1793521375181.jpg`.

## Existing legacy CI failure

The post-production [legacy Browser Sync Gate 41288548913](https://github.com/smhe00/qwerty-learner/actions/runs/41288548913) failed because unchanged `cloud-sync-live.spec.ts` waits for the retired `learning-state-backup-v3` capability. Its legacy cleanup also fails. The helper times out before registration, so this attempt did not create an account. The same unchanged files already failed on previous master in [41019627610](https://github.com/smhe00/qwerty-learner/actions/runs/41019627610), as well as older runs 40903886744 and 40516106399. This is separate from the successful required current V4 release gates; do not describe all CI as green.

Follow-up: `interactive/tasks/LEGACY-V3-BROWSER-GATE-20261101.md`. No runtime change or gate weakening was made to accommodate this obsolete fixture.

This release verifies the reviewed first batch only. Chromium results do not constitute physical iOS or HarmonyOS certification. Machine-readable evidence is in `STUDY-CONTENT-RELEASE-20261101-acceptance.json`.
