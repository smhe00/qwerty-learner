# Branch Strategy — Qwerty Fork Product Line

> Effective: 2026-09-29

## Long-lived branches

### `master`

Purpose: track the upstream `RealKai42/qwerty-learner` baseline and keep upstream contribution work separable from the fork product line.

Do not develop fork-only product features directly on `master`.

### `product/main`

Purpose: the single source of truth for the integrated fork product. The initial integrated Review + Cloud release candidate passed all production Gates on 2026-09-29.

All integrated product behavior belongs here:

- spaced Review;
- Review telemetry and learning context;
- Review scheduler state;
- EdgeOne cloud sync;
- future fork-only product features.

New feature work should branch from `product/main` and merge back after its targeted Gate passes.

## Frozen historical branches

### `feature/spaced-review`

Frozen at:

```text
93b40e0784ea26cf300d10d8e67365f16618e7e3
```

The same commit is preserved by:

```text
archive/review-baseline-20260928
```

This branch is no longer a development line. Do not land new Review changes here.

### `feature/edgeone-cloud-sync`

This branch is no longer a development line. EdgeOne's existing GitHub project is still bound to this branch as its Production trigger, so it is retained only as a **production pointer**.

Release rule:

```text
product/main verified RC
        ↓ fast-forward only
feature/edgeone-cloud-sync production pointer
        ↓ EdgeOne GitHub auto-deploy
Production
```

Do not land independent commits here. The pointer may only fast-forward to a commit already validated on `product/main`.

## Upstream contribution branches

Upstream PRs must remain independent of the fork product branch.

Create narrowly scoped branches from the latest upstream-compatible baseline, for example:

```text
upstream/review-pr1-priority
upstream/review-pr2-reinforcement
upstream/review-pr3-telemetry
```

Do not submit the complete fork product branch as one upstream PR.

## Invariant

There must be exactly one active integrated product line:

```text
product/main
```

Review schema, scheduler semantics, backup/restore behavior, and cloud synchronization must not evolve on separate long-lived branches.


## Historical production handoff

The block below records the verified 2026-09-29 production handoff. It is historical and is not the Learn Alpha 1 release baseline. For the current Alpha release, see `ALPHA_RELEASE_BASELINE.md`.

Verified on 2026-09-29:

```text
canonical product branch:
  product/main

verified application RC:
  2e1128095c41afa4d881757eff037ff7a28f5294

EdgeOne production pointer:
  feature/edgeone-cloud-sync
  -> 2e1128095c41afa4d881757eff037ff7a28f5294

EdgeOne production deployment:
  dpo4dh1hgncg

production project domain:
  qwerty-learner.edgeone.cool
```

The production deployment completed successfully and `/api/health` returned the expected `qwerty-sync-gateway` capabilities, including `blob-transient-retry-v1`.

The EdgeOne project is Provider=`Github`. Direct folder/ZIP deployment is therefore intentionally not used; the platform rejects that path for GitHub-provider projects. Production promotion is performed by fast-forwarding the production pointer to a verified `product/main` commit.
