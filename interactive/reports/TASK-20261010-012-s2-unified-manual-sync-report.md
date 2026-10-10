# S2 unified manual Sync — P0 work report

Working branch: `product/main`. No production Maker publication.

S2-P0 implements a pure decision kernel matching
`docs/CLOUD_SYNC_V2_MODEL.md` sections 4/6/7/8. No network, persisted
baseline, browser storage, active workspace mutation, or payload IO is
enabled by this slice. Real Cloud API still serves V1 snapshot metadata;
S2 must refuse V1-compatible metadata as V4 proof rather than silently
overwrite learning records.

Tests in `tests/cloud/sync-v2-policy.test.mjs` cover the full decision
table and safety rejection scenarios. The existing CI `Cloud Sync Gate`
runs `yarn test:cloud` plus frontend lint and Vite build; CI outcome
must be recorded after this commit lands.

Follow-up owner: implement server-side V4 metadata/CAS first, then a
crash-safe executor, then the one-Sync UI. S1 release blockers remain
documented in `docs/S1_CLOSEOUT_AUDIT_20261010.md`.

## 2026-10-10 implementation checkpoint

- P0 `a18b110e73a90a23cebfde103a53d938cd295888`: pure V4
  No-op/Push/Pull/Conflict/Blocked decision kernel and regression tests.
- CI [Cloud Sync Gate 38045048350](https://github.com/smhe00/qwerty-learner/actions/runs/38045048350):
  **62/62 Node cloud contract tests PASS**, sync/backend lint PASS, Vite build
  PASS. Existing third-party bundler and unrelated unused-variable warnings
  are nonblocking.
- P1a in progress: return an explicit transport `payloadSha256` alias
  alongside V1 `dataSha256`, and `logicalFingerprint: null` on old
  snapshots. This prevents a V3 cloud backup from being misidentified as a
  canonical V4 no-op. No V4 uploads are authorized by P1a.
- P1b remains: server-side verification of full V4 gzip snapshot, immutable
  account owner, canonical logical hash and CAS before enabling writes.

- P1a `97fcaf220ea2e40c9e7071ec02fad800ac61d426`:
  backward-compatible V1 response includes `payloadSha256` plus explicitly
  null `logicalFingerprint`; V4 uploads are still rejected server-side.
- CI [Cloud Sync Gate 38045228572](https://github.com/smhe00/qwerty-learner/actions/runs/38045228572):
  **PASS**, including new backend metadata contract, full cloud tests,
  frontend/cloud lint and Vite build.
- S2-P1b next requires *authoritative server verification* of a V4 payload
  (including immutable account binding, canonical logical fingerprint,
  gzip bounds, CAS and safe migration) before exposing V4 writes or the one
  user-facing Sync button.

## P1b backend implementation candidate

- Dedicated authenticated `/api/sync/v2` GET/PUT and
  `/api/sync/v2/meta` GET paths, reusing the existing versioned
  snapshot store without changing the V1 production request contract.
- Bounded gunzip decode (32 MiB inflated upper limit), strict V4
  schema/allowlist/account-owner checks, canonical workspace digest
  computed on the server and compared to the client claim.
- Revision-specific optimistic CAS; V3-to-V4 implicit overwrite and
  V4-to-V1 downgrade both rejected with 409. Identity and malformed
  payloads fail closed. Hash parity with client implementation tested.
- **No V2 UI or live Maker deployment.** Server endpoint remains in dev
  `product/main`, not Maker-bound `master`. Check CI after commit.

## S2-P2a local baseline groundwork

- New `src/sync/v2-baseline.ts` stores account-scoped revision/fingerprint
  in the existing S1 vault `registry` object store under independent keys.
  Does NOT alter its `HEAD` registry or database schema version.
- CAS checks both baseline revision and fingerprint; corrupt or cross-account
  baseline fails closed, revision rollback and fingerprint changes at identical
  revision are rejected.
- This primitive is **not wired to live cloud transfers**; a future executor
  must ensure a successful, crash-safe snapshot transfer/restore and a held
  single-writer lock before committing a baseline. Add browser IDB integration
  and fault injection in P2b.
