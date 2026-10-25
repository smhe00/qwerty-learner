---
task_id: IDLE-ACCOUNT-CLEANUP-20261024
status: REVIEW
executor: Codex (single executor)
target_branch: product/main
claim_base_commit: 5cd49872e6f2a6389c0de6eebdf03725c9a7e115
release_to_master: false
---

# Idle cleanup and existing SMHE administrator

## Outcome

Development implementation complete; not deployed or enabled against real accounts. Circle frontend remains paused. Owner approved the final activity-triggered approach: no external scheduler, independent request after login/mount, daily gate, bounded runtime, resumable work rather than a requirement to finish everything in one invocation. Continuous 180-day inactivity; no 30-day grace/notice stage. Browser learning data is untouched.

## Implementation

- `cloud-functions/_shared/idle-accounts.js`: conservative enable-date grace for legacy identities, monotonic UTC daily activity keys, administrator exemptions, target preview, storage metadata, 24h request drain, separate deletion marker, exact-prefix deletion, identity-last finalization, per-operation soft deadline checks, durable daily cursor/gate, privacy-safe counters and explicit Circle holds.
- `cloud-functions/_shared/administrator.js` + core auth hooks: existing SMHE pinned by immutable ID and normalized name; password verified from nonempty runtime ADMIN_PASSWORD, otherwise the owner-approved fixed bootstrap default. Neither effective credential is written as a new Blob password/verifier. Signed random admin session tokens are invalidated by environment-password rotation. Database-password fallback, in-app password change and admin account deletion are denied. Ordinary account auth and single-active-session policy retained.
- Existing `/api` gateway: administrator-only access/usage/preview/manual execution; ordinary authenticated users can only signal the fixed daily maintenance policy, with no target/cursor override. Default destructive switch is off; no scheduler secret or cron.
- `src/sync/idle-maintenance-trigger.ts`, `api.ts`, `src/index.tsx`: only activate after guarded mount, trigger a separate request after a short delay, coalesce local attempts, contain network/maintenance errors and retry only after later activity. Background maintenance 401 cannot emit the foreground session-revoked event. No login/startup/sync caller awaits cleanup.
- `AdministratorPanel.tsx`, account dialog and registration UI: role discovery, preview/confirm execution, quota metadata with explicit unknown size, 180-day policy without a grace-period claim. Account dialog remains in-document and scrollable.
- `.env.example` and `docs/operations/IDLE_ACCOUNT_CLEANUP.md`: configuration, operator workflow, bounded-runtime behavior and explicit consistency/deployment limitations. Test harnesses use fake accounts/Blob/mocked HTTP only.

## Validation actually executed

1. Backend qualification batch: `node --test tests/cloud/idle-accounts.test.mjs tests/cloud/idle-maintenance-trigger.test.mjs tests/cloud/backend-core.test.mjs tests/cloud/edgeone-blob-storage.test.mjs tests/cloud/s2-write-route.test.mjs tests/cloud/multi-session-auth.test.mjs tests/cloud/sync-v4-server.test.mjs tests/cloud/circle-open-gateway.test.mjs` — 70/70 PASS. Covers standard auth/session/Blob/V4 contracts, admin environment password and rotation, exact namespace isolation, daily gating, activity deadlines, mid-account runtime interruption and durable continuation, late/overwritten fence resilience, and nonblocking trigger behavior.
2. Final targeted engine suite after adding late Circle-hold reopening: `node --test tests/cloud/idle-accounts.test.mjs` — 21/21 PASS. Earlier 70-test batch preceded this narrowly scoped correction; unchanged broad suites were not needlessly rerun.
3. Entry/account regression: `node --test tests/cloud/default-dictionary-registration.test.mjs tests/cloud/login-event-warning.test.mjs` — 14/14 PASS. First attempt found the existing account-UI API mock missing the new policy export; updated the mock with disabled policy, retaining every existing assertion, then passed.
4. Browser: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node_modules/.bin/playwright test --config tests/e2e/idle-cleanup.config.ts` — 3/3 PASS. Real Chromium: existing account-dialog/responsive document/writer-lease/learning-row continuity; delayed maintenance then a simulated session-revoked 401 does not interrupt learning or clear auth; normal account lacks admin controls; admin previews, cancellation causes zero writes, confirmed cleanup sends one request, local sentinel unchanged.
5. Scoped ESLint on changed backend/frontend/cloud tests — zero errors, four pre-existing warnings (three non-null assertions in index.tsx, one existing import-type annotation in api.ts). Final engine/test lint and diff whitespace check PASS.
6. Production Vite build PASS; `node scripts/emit-edgeone-spa-entries.mjs` PASS. Existing bundle-size warnings remain. No Maker deployment/build was triggered.
7. `tsc --noEmit` remains FAIL with 147 existing diagnostic lines. Compared against the exact execution base exported into /tmp, using identical dependencies/config: all diagnostics match after normalizing path prefixes and shifted line numbers. No new TypeScript diagnostics; no tsconfig or baseline assertion was weakened.

The first browser launcher attempts failed on test-server cwd and then TS config import.meta/CJS mismatch; fixed launcher cwd and used standard Chrome configuration with a local executable override. Final real browser run passed. These failures did not touch live services.

## Remaining limits / rollout prerequisites

- Configure existing SMHE ADMIN_USER_ID and private ADMIN_PASSWORD in server runtime, fixed IDLE_POLICY_START_AT, then independently qualify the deployed etest code against disposable accounts/real Blob. Only after qualified release consider enabling IDLE_CLEANUP_EXECUTE=true. No real binding/configuration/deletion performed here; never put the password in chat or a frontend variable.
- Blob lacks atomic multi-object transactions and a reliable distributed lock. Daily claiming is best effort, not a mathematical exactly-once guarantee across POPs. Idempotent fences and identity checks protect repeat work; fake-store overlap tests are not proof of global physical erasure. Real interruption/listing-convergence qualification remains before production enablement.
- Accounts already holding Circle data are skipped pending independently audited social cleanup. A late hold during the drain reopens access before destructive work. Existing social deletion protection was not bypassed.
- 24h technical draining and conservative day rounding can retain data beyond exactly 180*24 hours. Username reuse has a 24h post-completion cooldown; minimal ID/hash tombstones remain, with no learning payload, username or credentials.
- Slow provider calls can exceed the soft 35s budget. Worker completion depends on future valid cloud activity; no traffic means no worker. Separate execution still consumes shared resources; zero contention is not claimed. An expired account already in cleanup can receive a maintenance error; unrelated users never wait for the cleanup request.
- Historical ordinary SMHE credential records are ignored, not migrated/erased in this task. The effective administrator password is never persisted in Blob; the fixed bootstrap default is intentionally in source under the owner’s later explicit instruction. Removing ADMIN_USER_ID is an auth-mode rollback, not the supported password-change route.

## Git / handoff

Execution base and final pre-commit origin/product/main are both 5cd49872e6f2a6389c0de6eebdf03725c9a7e115. No upstream divergence observed. Implementation commit is 3f0ce54e01bbe434881baece656b0e786457c822. Publication checkpoint and the owner’s default-password amendment are recorded below. No master/edgeone-test changes, real accounts, cloud cleanup or release authorization used.


## Owner amendment and final qualification

The owner explicitly requested a fixed bootstrap default when ADMIN_PASSWORD is absent/empty. This overrides the earlier missing-password fail-closed design. Implemented in `administrator.js`: a configured nonempty value disables the default completely; malformed nonempty values still fail closed. Missing ADMIN_USER_ID does NOT grant privileges or auto-create SMHE. Existing fixed-ID binding, cleanup protection and environment-rotation invalidation remain unchanged. The source-defined default is an explicitly authorized bootstrap credential, not an accidentally committed configured production secret. Runtime password values were never read or printed.

`node --test tests/cloud/idle-accounts.test.mjs` after this amendment: 22/22 PASS; scoped administrator/test ESLint and whitespace checks PASS. Tests prove omitted and empty values use the default, configured values reject it, environment changes invalidate old default-signed sessions, database passwords do not become fallback credentials, malformed configuration fails closed, and no effective password is stored in the fake Blob. Only the changed backend module/tests were rechecked; frontend build/browser behavior was unchanged.

New-site account creation is NOT automatic. Documented the ordering: owner registers ordinary SMHE while ADMIN_USER_ID is unset, obtains its real immutable ID, then binds that ID and applies administrator password configuration. An existing site binds the existing SMHE account. No real administrator was initialized or cloud configuration changed during development.

Final pre-publication origin/product/main remains 5cd49872e6f2a6389c0de6eebdf03725c9a7e115; no divergence. Development publication only; release_to_master remains false.
