# Review 系统架构

> 产品主线：`product/main`  
> 本文同时描述 **当前已实现架构** 与 **Adaptive Review 目标架构**。  
> 迭代顺序和验收标准见 `REVIEW_ADAPTIVE_DEVELOPMENT_PLAN.md`。

## 1. 目标

Review 的长期目标不是只回答：

```text
这个词什么时候再复习？
```

而是同时回答两个相互独立的问题：

```text
When?  什么时候复习
How?   这一次以什么条件复习
```

形式化为：

```text
ReviewDecision = SchedulingDecision + ExerciseDecision
```

其中：

- SchedulingDecision：长期 interval、due time、lapse/stability；
- ExerciseDecision：读音、释义、音标、字母提示、targeted mask、probe/training、同轮强化。

两者必须解耦，使 basic-v1 → FSRS 的调度升级不影响 exercise policy，也使 exercise policy 可以独立演进。

---

## 2. 不变的事实边界

必须保持：

```text
WordRecord
= raw observation / historical source of truth

ReviewWordState
= rebuildable derived scheduler state

ReviewRecord
= current review-session queue / progress
```

未来增加的 profile、grade、policy decision 都不得成为不可重建的唯一事实来源。

### 2.1 Raw evidence 优先

长期保留事实：

- typing telemetry；
- 错误位置和错误按键；
- first-key latency；
- inter-key latency；
- background/blur pause；
- 实际 answer/meaning/phonetic/audio 条件；
- 本次 exercise condition；
- policy version / reason code。

算法结论例如：

- recall / spelling / motor；
- Again / Hard / Good / Easy；
- weak position；
- audio dependence；
- memory stability；

都属于 derived state，可随算法升级重新计算。

---

## 3. 当前已实现架构

当前数据流：

```text
WordComponent
   │
   ├─ typing telemetry v2
   ├─ learning context v1
   └─ wrongCount / mistakes
   │
   ▼
WordRecord
   │
   ├─ classifier
   │     └─ clean / recall / spelling / motor / uncertain
   │
   ├─ classificationToReviewOutcome()
   │     └─ again / hard / good
   │
   └─ basic-v1 scheduler
         └─ 1 / 3 / 7 / 14 / 30 days
```

Review session 内还有独立 reinforcement：

```text
recall     → 3 words
spelling   → 4
uncertain  → 5
motor      → 7
```

### 3.1 当前限制

当前核心限制：

1. clean 基本直接映射为 good；
2. cue condition 尚未进入长期 grade；
3. fixed latency threshold 尚未个人化；
4. lifetime history 权重偏重旧数据；
5. scheduler 仍是 fixed-stage；
6. UI condition 主要由全局设置决定，不按单词状态动态选择；
7. 没有 Training / Probe 的显式区分；
8. 没有 condition-dependent skill profile。

---

## 4. Adaptive Review 目标数据流

```text
                  Raw Word History
                        │
                        ▼
                  ReviewContext
                        │
              ┌─────────┴─────────┐
              │                   │
              ▼                   ▼
      Scheduling Policy      Exercise Policy
          When?                  How?
              │                   │
              │             ExerciseCondition
              │                   │
              └─────────┬─────────┘
                        ▼
                     Attempt
                        │
            ┌───────────┴───────────┐
            │                       │
      Typing Telemetry       Actual Cue Context
            │                       │
            └───────────┬───────────┘
                        ▼
                 ReviewObservation
                        │
                        ▼
                   EvidenceModel
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
     MemoryGrade    ErrorProfile   CueProfile
          │             │             │
          ▼             ▼             ▼
     Scheduler     Reinforcement  Future Policy
```

关键原则：

> UI 执行 policy，不拥有 policy。

`WordComponent` 不应逐步堆积 “如果某词错了某字母就……” 之类算法规则。

---

## 5. ExerciseCondition

ExerciseCondition 描述 **本次题目被怎样呈现**，与用户最后是否真的使用某个 cue 分开。

目标结构：

```ts
type ExerciseConditionV1 = {
  version: 1

  purpose: 'training' | 'probe'
  source: 'user-settings' | 'adaptive-policy'

  audio: 'none' | 'automatic'
  meaning: 'hidden' | 'visible'
  phonetic: 'hidden' | 'visible'

  letters: {
    mode:
      | 'all-visible'
      | 'all-hidden'
      | 'partial'
      | 'targeted-mask'
    visiblePositions?: number[]
    maskedPositions?: number[]
  }

  probeDimension?:
    | 'none'
    | 'audio'
    | 'orthography'
    | 'meaning'
}
```

### Condition 和 LearningContext 的区别

`ExerciseCondition`：

> policy / UI 在本次开始时安排了什么。

`LearningContext`：

> 用户实际经历和使用了什么。

例如：

```text
condition.audio = automatic
```

并不等于声音一定真正播放成功；实际播放事实仍由 `LearningContextV1` 记录。

---

## 6. PolicyDecision

每次 Adaptive decision 必须可解释：

```ts
type ReviewPolicyDecisionV1 = {
  version: 1
  policyVersion: string
  reasonCodes: string[]
}
```

例：

```json
{
  "version": 1,
  "policyVersion": "exercise-targeted-mask-v1",
  "reasonCodes": [
    "dominant-spelling-position",
    "training-scaffold"
  ]
}
```

以后做 A/B 或 replay 时必须能知道当时为什么给出这个 condition。

---

## 7. ReviewObservation

Observation 是事实层的算法输入，不要求永久单独存表。

它由 WordRecord 构建：

```text
ReviewObservation
├─ word / dict / timestamp
├─ wrongCount / mistakes
├─ typingTelemetry
├─ learningContext
├─ exerciseCondition
└─ policyDecision
```

旧记录缺字段时语义始终是：

```text
unknown
```

而不是 false。

---

## 8. Evidence Model

当前 `classificationToReviewOutcome()` 最终应演进为：

```ts
ReviewEvidence {
  memoryGrade: 'again' | 'hard' | 'good' | 'easy'
  confidence: number
  evidenceStrength: number

  errorCause:
    | 'none'
    | 'recall'
    | 'spelling'
    | 'motor'
    | 'attention'
    | 'uncertain'

  weaknesses?: {
    audioDependence?: number
    orthography?: {
      positions: number[]
    }
  }
}
```

这样：

- Scheduler 消费 memoryGrade / evidenceStrength；
- reinforcement 消费 errorCause；
- ExercisePolicy 消费 weaknesses/profile；
- UI 不解释这些算法信号。

### 8.1 Retrieval validity

P1 首先解决：

```text
看过答案后正确 ≠ 普通 Good
长时间挣扎后正确 ≠ 普通 Good
无提示快速正确 可以成为 Easy 的强证据
motor typo ≠ memory failure
```

---

## 9. Word Skill Profiles

未来概念上拆成三个 profile。

### 9.1 MemoryProfile

回答：

- 当前长期记忆强度；
- lapse；
- stability / difficulty；
- next due。

初期 basic-v1，后期可由 FSRS 接管。

### 9.2 OrthographyProfile

回答：

- 哪些位置长期重复拼错；
- dominant wrong position；
- weak span；
- expected → typed confusion。

初期由历史 WordRecord 动态重建，不新增永久表。

### 9.3 CueDependenceProfile

比较同一词在不同条件下的表现：

```text
audio ON   success / latency
audio OFF  success / latency

letters partial
letters hidden

meaning visible
meaning hidden
```

用于发现 “有 cue 会、撤 cue 不会” 的 false mastery。

---

## 10. Training 与 Probe

必须显式区分。

### Training

目标：促进学习。

允许：

- audio；
- targeted mask；
- phonetic；
- meaning；
- scaffold。

### Probe

目标：测量真实能力。

原则：

> 一次 probe 尽量只改变一个主要变量。

例如 audio withdrawal：

```text
baseline: meaning + audio + hidden letters
probe:    meaning + NO audio + hidden letters
```

只改变 audio，才能把性能变化归因到 audio dependence。

Probe 失败也不能简单等价为普通 Again；它可能说明 cue dependence，而不是完全遗忘。

---

## 11. 第一批 Exercise Policy

第一代 policy 必须 deterministic、透明、可 replay。

### 11.1 Targeted Mask

候选规则：

```text
独立错误样本 >= N
AND
某位置错误占比 >= threshold
        ↓
targeted-mask training
```

训练从弱位置开始，成功后逐步撤 scaffold：

```text
单位置 mask
→ 小片段 mask
→ all-hidden
```

### 11.2 Audio Withdrawal Probe

候选规则：

```text
audio-on 多次 clean
+ 无 answer reveal
+ latency 稳定
        ↓
偶尔 audio-off probe
```

其它条件保持不变。

---

## 12. Personal latency

固定阈值只能作为 bootstrap。

未来建立 learner baseline：

```text
P25 / P50 / P75 / P90
```

来源应优先使用：

- clean；
- 无 reveal；
- 条件可比；
- active foreground time。

最终 latency 判断使用个人 percentile，而不是所有人统一 500/1800/3000ms。

---

## 13. History recency

未来不应只使用 lifetime failureRate。

Profile builder 应支持：

- recent window；
- EWMA；
- time decay；

避免半年前大量错误永久压制最近已经稳定掌握的词。

---

## 14. Scheduler 演进

调度器接口继续保持可替换：

```text
basic-v1 active
      │
      ├─ FSRS-6 shadow
      │      └─ 只预测，不控制 due date
      │
      └─ calibration pass
             ↓
         FSRS active
```

在 Grade/Evidence 层没有稳定前，不直接切 FSRS。

---

## 15. 实验指标

不能只看即时正确率。

核心目标：

```text
长期 retained words / review time
```

建议指标：

### Retention

- 1-day unaided recall；
- 7-day unaided recall；
- 30-day unaided recall。

### Efficiency

- review seconds / retained word；
- reviews / retained word。

### Diagnostic

- cue-assisted success → cue-free failure；
- false mastery rate；
- probe performance delta。

### Calibration

未来模型预测 90% recall 时，实际结果应接近 90%。

---

## 16. 代码边界

目标结构：

```text
src/review/
├── condition.ts          ExerciseCondition
├── decision.ts           PolicyDecision
├── observation.ts        raw record → observation
├── context.ts            ReviewContext builder
├── evidence.ts           observation → evidence
├── classifier.ts         error-cause classification
├── profile.ts            rebuildable skill profiles
├── exercise-policy.ts    How?
├── scheduler.ts          When?
├── session.ts            same-session reinforcement
├── experiment.ts         policy/reason/experiment metadata
└── repository.ts         persistence / rebuild
```

不要求一次性创建所有文件；按 development plan 增量演进。

---

## 17. 数据库策略

P0/P1 优先给 `WordRecord` 增加 optional additive fields，不修改 index：

```ts
exerciseCondition?: ExerciseConditionV1
reviewPolicyDecision?: ReviewPolicyDecisionV1
```

因此不需要仅为这些字段升级 Dexie schema。

Profile 第一阶段全部从 WordRecord rebuild。

只有确认重建成本成为问题时，再考虑可删除、可重建的 cache table。

---

## 18. 兼容和备份

本地和云端都对整个 Dexie DB 做导出。

新增 optional WordRecord 字段会自然进入：

```text
local .gz
cloud qwerty-dexie-gzip-v2
```

旧备份没有 adaptive fields 时仍必须正常导入。

---

## 19. 开发约束

1. When / How 分离。
2. Raw evidence 是 SSOT。
3. Profile / scheduler state 必须可重建。
4. Training / Probe 显式区分。
5. Probe 尽量 single-variable。
6. UI 不内嵌算法规则。
7. Policy 必须有 version 和 reason code。
8. 第一代 policy 可解释、确定性。
9. FSRS 先 shadow。
10. ML / contextual bandit 未来只能替换 policy/evidence，不重构产品主流程。

---

## 20. 非 Review 低优先级 backlog

Cloud portability 已确认可行，但不进入当前 Review 主线：

```text
LOW: provider-independent cloud backend
- formal storage contract
- isolate HTTP runtime adapter
- EdgeOne / Node / Postgres provider adapters
```

当前 EdgeOne 是 deployment/storage provider，不是 Review 算法依赖。
