# QWERTY Plus：三种终端场景共用一个 Learn 引擎 — V1

> 状态：**执行设计 / 未完整实施**。基于 2026-10-21 `product/main` 现有代码核对。本文是架构和验收门禁，不表示 Pages / EdgeOne 已具备跨设备融合。与 [跨设备事件融合协议](./LEARN_CROSS_DEVICE_MODE_CONVERGENCE_V1.md) 配套。

## A. 产品决策（先于技术）

**支持三种平等且完整的使用方式**：

1. **手机单独使用**：无键盘常驻的轻触学习 -> 首次独立回忆 -> FSRS-6 长期复习；在用户选择需要拼写的目标时，手机提供专门的短时虚拟键盘「独立拼写挑战」。从不要求登录电脑才能完成。
2. **电脑单独使用**：以无提示键盘拼写为默认，但可以选择与手机完全一致的轻触回忆、听音与点选题，全部共享同一词库进度；从不要求手机才能完成。
3. **手机与电脑混用**：各设备保留独立当前页面与短期会话，合流到同一账号词库的**一条事实历史、一份 FSRS 状态、同一个单日目标**；旧设备没有同步前允许继续离线，冲突靠事件汇合而非最后写入获胜。

以上是设备部署场景，不是三个学习模式。用户还可选择**学习目标**，但默认值不可根据设备偷偷改变：

- **词汇记忆**：目标是长期能从词义独立想起目标词。手机纯轻触可完整达成；需要真正冷探测，识别点选不等于记忆成功。
- **词汇与拼写**（推荐考试学习）：必须同时显示长期记忆目标与独立拼写证据状态。两端都可完成拼写挑战。尚无拼写证据不能标注「拼写已掌握」，但可以标注「词义记忆已达标」。
- **拼写强化**：更多无提示拼写练习，仍使用同一个 FSRS 记忆时钟，拼写练习不会另造一份“设备版记忆”。

「毕业」不可定义为“必须使用 PC”。学习目标中的若干指标可独立达标；不让可选的拼写验证把只有手机的用户永久卡死。

## B. 系统分层：单引擎，多个渲染器

```text
GoalProfile（记忆/记忆+拼写）     DeviceCapabilities（屏幕/输入/音频）
                     \          /
        Unified Learn Orchestrator
      ┌─────────┬──────────┬──────────────┐
      │ Acquisition │ FSRS-6 │ Task Selector │
      └─────────┴──────────┴──────────────┘
         ↓ StudyTask（何词/何时/考什么/可用提示）
┌───────────────────────────┬──────────────────────────────┐
│ Mobile renderer           │ Desktop renderer             │
│ 轻触、听音、一次性拼写框     │ 键盘拼写、轻触/鼠标、听音       │
└───────────────────────────┴──────────────────────────────┘
                ↓ StudyAttempt / AnswerTrace
            Unified Evidence Gate
            ↓ immutable events
        Local Event Store -> (optional) cloud event convergence
                ↓ deterministic projections
    FSRS-6 lexical memory / spelling evidence / listening / recognition
```

禁止界面代码自行决定「这个选择题等于一次成功的 FSRS Review」。UI 仅呈交带证据上下文的作答；统一域层判定评级是否有效及如何推进。

接口草案：

```ts
interface StudyInput {
  userGoal: 'vocabulary' | 'vocabulary-and-spelling' | 'spelling-focus'
  capabilities: { touch: boolean; physicalKeyboard: boolean; textInput: boolean; audio: boolean }
  modePreference: 'auto' | 'tap-recall' | 'cold-spelling'
  dictId: string
  localSessionId: string
}
type StudyTask = {
  wordKey: string
  phase: 'exposure' | 'guided' | 'supported' | 'cold-probe' | 'review' | 'reinforcement'
  exercise: 'tap-recall' | 'cold-spelling' | 'meaning-choice' | 'audio-choice' | 'cloze-choice'
  hintContract: { meaningVisible: boolean; answerHidden: boolean; audioCue: boolean }
  reviewPlanId?: string
}
type AttemptResult = {
  attemptId: string
  wordKey: string
  exercise: StudyTask['exercise']
  rating: 'again' | 'hard' | 'good' | 'easy' | null
  fsrsEligible: boolean
  evidenceType: 'self-report' | 'independent-spelling' | 'assisted' | 'recognition'
  spellingVerified: boolean
}
```

这些是目标接口，不等于现有 TS/Dexie schema。页面首先复用当前 WordPanel、Acquisition 状态机、FSRS ReviewState 和 V4 工作区，再逐步抽取统一控制器，而非一次性重写。

## C. 核心记忆算法闭环：FSRS 只有一条

### C1. 新词进入长期记忆的资格

共用 Acquisition 四个阶段，**最后一个通过标准改成「有效独立检索」而非「已经用键盘拼写」**：

- Exposure：展示词义、英文、音标、例句；只记录接触，不提升 FSRS。
- Guided / Supported：识别、听辨、点选、辅助巩固；只是训练，即使答对也不作为长期 FSRS Good。
- Cold Probe：目标词及拼写完全隐藏；词义可显示，例句目标位置必须掩码，禁止提前读出目标英文、字母或音标；按已有间隔/提示规则验证检索条件。
- Mobile Tap Recall：**揭晓前**先判断「忘了/模糊/记得」，再揭晓核对，允许更正；符合冷探测条件的自评可按证据门禁获得 FSRS 评级。
- Desktop Spelling / Mobile Spelling Challenge：完整无提示输入并检查正确性，作为独立检索证据和客观拼写证据；输入来源可以是手机系统键盘或物理键盘。
- 仅字母拼图/候选字母中选顺序、选项识别、照着单词重打，不属于无提示独立拼写，不能填充 spellingVerified。
- 「记得」是 self-report，不能凭设备名提升为 spellingVerified。评级资格依赖作答时看到的提示与实际流程，不依赖屏幕大小。

**实现重点：** 当前 `src/learn/admission.ts` 的新词入场判断依赖 `LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION` 和 spacing 条件；手机 `MobileWordPractice.tsx` 会在缺省计划时退回 `createCanonicalReviewProbePlan()`。必须对真实手机 Acquisition 的独立阶段做端到端检查：若用了 Review canonical policy 而不是 Acquisition independent policy，手机新词可能无法通过 admission。不得通过删掉间隔/证据验证条件“修复”。

### C2. 复习阶段（FSRS-6）

- 单词长期记忆 `(account/workspace, dictId, wordKey)` 只有一个 FSRS-6 状态；目标保留项目的既有记忆保持率设置（当前采用约 r=0.84）。
- 合法的冷探测可以来自手机答前心中回忆的诚实自评，也可以来自电脑/手机的无提示拼写。
- 「答前自评 Good」的证据较弱，但是真实可用的词汇记忆事件；单独记录 `self-report` 标签供诊断/能力显示。FSRS 不支持任意手工权重；不可静默随设备缩短/延长间隔。
- 同一次冷探测失败后的提示/纠错仅记录训练，不再次推进 FSRS；同一词多端并发的正向评级需进行竞争组仲裁，禁止双 Good 连续延长期限。
- 全部评级必须绑定**先写入的原始作答记录**；FSRS 只是可重建的派生状态。Review 完成结果经统一的 `scheduleLearnReviewCommit` 入口，Acquisition admission 另由状态机与持久证据决定。

### C3. 第二维度：拼写证据，不建第二套默认 FSRS

每个单词投影出 `orthographyProfile`：最近独立拼写验证时间、连续成功、错位特征、未验证/已验证。长期单词记忆仍只有一套 FSRS。拼写弱项可以在以后优先选择 Cold Spelling 题，而不是制造「电脑 FSRS」和「手机 FSRS」。

低设备负担原则：手机**主屏不常驻键盘**；只有明确进入一次完整拼写挑战时，临时切换输入层并调用系统输入法。考试目标由计划器抽查高风险与高频词；百分比和频率需要实验验证，不硬编码 90/10 或其他比例。

## D. 三种场景的端到端例子

| 场景 | 学习路径 | 预期最终状态 |
| --- | --- | --- |
| 单手机，词汇记忆目标 | 新词展示 → 辅助识别 → 间隔后答前自评回忆 → 核对 → FSRS 周期 | vocabulary 达标，spelling 未验证仍可完成记忆目标 |
| 单手机，考试目标 | 上述流程 + 偶尔弹出完整无提示手机拼写框 | 记忆和拼写分别达标；不依赖电脑 |
| 单电脑 | 新词 → 冷拼写 → FSRS；可随时使用鼠标轻触回忆 | 相同 FSRS 与能力画像；选择轻触不清空进度 |
| 手机白天 + PC 晚上 | 手机合格冷探测 → 上传事件 → PC 拉取后调整今日待复习；PC 可选择拼写题 | 记忆不重复计数，拼写能力补充更新 |
| PC 先学 + 手机接续 | PC 全词拼写并保存 → 手机领取未完成/到期词 | 不重新引入同词为新词；能继续其他词 |
| 两部手机或两台 PC 同时在线 | 各自维持当前会话，各自追加事件 | 合流后以单词身份去重、独立运行光标 |
| 设备离线并发练同一词 | 各设备保留原始事件，恢复后争议检测与保守评级 | 无丢失、不重复导致 FSRS 虚假增长 |
| 完全匿名单机离线 | 仅使用本地事件、投影与会话 | 仍完整学习；云是增强而非使用前提 |

## E. 全局计划与本机会话的不同步边界

**全局知识层**（最终一致）：每天新学目标、复习到期、单词学习历史、FSRS、已完成的词身份、学习目标。每个设备在进入 Learn、完成 Block、恢复同步后重新从**最新可见**知识投影领取任务。

**本机运行层**：当前卡片、按钮和提示状态、暂停、未提交答案、光标位置及尚未提交的训练草稿。另一台设备不能强制改掉当前作答；完成当前卡片后再对照最新知识跳过已完成项。

当网络不可用，不阻止学习；但两个离线设备可能各自领取同一新词，因此**严格意义上“跨离线设备每天最多恰好 20 个新词”无法在无原子协调服务的情况下保证**。可以保证合并后同一词只计一次、明确标出同步滞后，离线产生的超额新词留作有效历史，不删除它们。

## F. 云上合并语义

- 不以整份 V4 六表“最近上传者覆盖旧数据”实现多设备共享。全量备份仍留作导入/灾备；实际合流以不可变作答事件为中心。
- 事件 ID 唯一，带 workspaceEpoch、dictId、wordKey、clientSessionId、sourceDeviceId、cueTrace、answerTrace、evidenceMethod、policyVersion、time/clockQuality。单次上传重试必须幂等。
- EdgeOne Blob/KV 没有原子写，最终一致约一分钟。采用设备/会话独立命名的不可变事件（或等价无冲突分片），不依赖「全账号原子写锁」。
- 合并集合遵循交换律、结合律、幂等律；重建 L1 记忆状态不看 Blob list 的返回顺序。同词同基线并发冷探测做冲突仲裁而不是重复 FSRS 更新。
- 读取/上传完成不表示云数据已全面收敛；UI 区分「本机已保存」「上传待融合」「已融合」。旧账号 epoch 的事件不得在云重置后复活。
- 当前 Pages 测试站禁云，因此只能验证单设备同源切换；多设备实网 Gate 必须使用独立 `etest` 云空间，切勿污染 `master`。

## G. 实施顺序（有明确 Gate）

### P0 — 单引擎契约及手机新词闭环

- 提取统一 `StudyTask` / `EvidenceDecision`，手机与电脑共享 Acquisition + Review 语义；审计手机 Acquisition independent plan 真正使用目标 policyVersion 与 spacing，且不把 self-report 计为 objective spelling。
- E2E：**新浏览器仅用手机**完整学习、间隔测试、新词 admission、翌日到期复习；逐项验证历史事件、FSRS reviewCount、单日去重和恢复。之后再验证同一浏览器 PC ↔ Mobile 往返；发现回归前不放正式站。
- 修复既有手机 FSRS 回写与旧正向自评隔离后，只允许确认的有效事件改变长期到期；不可对原始历史做不受审计的全表覆盖。

### P1 — 电脑轻触记忆 + 手机临时拼写挑战

- 练习选择与渲染层分离，PC Learn 显示「自动 / 轻触回忆 / 独立拼写」偏好；手机 Learn 在正常无键盘页提供单独的「拼写挑战」任务入口或智能抽查。
- 两个设备的同一 exerciseKind 写出相同语义证据；电脑鼠标点「记得」不冒充拼写通过；手机系统键盘完整拼写则可客观验证。
- 用选择学习目标（记忆 / 记忆+拼写）控制“目标已达成”的含义，不用设备类型决定毕业条件。

### P2 — 本地统一历史与云事件汇合的只读验证

- 在现有 `v4-event-convergence.ts`、`v4-merge-preflight.ts` 上扩充多设备冲突组、去重及稳定重放，旧历史与导入边界先测试、后迁移。
- 证明 A∪B∪C 顺序无关，三台独立终端同一词的 Review 不被重复加分；建立事件与派生表的校验摘要。

### P3 — `etest` 联网融合与故障测试

- 独立 Blob 空间模拟一手机两电脑、两手机一电脑及纯多手机/纯多 PC：同步、断网、并发、重试、登录切换、账号删除、云重置。
- 启用后所有场景在恢复网络并达到可验证的同步边界时收敛同一全局 FSRS 投影，各端临时会话仍互相独立。仅在 gate 通过后安排主站发布。

## H. 强制验收原则

1. **PhoneOnlyCompletes:** 没有电脑、没有登录云，手机可以完成新词 admission 与 FSRS 长期复习；考试目标也能在手机验证拼写。
2. **DesktopOnlyCompletes:** 没有手机，电脑既能打字也能轻触完成同一记忆目标。
3. **CrossRendererEquivalent:** 同样的题目、相同的有效证据，在手机/电脑产生一致的知识更新。
4. **TypingNotRequiredForMemory:** 不以是否有物理键盘决定核心 FSRS eligibility。
5. **SpellingProofNotForged:** 任何点击识别/自评不能当作无提示拼写正确。
6. **NoLossNoDuplicate:** 多终端事件不丢不重；同时学习同词不会双倍延长 FSRS。
7. **SessionIsolation:** 设备 A 的暂停/当前词位置不覆盖设备 B 的运行会话。
8. **OfflineCompleteAndConverge:** 本机学习独立，联网后事件集合最终收敛，不谎称瞬时一致。

**这是一套面向用户目标而非面向设备的系统。**「只用手机」「只用电脑」「混用」不是学习水平的划分。