---
task_id: RESPONSIVE-DESKTOP-RETURN-20261030
status: PASS
executor: Codex-responsive-return
claim_base_commit: 7eb3631f1614c8c78352a13bcbcae84ba165a290
target_branch: product/main
release_to_master: false
---

Owner reports that narrowing a PC window automatically enters mobile, but widening does not restore desktop. This is a separately assigned UI task; preserve CURRENT_TASK and the independent Circle/Admin executors' work.

Distinguish automatic responsive entry from explicit touch routes. Restore the original desktop route, query/hash and router state when an automatically selected mobile home becomes wide/mouse-first again. Preserve intentional mobile navigation and tablet rotation. Stay in the current document/writer; change no sync/merge/auth/data algorithms.

Validate the regression against the old production bundle, then the fixed production Pages bundle, light/dark desktop roundtrips and wide touch/explicit mobile preservation. Check durable records and no Pages API requests, scoped lint and CSS ownership. Add published Pages coverage. Publish main only; no etest/master promotion.
