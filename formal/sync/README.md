# Cloud Sync V2 — S0.5 Executable TLA+ Specification

This directory is the executable formal specification for the complete Cloud Sync
V2 distributed protocol described by `docs/CLOUD_SYNC_V2_MODEL.md`.

It models **one logical EdgeOne service plus multiple browser-profile devices**.
A Device represents one browser profile; all tabs in that profile are collapsed
into one state because the product contract requires one shared
`activeWorkspace`.

## Scope

`CloudSyncV2.tla` includes transitions for:

- anonymous/account workspace isolation;
- username registration, deletion and reuse with immutable account IDs;
- explicit logout, login reconciliation and auth expiry/re-authentication;
- logical-word durable local progress;
- frozen Block target and future-only Block-size changes;
- Block-boundary automatic sync;
- logical-word-granular manual sync;
- local/cloud revision and fingerprint reconciliation;
- remote-ahead and divergence/conflict handling;
- explicit overwrite-local / overwrite-cloud recovery;
- server-commit-before-baseline and pull-before-baseline crash windows;
- network offline/online and process crash/restart;
- Backup V4 export, same-workspace restore, and explicitly authorized
  cross-workspace import;
- delete-learning-records;
- full account deletion, server tombstone observation, stale-device purge;
- multi-device stale-revision protection.

The TLA+ fingerprint tuple abstracts canonical Backup V4 `workspaceData`:

```text
<< learning,
   settingsVersion,
   blockSizeSetting,
   frozenBlockTarget,
   blockProgress,
   blockEpoch >>
```

Tuple equality is the formal equivalent of equal `logicalFingerprint`.
Transport representation (gzip/Base64/payload SHA) is deliberately outside the
protocol model.

## Safety invariants

The production configurations check the conjunction `Safety`, including:

- type correctness;
- username mappings point only to live account IDs;
- deleted immutable account IDs are never reused;
- active/account/auth workspace ownership remains coherent;
- absent account workspaces are locally purged;
- Block size/target never falls below 1;
- anonymous state is never cloud-backed;
- ordinary cloud writes never use a stale base revision;
- a Block-size setting change never retargets the already-created Block.

Three mutation configurations prove that the important invariants are live:

- `stale-push-mutation` permits stale ordinary writes and must fail;
- `id-reuse-mutation` permits reuse of a deleted immutable account ID and must
  fail;
- `block-retarget-mutation` retargets the current Block after a setting change
  and must fail.

## Model configurations

| Config | Purpose |
| --- | --- |
| `CloudSyncV2.production.cfg` | Exhaustive bounded protocol model with two devices and username delete/re-register capacity |
| `CloudSyncV2.three-device-four-username.cfg` | Exhaustive tight-bound model with **3 devices and 4 username values**; immutable account-ID pool is intentionally bounded to keep TLC finite |
| mutation configs | Negative controls: TLC must find a counterexample |

The model is finite by construction. Numeric bounds are abstraction bounds, not
product limits. In particular, product Block default 20 is represented by a
bounded model value while the protocol property being proved is that the setting
has minimum 1 and only affects future Blocks.

## Relationship to implementation

This is a **protocol specification**, not a code-shaped model.

Implementation phases S1–S4 must refine this state machine. Browser/TypeScript
tests should map concrete events back to the same transitions and invariants;
implementation behavior that cannot be represented by a legal TLA+ transition is
a protocol deviation and requires either a code fix or an explicit specification
change.

The repository `TLA Gate` parses the module, exhaustively checks the production
configurations, and requires the mutation configurations to produce
counterexamples.

Gate owner: `TLA Gate` (`.github/workflows/tla-gate.yml`).
