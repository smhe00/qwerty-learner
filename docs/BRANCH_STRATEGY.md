# Branch Strategy — Qwerty Plus

> Effective: 2026-10-05

## Authoritative branches

### `product/main` — development source of truth

`product/main` is the only active integrated development line.

All Qwerty Plus product development lands here first, including:

- Typing / Learn product changes;
- Review scheduler and state-machine changes;
- backup / restore and cloud sync changes;
- Formal / Simulation verification assets;
- CI and release-preparation changes.

Normal development pushes to `product/main` may run GitHub Actions such as lint,
unit tests, TLA+, Simulation, Playwright, contract tests, and local `yarn build`.
These GitHub Actions are **not** EdgeOne Maker deployments and do not consume the
limited Maker build quota.

No development commit should be made directly on `master`.

### `master` — release / EdgeOne Maker branch

`master` is the public release branch and the only branch bound to EdgeOne
Maker production deployment.

Updating `master` is therefore a release action:

```text
product/main
    │
    │ milestone accepted / release candidate approved
    ▼
master
    │
    ▼
EdgeOne Maker production build
    │
    ▼
production verification
```

Because the Maker build quota is limited, `master` must **not** be continuously
synchronized from `product/main`.

Rules:

1. ordinary development stays on `product/main`;
2. only a meaningful milestone may be synchronized to `master`;
3. each `master` update is expected to consume one EdgeOne Maker production build;
4. automation must never push or fast-forward `master` during ordinary CI;
5. production verification runs after the `master` release push;
6. the release record must retain the source `product/main` checkpoint, the
   resulting `master` SHA, and the EdgeOne deployment identity when available.

## CI topology

### Development CI — `product/main`

Allowed automatic work:

- Review Gate;
- TLA Gate;
- Simulation / mutation / persistence-race tests;
- Cloud backend contract tests;
- local Playwright browser tests;
- local `yarn build`;
- cloud/API contract tests against local or mocked development services.

The real EdgeOne browser-sync test is intentionally **not** an automatic
`product/main` gate. The development branch can legitimately contain frontend
or protocol changes that are newer than the currently deployed production
backend. Treating that version skew as a development failure would be incorrect.

These checks determine whether a development checkpoint is eligible to become a
release candidate.

### Release CI — `master`

A `master` push means that an approved release candidate has been promoted.

The EdgeOne production verification workflow must:

- inspect the deployment for repo branch `master`;
- require a successful Production deployment;
- verify the production `/api/health` contract;
- record the release SHA and EdgeOne deployment identity in the Actions log.

After Production Verify succeeds, the EdgeOne Browser Sync Gate runs against
that verified release and the newly deployed production backend. It may also be
started manually with `workflow_dispatch` when an explicit live integration
check is needed.

No `product/main` push may wait for, promote, create, or automatically probe
for a newer EdgeOne Maker deployment.

## Historical branches

Old branches such as `feature/edgeone-cloud-sync` and earlier Review feature
branches are historical only. They are not product truth, release pointers, or
deployment triggers.

Historical documents or commit records may still mention the former EdgeOne
production pointer. Those references describe the 2026-09-29 deployment process
and must not be interpreted as the current branch policy.

## Upstream contributions

Upstream contributions remain independent of the Qwerty Plus product branch.
Create narrowly scoped upstream-compatible branches when contributing to
`RealKai42/qwerty-learner`; do not repurpose `master` for upstream tracking.

## Invariants

There is exactly one development source of truth:

```text
product/main
```

There is exactly one Maker release branch:

```text
master
```

The two branches are intentionally **not** kept continuously synchronized.
