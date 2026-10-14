# One-shot production master V4 Base64 benchmark — 2026-10-15

User-authorized scope: benchmark existing production master 35134ca027dd55291e989bf63b4c776bd2668865 at https://qwerty-plus.edgeone.dev/ only. Never update/deploy master or edgeone-test and never use real-user credentials/data.

Independent development branch: codex/master-v4-once-20261015, based on product/main 30e0be26c05eef1eb3c85c644e85f8e22c30270c. This bounded task explicitly uses an isolated development branch and leaves the unrelated IN_PROGRESS CURRENT_TASK unchanged.

Files: scripts/master-v4-once-20261015.mjs and .github/workflows/master-v4-once-20261015.yml. Production source verifier is unchanged, blob 7b86a4c1ccb782e6f4ed2bb6951de14983b6194c matches master.

Acceptance: one newly registered random account; gzip sizes 256 KiB, 1 MiB, 1.5 MiB, 2 MiB within 128 bytes; cryptographic random entropy inside valid V4 workspace. Exactly one PUT per size. Record gzip/Base64/JSON bytes, status, elapsed PUT, revision, SHA256, metadata/readback/verification durations. On any failed or ambiguous PUT read metadata once, then stop all uploads without retry. Finally verify immutable identity and delete only the account created by this run; require DELETE 200/accountDeleted and subsequent authenticated me 401.

Pre-submission validation: Node syntax PASS; all four gzip fixtures verified with production V4 verifier; offline simulated HTTP 503 after committed revision PASS (one PUT, metadata SHA match, no readback/new upload, own account cleanup).

Workflow is push-triggered only by its own workflow path on the isolated branch, read-only GitHub token, no deployment step, no workflow_dispatch, reruns disabled by run_attempt. Results go to job logs, step summary, and redacted JSON artifact. Do not rerun the benchmark automatically. A report-only commit cannot retrigger it.
