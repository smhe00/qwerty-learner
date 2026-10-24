# Mobile menu release — completed

Status: DONE. Owner explicitly requested 发布 after mobile-menu PR #40. Published and verified release **ea4ede5380dfdc899a94371a5bc5289cb036004e**. Canonical production verification completed **2026-10-24T18:02:00Z** (2026-10-25 in East Asia).

Intake main c590c93a; PR #40 had 12 scoped checks on 2cf88073. Application/runtime source is unchanged throughout this release-preparation sequence; only tests, workflows and task/report documentation were corrected. No customer learning records, credentials or production test accounts were accessed or changed.

## Released functionality

- Mobile home has five real menu entries, no achievement/history placeholders. Achievements use /mobile/achievements, retain the mobile back action through rotation and keep locked cards non-interactive.
- /mobile/history reads the active workspace only: date/dictionary filters, attempt versus unique-word/review counts, recorded input time and daily word details. Browsing does not change six-table records, dictionary selection or the learning checkpoint.
- /mobile/data provides account management, read-only cloud metadata, existing guarded synchronization/download/recovery entry points and local full-backup export/file inspection. Import remains explicit replacement through the independent confirmation/transaction document, not a direct mobile-page restore.
- Exposure phonetics follow the saved UK/US voice and label missing-accent fallback. Hidden recall/spelling probes gain no answer hints.
- Physical route entry files exist for the new mobile URLs. This release does not change FSRS, schemas, ownership, authentication, writer locks or cloud merge algorithms.

## Passed evidence

1. Mobile implementation source acceptance: 12/12 targeted checks, scoped TypeScript/lint/build PASS on2cf88073, run40111528629. Existing unrelated whole-project TypeScript diagnostics remain outside the scoped check.
2. Full Mobile P0: run40116103531/job120937586434 PASS onfac22b1f. Full Review: run40116103536/job120937586327 PASS onfac22b1f. Subsequent release commits do not change the application/mobile/review surfaces they exercised.
3. Strict S1: run40116847064/job120939775173 PASS on984c4b7f, including3/3 lost-ack repetitions with retries=0 followed by128/128 complete workspace browser tests. Final ea4ede53 changes only workflow/report files relative to984c4b7f.
4. Exact release ea4ede53 Pages deployment and public browser regression: run40117142954 PASS. Cloud Sync Gate and exact-SHA Pages/staging admission: run40117142929, jobs120940655280 and120940938878 PASS.
5. After that admission, edgeone-test was fast-forwarded frome2a661ee9091beb269808ddddd116575e6d14d79 toea4ede53 with expected-old-SHA and force=false. Real staging /source-commit.txt confirmed ea4ede5 before disposable test-account creation.
6. Exact release staging Cloud browser and V4 Blob transport: run40117451472 attempt2 PASS. Browser job120943220057, transport120943218945, release-ready120943975307. Readiness explicitly recorded sameCommit=ea4ede5380dfdc899a94371a5bc5289cb036004e, passedPagesRun40117142954 and hardThreeDeviceE2ERun40117451532 success. The script does not authorize deployment itself; the user's explicit 发布 instruction provided that authorization.
7. Exact release hard three-device offline/re-auth automatic convergence: run40117451532/job120941601384 PASS. M3 relay40117451547/job120941601523 PASS; safe V4 writeback40117451639/job120941601915 PASS.
8. Historical full-V4 proof: run40117451522 attempt2/job120943773723 PASS. Downloaded redacted artifact12569513271 independently confirms700 review histories/1,472,401 Unicode bytes, exact six-table full download, aliases/Unicode preserved, divergent union5 WordRecords, original fork archives, independent completed sessions and UUID references, mixed legacy M3/M4 convergence, unchanged legacy rows, empty anonymous workspace restored on logout and no duplicate writes after repeat startup. This attempt's cleanup200/accountDeleted verification PASS. Unchanged-login measurement9061ms is an eTest measurement, not a promise for user devices.

Evidence URLs:
- https://github.com/smhe00/qwerty-learner/actions/runs/40111528629
- https://github.com/smhe00/qwerty-learner/actions/runs/40116103531
- https://github.com/smhe00/qwerty-learner/actions/runs/40116103536
- https://github.com/smhe00/qwerty-learner/actions/runs/40116847064
- https://github.com/smhe00/qwerty-learner/actions/runs/40117142954
- https://github.com/smhe00/qwerty-learner/actions/runs/40117142929
- https://github.com/smhe00/qwerty-learner/actions/runs/40117451472
- https://github.com/smhe00/qwerty-learner/actions/runs/40117451532
- https://github.com/smhe00/qwerty-learner/actions/runs/40117451522

## Actual master release and production verification

After all the evidence above, re-read main/eTest/master heads and used a non-force expected-old-SHA update of master:

1d1237a5e628edf94319d109a076ee33dbe94943 -> ea4ede5380dfdc899a94371a5bc5289cb036004e.

Production run **40118590795/job120945032430 PASS**, completed at2026-10-24T18:02:00Z. This was an actual anonymous read-only deployment probe, not an assumption from the branch pointer. It initially observed old1d1237a, then verified:

- Canonical HTTPS https://q.smhe.cn source marker **ea4ede5**, matching the complete expected release SHA.
- /api/health HTTP200, service qwerty-sync-gateway, apiVersion1 and required Blob capability.
- **/mobile, /mobile/history, /mobile/data, /mobile/achievements** each HTTP200, same HTTPS host/path and HTML application root. No redirects to an unrelated page.

https://github.com/smhe00/qwerty-learner/actions/runs/40118590795

These production probes certify deployed source/gateway/route-entry availability. Interactive behavior is covered by published Pages and mobile browser tests; this is not a new physical Huawei/iOS certification. Production verification used no login, database/profile mutation or learning record.

This final checkpoint only updates documentation on main. Master and eTest remain the identical validated ea4ede53 release. No history was rewritten, no branch was force-pushed.

## Retained failures and corrections

- c590 Pages40111804862:4/5, obsolete disabled-achievement expectation. cdecf4ed tests actual five-entry navigation,34 locked cards/five hidden IDs, Focus default, actual Learn and zero cloud calls. cdec Pages40114954939 PASS, followed by final exact-SHA Pages PASS. No runtime source change.
- c590 Review40111804905:115/118, stale five-metric count and two retired extra-round copy assertions. fac22b1f checks all six actual metric labels and retained-consolidation wording, while preserving queue, refresh, exact five-word and data assertions.
- c590 Mobile40111804897: old immediate-overview menu expectation. fac22b1f follows data page -> Manage Account, models account/data links under target=_blank and preserves same realm, one tab, auth replace-history and native/fallback exclusive ownership. Complete Mobile suite subsequently passed.
- c590 S1 40111804875:126/128. Account continuity had the same obsolete route. Corrected without relaxing exact rows/owner/generation/pending checks. Lost-ack full fingerprint failure was independently reproduced onfac22b1f in40116103540 repeat2; the assertion and trace were retained.
- c590 optional dual-site Explorer40111804828:11/12; existing production alias qwerty-plus.edgeone.dev was incorrectly expected to show a retired mobile explanation page. It was not relabeled as passed or used to certify this release. Canonical production source/health/mobile entries were verified separately as above.
- **Staging Cloud40117451472 attempt1/job120941601413:** second disposable registration returnedHTTP500/internal_error before transport assertions. Cleanup of the successfully registered first account passed. The second registration's final creation/cleanup status is **UNCONFIRMED** because its response failed before identity registration in the test cleanup list. Do not represent all attempt1 identities as erased. Failed-only attempt2 generated entirely new random identities and passed; it did not replay the ambiguous registration or cloud write.
- **History40117451522 attempt1/job120941601610:** full V4/Unicode/aliases download succeeded, but the next expected revision2 was observed as1. Test failed, and cleanup200 was confirmed. Same-source attempt2 used a new run-attempt-specific identity and passed all original assertions. The initial failure remains real; no root-cause claim or backend fix is inferred merely from the successful repeat.

These retained failures mean this is not a claim that every historical CI run is green or that intermittent backend failures have been eradicated. All required final release gates and the targeted failing-history follow-up passed without weakening their safety assertions.

## Lost-ack test diagnosis

Only synthetic profiles were inspected. Before/after trace data showed the six tables, settings and navigation EXACTLY equal; the sole difference was addition of learnRuntime.dailySessions.cet4. The old fixture had an unfinished ReviewRecord but no DailySession. src/pages/Typing/index.tsx legitimately anchors that block asynchronously on actual Learn mount; the synchronization toast could precede this independent local write.

984c4b7f first mounts the actual Learn page and waits for the real DailySession anchor BEFORE injecting response loss. It asserts unchanged six-table data, no baseline and zero cloud writes before injection. Original lost-ack record count, baseline absence, full recovered fingerprint and subsequent no-write assertions remain; equality of the full anchored workspace after failure and recovery is additionally required. The3-repeat and full128-test results above validate this correction. No production serialization, merge or recovery behavior was changed.

## Limits and handoff

Local shell Git/web access was unavailable; connected GitHub performed guarded writes and CI executed validation and actual site probes. No customer backups were used. Future master changes require their own explicit release authorization; this task's authorization is consumed by this publication. Remaining backend intermittent failures/unconfirmed failed-registration cleanup are recorded above rather than hidden. Physical-device validation remains distinct from Chromium mobile/touch emulation.
