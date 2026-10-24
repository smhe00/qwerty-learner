# Login/startup latency

Status: IN_PROGRESS. Base b780a160c3bd1e4dc92096033f44589ef32c65ef.

Confirmed from source: account UI runs S2, explicit M3 (up to two cycles), then M4 (which publishes M3 again). After navigation guarded bootstrap repeats S2 and M4. M4 downloads and projects all witnessed history, then captures/audits a complete V4 before discovering every remote attempt is already local. Thus unchanged login performs duplicate network/history work. This is a reproducible code-path defect, not a measured attribution of the user's particular delay.

Plan: authenticate/switch under the existing S1 transaction and navigate to the sole guarded startup synchronization; retain V4-before-M4 order. Add a no-write M4 shortcut only when independently canonicalized raw local immutable events exactly match the fresh authenticated server witness digest/count; otherwise preserve full batch/identity verification and merge. No cached success/identity handoff, no detached asynchronous writes.


## Implemented and local evidence

Account UI now performs only authentication and the existing isolated S1 transition, then navigates. The destination guarded bootstrap performs the sole S2 -> M3/M4 pipeline before app hydration. M4 publishes once when idle/drained, allows one extra confirmed non-empty cycle for backlog, and never retries an ambiguous/blocked outcome.

M4 accepts an unchanged result only after a fresh authenticated verify-set response, raw local event validation, exact canonical SHA256/count equality and owner/token/generation rechecks. It neither restores nor uploads on that shortcut. Unequal sets still follow original independent batch/chain/account/digest/UUID checks; actual adoption still requires original full-V4 source audit, candidate scratch audit, durable undo journal and exact readback. Local supersets still download/verify the remote chain before avoiding needless replay. Server contract inspected in cloud-functions/_shared/core.js verifyWitnessedChainSet: authenticates, verifies every receipt and conflicting immutable event before hashing the canonical set.

Added private-diagnostic stage timings for publication, observation, witness, capture, candidate, materialization and transaction. No raw identity/credential/row content added. Main behavior fix is elimination of work, not progress wording or reduced timeout.

Focused unit suites35/35 PASS (login-to-boot pipeline9, real M4 adapter5, witnessed receiver12, unchanged candidate safety9). Existing S2 startup/auth admission13/13 PASS. Long-history test proves64 batches -> zero client batch downloads and zero FSRS projection on exact fresh digest; changed content/same UUID, revoked ownership, false digest, invalid rows and remote additions retain strict handling. Local Chromium revoked reauthentication1/1 PASS with exact original learning rows preserved. Production build PASS; touched-file ESLint0 errors/12 warnings. Full repository tsc is not clean:147 diagnostics; compiler-host comparison against this task's base proves147 before/147 after, zero introduced.

The existing deployed historical full-V4 scenario is extended, reusing its disposable staging account: failed single startup metadata call must not duplicate/retry; next explicit entry must restore six tables exactly. After actual mixed legacy M3/M4 convergence, ordinary logout/login must show one V4 check, one publication, one witness verification, zero event GETs and zero additional M4 capture. Elapsed time and safe stage durations are retained in redacted proof. No new redundant full suite or production accounts.
