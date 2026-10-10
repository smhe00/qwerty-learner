# Qwerty Plus — S1 Closeout Audit (2026-10-10)

> Status: **S1 DEVELOPMENT CANDIDATE — RELEASE BLOCKED / NOT COMPLETE**
>
> Branch: `product/main`. No `master` update and no EdgeOne Maker release is authorized by this audit.
> Canonical protocol: `docs/CLOUD_SYNC_V2_MODEL.md`; bounded executable model: `formal/sync/CloudSyncV2.tla`.
>
> This document supersedes stale run-status claims in earlier chronological S1 reports but does not redefine their safety requirements.

## Verified product behavior and implementation

- Backup V4 full logical workspace snapshot, settings allowlist, DailySession persistence, legacy V3 conversion and deterministic fingerprint, separately keyed immutable-account IndexedDB vault.
- Single-writer Web Locks lease before mounted writers, CAS registry and crash journal, recovery before React hydration, safe account switch through anonymous workspace, expired-account local ownership and offline-safe logout.
- Dexie schema V6 fences obsolete V5 IndexedDB clients. An old V5 JavaScript tab can still modify origin-wide localStorage. During a mounted S1 owner, trusted cross-document storage writes are rolled back; a foreign `localStorage.clear()` fails closed.
- From `7c543e7`, a durable `v2:<digest>` migration witness seals S1-owned settings, navigation, DailySession and auth keys. A stale V5 tab modifying those values while the last S1 owner document is closed is detected on the next guarded boot and **cannot silently mount writable React**. This is an accidental-stale-client guard, not cryptographic tamper protection. A verified post-registry-CAS auth-recovery intent alone may reseal after crash. Commit `1dfe4a4` resolves the corresponding crash-window regression.

## Exact observed CI evidence

| Check | Tested source | Run | Observed conclusion |
| --- | --- | --- | --- |
| S1 Workspace Browser Gate | `1dfe4a42e6d1fda1c1e159d58797c1a424a46799` | [38043404455](https://github.com/smhe00/qwerty-learner/actions/runs/38043404455) | **PASS, 46/46 real Chromium** |
| Cloud Sync Gate | `1dfe4a42e6d1fda1c1e159d58797c1a424a46799` | [38043404510](https://github.com/smhe00/qwerty-learner/actions/runs/38043404510) | **PASS** |
| Published dual-site browser Explorer | `1dfe4a42e6d1fda1c1e159d58797c1a424a46799` | [38043404610](https://github.com/smhe00/qwerty-learner/actions/runs/38043404610) | **PASS, EdgeOne cloud account job skipped** |
| Review Gate | `d5f80d517c4082eb22ee762e502788ef2bc66b52` | [38043141620](https://github.com/smhe00/qwerty-learner/actions/runs/38043141620) | **PASS** (later S1-bootstrap-only changes separately browser tested) |
| Sync stale-push mutation negative control | `d5f80d517c4082eb22ee762e502788ef2bc66b52` | [38043141613](https://github.com/smhe00/qwerty-learner/actions/runs/38043141613) | **PASS, actual OrdinaryWritesUseCurrentBase invariant violation found in unsafe mutant** |
| Full required bounded TLA+ Gate | `d5f80d517c4082eb22ee762e502788ef2bc66b52` | [38043141649](https://github.com/smhe00/qwerty-learner/actions/runs/38043141649) | **PASS** (both `tla` and `sync-tla` jobs completed successfully; applies to the unchanged formal sources, not an unbounded state space) |

### Formal model defect closed

The original model wrote `ordinaryWriteSafe' = ordinaryWriteSafe /\\ (rev = baseRev)` without parentheses. TLC treated the conjunction as an action guard, making the unsafe mutation unreachable rather than recording an invariant violation. Parenthesizing the right-hand conjunction restores correct error reachability. The canonical safe policy still requires revision CAS; positive projection guards are not weakened. Diagnostics `StaleRemoteClientAbsent` and `StaleDirtyPushCandidateAbsent` are **reachability probes**, not positive production invariants.

## Remaining P0 release blockers (must not be silently waived)

1. **Production V1→V4 consent rollout:** production `VITE_S1_ENABLE_EXPLICIT_V4_MIGRATION` remains default-off. Validate user-facing explicit ownership consent/cancel, V3 historic data, unsynced local records, empty-account behavior, failed migration, rollback and final working account identity on the actual Maker release target before enabling. The local DEV migration tests are not a substitute for a live-Maker upgrade rehearsal.
2. **Obsolete open-tab rollout policy:** the witness prevents silent state contamination but cannot prevent an old JavaScript tab from attempting shared localStorage writes when the S1 owner is not mounted. V6 fences old IndexedDB writers; an observed foreign write is intentionally **fail closed**, and a repair/rollback runbook is necessary. A separate old V5 tab could have mutated V1 keys before the initial v2 seal was installed; production consent must include closing/reloading old tabs.
3. **TLA acceptance: CLOSED on the current formal model.** GitHub Actions [38043141649](https://github.com/smhe00/qwerty-learner/actions/runs/38043141649) succeeded for both Learn and Sync positive/negative bounded checks. Later S1 bootstrap and documentation commits did not edit `formal/`. The deferred 3-device/4-username exploration remains manual/nonblocking and must never be claimed exhaustively proven.
4. **Maker and customer acceptance:** source being on `product/main` or public GitHub Pages does not prove EdgeOne Maker deployment. Before S1 activation, verify exact Maker SHA, real deployed route/health, migration/recovery and rollback on disposable real accounts. Never fast-forward `master` solely because a development Gate is green.

## Scope boundary

S2 Cloud Sync V2 unified manual push/pull/conflict and Backup V4 restore; S3 Block auto sync; S4 account deletion/multidevice tombstones remain subsequent phases. S1 does **not** silently migrate current live users or begin S2 sync. Continue on `product/main` and keep deployment independently gated.

**Updated evidence decision (2026-10-10):** S1 code, all 46 browser tests, Cloud Sync, Review and required bounded TLA+ are **PASS**. S1 remains `PARTIAL / RELEASE BLOCKED` for independent **production V1→V4 migration, old-version rollout/remediation and Maker customer acceptance**. Do not remove formal validation from the Gate; it is now green.
