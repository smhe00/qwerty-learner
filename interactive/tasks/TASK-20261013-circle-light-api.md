---
protocol_version: "1.1"
task_id: "TASK-20261013-circle-light-api"
target_branch: "feature/circle-core-blob"
status: "REVIEW"
executor: "Codex"
release_to_master: false
claim_base_commit: "68833ab1fbd98a447cc681131f20db500947fcd5"
---

# Continue light Circle — offline API adaptation

Continue the user's light-social priority. Implement a minimal v2 request
dispatcher using the existing kernel, with required private/account/IP guards,
bounded JSON input/output, pending acknowledgements and sanitized failures.

Preserve production hard closed gate. Do not mount routes, touch UI/V4 or
protected branches, provision infrastructure, access live stores or deploy Maker.
CURRENT_TASK remains the unrelated UI task; do not change its executor.

Offline acceptance: actual kernel/storage request flows, logical retries,
all current read/mutation actions, identity/membership denial, field whitelist,
byte/stream limits, safe errors and maintained closed gate; node tests/lint;
scoped commit/push with resumable report.
