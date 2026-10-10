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

## S2-P2b read-only preflight groundwork

- `src/sync/v2-preflight.ts` computes the canonical V4 digest from an
  immutable captured snapshot and applies the account-scoped decision table.
  Empty/nonempty workspace detection errs on the side of treating unknown
  RecordDB shapes as meaningful, preventing destructive first-pull.
- Versioned `getSyncV2Meta` only reads cloud metadata. It does NOT wire
  in any production user button or snapshot transfer.
- Full executor work remains: writer quiescence, account/base CAS,
  pre-restore durable rollback journal, fault injection and reload after pull.

## S2-P2c read-only downloaded snapshot verification

- `src/sync/v2-verify-remote.ts`: compares versioned remote snapshot
  to pinned `/api/sync/v2/meta`; verifies compressed SHA/length, canonical
  V4 logical hash and immutable owner. Streaming decompression enforces
  32 MiB maximum inflated size before any DB import, preventing oversized
  gzip payload restore.
- No recovery journal or upload/restore is enabled by this layer.

## Verified gates and next release blocker

- `121ffb38`: Cloud Sync Gate
  [38045787565](https://github.com/smhe00/qwerty-learner/actions/runs/38045787565)
  **PASS** for backend verified V4 snapshots, CAS, owner rejection,
  browser/backend canonical hash parity.
- `72c5bdd0`: Cloud Sync Gate
  [38045964994](https://github.com/smhe00/qwerty-learner/actions/runs/38045964994)
  **PASS** for baseline validation/CAS unit contracts.
- `9d7a72d7`: Cloud Sync Gate
  [38046156897](https://github.com/smhe00/qwerty-learner/actions/runs/38046156897)
  **PASS** for read-only decision preflight.
- `b761a4ef`: Cloud Sync Gate
  [38046454667](https://github.com/smhe00/qwerty-learner/actions/runs/38046454667)
  **PASS** including 84 cloud tests, streaming cloud snapshot integrity
  validation, lint/build.
- `fa068ecc`: S1 Workspace Browser Gate
  [38046423639](https://github.com/smhe00/qwerty-learner/actions/runs/38046423639)
  **PASS 48/48**, including two real Chromium S2 baseline durability/
  stale-writer CAS tests.
- Earlier intermediate browser/review failures were caused by a missing
  import in the developer/test-only `backup-harness.ts` after adding
  S2 baseline exports. Repaired in `fa068ecc`; no deployed Maker JS
  or learning data affected.
- The next irreducible safety gate is the **S2-P2b durable pull journal**.
  Do not enable the real one-button Sync merely because the decision and
  verification layers are green: interrupted RecordDB restore without a
  replayable journal could otherwise mount an invalid mixed workspace.

## 2026-10-10 staged Pull recovery implementation

- Dedicated staged V4 snapshot journal in the existing S1 vault (no schema
  bump), replayed before app mounting under the original exclusive writer
  lease; corrupt journal fails closed.
- Atomic baseline revision advancement + journal deletion only after
  full RecordDB restore and localStorage integrity witness reseal.
- Unit fault injection and Chromium tests exercise crash replay,
  reload-required and checksum tampering; CI evidence pending.
- The initiated network Push/Pull execution/UI remains disabled.

## S2-P3 opt-in pilot UI

A single `Sync 同步` button now appears only for isolated account
workspaces when Vite DEV or an **explicit build flag**
`VITE_S2_ENABLE_UNIFIED_SYNC=true` is active. It navigates to
`/?s2-sync=run`, which runs the verified executor BEFORE importing
React/RecordDB and forces a fresh navigation afterwards. All outcomes
display an account-safe toast; conflict/blocked never fall back to
Upload/Download or automatic overwrite. The production build default
keeps this button and route unavailable. No Maker/master release.

## 2026-10-10 latest S2 checkpoint — verified, DEV-only

- Cloud Sync Gate [38048701997](https://github.com/smhe00/qwerty-learner/actions/runs/38048701997):
  **95/95 PASS**, including true three-device concurrent V4 revision CAS
  winner/stale conflict, backend+client full six-table restore validation
  and S2 Push/Pull/noop/stale-cloud policy/executor contracts.
- S1 Browser Gate [38048589692](https://github.com/smhe00/qwerty-learner/actions/runs/38048589692):
  **53/53 PASS**, including real guarded V4 Push, subsequent metadata-only
  No-op, expired session rejection and single-Sync full-page navigation.
- Learn Journey Gate [38048383193](https://github.com/smhe00/qwerty-learner/actions/runs/38048383193)
  and Achievement Gate [38048383202](https://github.com/smhe00/qwerty-learner/actions/runs/38048383202)
  **PASS**. Review Gate [38048383109](https://github.com/smhe00/qwerty-learner/actions/runs/38048383109)
  was still in its Learn browser stage at this checkpoint, not assumed green.
- Source code is committed only to `product/main`. Maker-bound
  `master` remains on an older production release. Local DEV URL
  `/?s2-sync=run` is a privileged internal test workflow (not customer
  release), guarded by the exclusive S1 writer lease; `VITE_S2_ENABLE_UNIFIED_SYNC`
  defaults OFF.
- P3b/P4b are release-blocking: safe V3-to-V4 cloud migration for
  accounts with old snapshots, account-consent/backup/rollback UX,
  non-destructive divergence recovery, disposable EdgeOne real cloud
  verification, and S1 old-version tab/migration rollout acceptance.

### Review Gate late-arrival confirmation

Review Gate [38048383109](https://github.com/smhe00/qwerty-learner/actions/runs/38048383109)
on the S2 pilot code source `2d11104db` has now **COMPLETED SUCCESS**
(including Learn browser contracts, Typing lifecycle, audio, P3 fuzz and
build). Later commits in this checkpoint added only dev test coverage
and documentation, not Learn/Typing business logic.

## P3b development closeout — 2026-10-10

Accepted in development (NOT released to Maker).
- `/api/sync/v2/recovery`: separate authenticated CAS operation that
  refuses a stale revision, wrong account owner, old cloud payload SHA,
  wrong V3/V4 recovery direction or an unverified V4 replacement.
  V1/V3 old clients remain barred from writing after V4 upgrade.
- `v2-recovery-ui.ts`: two independent gzip backup downloads plus
  explicit saved-file attestations, immutable account ID entry, deliberate
  local/cloud choice and a final destructive-operation confirmation. All
  text is rendered via textContent, no merging and no automatic choice.
- `v2-recovery-archive.ts`: exact original cloud bytes checked against
  pinned SHA/size/revision/format; 4MiB compressed and 32MiB inflated
  safety limits, malformed/partial old V3 conversions refused. V3 may not
  carry new Learn daily-session or settings data, explicitly disclosed.
- Cloud-wins V3 migration emits V4 content only from a complete safe V3
  export and uses server migration CAS before any local RecordDB import.
  Upon an uncertain remote response, original local state remains intact.
- Important bug found/fixed during deep browser testing: in-realm Pull
  restore ran after S1 installed its witness guard, causing premature
  result handling. Now only journal.stage runs in the recovery screen;
  fresh boot performs deterministic restore+reseal+baseline commit, then
  emits completion notification. This also corrects ordinary Sync Pull.
- Cloud Sync Gate [38050718488](https://github.com/smhe00/qwerty-learner/actions/runs/38050718488):
  **100/100 PASS**, including explicit V3 migration double-CAS, corrupted
  archives, incomplete table manifests, oversized gzip and pinned sha checks.
- S1 Browser Gate [38050718549](https://github.com/smhe00/qwerty-learner/actions/runs/38050718549):
  **58/58 PASS**, including the two real cloud-wins restore scenarios,
  actual post-restore IndexedDB navigation + baseline values + no pending
  journal; cancellation, rollback refusal and remote revision race coverage.
- Latest code verified: `a33a40d3c1be370b01dc3069362563dd586bbe56`.
  Maker release to `master` is not authorized.
- P4b must add real Maker disposable-account tests and production
  migration/rollback approval; audit that a complete Dexie export includes
  all durable per-table row payloads, and revisit TLA+ for explicit
  conflict recovery. An earlier Learn Journey gate reported one unrelated
  failure (see run 38050479982); do not claim all product gates green.
