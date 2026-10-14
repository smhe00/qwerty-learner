# Circle light-social integration into product/main — execution report

Date: 2026-10-14
Target branch: `product/main`
Integration staging branch: `feature/circle-main-merge-20261014`

## Scope and isolation

- User explicitly authorized merging Circle into `product/main` for Pages regression checking.
- Base main: `321f00495e55f5b6a8c4d7affb1469c8ca1cfd52`.
- Circle candidate: `feature/circle-etest-ready` at
  `5fc16da7e3deba0147190c909588f4aa7bed5a07`.
- Created a proper two-parent merge commit on the main base, then resolved
  the sole overlapping production gateway path manually from the **latest
  main implementation**.
- Preserved the latest V4 192-KiB binary multipart receiver, multi-device
  session/auth/event routes, Core and Blob storage adapter. The Circle change
  only adds isolated modules/tests/docs and guarded API routing.
- Production, Pages and other host Circle endpoints remain disabled (404).
  `https://etest.edgeone.dev` is separately feature-gated and requires
  isolated test Blob, allowlisted immutable test-account IDs, a private
  invite HMAC key and trusted IP. No Maker build was triggered.
- Circle membership uses Blob append-only event log, non-atomic eventual
  replay with remove-wins/close-wins; 60-second propagation is accepted
  for this light-social feature, **not** a promise of immediate revocation.
- Account deletion is intentionally held for pilot allowlisted users until
  residual Circle data cleanup is independently verified. No automatic
  erasure completeness claim.

## Integration verification

GitHub Actions run:
https://github.com/smhe00/qwerty-learner/actions/runs/38541579868

**SUCCESS** on integration code SHA:
`253a2f1ef8210303c9defa9d4fde133e7b7d433b`.

- Circle core, transport, authenticated etest gateway: **98 tests passed**.
- Existing V4 core, device sessions, Blob adapter, API route, HTTP multipart
  and part retry: **51 tests passed**.
- Backend JavaScript syntax and ESLint: **pass**.
- Frontend `yarn build` (Vite): **pass**; no Circle frontend or
  Learn/Typing/FSRS source changes.
- Previous real nonproduction Blob SDK sandbox verification:
  https://github.com/smhe00/qwerty-learner/actions/runs/38536214514
  (15 separate events, concurrent joins, removal/closure convergence and
  complete sandbox cleanup). This does not replace embedded Cloud Function
  qualification on etest.

## Next verification boundary

1. Observe GitHub Pages build from the **final product/main SHA**, check
   `source-commit.txt` and frontend Learn/Typing regressions.
2. Pages deliberately disables Cloud, so cannot validate real Circle API
   or Blob, only build/UI/regression integrity.
3. Do not advance `edgeone-test` or `master` without separate authorization.
   Before an etest push, validate isolated Blob Store and per-project env
   variables from `docs/CIRCLE_ETEST_PILOT_READINESS_20261014.md`.
4. The absence of a complete account-erasure protocol, real deployed
   Cloud Function API E2E and Circle UI blocks general availability.
