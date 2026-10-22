# Learn V1 使用指南

> 当前版本：Typing / Learn V1 + P4 Daily Learn Plan
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

### Beta 每日新词目标

当前默认每日引入新词目标为 **32 个**，可在设置中调整。目标统计的是当日首次进入学习计划的词数，不是每次进入 Learn 都额外获得一批额度。

系统会结合到期复习、当前工作量和学习状态安排实际顺序；提示帮助完成拼写不等于独立掌握。旧版研发文档出现的 5 / 10 / 20 档位属于历史方案，不是当前 Beta 的默认配置。

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

## 10. Beta 当前边界

当前运行版本包含：

- Typing / Learn 独立模式与分阶段新词引入；
- 到期复习、Hint、Dynamic Scaffold 和受控的 Recovery Window；
- FSRS-6 长期调度（目标保留率配置基线 r=0.84）；
- 默认每天 32 个新词的可配置目标与每日学习会话；
- 学习统计、成就、完整 Backup V4、本地与可选云端恢复；
- 自动同步策略以及遇到本地/云端冲突时的人工选择。

Beta **尚未承诺**：对每位用户在线训练最优记忆参数、不同设备的逐词自动合并、云端端到端加密和完整移动端学习体验。阶段性学习数据仍用于进一步评价长期记忆效率。

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


## PC 轻触模式：键盘与鼠标

Learn 页词典旁的「拼写 / 轻触」按钮可切换学习方式，当前会话继续使用同一份学习进度。在 PC 轻触模式下，可以直接点击，也可使用按钮上标注的快捷键：

| 按键 | 当前页面中的动作 |
|---|---|
| A / S / D | 回忆时选择「忘了 / 模糊 / 记得」 |
| A / S / D / F | 按画面顺序选择答案；数字 1–4 也可使用 |
| Space | 继续学习、手动下一词或当前明确显示的重试；不会默认判为记得 |
| R | 在页面提供发音操作时重听 |
| X | 判断记得后，在答案核对窗口内改为忘了 |
| W | 切换独立拼写验证与轻触回忆；输入框内仍正常输入字母 |
| Enter | 学习区域暂停/继续；拼写输入框内确认拼写 |
| Tab / Shift+Tab | 按原生顺序切换控件；控件获得焦点后可用 Enter/Space 激活 |

键帽只出现在当前可用动作旁。按住一个键不会连续提交答案；暂停后第一个练习键仅恢复学习。手机默认使用触控操作，键盘适配见下节。


## 手机 / 平板：外接键盘与拼写

在手机学习页，卡片右上角的「拼写 / 轻触」可显式选择输入方式。默认沿用轻触，不主动唤起软键盘。

- 在未揭晓答案的独立回忆题，直接输入英文字母会进入拼写，保留第一个字母；输入框自动获得焦点，Enter 确认。后续适合独立回忆的题目继续优先拼写。
- 新词初次曝光、选择题，以及已经揭晓/正在保存的题目保留当前步骤；拼写偏好在后续可用的回忆阶段生效。
- 需要软键盘时可主动选择「拼写」。明确选择「轻触」后，字母键不会再自动改成拼写；收到键盘操作后会显示当前可用的 A/S/D、Space 等提示。
- 拼写输入框内 Enter 提交，输入区外 Enter 暂停/继续；暂停后的第一个练习键只恢复学习。输入框、弹窗、组合键和输入法组合过程保留自身操作。
- 平板进入 `/mobile/study` 后，旋转屏幕会留在该学习页，保留未提交的输入。

这是一种基于实际按键的输入适配，不代表浏览器能可靠检测键盘连接/断开。偏好仅保留在本次页面运行中；刷新后恢复默认，不同步到账号或其他设备。
