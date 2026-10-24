# Login/startup latency

Status: DONE (targeted repair and authorized deployment complete; independent CI exceptions retained). Base b780a160c3bd1e4dc92096033f44589ef32c65ef.

Confirmed from source: account UI runs S2, explicit M3 (up to two cycles), then M4 (which publishes M3 again). After navigation guarded bootstrap repeats S2 and M4. M4 downloads and projects all witnessed history, then captures/audits a complete V4 before discovering every remote attempt is already local. Thus unchanged login performs duplicate network/history work. This is a reproducible code-path defect, not a measured attribution of the user's particular delay.

Plan: authenticate/switch under the existing S1 transaction and navigate to the sole guarded startup synchronization; retain V4-before-M4 order. Add a no-write M4 shortcut only when independently canonicalized raw local immutable events exactly match the fresh authenticated server witness digest/count; otherwise preserve full batch/identity verification and merge. No cached success/identity handoff, no detached asynchronous writes.


## Implemented and local evidence

Account UI now performs only authentication and the existing isolated S1 transition, then navigates. The destination guarded bootstrap performs the sole S2 -> M3/M4 pipeline before app hydration. M4 publishes once when idle/drained, allows one extra confirmed non-empty cycle for backlog, and never retries an ambiguous/blocked outcome.

M4 accepts an unchanged result only after a fresh authenticated verify-set response, raw local event validation, exact canonical SHA256/count equality and owner/token/generation rechecks. It neither restores nor uploads on that shortcut. Unequal sets still follow original independent batch/chain/account/digest/UUID checks; actual adoption still requires original full-V4 source audit, candidate scratch audit, durable undo journal and exact readback. Local supersets still download/verify the remote chain before avoiding needless replay. Server contract inspected in cloud-functions/_shared/core.js verifyWitnessedChainSet: authenticates, verifies every receipt and conflicting immutable event before hashing the canonical set.

Added private-diagnostic stage timings for publication, observation, witness, capture, candidate, materialization and transaction. No raw identity/credential/row content added. Main behavior fix is elimination of work, not progress wording or reduced timeout.

Focused unit suites35/35 PASS (login-to-boot pipeline9, real M4 adapter5, witnessed receiver12, unchanged candidate safety9). Existing S2 startup/auth admission13/13 PASS. Long-history test proves64 batches -> zero client batch downloads and zero FSRS projection on exact fresh digest; changed content/same UUID, revoked ownership, false digest, invalid rows and remote additions retain strict handling. Local Chromium revoked reauthentication1/1 PASS with exact original learning rows preserved. Production build PASS; touched-file ESLint0 errors/12 warnings. Full repository tsc is not clean:147 diagnostics; compiler-host comparison against this task's base proves147 before/147 after, zero introduced.

The existing deployed historical full-V4 scenario is extended, reusing its disposable staging account: failed single startup metadata call must not duplicate/retry; next explicit entry must restore six tables exactly. After actual mixed legacy M3/M4 convergence, ordinary logout/login must show one V4 check, one publication, one witness verification, zero event GETs and zero additional M4 capture. Elapsed time and safe stage durations are retained in redacted proof. No new redundant full suite or production accounts.


## Exact-SHA staging and authorized release

Application fix cfeaef6a1769bbaf94c9ed8ccd147727a058ad2f was pushed to product/main before edgeone-test. Same-SHA published Pages40094190292 PASS; Cloud Sync contract/lint/build40094190383 PASS; Branch Cloud40094214988 browser4/4 PASS and real Blob/V4 transport PASS (both transport test accounts deleted); three-device offline relay40094215013 PASS. Release-readiness job120874164606 confirms that exact SHA, Pages and three-device checks. Safe V4 writeback40094215023 PASS.

Targeted real historical acceptance40094215012 attempt2/job120874282621 PASS on cfeaef6. Six tables,700 review histories and1472401 UTF-8 history bytes; full download, divergent six-table reconciliation, immutable rollback archives, independent session references, shared aliases and Unicode all preserved. Mixed legacy M3 publication and genuine M4 adoption passed. Final unchanged logout/login retained every original row, produced no compatibility warning, and completed in7737ms including account-entry navigation/authentication. The learning document's guarded bootstrap took3667.3ms: S21468.7ms, M3publication11ms, receipt observation997.3ms, witness1018.2ms. Exactly one full-V4 check, one M3 cycle, one witness, zero event batch GETs, zero additional M4 V4 captures. Existing independent roundtrip fallback was used for historical alias representation and passed; no lossless check was disabled. Diagnostic export remained read-only. This attempt's disposable account cleanup200/accountDeleted=true. Full redacted proof is adjacent to this report. These are staging measurements, not a claim of measuring the user's original production incident or a universal latency guarantee.

Retained failures: historical attempt1 stopped on authentication HTTP500 before the fork's next sync; cleanup returned500, so that synthetic account is NOT claimed deleted. Independent M3 relay40094214983 likewise failed POST /api/auth/login with internal_error; cleanup is unverified. Only the failed historical job was rerun, on the identical SHA and a new disposable attempt identity; no writes on existing users or ambiguous operation replay. P4b CI40094190315 passed48/49 but its pre-existing lost-commit-ack case again had a post-mount fingerprint mismatch (same case recorded on prior release); S2 executor/recovery algorithms were unchanged by this patch. The result remains a failure, not described as a passing suite. No repeat of the full local recovery or production account-writing suites. Old-alias Published Dual-Site Explorer is not used as canonical q.smhe.cn qualification.

After all required same-SHA staging gates and the targeted history check passed, master was advanced from5307642581b30d7d30850410a0e2cbb344cbc50c to cfeaef6a1769bbaf94c9ed8ccd147727a058ad2f under the owner's explicit release authorization. Canonical production read-only verification40094993096/job120875253956 PASS; q.smhe.cn marker cfeaef6 and gateway health verified. Independent local read-only marker request also returned200/cfeaef6. No production customer records accessed, changed, cleared or migrated; no production regression accounts.


## Final source locations

- src/sync/workspace-account-ui.ts:128 authenticates/transitions then navigates; removes duplicate pre-navigation S2/M3/M4.
- src/sync/workspace-bootstrap.ts:226 is the guarded single pre-mount S2 entry; event adoption follows at247. Recovery journals still run first.
- src/sync/m3-witnessed-receiver.ts:122 validates raw local history;133 compares fresh authenticated server digest/count;223 retains complete remote chain verification for unequal sets.
- src/sync/m4-witnessed-prefix-browser.ts:124 bounds publication without replaying uncertainty;150 performs the witnessed comparison;174 retains full-V4 capture for actual adoption. Downstream candidate materialization/journal/readback remain mandatory.

Final documentation-only commit on main does not require a second etest/master application deployment; application release remains cfeaef6. Production three-device and multi-client regressions remain manual. No new production account-writing test ran.
