# Achievement P0 Product Closure Audit

> Branch: `product/main`
>
> Scope: 19 P0 achievements
>
> Status: runtime coverage complete; CI formal gate requires 19/19 supported metrics.

## Closure criteria

A P0 achievement is considered product-closed only when all of the following are true:

1. the metric has an explicit evaluator registry;
2. a live Learn event can trigger evaluation;
3. unlock is persisted exactly once in `achievementStates`;
4. the source event is persisted in `achievementEvents`;
5. the unlock can surface in Learn settlement;
6. the achievement is visible in the Achievement Gallery after unlock;
7. backup/export restores achievement events and states;
8. cloud snapshot fingerprint/count includes achievement tables;
9. imported historical records do not retroactively mint live achievements.

## P0 runtime coverage

| ID | Achievement | Metric | Ceremony | Runtime |
| --- | --- | --- | --- | --- |
| ACH_FIRST_DECODE | 初次破译 | `first_independent_word_correct` | quiet | ✅ |
| ACH_NO_HINT_10 | 自胜 | `consecutive_independent_correct_no_hint` | settlement | ✅ |
| ACH_WARMING_UP | 渐入佳境 | `session_second_half_accuracy_gain_pp` | quiet | ✅ |
| ACH_RECOVER_1 | 失而复得 | `prior_failed_word_independent_correct` | quiet | ✅ |
| ACH_RECOVER_3 | 扳回一局 | `word_independent_correct_after_prior_failures` | settlement | ✅ |
| ACH_ERROR_POSITION_FIXED | 毫厘得正 | `repeated_error_position_resolved` | settlement | ✅ |
| ACH_7_DAY | 七日回响 | `independent_recall_after_days` | settlement | ✅ |
| ACH_TRUE_MEMORY | 真正记住了 | `word_success_across_increasing_intervals` | spotlight | ✅ |
| ACH_AUDIO_10 | 听声成词 | `audio_only_independent_correct_count` | settlement | ✅ |
| ACH_DAILY_GOAL | 今日笃行 | `first_recommended_learn_goal_completed` | quiet | ✅ |
| ACH_CONTINUE | 再启一程 | `voluntary_continue_after_session` | quiet | ✅ |
| ACH_FAILURE_RECOVERY_SESSION | 重整旗鼓 | `recover_after_consecutive_errors` | settlement | ✅ |
| ACH_NEW_UNIT | 新境初开 | `new_unit_learn_started` | quiet | ✅ |
| ACH_CHAPTER_80 | 一章既成 | `chapter_long_term_mastery_ratio` | settlement | ✅ |
| ACH_MASTERED_100 | 百词基石 | `long_term_mastered_word_count` | settlement | ✅ |
| ACH_7_OF_10 | 十日七行 | `active_learn_days_in_window` | settlement | ✅ |
| ACH_HINT_REDUCTION | 提示退潮 | `hint_use_rate_drop_pp_vs_previous_window` | settlement | ✅ |
| ACH_HIDDEN_DAWN | 柳暗花明 | `same_session_fail_then_independent_recovery` | spotlight | ✅ |
| ACH_HIDDEN_CRAFT | 如琢如磨 | `same_word_distinct_error_positions_resolved` | spotlight | ✅ |

Total: **19/19 P0 metrics registered**.

The formal model test now treats any unsupported P0 metric as a CI failure.

## Unit/chapter normalization

Two P0 metrics require authoritative dictionary-unit membership:

- `new_unit_learn_started`
- `chapter_long_term_mastery_ratio`

Qwerty Plus restores Unit membership from the original ordered dictionary resource using:

```text
unitIndex = floor(originalDictionaryIndex / CHAPTER_LENGTH)
CHAPTER_LENGTH = 20
```

Important invariants:

- Unit boundaries use the original dictionary index, not a deduplicated list.
- Learn still owns one long-term memory per exact word name.
- Repeated word names are assigned to their first original occurrence for Achievement identity.
- Unit evaluation is an Achievement sidecar only; it does not alter Learn scheduling.
- Manual exclusions are removed from chapter-mastery denominator.
- Long-term mastery reuses the authoritative Learn `isLongTermMastered()` contract.

## Persistence and sync

Dexie v5 contains:

- `achievementEvents`
- `achievementStates`

Both tables are included automatically by database export/import.

Backup restore explicitly detects missing legacy achievement tables and clears local stale rows when the imported backup did not contain them.

Cloud snapshot logic includes both tables in:

- record count;
- exported logical database data;
- fingerprint calculation.

Therefore achievement state follows the same backup/cloud snapshot as Learn data.

## UI closure

P0 unlocks have two surfaces:

### Learn settlement

Unseen achievements are shown at session settlement.

Presentation follows the declared ceremony contract:

- `quiet` → compact
- `settlement` → standard
- `spotlight` → emphasized cross-column
- `ceremony` → highest emphasis

Leaving the settlement marks presented achievements as seen.

### Achievement Gallery

Global Trophy entry is available from the shared Typing/Learn Switcher.

The Gallery provides:

- locked/unlocked state;
- hidden achievement identity protection;
- culture-card view;
- culture-card seen timestamp;
- exact progress only for achievements whose contract says `progress=visible`.

Current exact visible P0 progress:

- 百词基石 — long-term mastered words / 100
- 十日七行 — active Learn days in the last 10 days / 7

Behavior achievements remain `near_only`; hidden achievements expose no progress.

## Anti-gaming and isolation

Achievement processing is additive and live-only.

It does not mutate:

- Review interval;
- queue priority;
- memory state;
- Cold Probe policy;
- Hint policy;
- Typing behavior.

Imported/restored history may provide evidence to a later live event, but import itself does not mint achievements.

## Remaining work after P0 closure

P0 does not require more achievement definitions.

Next work should be product polish and observation:

1. evaluate unlock frequency using real usage;
2. tune ceremony density if settlement becomes noisy;
3. add near-completion surfacing only where it does not reveal hidden conditions;
4. prepare badge/culture illustration assets;
5. decide when P1 achievements are promoted to runtime rollout.
