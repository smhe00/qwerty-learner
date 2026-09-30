# Adaptive Review 开发计划

> 权威产品分支：`product/main`  
> 本计划采用“小步实现 → 测试 → Gate → review → 下一步”的循环，不以大爆炸方式重写 Review。

## 1. 总体目标

建立一个长期可演进的 Review 架构，使系统能够独立优化：

```text
When to review
+
How to review
```

最终支持：

- retrieval-validity Grade V2；
- targeted spelling mask；
- audio withdrawal probe；
- condition-dependent profiles；
- personalized latency；
- adaptive reinforcement；
- FSRS shadow / active；
- 后续 learned exercise policy。

---

## 2. Gate 原则

每个阶段至少满足：

```text
yarn eslint <changed review/frontend files>
yarn build
Review Gate domain tests
```

并建立专门的 `Review Gate` GitHub Actions，对 `product/main` 的 Review 相关路径自动执行。

当前 `tests/e2e/review.spec.ts` 历史测试会沿应用依赖链进入 `import.meta` 模块，不能作为纯 Node CI 的稳定 domain-test 入口。新的纯领域回归放在 `tests/review/domain.test.ts`，由 esbuild bundle 后交给 Node test runner；真实 UI 行为另用浏览器 E2E 覆盖。

涉及 DB/export/sync 数据兼容时额外要求：

```text
Cloud Sync Gate PASS
```

涉及真实 UI condition 变化时增加浏览器行为测试。

生产发布与开发 Gate 分离；开发阶段不自动推进 EdgeOne production pointer。

---

## 3. P0 — Domain contracts

### 目标

先建立稳定的数据/接口边界，不改变用户行为。

### 新增

- `ExerciseConditionV1`
- `ReviewPolicyDecisionV1`
- `ReviewObservation`
- baseline condition builder
- baseline policy decision builder

### 要求

- pure TypeScript；
- 无 React / Dexie / EdgeOne 依赖；
- versioned；
- legacy-safe；
- deterministic。

### PASS

- unit tests 覆盖 all-visible / all-hidden / partial；
- observation 能处理旧 WordRecord；
- build/lint/review test PASS。

---

## 4. P0.5 — Record actual baseline condition

### 目标

不改变当前 UI，只开始记录当前真实练习条件。

### 行为

当前全局设置仍决定 UI。

在 Word 开始时生成：

```text
ExerciseCondition
source = user-settings
purpose = training
```

保存到当前 WordRecord。

同时保存：

```text
ReviewPolicyDecision
policyVersion = baseline-user-settings-v1
reasonCodes = [baseline-user-settings]
```

### 重要约束

- intended condition 与 actual LearningContext 分开；
- 不修改 scheduler；
- 不修改 classifier；
- 不改变用户看到的页面。

### PASS

- 新记录包含 condition / decision；
- 老记录无字段时正常读取；
- local/cloud backup 无 schema upgrade 即可包含新字段；
- Review Gate PASS。

---

## 5. P1 — Review Evidence / Grade V2

### 目标

解决当前最明显的 grade 信息损失。

### 第一版必须处理

```text
answer revealed before first key
→ 不能当普通 Good

clean but very slow
→ 不等价 normal Good

clean + unaided + fast
→ Easy strong candidate

motor typo
→ 不应按 memory failure 处理
```

### 输出

引入 `ReviewEvidence`，至少包括：

- memoryGrade；
- errorCause；
- confidence；
- evidenceStrength；
- reasonCodes。

### 迁移

scheduler 改为消费 evidence.memoryGrade。

same-session reinforcement 继续独立消费 errorCause。

### PASS

建立表驱动测试覆盖关键情形；不能只靠手写几个例子。

---

## 6. P2 — Orthography Profile + Targeted Mask

### 目标

上线第一个真正改变 How 的 adaptive feature。

### Profile

从历史 WordRecord 动态计算：

- wrong events；
- dominant wrong position；
- dominant ratio；
- sample count；
- expected → typed confusion。

不新增永久 profile table。

### Policy

只有证据足够强才启用 targeted mask。

第一版阈值必须放入 policy/config，不散落 UI。

### Scaffold

```text
weak position
→ weak span
→ all hidden
```

### PASS

- targeted mask 必须能稳定复现；
- UI 仅执行 condition；
- 同词不同 condition 正确记录；
- 不满足样本条件时保持 baseline。

---

## 7. P3 — Audio Withdrawal Probe

### 目标

检测 cue dependence。

### 触发

只有达到稳定 audio-on 表现后才允许 probe。

### Probe 原则

只改变 audio：

```text
baseline condition
vs
same condition + audio none
```

### 结果

probe failure 不能简单 reset 为普通 Again。

先记录 cue-dependence evidence，再由 EvidenceModel 解释。

### PASS

- probe 标记明确；
- single-variable test；
- condition/result 可 replay。

---

## 8. P4 — Condition-dependent Profiles

### 目标

能够回答：

```text
audio on vs off
partial letters vs hidden
meaning visible vs hidden
```

表现差异。

### Profile

第一阶段动态 rebuild：

- attempts；
- success rate；
- latency distribution；
- recent outcomes。

不新建永久表。

---

## 9. P5 — Personalized latency

### 目标

替换全局固定 latency threshold 的主导作用。

### Baseline 样本

优先：

- clean；
- unaided；
- foreground active time；
- condition 可比。

### 输出

至少：

```text
P25 / P50 / P75 / P90
```

Grade/Evidence 使用 normalized percentile。

---

## 10. P6 — Adaptive micro reinforcement

当前 3/4/5/7 word gap 升级为状态机。

例：

```text
recall fail
→ 3 words
→ fail again
→ shorter return
→ slow success
→ end-of-session probe
→ fast success
→ stop reinforcement
```

长期 scheduler 与 micro scheduler 保持独立。

---

## 11. P7 — Recency-weighted history

替换 lifetime-average 主导。

候选实现：

- recent-N window；
- EWMA；
- time decay。

先用可解释实现，不做黑盒拟合。

---

## 12. P8 — FSRS-6 shadow

FSRS 只做预测：

```text
basic-v1 controls due date
FSRS records shadow prediction
```

采集：

- predicted retrievability；
- actual later outcome；
- calibration error。

没有数据证明优于 basic-v1 前不切 active。

---

## 13. P9 — FSRS active

只有满足预先定义的 calibration / retention / workload Gate 后切换。

必须保留 basic-v1 rebuild / migration path。

---

## 14. P10 — Learned Exercise Policy

未来才考虑：

- contextual bandit；
- offline policy evaluation；
- personalized policy learning。

前提：

- condition 完整记录；
- decision reason/version 完整；
- outcome/evidence 完整；
- deterministic baseline 已积累足够数据。

ML 只能替换 policy/evidence 层，不能污染 UI 或 raw storage。

---

## 15. KPI

### Primary

- 7-day unaided recall；
- 30-day unaided recall。

### Efficiency

- review seconds / retained word；
- reviews / retained word。

### Diagnostics

- false mastery rate；
- cue-assisted → cue-free performance delta；
- spelling weak-position recurrence。

### Guardrail

- 单次 session workload；
- excessive repetition；
- unexpected difficulty spikes；
- old-data compatibility。

---

## 16. 当前迭代队列

```text
R2-P0-001  文档与 Domain Contract
R2-P0-002  Review Gate
R2-P0-003  Persist baseline ExerciseCondition / PolicyDecision
R2-P1-001  Evidence V2 design + table tests
R2-P1-002  Evidence V2 integration
R2-P2-001  Orthography profile
R2-P2-002  Targeted mask shadow decision
R2-P2-002.5 Session plan freeze（active 前消除异步 condition race）
R2-P2-003  Targeted mask active
R2-P3-001  Audio probe shadow
R2-P3-002  Audio probe active
```

每个任务完成后必须重新评估下一任务，不机械执行整张路线图。

---

## 17. 当前明确不做

- 不立即上 FSRS active；
- 不立即做 RL；
- 不同时改变 audio/meaning/letters 多个变量；
- 不新建不可重建 profile 真值表；
- 不为 optional record fields 无意义升级 Dexie schema；
- 不把 adaptive rule 写进 React UI。

---

## 18. 低优先级非 Review 任务

记录但不进入当前循环：

```text
LOW-CLOUD-PORTABILITY
- formalize storage contract
- split EdgeOne HTTP adapter from generic handlers
- add Node/Postgres reference provider
```

只有 Review 主线稳定或部署迁移出现实际需求时再启动。


## 19. 执行状态（2026-09-30）

```text
PASS  R2-P0-001   Domain contracts / architecture
PASS  R2-P0-002   Review Gate
PASS  R2-P0-003   Persist baseline ExerciseCondition / PolicyDecision
PASS  R2-P1-001   Evidence V2 shadow model
PASS  R2-P1-002   Persist Evidence V2 shadow
PASS  R2-P2-001   Orthography profile + targeted-mask policy
PASS  R2-P2-002   Targeted mask shadow decision
PASS  R2-P2-002.5 Session plan freeze
PASS  R2-P2-002.6 Scaffold withdrawal + stale-shadow guardrail
PASS  R2-P2-003   Active targeted mask in Review mode
PASS  R2-P3-001   Audio withdrawal probe shadow
PASS  R2-P3-002   Active audio withdrawal probe + probe-aware evidence
NEXT  R2-P4-001   Condition-dependent profile
```

P2-003 不直接从 WordComponent 的异步 IndexedDB history query 驱动。连续练习时下一词可立即接收键盘输入，因此 active condition 必须在 session/queue 层预先冻结，避免首键前后 presentation 改变并污染 telemetry。


### P3 policy arbitration

从 P3 起所有 `How` policy 必须经统一 coordinator 选择下一 action。第一版优先级：

```text
targeted spelling remediation
    >
audio withdrawal diagnostic probe
```

同一 exercise 不叠加两个 adaptive action，保持 single-variable / single-purpose 可解释性。


### Audio probe scheduler guardrail

Audio withdrawal probe 是诊断性条件变化。有效 audio-off probe 的 recall failure 表示 cue dependence，不直接等同普通遗忘。因此 P3-002 仅对：

```text
purpose = probe
probeDimension = audio
```

使用 Evidence V2 的 `memoryGrade` 驱动长期 scheduler；其它 attempt 继续沿用现有 classifier → outcome 映射。手动请求读音会把该 probe 标记为 assisted。


## 20. 临时高优先级修复：重复注册账号保护

Review 主线在 P3-002 完成后暂时冻结，先处理云账号数据安全问题：

```text
AUTH-HOTFIX-001  PASS
- 同名/规范化同名用户名重复注册返回 username_taken
- core 注册前做强一致性存在性检查
- EdgeOne Blob account create 再做一次 preflight，防止 provider onlyIfNew 语义退化
- 不生成/替换新 userId
- 不覆盖原 identity/auth/session
- 原 revisions 保持可访问
- 原密码和原账号继续有效
- 前端明确提示“用户名已存在，请直接登录。”
- Backend/Blob contract + browser/live regression 已补齐
- Cloud Sync Gate #62 @ 9af24267420e1a135ba91bb9c788d84620537e51 PASS
```

生产指针暂不自动推进：当前 `product/main` 同时包含尚未发布的 Review P2/P3 active 行为。Hotfix 代码已在产品主线验证完成，生产发布需要作为单独 release decision 处理，避免无意捆绑其它功能。


## 21. Integrated release candidate

用户选择完整发布：Review P2/P3 active 行为与 AUTH-HOTFIX-001 一起进入本次 release candidate。

发布纪律：最终候选 SHA 必须同时通过 Review Gate 与 Cloud Sync Gate；随后仅以 fast-forward 推进 `feature/edgeone-cloud-sync`，再由 production Live / Browser / Auth Rate Limit 三个 Gate 验收。


### Release verification correction

Production verification attempt 1 exposed test/deployment sequencing issues rather than an application regression: the duplicate-registration live scenario adds one successful login, so bounded session-history expectation advances to `[8,9,10]`; Browser Gate now waits for `duplicate-register-protection-v1` before exercising the new UI. These corrections do not change product behavior.


### Final production Gate isolation

Live integration authentication traffic is kept below the configured limiter threshold. Deliberate 429 testing remains isolated in the dedicated Auth Rate Limit Gate, preventing one acceptance Gate from invalidating another Gate's assumptions.


### Final RC gate alignment

The final RC marker touches all three production acceptance probe paths so Live / Browser / Auth Rate Limit automatically execute on the exact same promoted SHA. This is test/release metadata only; runtime code is unchanged.


## 22. AUTH/Review release blocker: first-review seeding

`REVIEW-HOTFIX-001` fixes the boundary between ordinary learning and spaced review:

```text
ordinary learning WordRecord (chapter >= 0)
  -> raw learning evidence / weakness seed
  -> first Review due immediately when the word is an error word
  -> does NOT increment reviewCount or advance basic-v1 interval

Review WordRecord (chapter == -1)
  -> formal spaced-review event
  -> may advance 1 / 3 / 7 / 14 / 30 day scheduler
```

`CURRENT_REVIEW_STATE_VERSION` is bumped from 3 to 4 so previously mis-scheduled states are deleted and rebuilt automatically on Review bootstrap.


### REVIEW-HOTFIX-001 verification

Implementation commit `9069e5d8d0707f1a6501211d8eb11cceabcef131` passed Review Gate #23.

Final RC requirements:

```text
ordinary learning error -> first Review due now, reviewCount=0
Review chapter=-1       -> advances scheduler
stateVersion 3           -> stale, rebuild as v4
```

The release marker aligns Review Gate + Cloud Sync Gate and all three production acceptance probes on one final SHA.


## 23. REVIEW-HOTFIX-002: multi-word Review completion

Observed production symptom: the first Review word completes, but a following word can reach its final correct letter without advancing.

The Review-only fix forces a fresh `WordComponent` instance whenever the live Review queue index changes. This resets per-attempt state, completion effects, telemetry collectors and condition refs at a component boundary. Ordinary learning mode deliberately retains the upstream component key semantics unchanged.
