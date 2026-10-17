# 2026-10-17 Learn exhaustion investigation

User-authorized scope: investigate the uploaded incident against 9445ae4, explain counts and scheduler/Review/Daily state, and supply a minimal verified fix if feasible. Prefer preserving master/etest.

This is an independent incident investigation, not a takeover of CURRENT_TASK session-revocation ownership.

Execution base: 0cd5e5b4c65fe6680278899f5f185f94e427e79f.
Work branch: fix/incident-2026-10-17. Keep this patch isolated for review; no integration into product/main and no production/staging deployment as part of this incident task.

Deliverables: lifecycle-safe extra-round selection; regression tests; evidence-based report at interactive/reports/INCIDENT-20261017-learn-exhaustion.md. Do not commit the user's incident JSON or raw database export.

Validation: exact incident-source progress/controller replay; daily-session plus relevant Learn/scheduler tests; changed-source ESLint; production build. Record existing failures separately.

Status: REVIEW. See report for all results, limitations, and follow-up choices. Publish the isolated branch if available; otherwise preserve the local commit and patch for handoff.

## Follow-up scope explicitly requested by the user

Continue all unfinished daily words through the normal Continue action; do not require five-more. When short retry spacing is insufficient, interleave weaker previously learned words or introduce new words dynamically. Preserve lifecycle exclusions, admission evidence and real spacing. Keep the same isolated branch; no product/main integration or master/etest deployment.

Acceptance: an exhausted legacy five-word boundary must not stop the daily plan; weak/new interleaving must permit eventual completion and survive reload; practice must not emit scheduler ratings or enlarge the frozen target; completed-day five-more remains available. Required checks include domain/controller tests, real Chromium + IndexedDB keyboard journeys and production build. Add the new regression tests to maintained CI. Follow-up report: interactive/reports/INCIDENT-20261017-continue-plan.md.
