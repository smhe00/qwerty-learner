# Mobile new-word action visibility — REVIEW

Date: 2026-10-29 (Asia/Shanghai). Executor: Codex-mobile-actions.
Execution base: 40698942f81b2dc2cb0a94b732917b84e5da8ec6.
Source commit: 3c5b7ac283eb87f23140993a546f604eaffce9b4.
Target: product/main. No etest/master promotion.

## Confirmed cause

New-word exposure intentionally waits for the Continue action before saving and advancing. The button existed and accepted taps, but the shipped Tailwind 3.3.2 reset `button,[type=button],[type=reset],[type=submit]` can load after mobile CSS. Its attribute selector ties `.mobile-practice-primary` specificity and overrides the button background to transparent. White text and a transparent border on the light study surface make the whole action appear empty. The existing higher-specificity tablet palette only applies at min-width 900px and aspect ratio 4/3, leaving phones affected.

Read the deployed etest app-5f9ab209.js dependencies: app-a7385d16.css contains the low-specificity primary rule; index-34cd7a14.css contains the competing reset. Local node_modules had Tailwind 3.4.19, whose lower-specificity reset masked this problem in both initial dev and built probes. Restored the local Tailwind package to the repository yarn.lock version 3.3.2 (no dependency/lockfile changes). The original built probe then failed exactly as reported: text rgb(255,255,255), background rgba(0,0,0,0), border rgba(0,0,0,0). Captured and inspected the empty-looking footer screenshot.

## Changes

- Scope the primary rule as `button.mobile-practice-primary` so it outranks the reset regardless of CSS load order; give it an accent border. Existing phone and tablet theme pairs remain intact. This also protects manual-next, audio fallback, spelling confirmation and resume controls sharing the primary class.
- Exposure status now says 看完后继续 rather than 学习中 while awaiting confirmation. Keep the existing 继续学习 button label and all save, evidence, auto-advance and reading-hold semantics.
- Add six production-browser cases covering 320x568, 390x844, 844x390 and 1024x600; light/dark; blocked/pending audio; home navigation and direct refresh. Require opaque background, text contrast >=4.5, >=44px height, full viewport reachability, successful tap progression and exactly one saved attempt. Refresh cases also verify manual-next after reading hold.
- Include the new tests in the existing built touch config and CI path triggers. No gate weakening or workflow skipping.

## Executed validation

- Before fix, built Chromium reproduction with lockfile Tailwind: 1 failed as expected on transparent background assertion.
- After fix, `yarn build`: PASS (production Vite build; existing third-party directive/chunk warnings only).
- `CI=true yarn playwright test --config=tests/e2e/tablet-refresh-built.config.ts`: 17/17 PASS, 27.8s. Six new cases plus eleven existing tablet refresh/audio/rotation/contrast/paused-menu cases.
- Scoped ESLint for MobileWordPractice.tsx and both changed/new test/config TS files: PASS, zero errors/warnings.
- `git diff --check`: PASS.
- Inspected post-fix phone light/dark screenshots; button surfaces and placement are now visible. Container lacks Chinese glyph fonts, so screenshots do not certify Chinese glyph rendering; DOM labels, contrast and interaction assertions passed.
- Refetched product/main before publishing: unchanged at execution base.

## Limits / handoff

Chromium touch emulation only; no physical phone, Huawei, HarmonyOS or Safari run. No cloud behavior changed or real account data used. No full Cloud suite required for CSS and status-copy changes. Etest remains the prior deployed 44ece41 candidate; this development fix requires a separate requested staging promotion. CURRENT_TASK and the Circle executor were left untouched. Source SHA above plus this report commit provide a resumable checkpoint.

## Introduction audit requested by owner (2026-10-29)

Verified both live source markers and remote refs: master ad862b392c6a935ca49514fc9df146932aa02ed2; etest 44ece41c32f5f1f61f0ad6a29c9b4cac5f2a229a. There are 26 intervening commits, including completion UI, tablet/input controls, short meanings and startup optimization. No yarn.lock, package.json or vite.config.ts change between these deployed versions.

The introducing commit is **9017ac2f944760d94f64b878384f5e4d058b8e10**, authored 2026-10-27 23:37:47 +08:00, `fix(ui): preserve Learn completion during sync and copy feedback`. It adds `import '../index.css'` to `src/sync/learn-block-sync-ui.ts` to reuse completion presentation while the application is unmounted during sync. The additional import makes global CSS (including Tailwind reset) a shared lazy chunk, changing stylesheet order throughout the application; the button component need not change to regress.

Live artifact evidence:
- master app-62877a80.js loads app-63128139.css with reset offset 4616 and primary button offset 117172 in the same CSS file: button wins.
- etest app-5f9ab209.js loads app-a7385d16.css containing primary styles and separate index-34cd7a14.css containing the competing reset: the later equal-specificity reset wins on phone buttons.

Built the exact parent 37631f68be481635ab0f4987abae526f67260cfc and exact introducing commit in isolated detached worktrees using the same Tailwind 3.3.2 installation. Chromium 390x844 touch tests seeded the same anonymous exposure fixture, entered from mobile home, resumed the old paused state and measured the footer Continue button:
- Parent: white text, opaque rgb(70,95,176) background, tap advances.
- Introducing commit: white text, rgba(0,0,0,0) background, tap still advances.
Both builds PASS (18.65s and 19.23s Vite); differential browser probe PASS with the expected before/after distinction. Initial probe needed correction for the old version's pause overlay (two Continue controls), with no product source modification.

This predates the tablet work and the recent startup-sync optimization. The tablet-specific cc8edf2 palette later masked the issue only at tablet widths. Earlier functional visibility/click assertions did not check painted contrast; new production checks cover both opaque backgrounds and contrast. This audit changes documentation only; neither staging nor production refs moved.
