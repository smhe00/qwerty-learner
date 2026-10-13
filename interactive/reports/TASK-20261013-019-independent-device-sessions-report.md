# M1 independent device sessions — development checkpoint

**Status**: PARTIAL — code landed in \`product/main\`, no live multi-device pilot/release.

## Base and first commit
- Started from \`a615895bcd8c29dab8d1fa966d61fcbf04a35442\`.
- Implementation commit: \`25e80ebb0a5bd1855377197f4d35b6ee05b2f64c\`.
- Cloud Sync Gate [#38386607197](https://github.com/smhe00/qwerty-learner/actions/runs/38386607197): **SUCCESS**, node backend contract tests, cloud/frontend lint and build all passed.
- Second commit: add explicit fail-closed V4 write guard in M1 pilot, extra test and this checkpoint. Exact commit SHA is GitHub branch commit following first SHA; use branch history to confirm.
- \`master\` unchanged.

## Tested locally in GitHub Actions
Default single-session; two independent concurrent logins and simultaneous valid tokens; per-token revocation; account-wide password change; account deletion/username reuse; legacy session conversion/rollback; blocked V4 upload when pilot enabled.

## Not yet demonstrated
No real EdgeOne multi-region consistency, user-facing pilot or independently authenticated dual-Chromium Maker run. Account auth-version latest-read eventual consistency and retention garbage collection remain risks. Formal M2 replay and M3 append-only cloud publication remain unimplemented.

## Current project task coordination
\`interactive/CURRENT_TASK.md\` still points to TASK-20261011-014 forced session revocation IN_PROGRESS. This work does not close or silently reassign that preexisting P0. Before executor handoff, explicitly coordinate/reconcile these tasks.
