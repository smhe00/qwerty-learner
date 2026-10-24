# Mobile menu release checkpoint

Status: IN_PROGRESS; no staging/master promotion by this release executor yet. Owner explicitly requested 发布. Intake main c590c93a, implementation PR #40 passed 12 scoped checks on 2cf88073.

## Retained failures and corrections

1. c590 Pages 40111804862: 4/5, obsolete disabled-achievement expectation. cdecf4ed tests actual five-entry mobile navigation, 34 locked cards/five hidden IDs, Focus default, real Learn and zero cloud requests. Published Pages 40114954939 PASS. No runtime source change.
2. c590 Review 40111804905: 115/118, stale five-metric count and two retired extra-round copy assertions. fac22b1f verifies all six actual metric labels and the retained-consolidation wording, keeping queue, refresh, exact five words and data assertions.
3. c590 Mobile 40111804897: old direct-overview menu expectation. fac22b1f follows data page -> Manage Account, models both account/data links under target=_blank, retains same realm, single tab, auth replace-history and native/fallback exclusion. FULL Mobile P0 40116103531/job120937586434 PASS on fac22b1f. Subsequent commits do not change app/mobile test sources.
4. c590 S1 40111804875: 126/128. Account continuity had the same menu-path issue; corrected without relaxing exact rows/owner/generation/pending evidence. Lost-ack fingerprint test also failed and was reproduced on fac22b1f in 40116103540 repeat2. Its unchanged assertion/trace was retained.

## Lost-ack trace diagnosis (synthetic profiles only)

The failing trace compares pre/post recovery full V4 data. Six tables, settings and navigation are EXACTLY equal. The only difference is addition of learnRuntime.dailySessions.cet4. The fixture deliberately has an unfinished ReviewRecord but no DailySession; src/pages/Typing/index.tsx migrates that active block asynchronously on actual Learn mount. A visible synchronization toast precedes that independent daily-plan write, so the old test raced legitimate app initialization against its full fingerprint readback.

Commit 984c4b7f first mounts the actual Learn page and awaits the product's real DailySession anchor BEFORE injecting response loss. It additionally requires all six source tables unchanged, baseline absent and cloud writes zero before failure injection. Original lost-ack count, baseline, full fingerprint and subsequent no-write assertions remain; full anchored workspace equality is additionally checked after failure and recovery. No production behavior, serialization or merge code changed. The required 3x repeat (retries=0) and full S1 are still pending; do not claim acceptance until they pass.

c590 optional dual-site Explorer 40111804828: 11/12 PASS, existing production alias qwerty-plus.edgeone.dev mobile shell was incorrectly expected to be the retired explanation page. That is not same-SHA new production certification; canonical q.smhe.cn must be verified separately. No result relabeled.

## Release sequence

Same-SHA Pages and Cloud/staging admission -> exact eTest frontend + browser/Blob + hard three-device + release-ready -> identical master -> canonical HTTPS read-only source/health and four mobile route-entry probes. Add the S2 browser fixture to Cloud trigger coverage so final test-only releases also have a corresponding Cloud status. Required checks are not skipped. Browser behavior comes from published Pages and mobile suites; production route probes certify entry availability, not physical phone behavior.

No customer account/data access. Local shell Git and web site access unavailable; native GitHub performs guarded writes and CI executes validation and deployment probes. Real test accounts, when created by existing staging suites, are disposable and require confirmed cleanup. Final release evidence will be appended after outcomes are known.
