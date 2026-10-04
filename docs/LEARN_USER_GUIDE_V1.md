# Learn V1 使用指南

> 当前版本：Typing / Learn V1 + P4 Daily Learn Plan
>
> Learn 的长期目标架构见 `LEARN_ARCHITECTURE_V1.md`。

## 1. 两种模式

Qwerty Learner 现在明确分为：

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

当前阶段包括两套 Learn 内部流程：

- 新词 Acquisition：Exposure → Supported Recall → Independent Recall；
- 到期 Review：canonical cold probe → Rating Gate → scheduler；
- Hint 0/1/2/3；
- Again/Hard/Good/Easy 证据体系（仅到期 Review）；
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

新词 Acquisition P0：

```text
无 due Review
→ P3/P4 决定本次可新增的新词数
→ Exposure：显示单词 + 音标 + 释义 + 双语例句，并自动发音
→ 看着正确输入一次，建立第一次成功体验
→ 隔开若干词后 Supported Recall：隐藏拼写，需要时可按 Esc 获取 Hint
→ 再隔开若干词后 Independent Recall
→ 只有无提示、无错误的独立拼写成功才进入 ACTIVE
→ nextReviewAt = +1 day
```

Exposure 和 Supported Recall 都是训练证据，不会被当成长期记忆已经建立。
如果 Independent Recall 仍需要提示，系统会自动回到有限的支持循环；连续
未形成独立回忆时会 defer，而不是把它伪装成“已经掌握”。

如果词库最后只剩很少几个新词，同一轮里没有足够的干扰词，哪怕 Independent
拼写正确也不会立即算“独立掌握”。系统会保存进度，至少间隔 5 分钟后直接
从 Independent Recall 继续，不会重新展示答案。等待期间如果还有其他新词，
Learn 会继续安排其他词；如果没有，则会提示稍后继续。

Acquisition 全程不产生 Again / Hard / Good / Easy，因此不会增加
reviewCount / lapseCount。

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
- 今天有效 Cold Probe 一次通过率；
- 最近 Learn 交互负荷（连续错误、Hint 深度、纠错次数和非 Exposure
  停顿）。

交互负荷只作为**减速保护**：明显吃力时会自动降低后续新词量；状态轻松
不会突破原本由记忆质量决定的上限。这个信号只使用 Learn 记录，不读取
Typing 表现，也不会在学生界面显示“情绪分数”。

Alpha 1 的 Interaction Strain 已升级为 V2：EWMA 观察器外增加 hysteresis，
避免分数在边界附近轻微波动时频繁在 low / elevated / recovery 之间切换。
控制参数仍是全局受约束参数，当前没有启用自动 Personal Calibration。

Cold Probe 至少有 5 个有效样本才参与当天调速；Rating Gate 判定无效的
尝试不会被当作“通过”。

每日额度是总量。例如今日目标 10 个、已经学了 7 个，再次进入 Learn
最多只会再加入 3 个新词，而不是重新获得 10 个额度。

### P4 今日 Learn 计划

P4 在 P3 新词额度之上增加当天总工作量规划。

基本原则：

```text
Due Review
    ↓ 永远优先，不能被时间预算截断
完成 Due
    ↓
P3 剩余新词额度
    ↓
P4 工作量预算再次约束
    ↓
实际 Acquisition 数量
```

V1 使用 20 分钟软预算。它不是倒计时，也不会强制停止 Learn，而只用于
判断今天清完 Due 后还应不应该继续增加新词。

时间估计优先使用最近 30 天个人 Learn 数据的中位数：

- Review 每词耗时；
- Acquisition 每词耗时。

样本不足时使用回退值：

```text
Review       15 秒/词
Acquisition  30 秒/词
```

例如今天已经完成约 15 分钟 Review，而 P3 仍允许 20 个新词，则 P4
按 30 秒/新词的回退模型，只会再安排约 10 个新词。

same-session reinforcement 虽然不产生 Rating，但真实消耗的时间仍计入
P4 今日工作量。

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

可以在拼写任意位置按：

```text
Esc
→ Hint 0
→ Hint 1
→ Hint 2
→ Hint 3
```

Space 始终是正常拼写字符；短语中的空格不会被当成“不会”或跳过操作。

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

## 7.1 Learn 完成页

Learn 不使用 Typing 的“正确率 / WPM / 错词评价”结果页。完成一轮后只显示：

- 本轮学习/复习词数；
- 新词阶段的“独立掌握”数量；
- 仍需继续巩固的数量；
- 本轮用时。

需要巩固的词由算法后续自动安排，不要求学生立刻因为“错误”重做整轮。

---

## 8. Learn 数据统计

Learn 中的数据统计入口会打开 Learn 专属统计页，而不是复用 Typing
统计口径。“独立掌握”只在 delayed Independent Recall 无提示、无错误
完成后增加，不把刚看过答案的 Exposure 当成掌握。

当前显示：

- 今日复习词数；
- 今日独立掌握词数；
- 今日新词目标、当前可新增；
- 今日 Learn 计划、预计剩余时间；
- 当前到期、其中困难到期词、长期学习中、已移出、尚未学习；
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

## 10. Alpha 1 当前边界

当前已经实际启用：

- Typing / Learn 产品边界；
- 分阶段 Acquisition；
- due Review + Rating Gate；
- basic-v2 长期间隔；
- Dynamic Scaffold V1.1；
- Interaction Strain V2 hysteresis；
- Recovery Window V1；
- quota V2 + P4 daily plan；
- Learn Statistics；
- 手工移出 / 恢复；
- Control Stability Gate。

当前尚未启用：

- 自动 Personal Calibration；
- 完整 FSRS-6 主调度；
- 自动跨设备 record-level merge；
- 以真实 7/30 天 retention 数据在线自动修改控制参数。

Alpha 阶段会先收集真实长期保持结果，再决定慢时间尺度的个性化参数学习。


## 动态学习支架

Learn 会在后台自动调整新词学习时的帮助强度，界面不会要求学生选择“难度”。

- 第一次接触新词时，会显示完整单词、音标并自动发音。
- 正常回忆时会逐步撤掉帮助。
- 如果最近学习交互明显吃力，或这个词刚刚经历过一次失败/需要帮助，
  下一次巩固会临时增加发音和音标支撑。
- 如果系统明确知道上一次独立拼写具体错在哪个字母位置，下一次强支架
  只显示那个位置的字母；如果没有可靠错误位置，就不会猜测性地显示前缀。
- 在这种强支架下继续按 Esc，只会得到更强的提示，不会退回更弱的提示。
- 真正进入长期学习前的 Independent 回忆不会因为“状态不好”而降低标准：
  单词仍然隐藏，且必须满足独立、干净、有效间隔的证据要求。
- 这些调整只作用于 Learn；Typing 的原有练习逻辑和个人设置不会被动态支架修改。

因此，系统可以减少连续失败带来的挫败，同时不会把“提示后会写”误判成
“已经独立掌握”。

## 恢复窗口

当 Learn 检测到最近交互压力较高，而且一个 Independent 独立回忆刚刚失败时，
系统不会立刻把这个困难词再次推到学生面前。

- elevated 状态优先安排最多 2 个高把握训练项；
- recovery 状态优先安排最多 3 个；
- 这些项目来自当前队列里已经存在的 Exposure/S0 或强支架 S1；
- 不会为了“让学生做对”而伪造新的简单题；
- 不会把 Independent 项目当作恢复题；
- 恢复训练本身不能直接产生“独立掌握”；
- 完成这一小段较容易成功的训练后，再回到刚才的困难词。

如果当前队列没有足够合适的恢复项，系统宁可少安排，也不会随意降低长期掌握标准。
