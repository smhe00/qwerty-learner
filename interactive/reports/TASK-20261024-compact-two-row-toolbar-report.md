# Compact two-row toolbar — 2026-10-24

Owner request: remove excessive horizontal whitespace when the desktop menu occupies two rows.
Base: 2826c1d09d2a18ca777938976f6aece97983b62a (origin/product/main).

Below the xl breakpoint the full-width flex nav stretched its surface across the header. Use a centered intrinsic-width single-column grid instead, sized to the wider of the existing primary/icon rows. Keep xl flex behavior, existing control sizes, gaps and all handlers. No cloud/account/state changes. The unrelated mobile investigation task pointer is preserved.

Validation: focused focus-ui.spec.ts wrapped-toolbar tests PASS 2/2, covering Typing and Learn at 1920, 1600, 1536, 1440, 1366, 1280, 1100, 1024, 900, 768, 701 and mobile routing at 700. Added compact content-width assertion below xl. Header ESLint PASS; direct Prettier check PASS. Learn screenshot visually checked at 1024; surface hugs both rows with normal padding. Existing >=xl wrapping behavior is retained. No production release.

Screenshots: test-results/focus-ui/{typing,learn}-compact-toolbar.png (local, ignored).
Integrated upstream 7ead6a7c (secure entry/mobile sync changes) without conflicts. Repeated affected browser checks after integration: PASS 2/2.
