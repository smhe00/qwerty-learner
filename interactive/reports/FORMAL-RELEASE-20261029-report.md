# QWERTY Plus 1.0.0 release qualification

Status: IN_PROGRESS. Owner authorization: “按你的节奏来发布正式版”. Execution base: 14b5a2b10ac0ca330e1c9545eb313aceda276d11. Original master: ad862b392c6a935ca49514fc9df146932aa02ed2. This task is independent of the Circle CURRENT_TASK; no other worktree or shared development history was rewritten.

## Root cause and change

The earlier four failures are closed by subsequent commits. Base 14b5a2b passed historical login 40831896142, three-device offline convergence 40831896082, Cloud/Blob/release-ready 40831896170 and Pages production UI/deployment/regression 40831893059. Its remaining completion test 40831896141 failed identically in both cases at the expected second upload on reload (expected 2, observed 1).

Inspection confirms the new owner-requested startup contract deliberately defers local-only changes when fresh cloud revision/fingerprint matches the baseline. The completion test now asserts upload-deferred, one existing upload, unchanged cloud revision/fingerprint and exact local extra-round preservation. It then invokes the existing explicit full-sync route, retains exactly-two-uploads/revision+1 assertions and requires fresh-profile exact cloud readback. No product sync/learning/kernel change is made to satisfy the test.

Product metadata becomes 1.0.0; current visible Beta wording is replaced while unavailable channels remain unavailable. Historical reports and third-party dictionary labels are preserved.

## Validation checkpoint

- Changed application files: scoped ESLint passed.
- Completion Playwright configuration discovers both cases; no retries or weaker data assertions added.
- Production build passed in 35.31 seconds; emitted physical SPA entries and UI CSS ownership/reset contract passed (Tailwind 3.3.2). Existing bundle-size advisories remain. git diff --check passed.
- Remote exact-SHA qualification, etest promotion and production deployment are pending. This report does not claim release success.

## Remaining boundaries

Physical Huawei/HarmonyOS/iOS devices are unavailable in this environment; no physical-device certification is claimed. Existing 143 TypeScript baseline diagnostics and no measured subsecond startup remain documented. No user record schema, ownership rule, merge identity, storage format or logout trigger is changed in this release task.

Release metadata follow-up: active HTML/social metadata, user guides and the existing branding contract now describe 1.0.0. Pages runs the branding contract before its build. Local branding contract and diff whitespace validation passed. Browser branding cases discover successfully; full painted production UI remains the Pages prerequisite. No external analytics was enabled.
