# Login V4 staging checkpoint

IN_PROGRESS. Baseline a2dc907c; PR #32 head at intake 84ebb034.
User explicitly requires product/main merge before edgeone-test promotion. Master remains untouched.

Confirmed source gap: production login invokes M3/M4 without full V4 S2 preflight; legacy WordRecords can block M3 before network publication; current login hides most sync failures. PR connects guarded S2 and repairs lossless legacy export audit. This continuation aligns the S2 build flag, avoids DB module initialization for disabled admission, corrects reauth result wording and adds focused plus live historical coverage.

Validation and deployment evidence pending.

Local pre-startup-extension validation: build PASS; related contracts 92/92; full S1 browser 116/117 with one ERR_ABORTED test navigation at workspace-v4-session-revoked.spec.ts:118 (retained, focused rerun pending). Whole-repo lint: 0 errors/129 warnings. TypeScript baseline and candidate both 144 diagnostics, 0 introduced. Added ordinary-startup guarded S2 after owner steering; final candidate validation pending.

Focused rerun reproduced ERR_ABORTED: the test started its readback-harness navigation 82 ms after submitting reauth, after token storage but before async full-V4 admission and account location.replace finished. Added a strict wait for root URL and real app readiness before readback; all ownership/pending/record/token assertions retained.
