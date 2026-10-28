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
