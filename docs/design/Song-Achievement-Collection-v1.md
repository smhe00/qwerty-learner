> **ARCHIVED / 被新架构替代（2026-10-16）**：以下是第一代 SVG/CSS 技术原型记录。图片优先正式视觉方案、未解锁云雾、亮暗双主题 Focus 入境、原始需求与目标图，请以 [成就雅集视觉文档集](./achievement-song-collection/README.md) 为准。当前原型可通过研究分支独立 Pages 预览，但并未达到目标图的视觉质量。

# QWERTY Plus · 宋韵成就雅集（独立研究分支）

> Scope: \`design/achievement-song-aesthetic-20261016\`. Base: \`product/main\` @ \`7a4f37e2611e1b091fc9813e195a17d60ea09884\`.
> This document is a visualization contract, not permission to merge or deploy to \`product/main\`, \`edgeone-test\` or \`master\`.

## 1. Design intent

Make achievement unlocking feel like collecting an individually engraved artifact instead of receiving another disposable gamification badge. Preserve a clean, usable modern interface and the existing Focus UI shell. Do **not** paste the concept image into the background of the app: it is a direction reference, not a responsive design asset or source of truth.

In the concept image, example titles/counts are illustrative; runtime MUST read the repository's actual achievement definitions, state records, culture bindings and rollout flags.

## 2. Tokens and rarity adapter

| Material | Color | Existing source rarity | UI treatment |
|---|---|---|---|
| 素笺墨印 | Paper \`#F7F4ED\`, ink \`#2C2A29\` | common | ink linework + quiet rubbing |
| 汝窑天青 | Celadon \`#7A9A95\` | rare | subdued celadon glaze, clean line icons |
| 泥金朱砂 | Gold \`#C59B27\`, cinnabar \`#B83B2B\` | epic and legendary | gold detail and real Zhu seal; legendary retains a separate detailed treatment |

The existing rarity enum remains \`common/rare/epic/legendary\`; the new **three visual materials are only a presentation projection**, not a data migration. Hidden achievements are a separate dimension. Locked hidden achievements must not leak their titles or images.

## 3. Component contract

- \`src/pages/Achievements/SongArtwork.tsx\`: first-pass hand-built inline SVG icon families, responsive and inexpensive. No network image dependency, no PNG text baked into cards.
- \`src/pages/Achievements/song-achievement.css\`: isolated styles, tokens, borders, paper textures, responsive rules, motion curves and reduced-motion path. Does not recolor global Focus UI.
- \`src/pages/Achievements/index.tsx\`: live \`getAchievementStates()\` and \`buildAchievementVisibleProgress()\`; untouched \`achievementDefinitions\` P0 filter; gallery filters, date inscription, in-place culture-card modal and a separate **clearly labeled visual-only** scroll/stamp demo.
- \`src/achievement/*\` and \`src/resources/achievementCulture/*.json\` must remain unchanged in the visual P0. All unlocking is still driven by event/evidence rules.

The first-pass SVG seals use two display characters and an artistic serif/Kaiti fallback. They are not yet true hand-designed seal-script engraving. Production art quality requires curated unique vector seals, consistent stroke geometry and manual glyph vetting for every achievement; reuse shared master silhouettes (方印、长方印、葫芦印) with per-ID glyph outlines. Do not claim otherwise.

## 4. Animation sequence

In the preview modal:
1. scroll page opens with a perspective scale/unfurl (~620 ms);
2. seal descends, lands, rebounds minimally (~500 ms; delayed 650 ms);
3. title, user culture quote and inscription remain static and readable.

CSS-only animations are used for this research sample to avoid new runtime dependencies. Use \`prefers-reduced-motion\` to disable both entirely. Only the real unlock event should show a newly-earned celebration in production; historical cards show the collector/culture view.

## 5. Next implementation gates

### Gate A — visual reference and navigation
- Desktop 1440, 1280, mobile 390 and 320 viewport; no horizontal clipping.
- Light and dark global modes, modal overlay, Focus navigation and keyboard capture.
- Empty account, locked card, unlocked card, hidden item, all filters, progress bars.
- Real unlock dates are read from \`AchievementStateRecord.unlockedAt\` (epoch seconds).
- Gallery demo MUST NOT call \`markAchievementSeen\`, achievement evaluator or create award events.
- Compare pixel samples with reference image. Tweak visual density without compromising legibility or load speed.

### Gate B — semantics and real unlock ceremony
- Audit \`getUnseenAchievementStates\`, session award queue and \`resolveAchievementCeremonyPresentation\` existing pathways.
- Derive ceremony intensity from \`presentation.ceremony\`, not only color tier.
- Integrate animation *after* durable unlock is recorded; honor once-only semantics and seen-state acknowledgement.
- Avoid stealing keyboard events from Learn; protect ESC “不会” and typing focus.
- Test refresh/restart mid-animation, multi-tab, duplicate awards and pending-award recovery. UI must not grant an achievement.
- No change to award pacing or difficulty criteria in this visual branch.

### Gate C — hand-crafted vectors + release qualification
- Vet per-achievement motifs against historical Song decorative references; remove inappropriate chronology/false provenance.
- Replace generic first-pass SVGs with ~19 curated P0 assets. Verify title readability and anti-counterfeit differentiated rarity.
- Audit performance: no heavyweight image downloads, font blocking, continuous animations or layout shifts.
- Run \`npm run validate:achievement-culture\`, TypeScript check, build, E2E, and check that existing cloud/learn gates are unaffected.
- Require explicit user review before promotion; do not auto-merge or trigger Maker builds.

## 6. Current state

Research sample implemented on this branch: live gallery skin, artwork/visual seal, locked ghost, date inscription, filters and an isolated '演示 · 展卷钤印' modal. **No proof of runtime build/E2E is claimed until those checks actually run.** The modal demonstrates graphics; it is not yet attached to the live unlock queue.


## 7. Research-branch implementation checkpoint (2026-10-16)

- Branch created from product/main at \`7a4f37e2611e1b091fc9813e195a17d60ea09884\`.
- Implemented SVG artwork families and presentation seals, styled live achievement gallery, rarity/locked/date projection, filters and a visual-only reveal animation.
- Branch-local no-deploy GitHub Action: \`.github/workflows/song-achievement-preview-gate.yml\`.
- CI run \`38862203806\` succeeded: install, achievement-culture validation, UI ESLint, scoped Achievement UI TypeScript diagnostic audit and Vite build.
- Full repository \`tsc --noEmit\` is not green due to many diagnostics in modules outside \`src/pages/Achievements\`; the scoped UI audit warns rather than hiding them. This is not a claim that full-project typecheck passed.
- Not yet done: live unlock-queue ceremony integration, curated unique per-achievement glyph outlines, browser screenshot comparison, Playwright cross-viewport and release gates.
- No push to \`product/main\`, \`edgeone-test\`, \`gh-pages\`, or \`master\`, and no Maker preview deployment.
