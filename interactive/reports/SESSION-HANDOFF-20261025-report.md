# SESSION-HANDOFF-20261025 — P0 checkpoint

Status: PARTIAL / prototype only; NOT release ready.
Execution base: ad092c7348260407c0c91102073c5447fffeee07.
Branch: fix/session-handoff-20261025.

Implemented: durable drain transition model, an injectable atomic barrier with
no local fallback/no timeout unlock, a PostgreSQL control-plane reference
adapter, deterministic existing-core race fixtures and focused CI qualification.
No gateway import or authentication/runtime path has changed.

Local Node v22.16.0 results: 20/20 tests PASS, zero skipped (16 barrier, 4 adapter
contract tests). All new JavaScript syntax checked. Full repo clone in this
container failed DNS resolution; source was inspected through GitHub. Exact
existing-core regressions and real PostgreSQL tests are delegated to the new
read-only CI workflow; their results are not yet claimed in this checkpoint.

Untouched: master, edgeone-test, product/main, active idle-activation CURRENT_TASK,
production Blob data, runtime configuration, credentials and application package
lockfiles. No provider subscription or learning-data migration occurred.

Remaining: actual gateway integration, provider/runtime qualification, pre-auth
and in-gate re-authentication, full mutation coverage, bounded receipts, crash/
unknown-outcome recovery, safe rollout excluding old unguarded instances,
real etest browser/Blob validation. Details in experimental/session-handoff/README.md.

Next executor: read the task and this report; inspect exact branch and CI SHA.
Do not merge to product/main during the independent idle-activation freeze.
Do not describe the retained PostgreSQL test adapter as a selected paid service
or the prototype as a completed production safety fix.
