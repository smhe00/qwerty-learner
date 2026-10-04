# Achievement + Culture Library — V2 Polish Audit

## Verdict

V2 is ready to serve as the content/specification baseline for runtime implementation.

The main change is not cosmetic. The system now treats achievements as **evidence of capability change**, with recovery, independence and durable memory ranked above raw volume or perfect performance.

## Current scale

- 12 spirit themes
- 27 executable metric contracts
- 34 permanent achievements
- 5 hidden achievements
- 89 culture entries
- 51 culture entries tagged high-relevance for junior-middle cultural/literacy use
- P0 / P1 / P2 rollout = 19 / 11 / 4
- rarity distribution = 7 common / 15 rare / 8 epic / 4 legendary

## Major design corrections

### 1. Hidden is no longer a rarity

Old:

```text
rarity = hidden
```

V2:

```text
hidden = true
rarity = rare | epic | legendary
```

Examples:

- 柳暗花明 — hidden + epic
- 长风 — hidden + legendary

This allows the collection system to express both secrecy and value independently.

### 2. Permanent achievements unlock once

`unlockPolicy = once` for every collection achievement.

Daily repeated encouragement must eventually use a separate journey-mark/stamp system. This prevents “今日笃行” from becoming a badge farm.

### 3. First-try success no longer praises innate talent

`一遍即会` was renamed **厚积初见**.

Its cultural anchor changed to 苏轼“厚积薄发”, and the copy now frames easy-looking success as evidence of prior accumulation rather than fixed ability.

### 4. Recovery has higher motivational priority

The system intentionally gives strong identity and art to:

- 失而复得
- 扳回一局
- 百炼
- 重整旗鼓
- 柳暗花明
- 老对手

The target learner should experience:

```text
failure -> evidence of a future comeback
```

not:

```text
failure -> proof that I am bad at vocabulary
```

### 5. Fine-grained correction is now culturally coherent

`一字既正` -> **毫厘得正**

Primary culture:

> 天下难事，必作于易；天下大事，必作于细。

Alternate:

> 人谁无过？过而能改，善莫大焉。

The achievement rewards identifying and repairing a repeated error position, not blindly repeating the whole word.

### 6. Long-memory series now has a stronger cultural arc

- 七日回响 — 温故知新
- 久别重逢 — 似曾相识燕归来
- 岁寒不忘 — 岁寒知松柏
- 长风 [hidden legendary] — 长风破浪

The 90-day badge now uses the “松柏经岁寒” image instead of a generic perseverance quote.

### 7. Audio mastery now uses 《卖油翁》

`耳熟能详` primary culture:

> 我亦无他，惟手熟尔。

This is more directly connected to skill automation than the generic “熟能生巧” label.

### 8. Continue-after-goal is not ordinary continuation

`再启一程` only counts when:

- the recommended goal is already complete;
- the learner explicitly chooses to continue;
- at least one additional Learn attempt actually starts.

Its primary culture is now “百尺竿头，更进一步”.

## Content corrections

- 《韩非子·喻老》 entry changed from the later idiom form to the closer source wording “千丈之堤，以蝼蚁之穴溃。”
- 李商隐《夜雨寄北》 culture-title metadata corrected to “西窗剪烛”.
- 屈原《离骚》 internal ID corrected from an unrelated placeholder ID to `CUL_QUYUAN_001`.
- Added:
  - 《道德经》“天下大事，必作于细”
  - 《论语》“岁寒知松柏”
  - 欧阳修《卖油翁》“惟手熟尔”
  - 《左传》“过而能改”

## Presentation contract

Every achievement now defines:

```text
unlockPolicy
presentation.rollout
presentation.progress
presentation.ceremony
artDirection.symbol
artDirection.scene
artDirection.paletteMood
artDirection.material
```

### Progress

- cumulative milestones: visible exact progress
- behavioral achievements: near-completion only
- hidden achievements: no progress exposure

This supports the desired “interface simple, intelligence behind it” model.

### Ceremony

- common -> quiet
- rare -> settlement
- epic -> spotlight
- legendary -> ceremony

Rarity changes presentation intensity; it does not imply that one kind of learner is “better”.

## P0 launch set

P0 contains 19 achievements:

- 初次破译
- 自胜
- 渐入佳境
- 失而复得
- 扳回一局
- 毫厘得正
- 七日回响
- 真正记住了
- 听声成词
- 今日笃行
- 再启一程
- 重整旗鼓
- 新境初开
- 一章既成
- 百词基石
- 十日七行
- 提示退潮
- 柳暗花明 [hidden]
- 如琢如磨 [hidden]

This gives an early learner multiple ways to win: starting, recovering, improving, remembering, hearing, correcting details and building consistency.

## P1 / P2

P1 adds broader collection depth and harder repeat evidence:

- 厚积初见
- 独立成章
- 百炼
- 久别重逢
- 温故成习
- 耳熟能详
- 五百成林
- 积日成章
- 更上一层
- 跬步成途 [hidden]
- 慎终如始 [hidden]

P2 is deliberately long-horizon:

- 老对手
- 岁寒不忘
- 千词成山
- 长风 [hidden legendary]

## Metric registry

`metrics.json` defines all 27 metrics used by achievements.

Each contract fixes:

- scope
- unit
- semantic definition
- required Learn events
- required state/history
- whether a new observation is required
- anti-gaming boundary

Important examples:

- `independent_recall_after_days`
- `recover_after_consecutive_errors`
- `repeated_error_position_resolved`
- `hint_use_rate_drop_pp_vs_previous_window`
- `word_success_across_increasing_intervals`

This is the boundary that prevents Achievement Engine from reinterpreting Learn memory state.

## Observation impact

The registry confirms the earlier conclusion: we do not need a large telemetry expansion.

The main normalized additions remain:

1. `attemptContext`
2. explicit first-try / independent outcome
3. word-recovered signal
4. session started/completed/abandoned
5. entry source / voluntary continue source

Existing review records, word states, timestamps and error-position history carry most of the rest.

## Shanghai / Zhongkao positioning

For 2026 Shanghai admissions, official policy continues to state that exam setting should be based on curriculum standards, embody subject core competencies, emphasize ability, and assess application of knowledge in concrete contexts.

Therefore:

- culture entries may be tagged for junior-middle relevance;
- no entry is called “Shanghai Zhongkao required” without date-specific verification;
- culture exposure is optimized for language literacy, classical-text familiarity, writing material and cultural understanding.

Official reference:
https://edu.sh.gov.cn/xxgk2_zdgz_rxgkyzs_03/20260227/923fcd6838744ca59c213daa3fb180fd.html

2025 official Chinese-exam commentary is also retained as a useful recent example of the curriculum/competency direction:
https://www.shmeea.edu.cn/page/03500/20250615/19510.html

## Validation

Current branch re-read validation:

```text
themes:       12
metrics:      27
culture:      89
achievements: 34
hidden:        5

errors:   0
warnings: 0
```

## Recommendation

The content layer should now be frozen temporarily.

Next implementation work should focus on:

1. event normalization;
2. metric evaluator;
3. achievement state persistence;
4. session-end unlock presentation;
5. achievement gallery / culture card.

Do not expand to more badges until P0 unlock frequency and student behavior are observed.
