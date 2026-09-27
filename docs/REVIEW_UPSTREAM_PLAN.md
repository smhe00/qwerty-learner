# Review 向上游提交策略

> 目标：保留 fork 中完整的 Review / spaced-learning 研发能力，同时把成熟、通用、低侵入的部分逐步贡献给 `RealKai42/qwerty-learner`。

## 1. 基本判断

当前 `feature/spaced-review` 是完整研发分支，不适合整体作为一个大型 PR 直接提交 upstream。

原因不是功能方向有问题，而是它同时包含：

- telemetry；
- learning context；
- classifier；
- Review reinforcement；
- Dexie v4；
- ReviewWordState；
- scheduler；
- rebuild / migration；
- diagnostics；
- backup compatibility。

如果一次提交，上游维护者必须同时接受整套长期记忆架构，review 和维护成本过高。

因此：

```text
完整研发分支
≠
Upstream PR 分支
```

---

## 2. 两条线并行

### Fork 产品线

```text
feature/spaced-review
```

用于：

- 完整功能研发；
- 本地真实使用；
- 数据积累；
- classifier / scheduler 校准；
- all-learned 等后续探索。

这里可以保留较完整的架构。

### Upstream 贡献线

每个 PR 应从接近 upstream master 的干净分支开始。

只带一个明确、独立、容易验证的功能。

---

## 3. 上游提交优先级

### PR 1：Review 排序正确性

建议范围：

- `src/review/priority.ts`
- `src/utils/db/review-record.ts` 少量修改
- 对应测试

目标：

> 修正现有 Review candidate 排序，并引入一个纯函数 seam。

不包含：

- telemetry
- scheduler
- 新 DB 表
- learningContext
- WordPanel 大改

这是最适合作为第一笔 upstream contribution 的内容。

---

### PR 2：Review 同轮延迟强化

建议范围：

- `src/review/session.ts`
- WordPanel 极小接入
- queue regression tests

目标：

```text
Review 中答错
→ 隔几个词再次出现
```

保持：

- 原有 Typing 页面；
- 原有 ReviewRecord；
- 原有词库结构。

不要同时引入长期 scheduler。

---

### PR 3：更丰富的输入 telemetry

只有在前两个 PR 稳定、并能清楚证明收益后再考虑。

建议目标：

> 为现有 Review 提供更可靠、可解释的输入证据。

要求：

- optional；
- additive；
- 旧 `WordRecord` 合法；
- 不要求修改词典 JSON；
- 不改变 UI；
- 不强迫 upstream 同时接受长期 scheduler。

`learningContext` 是否进入这一阶段，应视上游兴趣决定。

---

### PR 4：长期 ReviewWordState / scheduler

这是高门槛 PR。

建议只有在 fork 已有真实使用证据后考虑。

需要独立说明：

- 为什么需要新表；
- 为什么 `WordRecord` 仍是 source of truth；
- migration / rebuild 如何工作；
- backup/import 如何兼容；
- due query 如何实现；
- 为什么不会影响正常 chapter flow。

不要把 school-specific policy 放进这个 PR。

---

## 4. 暂时保留在 fork 的内容

当前建议 fork-only：

- all-learned；
- 跨词库 global memory；
- 上海教材 / 中考策略；
- parent-facing report；
- 自动 classifier calibration；
- 自动 interval calibration；
- learned cue weights；
- FSRS6；
- 更复杂 dashboard；
- 个性化学习策略。

这些能力可以长期存在于 fork，不需要为了 upstream 而删除。

---

## 5. 原项目代码侵入原则

优先保持原项目这些区域稳定：

- Typing reducer；
- 正常 chapter flow；
- pronunciation provider；
- phonetic renderer；
- dictionary JSON；
- Gallery 基本结构。

新增复杂逻辑尽量放在：

```text
src/review/
```

原项目只保留薄接入点。

原则：

> 共享数据和算法，不为“架构统一”强行重构原项目控制流。

尤其避免把正常学习流程强制改造成新的 `SessionPolicy` 框架，除非 upstream 自己希望做这一层重构。

---

## 6. 数据兼容原则

### 正式兼容对象

必须兼容：

- upstream 正式 `WordRecord`；
- upstream 正式备份；
- 我们正式确定后的新数据格式。

### 不为短期实验格式增加长期维护负担

开发期短时间产生的实验 schema，不建立额外 compatibility branch。

当前正式 telemetry 只有：

```text
typingTelemetry.telemetryVersion = 2
```

旧实验格式存在时直接忽略。

---

## 7. Pull Request 质量标准

每个 upstream PR 都应该满足：

1. 一个明确用户问题；
2. 一个主要行为变化；
3. 尽可能少的原文件修改；
4. 没有无关格式化；
5. 新算法尽量是纯函数；
6. 有针对性的 regression tests；
7. 不要求 reviewer 同时接受未来 roadmap；
8. PR 描述只讨论当前 PR，不销售整个 fork 架构。

建议单个早期 PR 控制在：

```text
2～4 个主要文件
约 100～250 行有效改动
```

这不是硬性限制，而是 reviewability 目标。

---

## 8. 分支策略

不要直接把：

```text
feature/spaced-review
```

提交为 upstream PR。

建议：

```text
upstream/review-pr1-priority
upstream/review-pr2-reinforcement
upstream/review-pr3-telemetry
...
```

每个分支从最新 upstream master 建立，再把成熟功能以最小实现重新落进去。

不要简单把 feature branch 的大量 commit 整体 cherry-pick 过去。

---

## 9. 每次准备 upstream PR 前

执行：

1. fetch 最新 upstream master；
2. 确认 fork master 与 upstream 差异；
3. 从干净 baseline 建 PR branch；
4. 只实现当前 PR 的功能；
5. 执行 lint / build / target tests；
6. 本地浏览器做一次真实流程验证；
7. 检查 IndexedDB / backup 是否真的被当前 PR 触及；
8. 检查 diff 是否包含无关文件；
9. 写清行为前后对比；
10. 再提交 PR。

---

## 10. 当前 fork 的完整能力不需要削弱

Upstream 接受概率和 fork 产品能力是两个不同目标。

正确关系应是：

```text
               smhe00 完整研发分支
                       │
          ┌────────────┴────────────┐
          │                         │
  完整 adaptive review       小粒度 upstream PR
  telemetry                  排序修正
  learning context           reinforcement
  scheduler                  telemetry foundation
  diagnostics                scheduler（更晚）
```

因此，不要为了让 upstream 更容易 merge，就把已经验证有价值的完整功能从 fork 删除。

应该做的是：

> 让 upstream 每次只承担一个清晰、有限、可逆的决策。
