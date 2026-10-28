# Unchanged startup: local data reuse

Date: 2026-10-29 (Asia/Shanghai). Status: REVIEW.
Execution base: 2e18c82428fa21dd6f1478d6aa29f36d5268650a.
Source commit: f97b625f32e6320dfa5d6dc05f0677c4946138c8.
Source tree: 23fb77035283902897c1ed4c97865955d977fca1.
Target: product/main. No staging or production promotion in this task.

## Problem and behavior

Startup previously always exported and independently audited the complete V4 working workspace before deciding it was already current. It already avoided payload transport for a fingerprint-equal no-op, but repeated the expensive local export/audit. The subsequent authenticated history verification also rewrote and reread an already complete, identical server checkpoint.

Ordinary guarded learning startup now compares a fresh authenticated cloud revision/fingerprint with the durable baseline and a locally stored proof of a completed full audit. It independently reads the current raw contents of every live RecordDB table in a single read transaction, together with table schema/version and all V4-owned localStorage settings, daily sessions and navigation. Exact unchanged content can reuse the previously verified logical fingerprint. Cache hits perform no Dexie export, scratch roundtrip, gzip, payload transfer, restore or baseline write. The cache does not authorize any remote/local mutation.

The disposable proof is scoped to immutable account and workspace generation and protected by an integrity checksum. The raw-state digest is type-tagged: undefined, sparse arrays, negative zero, NaN, dates and object structure do not collapse through JSON equality. Unsupported types, cycles/shared references and oversized graphs bypass reuse. Missing/corrupt/unavailable cache or raw reads fall back to the original full executor. No schema migration, dirty-counter assumption, learning row rewrite or settings format change was introduced. The proof stores only identifiers, revision and digests in the existing vault registry store; it is excluded from portable backups.

Only a completed full no-op/push with a committed baseline and identical raw content before/after can refresh the proof. Manual and Block-completion sync still perform their full audit and now refresh the proof for the next opening. Any local change, changed remote revision/fingerprint, changed account/generation, unsupported cloud format or legacy storage layout takes the existing full path. Initial metadata is reused once during fallback; Pull/merge rechecks still make new requests. Cloud writes retain their original CAS and integrity checks; interrupted transfers retain their recovery journals. Lost V4 acknowledgments still settle through fresh metadata without duplicate writes.

M3 publication and history observation remain independent and are never suppressed by a V4 proof. An outstanding immutable batch stays durable and uses the existing identical-batch retry/readback protocol. Receipt listings remain non-authoritative. When history heads are exactly unchanged and the server-owned content-addressed checkpoint is already complete, the server returns the authenticated validated proof without rewriting or rereading it. Incomplete/extended chains retain normal paginated verification and exact persistence/readback. Fresh authentication, account checks and post-read ownership checks remain mandatory. No browser authorization cache was added.

Startup text now says 正在核对学习记录 and explains that changed records are synchronized. This change does not promise offline metadata confirmation or skip required identity checks.

## Files

- New src/sync/startup-local-proof.ts, startup-local-proof-browser.ts and startup-sync-v2.ts: conservative content proof, disposable vault storage and guarded orchestration.
- src/sync/v2-browser-executor.ts, account-login-v4-check.ts and workspace-bootstrap.ts: enable reuse only on startup; seed proofs after complete manual/startup sync.
- src/index.tsx: accurate startup status text.
- cloud-functions/_shared/history-verification.js: return exact completed server proof without redundant Blob write/readback.
- tests/cloud/startup-local-proof.test.mjs and history-verification-resume.test.mjs: reuse, invalidation and server safety contracts.
- tests/e2e/startup-sync-regression.spec.ts and its harness: real browser/IndexedDB and mocked-transport regression. Existing Startup Sync Recovery and Cloud Sync workflows already trigger/run this coverage; no gate was weakened or bypassed.
- Dedicated task/report. Unrelated Circle CURRENT_TASK remains untouched.

## Validation executed

1. New local-proof and history-resumption contracts: **45/45 passed**, 1.58 s. Includes all six tables' same-count edits, settings/navigation, raw-state invalidation, cache faults, owner change, session rejection, revision changes/regression/disappearance, remote Pull/meta recheck, manual proof refresh, and lossless digest distinctions. Server tests prove one validated checkpoint load, zero checkpoint writes and zero batch rereads for completed unchanged heads; extension and session revocation remain strict.
2. Existing startup boot/budget, S2 executor/policy/baseline/Pull transactions and M3 witnessed receiver contracts: **106/106 passed**, 1.70 s.
3. Existing account-login V4 and login-event warning contracts: **22/22 passed**, 0.18 s.
4. Final browser startup/account-return suite excluding the already passed unchanged full-budget case: **19/19 passed**, 1.3 min, Chromium 120. Includes phone 390px and desktop 1440px reload; an independent counter proves no startup Dexie export on cache hits (the test's own post-mount conservation export is counted separately). Requests on a current account without immutable history are exactly metadata GET plus receipt-observation GET, with no payload transfer/write. Covers native IndexedDB same-count updates, settings and DailySession changes, corrupt proof fallback, full remote download/stage/recovery, revoked sessions, offline/slow transport, lost V4 ACK and manual-sync-to-next-startup reuse.
5. Added outstanding immutable-event browser regression: **1/1 passed**, 4.8 s including runner startup. A cached current V4 proof still retries the exact same pending immutable batch and retains unchanged learning data; no additional V4 upload occurs.
6. Earlier complete browser run: **18/18 passed**, 2.3 min. Its unchanged full-network-budget test mounted preserved local data in 62,509 ms with one metadata request, zero writes and one retained local row. The first-frame deadline remains the existing bounded policy; this work does not claim instant startup during a stalled network.
7. Final build: passed; Vite 18.44 s, command 19.25 s. Existing bundle-size warnings remain.
8. Scoped source/server/test ESLint: zero errors; three pre-existing non-null assertion warnings in src/index.tsx. E2E files checked with the TypeScript parser explicitly because the repository override covers test/ rather than tests/. git diff --check passed.
9. TypeScript whole-repository check still reports 143 pre-existing diagnostics; no diagnostics in changed application files after fixing the new Set iteration to Array.from. Whole-repository type cleanliness is not claimed.

Two initial new unit fixtures were corrected (an unsupported setting name and omitted compressed payload size); both final assertions pass. The first outbox browser assertion incorrectly expected the V4 read-before-retry rule to apply to immutable M3 batches. Inspection confirmed M3 deliberately retains and retries identical batch bytes. The final test asserts exact identity/body equality across attempts, retained learning data and no duplicate V4 write; no publisher behavior or safety assertion was weakened.

## Limits and delivery

An older profile without a usable proof needs a full audit once. Changed content still requires full sync. Actual local rows are read and hashed on every startup, so this is not a constant-time shortcut for arbitrarily large databases. Authentication/metadata and independent event/history checks still use the network; completed server history proofs now avoid redundant persistence. Cloud latency and Huawei/iPad/HarmonyOS rendering were not measured in this local run. Existing session-revocation polling is unchanged.

Upstream was freshly fetched and remained at the execution base after validation. Publish source plus this report with one expected-SHA force=false update to product/main. Remote CI is separate from the local results above. This task does not advance etest or master; the earlier pinned candidate remains a separate release decision.
