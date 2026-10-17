# 2026-10-17 Learn exhaustion investigation

User-authorized scope: investigate the uploaded incident against 9445ae4, explain counts and scheduler/Review/Daily state, and supply a minimal verified fix if feasible. Prefer preserving master/etest.

This is an independent incident investigation, not a takeover of CURRENT_TASK session-revocation ownership.

Execution base: 0cd5e5b4c65fe6680278899f5f185f94e427e79f.
Work branch: fix/incident-2026-10-17. Keep this patch isolated for review; no integration into product/main and no production/staging deployment as part of this incident task.

Deliverables: lifecycle-safe extra-round selection; regression tests; evidence-based report at interactive/reports/INCIDENT-20261017-learn-exhaustion.md. Do not commit the user's incident JSON or raw database export.

Validation: exact incident-source progress/controller replay; daily-session plus relevant Learn/scheduler tests; changed-source ESLint; production build. Record existing failures separately.

Status: REVIEW. See report for all results, limitations, and follow-up choices. Publish the isolated branch if available; otherwise preserve the local commit and patch for handoff.
