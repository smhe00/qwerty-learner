# Pages deployment gate repair — 2026-10-15

Base: product/main 30e0be26c05eef1eb3c85c644e85f8e22c30270c.
Authority: direct user instruction to implement the minimum repair. Development only.

## Confirmed cause

Source run 38628144182 built and pushed artifact commit 43f78970735714adba32741de283da797af06ce1 successfully.
Dynamic Pages run 38628277905 uploaded artifact 11924617311, then job 116073119998 failed creating a deployment with HTTP 504 at 2026-10-14T20:00:10Z.
The four published regression cases stopped at source-SHA checks (served a2771430, expected 30e0be26); Explorer did not run its browser cases; Cloud contracts passed 320/320 and Admission failed downstream.

## Changes

- scripts/wait-pages-deployment.mjs: read-only exact artifact deployment evidence, bounded deployment wait (10 minutes), independent live propagation wait (3 minutes), cache-busted full source marker, and fail-closed candidate freshness/API checks.
- deploy-pages.yml: actions:read and explicit actual-deployment then propagation steps before Chromium/browser regression.
- pages-explorer.yml: same deployment/propagation prerequisite before exploration.
- pages-regression.spec.ts: cache-bust marker probes; all expectations, timeouts and browser flows preserved.
- verify-etest-entry.mjs: distinguish publish/regression workflow failure and link run; wait budget 20 minutes instead of 8 to cover the new prerequisites; cache-bust final marker check.
- Admission jobs: 25-minute ceiling. Trigger paths include the new helper.
- Nine deterministic tests cover successful/pending deployment, failed/cancelled deployment, unrelated artifact/run, old live SHA, superseded candidate and denied API.

## Local validation

- Focused gate tests: 9/9 PASS.
- Both helper scripts: node syntax checks PASS.
- Four changed workflow YAML files: parse PASS.
- Focused ESLint on the two helpers and gate tests: PASS.
- Full yarn test:cloud on Windows: 320 passed, 1 file failed. Existing tests/cloud/s2-write-route.test.mjs constructs /C:/.../cloud-functions/api/[[default]].js and esbuild cannot resolve it. No test was weakened or excluded. Linux CI must confirm the complete suite.
- Pages-configured build: result recorded after completion below.
- Online deployment/browser verification: must be checked on the new pushed source SHA; historical 30e0be26 is not republished once superseded.

No master/edgeone-test updates or cloud functional changes. No automatic deployment retry: a failed actual deployment remains a hard failure with its run URL, allowing a targeted operator retry rather than silently repeating publication.

## Integration and build

- Pages-configured yarn build PASS (Vite 46.39s). Existing chunk-size warnings only.
- Before commit, origin/product/main advanced to 235bb0a6854536332386684e578e3ebc9926116e via two isolated etest benchmark files. Fast-forwarded safely; none of the repaired files, frontend, dependencies or test fixtures overlapped.
