# Achievement + Culture Library

## Purpose

This library is the content foundation for the Learn achievement system.

The design intentionally separates four concerns:

1. **Learn engine** — owns learning, review scheduling and memory-state transitions.
2. **Achievement evaluator** — consumes normalized Learn events/metrics.
3. **Achievement definitions** — declarative conditions, names, rarity, copy and culture bindings.
4. **Culture library** — reusable Chinese poetry, classics, historical material and cultural imagery.

Removing the achievement feature must not change Typing or Learn scheduling behavior.

## Current content

- 12 spirit themes
- 34 achievement definitions
- 85 culture entries
- 5 hidden achievements
- culture entries are deliberately more numerous than achievements so a badge can later rotate or collect related culture cards

## Spirit themes

初见 / 笃行 / 逆转 / 温故 / 自胜 / 精进 / 坚韧 / 远志 / 专注 / 求知 / 琢磨 / 勇毅

The spirit theme is the semantic join key between a learning behavior and cultural material. It is more important than literal keyword matching.

Example:

- Learn behavior: repeated failures, later independent recall
- spirit themes: recovery + resilience
- achievement: 失而复得
- primary culture: 陆游《游山西村》“山重水复疑无路，柳暗花明又一村。”

## Files

```text
src/resources/achievementCulture/
  types.ts
  themes.json
  achievements.json
  culture-classics-1.json
  culture-classics-2.json
  culture-stories.json
  index.ts

scripts/
  validate-achievement-culture.mjs
```

Run:

```bash
node scripts/validate-achievement-culture.mjs
```

## Shanghai / Zhongkao content policy

The library may tag material as highly relevant to junior-middle-school Chinese learning, but it must **not** label an item “Shanghai Zhongkao required” merely because it is a famous text or commonly taught text.

`curriculum.shanghaiExamClaim` defaults to `not_claimed`.

A future value such as `verified_for_specific_year` should only be used after a date-specific curriculum/exam-material review.

This conservative rule matches Shanghai's public exam guidance: the junior-high academic proficiency examination is bounded by curriculum standards, and recent Chinese-exam commentaries emphasize classical texts, excellent traditional Chinese culture, language use and core literacy rather than a permanent unofficial “must-test quote list”.

Useful official references for future content review:

- Shanghai Municipal Education Commission, junior-high academic proficiency examination implementation guidance:
  https://edu.sh.gov.cn/xxgk2_zdgz_rxgkyzs/20230412/ec0b8612c5c14970ad0260593696af43.html
- Shanghai Municipal Educational Examinations Authority, 2025 Chinese exam commentary:
  https://www.shmeea.edu.cn/page/03500/20250615/19510.html
- Shanghai Municipal Educational Examinations Authority, 2024 Chinese exam commentary:
  https://www.shmeea.edu.cn/page/03500/20240615/18570.html

## Runtime contract

Achievement definitions use declarative metric names such as:

- `first_independent_word_correct`
- `consecutive_independent_correct_no_hint`
- `prior_failed_word_independent_correct`
- `independent_recall_after_days`
- `recover_after_consecutive_errors`
- `cold_probe_accuracy_gain_pp_vs_previous_window`

These are **contracts**, not permission for the achievement layer to mutate Learn state.

The evaluator may read normalized events and history. It must not change:

- review intervals
- queue priority
- memory state
- Cold Probe logic
- Hint policy
- Typing behavior

## Anti-gaming principle

Never reward failure itself.

Bad:

```text
fail 3 times -> achievement
```

Good:

```text
historical failures >= 3
AND later independent success
-> recovery achievement
```

This is especially important for adolescents: the system should reinterpret difficulty as evidence of later growth without encouraging intentional mistakes.

## Art direction

Every achievement and culture entry already contains art metadata.

The future asset pipeline can create two visual layers:

1. **Badge** — compact symbolic object, recognizable at small size.
2. **Culture card illustration** — larger scene used when an achievement is opened.

Art should be refined rather than childish. Avoid embedding generated text inside illustrations; render titles and quotations with UI typography so Chinese characters remain accurate.

Suggested visual language:

- seal / jade / bamboo / mountain path / river / sail / lamp / book / cloud stair / ripples
- restrained Chinese aesthetic mixed with a modern learning-product interface
- collectible but not casino-like
- rare/epic/legendary should differ in composition and detail, not only by loud color

## Next integration stage

P0 runtime integration should add a small event-normalization layer and an evaluator.

Recommended first events:

- `word_attempt`
- `cold_probe_completed`
- `hint_used`
- `word_recovered`
- `session_started`
- `session_completed`
- `session_abandoned`

The achievement system should first ship with a limited visible subset even though the database is larger. This permits tuning unlock frequency before exposing the full collection.
