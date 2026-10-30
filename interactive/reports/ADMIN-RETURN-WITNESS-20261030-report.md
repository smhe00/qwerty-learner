---
protocol_version: '1.1'
task_id: ADMIN-RETURN-WITNESS-20261030
status: REVIEW
executor: Codex-admin-console
claim_base_commit: f2892841fa3faa48b6d48d17c7ac34a5ef2b3ad9
target_branch: product/main
integration_base: d11b924bad165a212fc3d12c712b23ed4e0d61f8
candidate_commit: "Commit introducing this report; resolve with git log --diff-filter=A --format=%H -- interactive/reports/ADMIN-RETURN-WITNESS-20261030-report.md"
release_to_master: false
---
# Administrator return: preserve sealed learning workspaces

## Confirmed root cause

81dcdd8's admin entry removed `qwerty.cloudAuth.v1` after copying a legacy administrator credential into sessionStorage. That auth key is included in the S1 storage witness. The admin app deliberately does not own/install the ordinary writer guard, so the deletion invalidated the witness and left the old account registry active. Ordinary login correctly failed closed. Blindly resealing would also leave the active owner inconsistent. Existing admin tests lacked a real sealed S1 registry and never followed the return to ordinary login.

## Change

- Admin entry only copies credentials after server verification; it never deletes the learning-auth pointer.
- The authenticated admin header now offers a direct ordinary-login return. Its short-lived credential stays in a separate sessionStorage ticket while the guarded local return finishes; it is cleared and revocation requested afterward. The original explicit management logout still clears/revokes its session.
- The ordinary-return route opts into local-only S1 boot: existing leases, integrity, identity and pending-journal checks all remain, while startup S2/M3/M4 network activity is suppressed. For a sealed legacy admin owner, normal S1 logout saves that owner's complete snapshot and restores the previous anonymous space. Ordinary users' credentials and spaces are not reassigned.
- Existing damaged profiles have a targeted recovery: missing learning credential, V2 witness, initialized registry, exact server-authenticated administrator ID matching that registry, and no conflicting journals/foreign-clear flag. Both admin access and the actual /auth/me principal are freshly checked, not trusted from cached metadata.
- Recovery requires explicit consent, captures/audits all six tables plus settings/session/navigation through the existing V4 adapter, and atomically stages identical original/candidate snapshots with an independent rollback record using the existing manual-import journal. No auth restoration happens before that durable confirmation. Existing replay verifies the full restored fingerprint before sealing/finalization; normal S1 logout then archives the legacy space and restores anonymous data. This is not an unconditional witness reset.
- Interrupted credential writes resume the same durable backup after reload instead of creating another one. Generic/different-owner corruption and revoked or mismatched principals remain blocked. Read-only storage fingerprint comparisons detect changes during capture/staging.
- The temporary recovery screen releases its lease on page exit only when no mutation is in flight. Subsequent boot permits the normal bounded 3-second release wait; no lease is stolen. The existing pagehide-before-action guard is retained.
- Recovery uses a purpose-specific completion message and does not ask the ordinary user to upload admin history. Global CSS ownership, normal sync/merge algorithms, backend authorization and production refs are unchanged.

## Validation

| Check | Result |
| --- | --- |
| Production EdgeOne administrator matrix | 78 passed across six phone/tablet/desktop + light/dark profiles. Includes normal sealed roundtrip, populated legacy admin archive + unchanged anonymous fingerprint, already-deleted credential repair, consent gating, interruption/reload with exactly one rollback, actual-principal binding, revoked principal and unrelated-owner refusal, and zero startup learning API requests. |
| Final production return checks after retaining the pagehide guard | 16 passed on 320px light phone and 1440px dark PC. |
| Additional fallback-writer recovery | 2 passed on phone/PC with navigator.locks unavailable. The same fallback case is included in the expanded CI matrix. |
| Production Pages | 12 passed, 72 cloud-only cases skipped; zero API requests and ordinary credentials unchanged. Executed from a clean generated artifact. |
| S1/login/V4 identity/transaction/import-plan contracts | 32 passed, zero failures/skips. New local-only boot contract proves no V4/M3/M4 startup calls while normal login assertions remain unchanged. |
| Both production builds and CSS ownership | passed; existing chunk-size/library advisory output only. |
| Scoped ESLint and git diff whitespace | no errors; six pre-existing non-null/any warnings. |
| Full TypeScript vs unchanged release baseline | byte-identical 149-line baseline diagnostics; no newly introduced type failure. Not represented as a passing repository-wide typecheck. |

Initial new recovery tests exposed an immediate self-reacquisition/lease-release race; that was fixed with lifecycle cleanup and bounded ordinary release wait. An initial local Pages run used leftover EdgeOne physical route HTML after switching build flavors; a clean Pages build/matrix passed. No assertions, source guards or required gates were weakened. Local evidence is `/workspace/scratch/4c3b6e25c0cf/admin-return-*`; normal CI retains per-state audits/screenshots/traces. Source CI must run full existing S1/Cloud gates before etest acceptance.

## Deployment / user recovery

Publish this source on product/main, qualify its exact SHA using Pages + Cloud admission, then fast-forward etest once for the explicitly requested fix. Existing etest is 81dcdd85bfa47a376eaa66927128d6e38d943df0; master is f874b146875c507f6f30097059a47bb700c761bf. No master promotion.

After deployment, an already affected user should open /admin (or /mobile/admin), log in with admin, and select the header's 普通账号登录. If prompted, confirm 保留完整本机副本 to repair the interrupted state using the existing journal. Do not clear browser data. Already valid profiles return without a repair dialog. Uninitialized/malformed/foreign-owner state is deliberately not silently adopted.

Actual privileged admin credentials are unavailable to the executor. Local and deployed-UI synthetic-API fixtures can certify this client/IndexedDB flow, not genuine private admin statistics/reply acceptance. Never mutate a real user's browser data through a fixture, and never run cloud maintenance for this fix. Leave CURRENT_TASK/Circle ownership untouched.

## Upstream integration before publication

Main advanced from f2892841 to d11b924bad165a212fc3d12c712b23ed4e0d61f8 while this fix was being validated. Integrated all 22 guide/task/test files from the three guide commits without overlapping or overwriting any admin fix. The resulting candidate retains the new guide in both app routes and the EdgeOne SPA emitter; no feature subset was cherry-picked for staging.

Revalidation on the integrated source: 39 focused S1/login/V4/SPA contracts PASS, clean production EdgeOne build + CSS ownership PASS, and 18 final return/recovery/negative-control cases PASS on phone-light and desktop-dark including fallback writer. Scoped lint has no errors, only the same six existing warnings. The earlier six-profile 78-case admin matrix and clean Pages 12-pass matrix remain evidence for the implementation; CI will reconfirm the full combined guide/admin source at the exact candidate SHA. The pre-integration full TypeScript output matched baseline and is not represented as a fresh post-integration global typecheck.

Final integrated/polished production build + CSS ownership PASS; 18 final phone/PC light/dark return/recovery cases PASS (35.2 s), including fallback writer and interruption replay. Recovery consent screen manually reviewed: short heading, explicit backup consent, 44px primary/retry/return controls and no clipped primary action. The post-integration TypeScript output also matches the unchanged 149-line baseline. Local-only boot does not emit a false startup-sync-timeout notice.

Final publication parent 58b0c4293ebd8892f10390aa4a602241b0d701f2 adds only the guide executor documentation checkpoint on top of d11b924b; both updated guide documents are retained unchanged. No runtime/test source changed after the integration validation.

## CI fixture compatibility follow-up

Initial source f137767e23096f475e226feae1bd5d8b5e75c273 passed Cloud backend contracts/lint/build, startup recovery, private feedback, P4b and Learn gates, but the visible-UI gate stopped while collecting tests: locked CI esbuild inherited the repository ES5 tsconfig for the new browser fixture. Local installed esbuild did not expose that default difference. Explicitly target ES2020 for this test-only IIFE, matching the supported Chromium test runtime. Application bundle, storage checks and test assertions remain unchanged. Collection now includes all 84 administrator cases; exact-SHA Pages/Cloud admission must pass on the follow-up before etest moves.

Targeted fixture revalidation: five phone roundtrip/recovery/replay cases PASS. Commit 10ad50554ab94eb08a258ace597608c29118724b contains that test-only correction. It also exposed a CI coverage gap: administrator-only source/test changes triggered Pages but omitted Cloud/admission, leaving no exact-SHA staging evidence. Add src/admin/** and tests/e2e/administrator-*.ts to both existing workflow path filters. This broadens checks for the newly separate authentication boundary; no job or assertion is removed.

## Qualified etest deployment and acceptance

Pinned source: **b59d1e84af85e1f5f40567073242a81de6c7fd4c** (application implementation f137767e, test target correction 10ad5055, broadened exact-source workflow triggers b59d1e84). Tree 07b39d51340bee8ac60ecdfcef2722233e59bded.

- Exact-source [Pages deployment and published regression](https://github.com/smhe00/qwerty-learner/actions/runs/40988503917) PASS. The production visible-UI companion matrix passed 156 EdgeOne cases / 12 Pages-only skips and 66 Pages cases / 102 cloud-dependent skips. Each deployment also passed 17 learning/refresh/audio cases; Pages account preview passed 20 / 4 expected skips, with cloud disabled.
- Exact-source [Cloud Sync Gate](https://github.com/smhe00/qwerty-learner/actions/runs/40988503957) and [read-only staging admission](https://github.com/smhe00/qwerty-learner/actions/runs/40988503901) PASS. No earlier-SHA gate substituted. S1 browser gate for the identical application implementation f137767e also passed (40987853336).
- After fresh ref/ancestry checks, fast-forwarded edgeone-test once, 81dcdd85 -> b59d1e84; verified the actual published https://t.smhe.cn/source-commit.txt marker **b59d1e8**, with cache-bypassing probes. Master remains f874b146875c507f6f30097059a47bb700c761bf.
- Deployed static UI + actual browser IndexedDB exercised across 320px light phone / 1440px dark PC: 16 cases passed initially; two initial phone cases timed out on the initial local-workspace loading screen at the local test runner's default 5-second assertion wait, before any admin transition. Re-ran only those two with a 30-second remote assertion wait: both passed (12.7s / 14.7s total flows). All 18 distinct intended cases passed; no application change, assertion removal, blanket retry or source-gate relaxation. Preserve the initial timeout evidence; this is not a claim of sub-5-second cold startup.
- Deployed recovery screen manually reviewed at 320px: legible copy, explicit consent, obvious primary action and return link fit in the viewport. Tests verify both preserved spaces, exact anonymous fingerprint, archived nonempty admin records, one durable recovery copy, interrupted-write resume, native/fallback writer, revoked/wrong principal refusal, and zero learning-sync/maintenance/Circle calls during management return.
- This deployed admin UI validation uses synthetic intercepted private APIs in fresh isolated browser contexts, never real admin credentials or an existing user's browser data. TLS verification remains enabled. The real ordinary-account three-browser S1 job also passed in [Branch EdgeOne Cloud E2E](https://github.com/smhe00/qwerty-learner/actions/runs/40989579410) (job 123848462103). Its larger real-V4 transport job and other automatically triggered etest suites were still running at this checkpoint; do not treat this as complete GA/release qualification.
- Anonymous reads of /api/admin/access and /api/auth/me on etest return 401. Actual privileged admin statistics/reply operations and physical iOS/HarmonyOS devices were not exercised. No master promotion and no production qualification claimed.

Acceptance logs and screenshots are retained under /workspace/scratch/4c3b6e25c0cf/admin-return-deployed-*; source CI retains its normal artifacts. An already affected browser should open https://t.smhe.cn/admin (mobile may use /mobile/admin), sign in with admin, click the authenticated header's **普通账号登录**, and, if offered, consent to **保留数据并恢复普通登录**. Do not clear browser data. This resumes the existing full-backup recovery and preserves the archived admin and ordinary workspaces.
