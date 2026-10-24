# Complete V4 failure stage diagnostics

Continuation of the authorized cloud-sync incident. Base 9a254569cffe0af6bcf3f5e7732fc80a175289b0. The Unicode fix is released and the owner confirms local lossless backup export succeeds. Existing-tab network evidence shows metadata, manifest and one binary part HTTP 200, but no full convergence. Exact remaining exception is UNKNOWN.

Repair observability: record success/failure on stage timers, instrument the missing automatic full-V4 fork branch, and show a fixed safe diagnostic code with the retained startup failure. Never record raw errors, identities, URLs, headers, records, or backup contents. Preserve original error identity, request count/order, single-session guards, lossless audit, archives, CAS and unknown-write no-replay. No existing user data access/mutation. Test only synthetic profiles/accounts.

Follow prior authorized main -> etest -> master order with identical SHA and all required gates before deployment; do not claim a convergence fix from diagnostic improvements. Preserve prior reports on codex/v4-utf8-report-20261024 (4847651b).

## Source repair continuation (base 55cc1d52)

Owner requested direct source analysis instead of further diagnostic collection. A synthetic reproduction using the real getAchievementSessionId and mergeDecodedV4Tables proves two different UUID review sessions with the same device-local numeric ID generate colliding completion-event IDs and fail with auto-merge-achievement-identity-conflict. This is a confirmed valid-data defect; the affected real account's exact exception remains unobserved.

Repair all supported numeric review-session references in the isolated candidate (events, grants, queue awards, trigger IDs and daily completedBlockIds). Preserve UUID provenance, original source archives, full-value roundtrip checks, and immutable-attempt conflict rejection. Cover two independently completed sessions, same-session summaries, repeated/inverse merges and durable browser readback. Do not change the live event producer or existing real user data. Hold etest/master until this functional repair passes required validation, then follow the already authorized main -> etest -> master order.
