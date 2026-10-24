# Unicode chunk import repair and remaining account incident

Status: PARTIAL for the real-account incident; the Unicode repair is merged, qualified on etest and published. New screenshot on the deployed version still reports a generic complete-V4 sync failure. Do not claim that the user's complete sync is fixed.

## Release and scope

- Base: 51d2124360b620d6d84742b5359d6991f1f60567.
- Application fix: 5a6ff05c75f67b3fbe4e27aa4c8b4ec94dfbb2c2. Final test refinement: f0301824ce8c9f00b11381c84d1a02ba150f4033.
- [PR #36](https://github.com/smhe00/qwerty-learner/pull/36) merged product/main at 9a254569cffe0af6bcf3f5e7732fc80a175289b0.
- Promotion order: product/main, identical edgeone-test, qualified staging, then identical master under explicit owner authorization. All three refs rechecked equal 9a254569.
- Public production version/health run 40063249178, job 120781061590 passed. Source marker and user's screenshot footer both show 9a25456.
- No existing user backup, cloud account contents or browser learning database was accessed or manually modified. All functional validation used synthetic profiles and disposable accounts.

## Confirmed defect and repair

The original screenshot reported: Backup V4 independent roundtrip value mismatch: reviewRecords fields words.element.trans.element. Isolated Chromium reproduced this exact error: dexie-export-import 4.0.7 decodes independent byte slices as UTF-8, corrupting a character crossing the default 1 MiB boundary. Original source rows remained unchanged. The actual user's dataset has not been inspected.

src/utils/db/dexie-import-blob.ts converts non-ASCII UTF-16 code units to equivalent JSON Unicode escapes for local Dexie import only. All five import entry points use it: independent audit, M4 candidate, durable restore, automatic merge scratch copies and legacy backup import/metadata peeking. Typeson revival, bounded parsing, shared references, negative-zero refusal, source/readback comparisons, account/session guards and durable recovery remain intact. No cloud payload bytes, fingerprints, formats, dependencies, backend or stored text normalization changed.

The temporary local representation grows (Chinese typically 2x and supplementary characters 3x in bytes). Archive/upload bytes do not grow.

## Validation

- Before fix: synthetic >1 MiB regression reproduced the reported reviewRecords field mismatch.
- Local full workspace Chromium: 122/122 passed (5.2 minutes). Final fixture refinement targeted Unicode tests: 3/3 passed (27 seconds), exercising all five import paths and large M4 candidates/restores.
- Code-unit coverage: all 65,536 UTF-16 units, escaped property names, supplementary/lone surrogates, Typeson metadata and literal replacement characters. Existing cloud contracts 583/583 plus 2 new tests; exact main Cloud CI 585/585.
- TypeScript baseline/current 144/144, no introduced errors. Lint 0 errors and 133 existing warnings. Build passed (25.79 seconds).
- Same-SHA main Pages/published browser 40061921676 passed; S1 40061921714 passed 122/122; Cloud 40061921684 passed; Review 40061921690 passed; Architecture, Achievement, Learn Journey and admission gates passed. PR performance/Learn Block checks passed.
- Recovery 40061921675 attempt1 failed 1/48: synthetic trace showed only learnRuntime.dailySessions.cet4 added after mount; all six DB tables and settings unchanged. Same case passed in S1 and local 6/6 repeats. Unchanged attempt2 passed 48/48. No assertions weakened.
- Anonymous dual-site Explorer 40061921691 passed 11/12; an old production 51d2124 mobile-shell visibility assertion timed out at 5 seconds. This unrelated observation is retained, not counted as passed or attributed to the candidate Unicode fix.

## Qualified etest evidence

All results below are for 9a254569. Detailed run/job IDs are in the adjacent proof JSON.

- Historical V4 40062660188 attempt2: 1,472,401-byte Unicode history, 700 reviews. Existing-session ordinary startup downloaded the complete V4; six tables exact; Chinese/accents/emoji and shared reference preserved; both forks and original archives retained; six-table convergence; repeated startup did not upload again. Cleanup 200 and deletion verified.
- History attempt1 failed: direct POST was observed, later metadata revision remained 0; HTTP response was not retained, so root cause is UNKNOWN. Source tables were unchanged; cleanup 200 verified. Attempt2 used a NEW attempt-specific disposable account, never replayed that original ambiguous write.
- Three-device 40062660191: single-session reauthentication plus three offline forks passed; cleanup 200.
- Branch Cloud 40062660200: 4 browser tests, binary/large multipart transport and release-ready passed; two browser and two transport accounts deleted. The readiness script's releaseAuthorized:false marker means it requires separate human authority; the owner explicitly supplied that authority in this task.
- M3 40062660225 and safe V4 writeback 40062660274 passed with cleanup guards. M3 event proof alone is not full V4 proof; the historical test above proves full history convergence.

## Production completion and cancellation limitation

Master was promoted only after staging succeeded. Read-only version/health confirmation passed. The push also auto-triggered production three-device run 40063249142. The initial bounded cancellation attempt was rejected by automatic approval review because older approval named different run IDs; that rejected command did not execute. The owner then explicitly authorized this run, conditional on the test/account-creation step not having started. A subsequent live recheck showed the test already running, so that condition no longer held. No cancellation is claimed; completion and cleanup were preserved. Job 120781061605 finished successfully (1 passed, 3.7 minutes), with E2E_ACCOUNT_CLEANUP status 200. No additional production functional workflow was manually dispatched.

## New screenshot: unresolved real-account failure

The footer is 9a25456 and the message is now the generic cloud complete V4 check/transfer failure. src/sync/account-login-v4-check.ts:59-66 catches all thrown exceptions, distinguishing only two local-audit message prefixes; it does not retain the actual error. This screenshot is therefore neither proof of a network failure nor proof that full history downloaded or merged.

src/sync/v2-browser-executor.ts checks account/session/ownership before the executor. src/sync/v2-manual-executor.ts captures local data concurrently with metadata and baseline; automatic-merge branches can then fail during download, verification, scratch decoding/merge, archive, one CAS write or journal staging. A failed check can be followed by separate M3/M4 event work. Do not equate event fusion with complete V4 convergence, infer all data is unchanged from a toast alone, or bypass the lossless guard.

Next evidence: ask whether the local full-backup export now succeeds; no user backup upload is needed. Read only fixed-field records from the existing tab's qwerty.perf-diagnostics.v1, preferably without navigation/retry. These contain stage names/timings/sizes and bounded transport failure classifications, not tokens or learning contents. timePerfStage currently records completion in finally, so a timing entry alone does NOT prove that stage succeeded. Automatic merge has incomplete stage coverage; missing transport samples do not prove no network request occurred. If this evidence cannot isolate the exception, add narrowly scoped sanitized stage/error diagnostics in a separate reviewed change, retaining all guards and the main -> etest -> master release sequence.

Report-only branch: codex/v4-utf8-report-20261024. Preserve existing user browser data and avoid repeated sync, forced overwrite, logout or clear-data operations during diagnosis.

## Follow-up: local backup succeeds, startup preflight reached

The owner confirmed full local backup export now succeeds. The supplied existing-tab performance record contains two post-release attempts that both reach fingerprint-decision after local snapshot capture and remote-meta. In v2-manual-executor.ts:101-117, this stage follows resolution of Promise.all for capture, baseline and metadata, plus local envelope/owner validation. Thus the local audited capture and metadata request completed; this is not a no-network-request case and not the former local audit blocker.

The fingerprint-decision timer itself uses finally and does not prove decision success. No normal download-request, binary-cloud-migration, payload-prepare/gzip or upload samples follow. The automatic conflict path at v2-manual-executor.ts:119-167 lacks download/verification/build/archive timing and remains a possible location, not an established root cause. The later bootstrap completion also includes separate M3/M4 processing, so its several-second gap cannot be attributed to a specific S2 operation. No completed full V4 download/merge is established.

Requested only existing Resource Timing entries filtered to S2 API path, HTTP status and elapsed time, without reloading or reissuing a request. No request headers, query parameters, auth, backup contents or actual learning rows are requested. HTTP responseStatus 0 would be unavailable/opaque evidence, not proof of server HTTP 0. Await this bounded evidence before changing arbitration or making any claim about backend failure. Raw user timestamps/logs are intentionally not copied into the public report.
