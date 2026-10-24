# Follow-up: content-driven header wrapping (2026-10-24)

Request: a wide-screen two-row menu retained horizontal whitespace and moved below the brand too early on window shrink.
Base: 1d1237a5e628edf94319d109a076ee33dbe94943, product/main.

Root cause: prior fix only applied below xl; xl still used a flex nav that retained unused line width. Header container widths also stepped down at breakpoints and the menu was forced below at xl.

Change: replace stepped header container with a fluid, capped width. Observe intrinsic control-group, brand, account and header widths. Select one menu row, compact two rows beside brand, or compact menu below brand using actual available width and existing gaps/padding. Resize in either direction, font changes and dictionary/account label width changes are observed. Cleanup disconnects observation. Generic one-button Header remains supported. All event handlers and data/account/sync logic are unchanged. Independent mobile task pointer preserved; no release authority inferred.

Validation:
- Focused Typing/Learn wrapping tests PASS 2/2 over 22 resize steps including 1281/1280/1279 and reverse enlargement. Assertions cover compactness at every two-row width, staying beside the brand whenever space permits, no overlaps, centered rows, grouped controls and no page overflow; mobile route at 700 retained.
- Brand separation and active-mode light/dark check PASS. Final combined run: 3/3 PASS.
- The brand check initially timed out before reaching layout assertions while the homepage hydrated (~7.5s). It now uses the same 25s root-route budget as the existing homepage test, retaining all assertions.
- Header ESLint PASS with zero warnings/errors; changed production files Prettier PASS; git diff --check PASS.
- Full tsc --noEmit was additionally attempted and FAILED with errors in other modules (target/downlevelIteration and pre-existing-shape issues in dev, sync, learn and utils). No Header diagnostic appeared; this report does not claim full-project typecheck success. No unrelated type/config changes made.
- Visually inspected full-header screenshots at 1594 (single row) and 1279 (compact two-row beside brand/account). Local ignored screenshots: test-results/focus-ui/learn-header-{1594,1279}.png.

Development only. No etest/master promotion, production account writes, or sync behavior changes.