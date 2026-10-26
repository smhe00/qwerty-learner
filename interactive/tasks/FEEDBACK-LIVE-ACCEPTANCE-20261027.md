# Feedback real-site acceptance
Status: PARTIAL — waiting for manual administrator login. Executor: Codex-feedback.
Development checkout base: 157350ae. Independent of Circle CURRENT_TASK.

Owner explicitly requested real etest UI verification for anonymous and authenticated feedback: submit, administrator view/reply/status change, then submitter sees reply. Use isolated browser contexts, marked synthetic feedback and a disposable ordinary account. No API mocks, auth seeding, production operations or test-gate bypass. Keep one exact deployed candidate per complete run. Do not extract administrator credentials from code/environment: approval review rejected that method; owner must sign in manually.

Report: interactive/reports/FEEDBACK-LIVE-ACCEPTANCE-20261027-report.md. Current candidate 7f5dd39045bde7229fd0bcb78e38941e68f5784a. User has been shown how to set server ADMIN_PASSWORD in the etest EdgeOne project and redeploy, then log in as smhe. Await manual login before administrative actions. No etest/master promotion by this task.
