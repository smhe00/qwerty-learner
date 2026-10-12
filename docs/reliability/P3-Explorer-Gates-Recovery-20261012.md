# P3 Browser Fuzz & Dual-Site Explorer Gate 修复记录（2026-10-12）

**范围**：仅修正过期/不完整的浏览器测试环境与断言；不修改 Learn/Typing 生产逻辑，不改云端、FSRS、S1、V4 备份或 EdgeOne 构建配置。

## 1. 历史故障与调查结论

### P3 Route-cache ahead of IndexedDB

旧测试先启用 `review-persistence` 写入阻塞钩子，再调用 `resetAndSeed()`。当前单路由 Learn 在初始化阶段就可能执行 Review Record 持久化/准备逻辑，钩子被过早开启会令启动过程永久停留于「正在准备 Learn…」，测试没有触及意图验证的**输入后路由领先耐久数据**竞态。

**调整**：初始化时不启用 gate，等待真实 Learn 单词出现后、发起第一次拼写前启用；因此 gate 仅阻塞第一次键盘完成后的写入。旧有严格断言全部保留：阻塞时 `routeIndex=1, durableIndex=0`；刷新后进度不会倒退；第二次完成后 IndexedDB 的 index 与路由收敛到 ≥2。首次修正运行已记录 `P3_ROUTE_CACHE_IDB_DIVERGENCE {\"sessionId\":940001,\"routeIndex\":1,\"durableIndex\":0}`，并通过其后恢复检查。

### P3 终点缩放与随机操作序列

旧的 P3 fixture 只造 `ReviewRecord`，没有构建当前 Learn 所需的**每日冻结计划**及其真实到期 `reviewWordStates`。现调度器会正确认为“无可执行 Review 词”，把日计划标记为 `executionExhausted: true`，故测试既没有最后一词也没有完成页。若在已挂载的 S1 页面上 `localStorage.clear()`、`sessionStorage.clear()`，还会销毁工作区自身的持有/租约键，额外产生与测试目的无关的初始化竞态。

**调整**：测试使用与五词 ReviewRecord 完全一致的当日计划：`plannedReviewWords` 五项、`plannedNewWords=0`、`blockMilestones=[5]`；并在同一个真实 Dexie V6 事务中写入五条已到期 FSRS 状态；不再全量清理 S1 工作区缓存，只更新测试自己的 Learn 状态。保留原有 word index、双存储持久化、终点 URL/状态突变断言，未取消测试、未替换 DB。

### 双站 Explorer 11/12 → 12/12

旧 Pages 测试期望导航后 URL 精确等于 `/gallery`，但当前应用合法携带 `?mode=learn`；新 Pages 显示词库弹窗，旧 EdgeOne master 显示独立词库页面，故不能在旧站要求出现新弹窗标题。两站共有的稳定语义控件是语言选择器中的「英语」；Pages 另外检查弹窗自身可见。

旧 EdgeOne 测试还要求「云端同步与账号」和数据设置内的「登录」按钮；S1 架构已经把登录/注册/安全退出移至顶部 Header 账户入口，而数据设置保留账号中立的「云端同步」控件。修复后的测试在 EdgeOne 检查云同步说明和 Header 账号入口，在 Pages 则验证**不存在任何可用云同步功能入口**；真实站 Explorer 的 API POST/PUT/PATCH/DELETE 全部由浏览器拦截，只有独立授权的实网多客户端用例能写云端。

## 2. 回归测试（以 CI 结果为准）

- 首轮 P3 五项 Playwright：**5/5 通过**，包含严格的 route-cache/IndexedDB 分叉复现和收敛、终点缩放、状态操作序列。参见独立分支 CI。
- 首轮匿名两站 Explorer：**12/12 通过**，实站 Pages 与 EdgeOne 均已访问，且未触发云端写入。
- 合入门槛：将 P3 随机种子规模调整为与主线 Review Gate 相同的 **20 seeds**，全部通过后才允许 PR 进入 Ready。
- 合入后：继续监视 main 上 Review Gate、Learn Real Journey、Achievement Gate 和 Published Dual-Site Explorer；不能因为分支 Gate 通过就宣称主线所有 Gate 成功。

## 3. 安全约束

- `src/**` 未修改；补齐的是**用于验证的数据库种子**，不是替代数据库或让测试绕过真实键盘输入。
- 已保留真实播放/输入、独立拼写、刷新后数据不可倒退、不允许匿名云端写入等断言。
- 仅 merge 到 `product/main`；`master` / EdgeOne 正式站严禁构建或发布。
- 建议未来维护测试规则：每当 Learn 每日调度结构发生演化，P3 与 E2E fixture 应使用当前公共 seed builder，而不是拼装早期 V1 的片段。
