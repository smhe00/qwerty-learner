# 未完成今日计划直接继续学习

状态：REVIEW；独立分支 `fix/incident-2026-10-17`。用户在事故调查后明确要求：未完成计划应直接继续，间隔不足时穿插历史薄弱词或新词。

## 交付行为

- 未完成的同日计划保留“继续学习”主按钮与键盘入口，不再因旧 `executionExhausted` 标志隐藏开始/继续操作，也不必点击“再学 5 词”。
- 控制器与 block 结算以全日未完成计划为范围；旧的五词名单不再充当全日结束边界。已有记录、计划身份、当天新词目标保持原值。
- 已经评分到未来但尚未独立通过的原计划复习词，可在真实间隔充分后继续测试。普通 retry 的短间隔条件为已有策略常量：两个不同的其他 Learn 词的真实记录，或五分钟时间；刷新、重复抄同一词、Typing 记录及未来时间记录不提供该间隔。
- 如果原计划词正在等待间隔，优先穿插 ACTIVE 已学词。按历史 lapse、错误次数排序，并避免紧接着重复上一道穿插词。
- 已学词不足时引入少量词库新词供真实穿插；这些辅助新词不扩大被冻结的今日目标，也不修改每日设置。已有的新词学习流程、独立测试与 admission gate 保留。
- 用于旧词穿插的题采用 `spacingOnly` / `learnItemKind=practice`，不额外给旧词提交 FSRS 评分，不把练习伪装成掌握。
- 新加入的辅助词尚未 admission 时，其已完成的真实练习同样可以提供跨 block 间隔。deferred Acquisition 通过这些实际记录恢复独立测试，不再被原来的 clock-only resumeAfter 挡住，也不靠重新打开页面补充终测次数。
- 生命周期 excluded 从有效执行目标中扣除，原冻结名单仍保留，掌握证据不伪造。恢复 ACTIVE 会重新纳入目标。
- 计划真正完成后仍可选“再学 5 词”；普通继续路径不需要该入口。
- 极小词库若既没有两个可穿插的其他词、也没有新词，保留未完成状态与继续入口，提示稍后继续，不会通过无限复制同一辅助词来伪造间隔。

## 事故数据回放

原快照：原始冻结计划 98 词，独立完成 71，未达标 27；其中 6 项已被手动排除。

新逻辑在明确点击继续后：有效目标 **92**，独立完成 **71**，仍待学习 **21**。21 个未通过的 ACTIVE 复习词全部进入可继续范围（在快照时间已满足短重试间隔）；原始新词计划仍为 **20**，不是新开五词任务。排除词不会重入。

快照的全部学习记录与用户附件保持只读；只在独立测试环境中回放，没有修改实际账户/浏览器学习库。

## 代码与测试

- `src/learn/continuation.ts`：真实间隔验证、未完成复习候选与薄弱词排序。
- `src/learn/daily-session.ts`：继续全日计划、旧边界兼容、排除项的执行目标处理。
- `src/learn/controller.ts`：在恢复/生成前启用全计划继续，不再按旧加学轮次提前返回 daily-complete。
- `src/learn/settlement.ts`：以同一有效全日进度结算。
- `src/utils/db/review-record.ts`：选择未通过且间隔合法的计划复习，生成弱词/新词桥接题，按真实记录恢复 acquisition。
- `src/pages/Learn/index.tsx`：可见的继续按钮、键盘入口与状态说明。
- `tests/learn/continuation.test.ts`：覆盖间隔真实性、重复/Typing/未来记录隔离、薄弱词优先及轮换、排除与恢复、旧五词迁移、controller 不再阻断。
- `tests/e2e/learn-continue-plan.spec.ts`：真实 Chromium、IndexedDB、键盘输入、刷新恢复及最终完成；验证弱词、新词、失败终测三种情景，并核对 practice 未增加旧词 reviewCount。
- `tests/e2e/learn-extra-words.spec.ts`：保留完成后五词加学两条回归；将原来依赖强制五词的未完成计划测试改为普通 Continue，并覆盖旧五词边界迁移。
- `tests/e2e/review-flow.config.ts` 已纳入新浏览器测试。Review Gate 新增 continuation 单元测试执行及精确触发路径的配置已制作成独立补丁；GitHub 凭据缺少 workflow scope，服务器拒绝包含此工作流文件的推送，因此这部分配置仅本地保留。

## 验证记录

- Learn/daily-session/continuation/acquisition/live-stats/quota/scaffold/scheduler-lifecycle：**123/123**。
- Review foundation 与生产 controller 的 system-driver 仿真：**68/68**。
- Chromium + 实际 IndexedDB：弱词桥接、新词桥接、失败新词终测恢复及 reload 场景通过；完成后从 result/landing 追加五词的既有回归通过。最终合并运行 **7/7 通过**（51.9 秒），详见本地 `incident-analysis/continuation-final-browser.log`。
- 原始事故 JSON 回放：断言 92 有效目标 / 71 完成 / 21 剩余、21 可继续词、不增加原始 20 新词计划，**通过**。
- 修改源文件 ESLint：无错误；Learn landing 既有 ref cleanup warning 未改动。
- Vite 生产构建：通过，保留既有大 chunk 警告。
- 全项目 TypeScript 不能声明通过：现有配置使用 ES5、仓库已有迭代及其他类型错误。用 ES2020 参数核对本次与父提交 `72cd024d`：两者均有相同 **28 项**已有诊断，新增/消失诊断均为 0；未修改 tsconfig 或降低检查来隐藏问题。
- 事故调查时发现的 block-size=1 既有失败未改动，详见上份报告；此次没有宣称全库测试通过。
- 未进行云同步、真实账户恢复、Maker/Pages 发布或 release qualification。

## 范围与交接

基础开发提交 `0cd5e5b4c65fe6680278899f5f185f94e427e79f`；此前最小排除补丁 `72cd024d654c6095fea923566e2518f4b9b8549e`。本次继续同一独立事故分支，没有接管 CURRENT_TASK 指向的另一个执行者的 session-revocation 任务。

代码和本报告同提交；精确交付 SHA 可用 `git log -1 --format=%H -- src/learn/continuation.ts` 或分支查看。功能、测试及报告提交并推送独立分支供评审；工作流接线补丁另存于本地 `incident-analysis/continuation-ci-wiring.patch`，待具备 workflow 权限后应用。不推进 product/main、master 或 edgeone-test。任何真实站点发布仍须经过项目规定的单独 release gates。
