# Landscape tablet touch entry — complete

Date: 2026-10-28 (Asia/Shanghai).
Executor: Codex-tablet-touch. Target: product/main.
Execution base: 9e8d5037c68009a5d1a462e6ebbfd9b6e445ae17.
Integrated upstream: a25eb51d3a21320a73a1bc502af95cf0fbcbfc81.
Implementation and evidence travel together in this commit; use the commit
containing this report for the final SHA. No master/etest promotion performed.

## Root cause and change

`src/app.tsx` previously selected the phone surface only at widths <=700 CSS px.
Landscape tablets above that width therefore entered keyboard-first Learn.
It also navigated /mobile to /learn when a resize crossed the desktop boundary.

Use narrow width OR a coarse primary pointer without hover to select the touch
surface. Do not infer keyboard hardware from this signal, sniff a UA, or route
all touchscreen laptops into mobile solely because they expose touch points.
Observe pointer/hover media-query changes as well as resize, cleaning up the
listeners on unmount. Pin the explicit /mobile menu just like its study/settings
routes so rotating/unfolding or attaching a pointer retains the touch choice.
The existing Learn controller and all auth/workspace/storage code are reused.

## Validation

Local Chromium 120 / Playwright 1.40.1 (repository lockfile test version), real
browser touch emulation with a desktop UA and `isMobile:false`:

- `playwright test --config=tests/e2e/mobile-p0.config.ts tablet-touch.spec.ts
  --project=chromium --retries=0`: **5/5 passed**.
  - 1024x768 and 1366x1024: root opens touch home; tap-only exposure completes
    and advances to another word with no input/textarea and no horizontal overflow.
  - Active answered card survives 390x844 -> 1366x768 -> 768x1024: same DOM node,
    current word, feedback, full reviewModeInfo checkpoint, and visible action zone.
  - Mouse-first 1280x800 retains /learn and explicit /typing.
  - Explicit /mobile remains available through narrow-to-wide resize and reload.
- Existing `Mobile tap targets`, `Mobile pause freezes`, and `home previews
  canonical` tests: **3/3 passed**; no keyboard opens on pause/resume.
- `npm run build`: **passed**, including physical SPA route emission.
- `eslint src/app.tsx`: **passed**.
- `prettier --check src/app.tsx tests/e2e/tablet-touch.spec.ts`: **passed**.
- `git diff --check`: **passed**.
- `tsc --noEmit`: **not a whole-repository pass**; diagnostics elsewhere in the
  repository (including ES5 iterator target errors). **No src/app.tsx diagnostics**.

The tablet regression is included in the existing Mobile P0 Gate test match and
path triggers. No gate weakening or skips. Upstream integration changed feedback
colors and unrelated tests/docs, with no conflicts in this task's files.

## Limits and next action

These are Chromium emulation results, not Huawei/iPad physical-device acceptance.
Input media queries select a safe default, not a definitive keyboard detector.
No separate tablet visual redesign, native HarmonyOS app, or synchronization
behavior change is included. Existing production users can explicitly open
https://q.smhe.cn/mobile as a temporary touch entry before this fix is released.
Master release still follows the owner's exact-SHA staging qualification policy.
CURRENT_TASK.md and the Circle executor's task were left untouched.
