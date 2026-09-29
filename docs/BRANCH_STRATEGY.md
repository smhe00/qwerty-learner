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
- encrypted EdgeOne cloud sync;
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

This branch produced the initial integrated Review + Cloud release candidate and is now frozen at `7d9a0730f4627d91077948cb1bfa677cb18ec68d`.

`product/main` was created from that exact verified commit. Do not land new product development on this feature branch.

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
