# Login full-V4 admission and staging experiment

Owner authorization (2026-10-24): 修复以后到etest上去实验; 注意要先合并main，再同步到etest.

Single executor Codex. Baseline a2dc907c9c0f6e8924f441fa360ebabd317233dd. Continue PR #32.

Connect existing-account login/reauth to S1 writer-exclusive S2 full six-table admission before M3/M4. Preserve single-active-session, anonymous isolation, exact source audit, CAS, durable Pull/M4 journals and fail-closed divergence/legacy-event refusal. Do not invent legacy attempt IDs or imply event prefixes prove complete history.

Add regression checks for disabled/offline/not-ready, successful push/noop/pull staging, conflict/blocked, local export failure and uncertain transport. Add an exact-SHA t.smhe.cn-only two-profile historical six-table experiment with fresh disposable identity, independent local row evidence, automatic reauthentication push/pull, preserved divergent histories, and verified identity-bound cleanup. Synthetic local fixture seeding is permitted ONLY in those disposable browser profiles before sign-in/reauth; no production data.

Validate locally and CI, merge PR into product/main, wait for merged-SHA Pages/cloud validation, then fast-forward edgeone-test to that same SHA and verify live staging. Never update master. Report application proof separately from cleanup failures, retain failures, and never replay ambiguous cloud writes.

Owner steering: ordinary startup must inspect/download full cloud V4 before safe local reconciliation. Add guarded normal-entry S2 before M4, bypass account/tool/offline/expired flows, and prove startup recovery independently after a deliberately failed login preflight. Historical divergence remains explicit and fail-closed.
