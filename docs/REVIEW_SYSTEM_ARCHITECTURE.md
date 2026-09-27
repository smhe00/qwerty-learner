# Review 系统架构说明

> 本文描述 `feature/spaced-review` **当前已经实现的架构**。  
> 用户使用说明见 `REVIEW_USER_GUIDE.md`；向上游拆分提交策略见 `REVIEW_UPSTREAM_PLAN.md`。

## 1. 设计目标

在尽量不重构原项目 Typing 主流程的前提下，为现有“错题回顾”增加：

1. 可解释的输入行为采集；
2. 学习条件采集；
3. 错因分类；
4. 同一 Review 会话中的延迟强化；
5. 跨会话到期调度；
6. 历史状态重建；
7. 对原版数据和备份的兼容。

核心原则：

```text
共享数据和算法
≠
强行重构原项目控制流
```

复杂逻辑尽量放在：

```text
src/review/
```

原项目仅保留必要接入点。

---

## 2. 当前总体数据流

```text
正常词库学习 / 错题复习
            │
            ▼
      WordComponent
            │
            ├─ typing telemetry
            ├─ learning context
            └─ wrongCount / mistakes
            │
            ▼
        WordRecord
     （原始事实记录）
            │
            ├──────────────► classifier
            │                   │
            │                   ▼
            │              ReviewOutcome
            │                   │
            ▼                   ▼
      historical data     scheduler
            │                   │
            └──── rebuild ◄─────┘
                                │
                                ▼
                       ReviewWordState
                       （可重建派生状态）
                                │
                                ▼
              historical errors ∩ due states
                                │
                                ▼
                         ReviewRecord
                         （会话队列）
```

---

## 3. 三类持久数据的职责

### 3.1 WordRecord：原始事实来源

原版字段保持不变：

```ts
word
timeStamp
dict
chapter
timing
wrongCount
mistakes
```

新增字段均为 optional：

```ts
typingTelemetry?: WordRecordTelemetry
learningContext?: LearningContextV1
```

原则：

> `WordRecord` 是长期事实数据；新增字段缺失表示旧数据或未知，不表示 false。

### 3.2 ReviewWordState：派生记忆状态

当前唯一身份：

```text
[dict + word]
```

主要字段：

```ts
dict
word
createdAt
updatedAt
lastReviewedAt?
nextReviewAt
reviewCount
lapseCount
cleanStreak
lastOutcome?
stateVersion
schedulerState
```

当前：

```text
CURRENT_REVIEW_STATE_VERSION = 3
```

该表是**可重建派生状态**，不是唯一事实来源。

### 3.3 ReviewRecord：当前 Review 会话

沿用原项目已有结构：

```ts
dict
index
createTime
isFinished
words[]
```

它负责：

- 保存当前队列；
- 保存当前进度；
- 支持刷新后继续；
- 保存同轮强化后发生变化的队列。

---

## 4. IndexedDB

当前 Dexie schema 为 v4。

新增表：

```text
reviewWordStates:
++id,
&[dict+word],
dict,
word,
nextReviewAt,
[dict+nextReviewAt],
lastReviewedAt
```

关键索引：

```text
[dict+word]          唯一词状态
[dict+nextReviewAt] 到期查询
```

原来的 `wordRecords`、`chapterRecords`、`reviewRecords` 结构保持兼容。

---

## 5. Typing Telemetry v2

当前正式格式只有 v2。

开发过程中产生的实验 v1 不做兼容分支，直接视为没有 telemetry。

主要结构：

```ts
type WordRecordTelemetry = {
  telemetryVersion: 2
  firstKeyLatencyMs: number
  attempts: WordAttemptRecord[]

  backgroundPauseMs?: number
  backgroundPauseCount?: number
  backgroundPauseBeforeFirstKeyMs?: number
  backgroundPauseBeforeFirstKeyCount?: number
}
```

每个 attempt 记录：

- `startLatencyMs`
- `durationMs`
- `correctPrefixLength`
- `result`
- `wrongIndex?`
- `wrongKey?`
- `interKeyIntervalsMs?`

### active foreground time

`blur` 和 `visibilitychange` 期间的时间从有效 latency 中剔除。

例如：

```text
前台 0.5 秒
+ 后台 30 秒
+ 回来第一键
=
firstKeyLatency ≈ 0.5 秒
```

同时后台暂停事实仍单独保存。

---

## 6. Learning Context v1

学习条件记录“认知条件”，不绑定具体 UI 控件。

### 英文答案

- 起始 visibility：`full / partial / hidden`；
- 起始可见比例；
- 是否 reveal；
- reveal 是否发生在第一键前；
- reveal 次数；
- 最近一次 reveal 到第一键的时间。

### 中文释义

- 开始时是否可见；
- 是否后来 reveal；
- 是否第一键前 reveal；
- reveal 次数。

### 音标和发音

- 音标是否可见；
- 发音功能开始时是否启用；
- 是否实际播放；
- 是否第一键前播放；
- 总播放次数；
- 自动播放次数；
- 主动请求播放次数。

当前这些数据主要用于建立可靠原始证据层。

除 attention-uncertain 保护外，尚未把这些 cue 权重硬编码进长期 mastery 计算。

---

## 7. 注意力不确定性

“停很久”不能直接解释成“不会”。

当前区分两类情况。

### 后台 / 失焦

直接从 active time 中剔除。

### 前台超长停顿

当前策略阈值：

```text
首键无解释停顿 >= 15 秒
或
词内按键间隔 >= 15 秒
```

如果首键前没有 reveal / meaning reveal / pronunciation 等解释性学习行为，则标记：

```text
attentionUncertain = true
```

该标记只表示样本可信度较低，不表示“确定走神”。

当前 scheduler 会保守映射为 `hard`。

---

## 8. 错因分类

当前分类：

```text
clean
recall
spelling
motor
uncertain
```

主要证据包括：

- first-key latency；
- failed attempt 数；
- 错误位置是否分散；
- 同一位置是否重复错；
- 错键是否为 QWERTY 邻键；
- 平均和最大 inter-key interval；
- 历史 failure rate；
- 历史稳定错误位置；
- attention uncertainty。

当前是透明启发式模型，不是机器学习黑盒。

原始 telemetry 保留，以便以后重新分类或校准。

---

## 9. 分类到调度结果的映射

当前映射：

```text
recall                → again
spelling              → hard
uncertain             → hard
attentionUncertain    → hard
motor                 → good
clean                 → good
```

`easy` 已在 scheduler 接口中预留，但当前输入 classifier 不主动产生。

---

## 10. basic-v1 跨会话调度

当前固定间隔：

```text
1 → 3 → 7 → 14 → 30 天
```

语义：

- `again`：回到 stage 0；
- `hard`：保持当前 stage；
- `good`：只有真正到期时才前进一步；
- `easy`：只有真正到期时才允许更快前进。

### same-session 保护

当前学习窗口：

```text
30 分钟
```

同一学习会话里的立即强化：

- 不推进长期 stage；
- 不反复增加长期 reviewCount；
- 不反复增加 cleanStreak；
- 提前 clean 不把 due date 推迟。

---

## 11. 正常学习与 Review 的关系

两者共享：

- `WordComponent`；
- `WordRecord`；
- telemetry；
- learningContext；
- classifier；
- scheduler state update。

但控制流没有强行统一。

正常学习仍按 chapter 运行。

Review 仍使用原来的虚拟 `ReviewRecord.words` 队列。

当前同轮 reinforcement 只发生在 Review。

这种设计是有意的：

> 共享观察和记忆引擎，但不为了形式统一而重构原项目 Typing 主流程。

---

## 12. 当前 Review 候选生成

当前候选范围仍然是：

```text
historical-errors
```

生成过程：

```text
bootstrap 当前 dict 的 ReviewWordState
        ↓
查询 nextReviewAt <= now
        ↓
取得当前 dict 历史错词
        ↓
historical errors ∩ due states
        ↓
排序
        ↓
ReviewRecord
```

因此当前不是 all-learned spaced repetition。

### 当前排序

优先级为：

1. `lapseCount` 更高；
2. basic stage 更弱；
3. 历史错误次数更多；
4. `nextReviewAt` 更早；
5. 最后以更近期历史错误做 tie-break。

身份始终为 `[dict + word]`，不跨词库合并。

---

## 13. Review 同轮强化

如果 Review 中一个词发生错误，会在后面再次出现。

当前 gap：

```text
recall     3
spelling   4
uncertain  5
motor      7
```

fallback 会根据 wrongCount 给出 3～5 的间隔。

规则：

- 最少隔 3 个词；
- 最多隔 7 个词；
- 当前队列中同一词最多保留一个 pending reinforcement；
- 接近队尾时可直接追加。

---

## 14. 历史数据迁移语义

原版 `WordRecord` 没有 adaptive telemetry。

### 历史错词

```text
legacy wrong record
→ 可作为失败证据
→ 第一次迁移时 due now
```

即：先让用户做一次真实 Review，再开始 1/3/7/14/30 调度。

### 历史 clean 普通练习

不把它解释成 spaced-review 的 `good`。

原因：

> 当时不知道答案是否显示、是否只是照抄，也不知道这是不是独立 retrieval。

### stale derived state

如果发现 `stateVersion` 落后，会删除当前 dict 的旧派生状态并从 `wordRecords` 重建。

---

## 15. 备份和恢复

导入旧备份时允许：

- DB version 不同；
- 缺少新表。

如果备份中没有 `reviewWordStates`：

```text
导入 WordRecord
→ 清空本地派生 ReviewWordState
→ 后续按词库 lazy rebuild
```

这样避免旧本地派生状态污染新导入数据。

---

## 16. 诊断能力

DEV 环境动态安装：

```js
window.__qwertyReviewDebug
```

主要接口：

```js
inspect(dict, word)
due(dict)
stats(dict)
```

可查看：

- scheduler state；
- due 状态；
- 下一次复习时间；
- 历史错误摘要；
- latest telemetry；
- learning context；
- classifier；
- evidence tags；
- attention-uncertain；
- telemetry coverage；
- basic stage 分布。

生产环境不安装该全局对象。

---

## 17. 当前事实来源边界

必须保持：

```text
WordRecord
= raw / historical source of truth

ReviewWordState
= rebuildable derived scheduler state

ReviewRecord
= current review-session queue/progress
```

未来算法升级，应优先保证旧 `WordRecord` 能安全 fallback。

---

## 18. 当前没有实现的能力

明确未实现：

- all-learned candidate scope；
- 跨词库 global word identity；
- 正式 FSRS6 运行时调度；
- 自动在线 classifier calibration；
- 自动 interval calibration；
- 根据 cue context 直接预测长期 recall probability；
- 新 Review UI / dashboard。

这些属于后续功能，不应描述成当前已存在。

---

## 19. 测试与验证原则

`tests/e2e/review.spec.ts` 当前包含大量纯逻辑回归测试，覆盖：

- queue reinforcement；
- telemetry；
- cue context；
- background pause；
- attention uncertainty；
- classifier；
- scheduler；
- legacy rebuild；
- due migration；
- diagnostics。

测试文件存在不等于环境已经执行成功。

发布或提交 upstream 前仍应实际执行：

```text
yarn lint
yarn build
yarn playwright test tests/e2e/review.spec.ts
```

并单独做一次真实浏览器 IndexedDB 导入/升级验证。
