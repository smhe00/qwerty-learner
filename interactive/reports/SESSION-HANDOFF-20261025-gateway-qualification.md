# Account handoff gateway qualification checkpoint

Base: 6064bb504c89100551836a0b2629220ee41ea35d.
Last inspected upstream: a782fb0e46c361bff1eca5ffaef2aee15fe8d18a.
Status: local qualification completed; repository CI/live results pending.
No database provisioning/migration, production deployment or real-user mutation.

## Implemented

- Public HTTP onRequest integration, not just standalone service wrappers.
- Blob-only immutable-ticket cross-instance coordination; no CAS, local mutex,
  lease expiry, fixed-delay safety claim or PostgreSQL runtime.
- Whole-request mutation tracking: direct/multipart upload, final manifest,
  cleanup, activity metadata, account/password/session operations.
- Preflight plus in-gate credential checks; late old tokens rejected.
- Explicit single-session logout writes and verifies revocation under ownership.
- Read-only fixture status, bounded held-manifest injection, capacity/listing
  refusal and no automatic unlock on timeout or uncertain mutation.
- Fixed request-body classification error path: never delegate unknown auth
  requests to unguarded login even if a second body read might succeed.
- Real staging-only fresh-account journey with exact source and payload checks.

## Local evidence

Node v22.16.0 selected suite 107/107 passed without failures/skips before the last
body-classification hardening. Updated gateway suite 10/10 passed, including
that new negative regression and the complete live-script journey against the
actual handler. Repository workflow runs the combined 108 tests after merge.

Finite model: 672225 states with no mutual-exclusion violation; deliberately
incomplete membership negative control finds a violation. Three independent OS
processes share only HTTP get/set/list and exclude overlapping business effects.
Provider I/O is synthetic in local tests, NOT an EdgeOne consistency certificate.

## Publishing and scope

The reviewed compact wiring patch is pinned to original core and gateway blob
hashes. Feature workflow applies it, commits real source, merges current main,
runs all relevant tests and pushes ONLY feature without force. Exact tested SHA
is in the workflow artifact. Do not stage the bootstrap trigger SHA instead.
No credentials or runtime data are exported to the local execution.

Owner authorized staging the qualified feature directly to edgeone-test while
preserving the separate idle task on product/main. Do not alter CURRENT_TASK or
master. Inspect ref changes before promotion. Record actual CI/live results.

Only random new usernames matching ^qh26[0-9a-f]{24}$ are enabled. Existing users
retain the previous behavior. Health explicitly sets handoffProductionReady=false.
Circle/admin/global-maintenance are refused for fixtures. Executing idle cleanup
must remain off. Complete strong get/list and durable writes are assumptions.
128 operations per fixture, one complete list page, no receipt pruning or forced
unlock. Unknown/crashed writes may strand fixtures. This is controlled Etest
qualification, not general production rollout. See BLOB-QUALIFICATION.md.
