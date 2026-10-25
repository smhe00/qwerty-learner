# Mobile UI clarity — 2026-10-25

Status: DONE, product/main only. Base a782fb0e46c361bff1eca5ffaef2aee15fe8d18a; implementation fa3b07a2f3f6d7f59ee0a0a2b3039c2e012bc11f.

Owner requests concise mobile login/account UI, no public SMHE/administrator account explanations and no engineering language in ordinary flows. This independent presentation task preserves interactive/CURRENT_TASK.md and the blocked idle-activation task/report. No etest/master promotion, production accounts or idle-policy activation.

## Changes

- Removed public SMHE reserved-administrator paragraph and the duplicate unconditional retention paragraph from login. Kept server-side reserved-name/password/administrator rules intact; mapped their errors to ordinary user wording.
- Removed the English eyebrow and repeated ownership/safety prose. Short login description; compact spacing with the login button visible at360x640 and390x844. Registration switches the actual heading/description, not only the selected tab. Registration-only recovery disclosure remains visible; the conditional180-day policy is expandable and no longer falsely promises that currently disabled maintenance is running.
- Re-login and password-edit panels are mutually exclusive. Native validation, confirmation, auth calls, same-account checks, single-writer lease, recovery and data migration behavior are retained. Shortened transition/logout wording; the meaningful no-merge and unsynced-local-record consequences are still disclosed at confirmation.
- Account overview has one short status rather than repeated explanations. Disabled idle-policy implementation state is not printed to ordinary users. Enabled policy is expandable; administrator tools remain server-access-gated and collapsed until requested. No permission or maintenance action logic changed.
- Mobile sync exposes the account and primary action, with advanced options expanded on demand. Kept read-only metadata requests, disabled-state checks, original full-document tool routes and existing block-sync preference behavior. Replaced Block/S1/workspace/Revision jargon with ordinary wording. API responses and revision checks are unchanged.
- Backup success and validation messages omit table/session/settings counts. Restore still explicitly warns that it replaces records and does not merge. Raw backup/cloud error text is not shown; safe failure codes use the existing developer trace when enabled.
- History uses “练过的词” and collapses statistical definitions/partial legacy-record explanations. Filters, counts and original rows are unchanged. Mobile footer uses the existing brand wording.

## Validation

18 distinct targeted local browser cases PASS:
- Shared/mobile account8/8: login/register native validation, password visibility, login/logout isolation, desktop+phone password updates preserving records, responsive clean login/register and exclusive editors.
- Mobile history/backup/cloud3/3: all six tables and dictionary preserved; exact exported archive remains complete; invalid backup does not import/write; metadata is one GET; manual sync retains its guarded route.
- Normal-user/admin visibility2/2: no administrator controls for ordinary users; preview/confirmation still gate simulated cleanup and local learning stays intact.
- Shared data-cloud visibility5/5: anonymous, owner, logout, expiry and foreign-account cases preserve control boundaries and local backups.

Existing login-event-warning contracts9/9 PASS: no duplicate sync pipeline, legacy/invalid/contradictory histories retain safety, private uncertainty stays in diagnostics. Scoped source ESLint PASS; build PASS. The last3 mobile layout/editor cases were rerun after correcting the registration heading and a callback typing/lint issue;3/3 PASS. Light360px login and dark390px register screenshots visually reviewed, plus no horizontal overflow and visible primary login button checks. Chromium emulation, not physical phone certification.

A pre-existing shared desktop test used the obsolete “数据设置” tab name and timed out before reaching our UI. Stopped the remaining invalid batch, corrected it to actual “数据与备份”, and all5 existing safety cases passed. No assertion or permission boundary was removed to make it pass. Static text selectors were updated for intentional visible wording/expanded options. No cloud or full end-to-end regression was repeated.

Local screenshots: test-results/mobile-ui-clarity-*/ and .diagnostic/ui-clarity-final/; test artifacts/logs remain untracked. Existing .diagnostic/.mutation-audit/login-sync logs were not committed. Final task/report are pushed to main for review; this request does not release a production version.
