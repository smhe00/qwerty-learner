# Circle PR17 inspection — 2026-10-25

Inspected after completing the current idle-admin/HTTP500 production release,
as requested by the owner. Read-only review; no Circle implementation started.

- [PR17](https://github.com/smhe00/qwerty-learner/pull/17) is OPEN, not Draft,
  and has not been merged. Base: product/main. Head branch:
  feature/circle-parallel-replay-20261016; head59aaed45f04fd394b7deb9bac83020a0f40b9237.
- Title: `perf+test(circle): bounded Blob replay and gated etest real-account admission`.
  Its current reported `verify` check is SUCCESS; this is not current production
  or complete multi-account Circle acceptance.
- It changes Circle Blob event replay to bounded concurrent reads, adds
  deterministic-order/concurrency/missing-object/scope tests, and adds an
  explicitly gated two-disposable-account staging journey plus read-only
  preflight/operator handoff. It does not add a Circle frontend or website entry.
- PR body cites104 Circle and59 V4 core tests, a one-run replay benchmark and
  old staging preflight that observed a disabled/unmounted Circle API. Those
  historical assertions were not rerun or treated as evidence for today's code.
- Its old prerequisites (separate Circle binding, invite key and allowlist)
  predate current `docs/CIRCLE_PUBLIC_API_LAUNCH_20261017.md`: current API uses
  existing V4 sessions/private Blob prefixes and removes those feature toggles.
  Review/reconcile the PR with current main before any merge or live journey.
- Current repository still has no Circle frontend under src. Current API docs
  explicitly call it experimental pending physical-erasure lifecycle and full
  real multi-account E2E. Circle accounts have conservative deletion holds;
  this must be resolved before claiming idle cleanup covers Circle data.

Next Circle work, when resumed: reconcile PR17 against current main, define the
deletion lifecycle together with idle/admin protection, then implement and test
the Circle UI and real multi-account flow. No new deployment, credentials,
Circle writes or production changes were made during this inspection.
