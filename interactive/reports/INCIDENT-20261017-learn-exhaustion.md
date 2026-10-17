# QWERTY Plus 2026-10-17 学习任务结束调查

状态：REVIEW；已完成代码核对、数据回放与最小补丁验证，未部署。

## 结论

这份快照能解释“任务还没全部通过，系统却结束出题”：全日掌握进度与当前可执行轮次采用不同的结束条件。最终快照的全日进度是 **71/98（72%），剩余 27**，但冻结的本轮加学进度是 **5/5**。控制器按后者结束本轮，保留 `status=active` 并写入 `executionExhausted=true`。该字段不表示全日完成，也不是报错标志。

没有发现计划词练习记录被截断或丢失的直接证据。不能据此排除快照之前的所有运行异常：`trace.events=[]`，没有逐步点击/运行轨迹。本报告区分持久化事实与按代码回放得到的结论。

## 输入与代码版本

- 用户指定的 `/mnt/data/` 路径在本机不存在；通过原 ChatGPT 对话附件取到了同名上传文件，未改写原附件。
- 文件：`Qwerty-Plus-Incident-2026-10-17T13-15-48-595Z.json`。
- SHA-256：`4d012cd9e65fbeb496715a8c738a60c03c225eeeaadb26a9274b83fa6e4346bc`。
- 构建提交：`9445ae4a`（附件声明 `9445ae4`，代码从 GitHub 仓库获取并用该提交的源码独立回放）。
- 词库：`shanghai-zhongkao-2027`。
- 快照：2026-10-17 21:15:48，Asia/Shanghai。
- 当日任务开始：14:46:55；记录的有效练习时间 2703 秒，即 45 分 03 秒；完成 block 15 个，ID `review:52` 至 `review:66`。
- 补丁执行基线：`origin/product/main = 0cd5e5b4c65fe6680278899f5f185f94e427e79f`。核对的 Learn 文件与事故提交一致。
- 当前任务指针仍为其他执行者的 session-revocation 工作；未修改该任务及其所有权。本次在 `fix/incident-2026-10-17` 隔离。

## 计划与实际

完成定义来自 `deriveLearnDailyProgress`，不是简单的“打过一次”。复习必须有 Learn 来源、可评分、独立检索且 `errorCause=clean` 的记录；新学必须通过 acquisition admission gate。

| 类别 | 原计划 | 当日有练习的独立词数 | 达到代码完成条件 | 未达标 |
|---|---:|---:|---:|---:|
| 复习 | 77 | 73 | 52 | 25 |
| 新学 | 20 | 20 | 18 | 2 |
| 遗留新学 `area` | 1 | 1 | 1 | 0 |
| 合计 | 98 | 94 | 71 | 27 |

当日原始 WordRecord 共 **254 条**，覆盖 **94 个词**。其中按 item kind 为 review 163 条、acquisition 77 条、practice 14 条。重复、训练与练习记录不能都当成新完成词。

27 个未达标词的分类（按最终快照）：

1. **19 个复习词**最终调度结果 `again`，下一次到期在 2026-10-18：`again, ahead, allow, along, also, although, amazing, ambition, a.m., accurate, among, amusing, ancient, airport, American, amount, appear, apply, April`。
2. **2 个复习词 `Africa`、`alive`**：独立检索的错误被分类器判为 `motor`，调度评分为 `good`，但全日完成要求 `errorCause=clean`，所以仍不计入全日完成。后续强化记录的 `eligible=false` 也无法补足该条件。下次到期分别为 2026-11-29 17:22:10 与 2026-10-22 17:15:27。
3. **4 个复习词被手动排除且当日没有 WordRecord**：`advantage, adventure, amusement, apologize`。排除时间均晚于当日任务冻结时间，因此仍出现在冻结计划里。
4. **2 个新学词被手动排除且未完成 admission**：`attention, attitude`。有 exposure/support/hint 记录，但没有有效独立完成记录。

这 6 个排除词仍占原计划分母，不能自动记为“掌握”。库内共有 7 个 excluded state，另一个 `achieve` 已在此前排除，不在今天的计划中。

## review block 与结束路径

- 快照中 `reviewModeInfo.reviewRecord.id=66`，包含 `across`、`actually`，`isFinished=true`；两个 item state 均 `phase=done`、`ratingEmitted=true`。
- DB 中本日登记完成的 block 52–66 全部 `isFinished=true`。历史 block 的 `words=[]` 是导出/保留压缩后的形态，不能据此推断当时没有题或没有练习；WordRecord、成就事件以及当前 localStorage 快照保留了证据。
- block 52 的创建时间是 10 月 12 日，但当天有继续学习记录并被计入当天完成列表。因此统计当日练习应按 WordRecord 时间，不能只用 review record 的 `createTime` 截取。
- `extraRoundWordNames = [above, across, actually, advise, afford]`，`extraNewWordCount=0`；这轮是重试原计划未通过词，没有增加新词。
- `extraRoundStartedAt` 为 17:24:02；block 65 当时创建，记录中的练习发生在 21:14:08–21:15:18。block 66 在 21:15:18 创建，21:15:23、21:15:30 为最后两条记录。
- 用 17:24:02 以前的记录重建全日进度为 66/98；五个词后来全部取得完成证据，最终变成 71/98。
- `deriveLearnExecutionProgress` 只统计被冻结的本轮五词，得到 **5/5、remaining=0、complete=true**。
- `prepareLearnSession` 在 `controller.ts:166–180` 看到本轮完成、全日未完成，保持 active 并设置 executionExhausted，返回 `waiting / daily-complete`，提示“本次加学已完成；未掌握的原计划词已保留。”此路径不调用新题生成器。
- `settlement.ts` 对本轮完成使用同样的判断，所以该字段也可能在最后 block 结算时写入。由于没有 trace，无法断言最后一次写入具体来自哪一处。
- 此前普通轮次的耗尽路径在 `controller.ts:307–314`：生成不到题、没有 deferred acquisition resume、新词全部已引入，而剩余词仍大于零时，也写 executionExhausted。结合冻结加学字段与调用前置条件，推断此前经历过该类“可执行题耗尽后再学五个”的过程；没有点击轨迹来还原每一步。
- 本轮五词完成后不会自动扩大到剩余原计划。这与仓库既有的 five-more 测试明确规定的行为一致。

## 调度为什么先于“全日掌握”结束

普通队列只选择 ACTIVE 且 `nextReviewAt <= now` 的词，再限制在当日冻结计划中。FSRS 使用 `enable_short_term=false`、空 learning/relearning steps。一次有效的失败评分也会推进下次复习时间；有限的补练不能无限补充同日重试预算。因此“已评分并排到以后”和“独立无错通过”会分离。

导出时，**原计划中的 ACTIVE 复习词没有到期词**。但全词库另有两个 ACTIVE 到期词：`accept`（20:42:54）、`address`（20:42:59）；它们下午冻结计划时尚未到期，不属于原计划，也不属于本轮五词，因此没有被追加。不能把“本轮无可执行题”解读成“整个词库无到期词”。

`dom.resultVisible=false` 与已结束 block 返回 Learn 页面相容，不能单独作为崩溃或异常结束证据。

## 最小补丁

本次修复已实证的排除词重入漏洞，保留现有完成与 FSRS 规则：

- `src/learn/daily-session.ts`：选择“再学五个”的 unfinished cohort 前排除该词库的 `lifecycle=excluded` 词；过滤发生在 `.slice(0,5)` 之前，避免排除词占用名额。保留原计划身份与真实完成证据，不虚增掌握数。
- `src/utils/db/review-record.ts`：加学复习改用现有 `selectReviewCandidates(..., 'force')`，保留忽略未来 due 时间的显式重试能力，同时必须是 ACTIVE state；防止旧/冻结加学名单或中途排除绕过生命周期过滤。
- `tests/learn/daily-session.test.ts`：增加 review/carry-over/new 三类排除词不得重入、恢复 ACTIVE 后可重新选择、只有排除词时不得无效重开等回归断言。

真实快照上再次点击“再学五个”的纯函数结果：

- 修复前：`Africa, advantage, again, ahead, alive`，错误选入已排除的 `advantage`。
- 修复后：`Africa, again, ahead, alive, allow`，五个均为可重试的活动词。

该漏洞并未造成快照中的最后一轮提前结束：当时冻结的五词均为 ACTIVE，最终也全部完成。补丁不声称把 71/98 修成 98/98；这需要澄清产品完成口径，不能通过清除 exhausted、虚改原始记录或取消用户排除来处理。

## 后续建议

1. 界面同时显示“本轮已结束”和“全日独立通过 71/98”，并单列 6 个排除项、19 个待后续复习项及 2 个 motor 评分项；不要让 `daily-complete` 原因码被其他界面误读为全日完成。
2. 将 excluded 作为单独 resolved/excluded 结果，从有效执行目标中剔除，但保留冻结计划作审计；不得把排除等同掌握。
3. 明确区分“完成今日安排”与“今日全词独立无错通过”。若产品目标是前者，完成口径应与实际评分/终止状态对齐；若目标是后者，应提供有边界的再练轮次，并在未达标时解释终止原因。
4. 确认 motor-only / independent / good 是否应视为“记忆通过”；若应计入，增加对应完成口径与测试，保留拼写准确率指标，不能只为补齐数字直接降低标准。
5. 对晚间新增到期的计划外词给出显式追加入口或“明日处理”说明，避免用户把冻结计划视为动态清空整个 due 队列。

## 验证与限制

- 原始 `9445ae4` 源码解包、独立打包回放，断言全日 71/98、本轮 5/5、控制器 waiting/daily-complete、不调用 generator：通过。
- 修复前新增两项测试均失败，确实复现排除词重入及只有排除词时无效重开。
- 修复后 daily-session：**15/15 通过**。
- Learn/acquisition/live-stats/quota/scaffold 与 review scheduler-lifecycle 相关测试：**117/117 通过**。
- 加上 block-size suite 后：**123/124**；唯一失败为 `block size 1 limits fresh, pending, Review and mixed cohorts` 的预期 `3`、实际 `1`。在 `9445ae4` 原源码独立重跑同样失败（该 suite 6/7），与补丁无关。未修改该测试或实现来掩盖失败。
- 修改的两个源文件 ESLint：通过。
- Vite 生产构建：通过（5.66 秒；有既有大 chunk 警告）。
- 第一次 npm 安装遇到当前依赖范围的 peer resolution 冲突；随后使用仓库 `yarn.lock` 执行 `yarn install --frozen-lockfile --ignore-scripts` 成功，没有修改依赖声明和锁文件。
- 未进行真实浏览器/线上个人账户恢复、云同步或发布验收。controller 回放的存储/依赖为内存适配，验证控制分支；不冒充真实 IndexedDB 或浏览器端到端测试。generator 的生命周期选择依赖已有 force-mode 测试与静态调用核对。
- 未修改用户学习数据、master、edgeone-test，也未发布站点。上传附件与提取的完整学习记录不进入 Git。

## 交接

改动文件为上述两个源文件、daily-session 测试、本报告与独立任务说明。执行基线 `0cd5e5b4c65fe6680278899f5f185f94e427e79f`。补丁提交用 `git log -1 --format=%H -- src/learn/daily-session.ts` 查得；报告与补丁同提交，避免循环引用自身 SHA。后续应先评审完成口径和最小补丁，再决定开发分支集成与发布；不得直接推进 master/etest。
