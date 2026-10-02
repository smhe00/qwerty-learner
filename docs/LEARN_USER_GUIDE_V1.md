# Learn V1 使用指南

> 当前版本：Typing / Learn V1 + P3 Adaptive Acquisition Quota
>
> Learn 的长期目标架构见 `LEARN_ARCHITECTURE_V1.md`。

## 1. 两种模式

Qwerty Plus 现在明确分为：

```text
Typing
Learn
```

### Typing

Typing 保持原 Qwerty Learner 的章节打字练习逻辑。

可以继续使用：

- 章节；
- 发音；
- 音标；
- 默写；
- 循环；
- 释义；
- Skip；
- 原有打字训练设置。

Typing 产生的记录可以作为历史证据，但 Typing 不直接改变长期记忆调度。

### Learn

Learn 管理长期记忆。

当前阶段已经承接原有的长期 Review 状态，包括：

- 到期学习；
- canonical cold probe；
- Hint 0/1/2/3；
- Again/Hard/Good/Easy 证据体系；
- bounded reinforcement；
- 手工移出/恢复学习计划。

词库中的新词会逐批进入长期记忆系统；Typing 历史不会自动把词加入 Learn。

---

## 2. 如何切换模式

顶部始终显示：

```text
[ Typing | Learn ]
```

这是一级模式切换，不再隐藏在 Start 菜单中。

Start / Pause 只负责开始或暂停当前输入。

云备份和数据操作继续放在“设置 → 数据”中。

## 2.1 Learn 词库选择

Learn 的词库选择直接复用 Typing 的词库 Gallery 界面：

```text
Learn
→ 点击当前词库名
→ 进入与 Typing 相同的词库 Gallery
→ 点击词库卡片
→ 直接返回 Learn
```

Learn 只选择“词库”，不会进入 Typing 的第二级章节选择。

---

---

## 3. Learn 首页

Learn 首页第一行与 Typing 保持同一布局骨架：

- 词库名位置一致；
- Start / Continue 位置一致；
- 设置位置一致；
- Typing 与 Learn 使用统一的 indigo 交互色系；模式身份由标签和状态表达；
- 第一行以下暂时留空，后续再决定长期状态信息如何呈现。

新词 Acquisition V2：

```text
无 due Review
→ P3 计算今日剩余新词额度
→ 从词库中按顺序选择最多 allowedNow 个 UNSEEN 词
→ Cold Probe：只显示释义，隐藏拼写/音标，不自动发音
→ 会：直接正确输入
→ 不会/持续拼错：Hint 0 → 1 → 2 → 3
→ 完成后 ACTIVE
→ nextReviewAt = +1 day
```

第一次 cold probe 属于 Learn admission probe；当前仍不把它伪装成长期
Again / Hard / Good / Easy 调度事件，因此不会增加 reviewCount / lapseCount。

### P3 每日新词额度

新词不再固定为“每次最多 20 个”。系统根据近期记忆质量给出每日目标：

```text
记忆压力高    → 5 个/天
中等          → 10 个/天
稳定/样本不足 → 20 个/天
```

主要反馈信号是：

- 当前 Due：只要还有到期 Review，就先复习，不新增；
- 最近 30 天 Again 比例；
- 今天有效 Cold Probe 一次通过率。

Cold Probe 至少有 5 个有效样本才参与当天调速；Rating Gate 判定无效的
尝试不会被当作“通过”。

每日额度是总量。例如今日目标 10 个、已经学了 7 个，再次进入 Learn
最多只会再加入 3 个新词，而不是重新获得 10 个额度。

---

## 4. 移出学习计划

如果某个词明显不需要继续长期记忆，可以选择：

```text
移出学习计划
```

入口有两个：

1. Learn 首页 → 学习计划 → 学习中；
2. Learn session 当前单词右侧 `⋯` 菜单。

执行后：

```text
ACTIVE → EXCLUDED
```

系统会：

- 停止该词后续 Learn 调度；
- 从未完成 Learn 队列中移除该词及其重复 reinforcement；
- 保留所有历史 WordRecord；
- 保留 scheduler 历史；
- 保留错误、Hint、telemetry 等证据。

“已移出”不等于“已经 mastered”。

---

## 5. 恢复学习

进入：

```text
Learn
→ 学习计划
→ 已移出
```

点击：

```text
恢复学习
```

后：

```text
EXCLUDED → ACTIVE
nextReviewAt = now
```

历史 scheduler 状态不会清空。

下一次 Learn 会重新通过真实 memory probe 判断当前记忆情况。

---

## 6. Typing 不会把已移出词重新加回来

如果一个词已经：

```text
lifecycle = EXCLUDED
```

用户仍然可以在 Typing 中正常打这个词。

但是：

```text
Typing clean
Typing error
Typing repeat
```

都不会执行：

```text
EXCLUDED → ACTIVE
```

只有 Learn 中明确执行“恢复学习”才能重新进入长期学习计划。

---

## 7. Learn 中为什么没有普通 Skip

Learn 与 Typing 的语义不同。

如果是：

> 我想不起来。

使用：

```text
Space
→ Hint 0
→ Hint 1
→ Hint 2
→ Hint 3
```

如果是：

> 这个词根本不值得继续记。

使用：

```text
⋯
→ 移出学习计划
```

因此 Learn 不需要一个含义模糊的普通 Skip。

Hint 3 仍然必须把完整单词输入正确才能正常完成；“移出学习计划”属于明确的 lifecycle 操作，不是绕过 Hint 的 Skip。

---

## 8. Learn 数据统计

Learn 中的数据统计入口会打开 Learn 专属统计页，而不是复用 Typing
统计口径。

当前显示：

- 今日复习词数；
- 今日新学词数；
- 今日新词目标、当前可新增；
- 当前到期、长期学习中、已移出、尚未学习；
- Cold Probe 一次通过率（仅有效 Review probe）；
- Hint 使用率；
- 最近 30 天 Again / Hard / Good / Easy；
- 最近 30 天复习通过率；
- ACTIVE 单词的平均调度间隔；
- 最近 30 天复习、新学和通过率趋势。

其中“30 日复习通过率”只统计通过 Rating Gate 的调度事件：

```text
Again           → 未通过
Hard/Good/Easy  → 通过
```

它不是 FSRS 意义上的校准 retention probability。

Typing 数据不会混入 Learn 统计。Learn 统计页也不会修改复习日期、
lifecycle 或 scheduler state。

如果词表文件暂时加载失败，`UNSEEN / 尚未学习` 会显示未知；已有
Learn 历史、到期、Rating 等统计仍然可用。

---

## 9. 当前兼容状态

内部代码仍然暂时保留：

- `isReviewMode`;
- `ReviewRecord`;
- `ReviewWordState`;
- `reviewEvidence`;
- `reviewScheduler`。

这些是迁移中的内部术语。

用户产品模型已经是：

```text
Typing
Learn
```

后续不会为了重命名而一次性大规模改动稳定内核。

---

## 10. 下一阶段

后续按照架构顺序继续：

```text
Phase C
Acquisition + Review 统一为 Learn Session

Phase D
decideReviewRating() 成为唯一 scheduler mutation gate

Phase E
所有非 EXCLUDED 词进入 all-word Learn admission

Phase F
basic-v2: 1/3/7/14/30/60/120/180

Phase G
FSRS-6 adapter
```
