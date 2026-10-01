# Learn V1 使用指南

> 当前版本：Typing / Learn Phase A/B
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

新词全量进入长期记忆系统将在后续 all-word admission 阶段开启。

---

## 2. 如何切换模式

顶部始终显示：

```text
[ Typing | Learn ]
```

这是一级模式切换，不再隐藏在 Start 菜单中。

Start / Pause 只负责开始或暂停当前输入。

云备份和数据操作继续放在“设置 → 数据”中。

---

## 3. Learn 首页

Learn 首页显示当前词库的长期学习状态：

```text
今日到期
长期学习中
尚未进入 Learn
已移出
```

主要操作：

- **继续当前学习**：恢复未完成的 Learn session；
- **开始今日学习**：处理当前到期词；
- **额外复习**：当前没有到期任务时的辅助入口；
- **学习计划**：查看长期学习中的词和已移出词。

当前 A/B 阶段中，“尚未进入 Learn”的 clean-only/未建卡词不会自动 admission。

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

## 8. 当前兼容状态

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

## 9. 下一阶段

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
