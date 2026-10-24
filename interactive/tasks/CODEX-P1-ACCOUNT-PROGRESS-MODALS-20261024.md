# Account, progress and dialog continuity

Explicit owner authorization on 2026-10-24: fix all three bug.txt findings, separate today's completed review tasks from mastery/independent recall, use novice-readable dialogs instead of full-page information, and remove unnecessary document reload/lease acquisition when responsive layout changes or an account panel is opened and closed without action. Main -> etest focused verification -> master is authorized.

Execution base d2306803fd7ee78a53417b71d2655f3dd4e65039. One executor. Existing user-supplied incident is read-only private input and must not be committed. Aggregate replay proved 96 review tasks performed, 67 independent clean passes, 29 remaining for consolidation; 20/20 new words passed. Do not fabricate mastery or change FSRS, record history, single-session policy, journal/rollback or full-V4 validation. Real identity changes and sync restore must remain pre-mount under the exclusive writer lease.

Validation: focused daily completion/evidence, revoked account reauth, no-op account dialog and responsive document continuity, themed sync-dialog browser checks. Reuse existing release gates and one targeted etest scenario with synthetic accounts, verified cleanup. Do not duplicate full local/cloud suites. Production confirmation is read-only source/health. Report exact outcomes and retained limitations.
