---
protocol_version: '1.1'
task_id: ARCHITECTURE-PHASE3B-RISK-20261026
status: REVIEW
executor: Codex
target_branch: codex/cloud-refactor-risk-assessment-20261026
claim_base_commit: 91b773b7f54ad77e7c2d09d9ab0f01e095df8c88
upstream_head_at_assessment: 91b773b7f54ad77e7c2d09d9ab0f01e095df8c88
integrated_upstream: a0754e72728d86e1f5b3a3c3973a16fb89e60581
release_to_master: false
---

# 云服务接口拆分风险评估与成果保留

## 结论

**目前建议保留云运行时实现，暂缓拆分 auth/events/V4 的编排和存储流程。** 先明确现有接口和副作用，再决定某一边界是否值得移动。该结论不是“云架构已经理想”，也不是“永不重构”：当前职责集中确有维护成本，但尚未找到一个收益明确、不会迁移安全边界的拆分方案，不能仅凭文件长或重复检查就承担云端回归风险。

本次为静态风险评估，基线 `91b773b7f54ad77e7c2d09d9ab0f01e095df8c88`；不重新认证线上发布资格。没有修改运行时代码、部署配置、测试或 CI，没有访问真实云数据、创建账号或重试历史未知写入。文中的“端口”是代码接口，不是 TCP 端口或新增服务。

## 已有成果保留清单

| 成果 | 精确版本和状态 | 证据与限制 |
| --- | --- | --- |
| 阶段 1/2a：保存失败停止推进、pending 拒绝处理、依赖修正 | [PR #46](https://github.com/smhe00/qwerty-learner/pull/46) 已合并；head `c70ac66ab7e73c25aca81411a3a877e60529a1f1`；merge `a11362de0e93736e2cc68918f1f267f41e45da21` | [原执行报告](ARCHITECTURE-REMEDIATION-20261026-report.md)，不重写历史测试记录 |
| 阶段 2b：构造、提交、浏览器适配与 UI 边界，durable receipt，单一 ReviewRecord writer | [PR #47](https://github.com/smhe00/qwerty-learner/pull/47) 经用户授权合并；head `8c287317307e1560f0e2a820e329cd887b09b9f3`；merge `78d1515a80eeb0848928ef13627139d46ac54457` | [阶段 2b 报告](ARCHITECTURE-PHASE2B-20261026-report.md)；本地原分支、提交及已合并历史保留 |
| 阶段 3a：显式启动结果与错误类型 | [PR #48](https://github.com/smhe00/qwerty-learner/pull/48) OPEN、未合并；head `af98c482af46eee1c3a7a33ec812f5219ac1b853`；实现 `c6838281b598311bbfdd724e95a9533f6202a6eb` | [固定版本报告](https://github.com/smhe00/qwerty-learner/blob/af98c482af46eee1c3a7a33ec812f5219ac1b853/interactive/reports/ARCHITECTURE-PHASE3A-20261026-report.md)，本轮不 amend/rebase 或合并 |

PR #48 本轮检查的四项 CI 为 success：[Performance](https://github.com/smhe00/qwerty-learner/actions/runs/40288127917/job/121456551761)、[Learn Completion](https://github.com/smhe00/qwerty-learner/actions/runs/40288127714/job/121456551224)、[Startup Recovery](https://github.com/smhe00/qwerty-learner/actions/runs/40288127641/job/121456551178)、[Learn Block Sync](https://github.com/smhe00/qwerty-learner/actions/runs/40288127621/job/121456550539)。这不等于外部审查批准，也不等于真实 Cloud/Blob 或物理设备验收。

原阶段 3a 报告记录 67 项 Node 契约、21 项不同浏览器用例、构建和架构门禁通过；首次冷启动超时及定向重跑仍保留。全仓类型诊断为基线 147 / 候选 147、新增 0，**全仓类型检查仍不干净**。这些是既有版本的证据，本轮未重跑，也不扩展为本轮云端保证。

## 现状：已有边界与仍集中的职责

以下源码定位均针对上述评估基线，可用 `git show 91b773b7:<path>` 复核。该清单聚焦拟拆分的主链，不声称穷尽 Circle、管理员及所有后台清理规则。

| 边界 | 当前接口及实际依赖 | 拆分时容易遗漏的职责 |
| --- | --- | --- |
| HTTP 入口 | `cloud-functions/api/[[default]].js:262` 的 `onRequest` 先经过 `withHandoffGateway`；`:176` 创建 Blob storage；`:185` 装配 backend | 请求作用域、运行环境识别、限流、CORS、错误映射和日志阶段；路由还直接处理部分 V4 暂存，不能只包住 core 就认为所有写入口受控 |
| backend 应用接口 | `cloud-functions/_shared/core.js:325` 的 `createBackendService`；`:337` 共享 storage、TTL、保留数、activity/registration guard、credentials；`:1543` 返回公开方法 | authenticate 与活动记录可能连带写入；工厂闭包不是可随意搬移的纯函数集合 |
| Blob 存储适配 | `cloud-functions/_shared/storage/edgeone-blob.js:65` 的 `createEdgeOneBlobStorage` | 已是独立依赖接口；账号、版本、不可变事件、分片和清理共享 key/读回/重试语义，不能再封装成一个隐藏差异的通用 save |
| V4 内容验证 | `cloud-functions/_shared/sync-v4.js` 与浏览器 canonical 实现 | 服务端独立解压、owner、六表、settings、逻辑指纹验证；同语义的跨运行时实现需要一致性测试 |
| 传输与重试 | `src/sync/api.ts:365`、`src/sync/v4-http-part-retry.ts`、`cloud-functions/_shared/safe-body-retry.js` | 认证请求安全重试、不可变分片重试、最终提交未知结果是三种不同契约 |
| 试验性 handoff | `session-handoff-service.js:35`、`session-handoff-context.js:51`、gateway/deployment-policy | 方法白名单、实际副作用追踪、drain、关门后拒绝、停写证明与 unknown；现有试验范围不能因重构扩大到普通账号/生产 |

主要路由族仍在同一 HTTP 入口中：`/api/auth/*` 对应账号和会话；`/api/sync/events/v1`、`events/v2` 对应不可变事件、checkout 与链证明；`/api/sync/v2/*` 承载 V4 的 direct/parts/commit/recovery/binary/meta；另有历史 `/api/sync` 兼容/拒绝入口。**URL 中的 v2 不等于数据格式仍是 Backup V2**，不能为了命名整齐改 URL、格式或移除旧数据读取能力。

可确认的维护负担：HTTP 文件同时装配多个子系统；core 工厂公开方法跨账号、事件、快照；storage 接口较宽；副作用性质不能从 get/read 命名判断。应先让这些事实显式可查，再评估是否搬代码。直接增加 auth/events/V4 三个相互依赖的 service、转发 wrapper 和共享 context，可能只是把原有耦合隐藏起来。

## 必须保存的行为与风险

| 改动触点 | 风险与源码证据 | 本阶段处置 |
| --- | --- | --- |
| 请求体接收 | 入口 `:80–143` 注释记录 Maker stream reader 的尺寸相关失败，当前使用 `arrayBuffer()`；handoff 已读过的 auth body 必须复用同一 promise，包括拒绝，不能 clone/二次消费；UTF-8、声明长度、实际长度检查有不同责任 | 高风险；保持接收原语、大小边界和错误分类，不能按一般 Web 框架习惯替换 |
| 鉴权/副作用顺序 | 入口 `:207–221` 在解析/暂存 V4 前验证当前会话；core 写方法再次执行自身的身份与内容校验；`:196–200` 注入 idle 和管理员行为。handoff-service `:137–146` 明确 read API 也可能写活动元数据 | 高风险；不能去掉“重复鉴权”，不能让一个提前获得的 identity 成为跨请求永久写能力 |
| 存储提交 | Blob adapter `:588–643` 先写分片、逐片强读验证，再发布 manifest；`:674` 起保留旧 Base64 分片路径。失败阶段和 partIndex 用于识别是否可能已提交 | 极高风险；不调整提交/清理顺序、并发数、key、分片大小、保留数或格式 |
| 并发与冲突 | core `:1298–1407` 明确 Blob onlyIfNew **不是原子 CAS**；当前单会话约束仍必要，多会话模式拒绝 V4 写入。适配器条件写/精确读回不能升级描述成数据库事务 | 极高风险；不引入通用自动重试事务，不假设拆出存储层即可支持多写者 |
| 重试/未知结果 | safe-body-retry `:11–28` 只给特定 auth 路由、明确 pre-business 503 一次重试；api.ts `:371–429` 对相同不可变分片进行有界重试并核验回执；core `:1392–1397` 要求模糊提交先查证据 | 极高风险；未知最终提交不重放，不统一成“503 都重试”或“catch 后认为未写入” |
| 保护层装配 | core `:325–334` 以属性是否存在区分普通服务和显式 handoff；显式 null/无效 barrier 必须失败。handoff-service `:48–52` 拒绝未分类方法；context `:62–69` 等待已发出写入并保留 unknown | 极高风险；不能通过默认值、漏传依赖或新增未受控入口降级；不能把所有命名为 read 的操作视为无副作用 |
| 数据一致性与恢复 | 服务端 canonical、owner、六表验证与客户端证据互相核对；客户端 S1/S2/M3/M4 依赖稳定的成功、冲突和未知语义 | 极高风险；schema、身份、摘要和错误意义不变，durable journal、回滚、writer lease 和重载条件原样保留 |
| 试验/生产身份 | `AGENTS.md` 与 `runtime-environment.js`、handoff deployment policy 规定只有可信服务端精确 `branch=etest` 可以开启试验 | 极高风险；不改开关来源、不从 URL/Host 推断权限，不扩大试验覆盖范围 |

### 不能当作无效冗余删除的机制

- 传输 SHA 与逻辑 fingerprint 分别证明字节和逻辑内容；本地成功、HTTP 回执、云端精确读回也不是同一种证据。
- 不可变分片的重试与最终 manifest 提交的未知处理不同；Blob 层的同内容确认不授权应用层重发整个事务。
- HTTP 入口与 backend 的身份/内容验证服务于不同调用边界，不能只留下外层检查。
- 浏览器与 Node canonical 代码有跨运行时约束。可先强化 parity 契约，不能仅因相似就移动到一个新依赖链中。
- 旧 V4 Base64 读取、升级路径与新 binary 路径共存属于数据兼容责任；在没有完整读者/数据迁移证据前不能按“旧代码”删除。
- handoff 与普通路径有不同部署资格；Circle、idle、administrator 也可能写存储。保留显式覆盖范围，不把未纳入的写者默认为例外。

这不是宣布所有冗余都合理；它将安全机制从候选清理项中排除。真正的死代码需另证明无静态/动态调用、无兼容入口、无恢复职责，并确认删除不会改变打包和运行时装配。

## 调整后的推进顺序与准入门槛

| 步骤 | 可交付结果 | 准入与停止条件 |
| --- | --- | --- |
| 3b-1，当前完成 | 本报告、成果索引、接口与副作用清单、原计划调整；运行时代码保持基线 | 独立文档 PR；不与 PR #48 混合，不改变 etest 固定候选 |
| 3b-2，优先后续 | 为一个具体维护痛点补齐调用者/副作用/失败矩阵；必要时增加缺失的边界契约测试 | 测试必须断言外部效果和写入顺序；现有覆盖已足够则不重复建设。独立开发，不共用真实测试账号、不推进他人验收中的 etest |
| 3b-3，可选 | 只提取证明确为纯逻辑、被重复修改且收益明确的叶子函数；一次一个边界 | 无 storage、request body、session、clock、journal 或隐含环境依赖；输出和异常完全一致。出现新转发层/循环依赖或额外网络调用则退回设计 |
| auth/events/V4 编排拆分，暂缓 | 只有现有契约仍不能解决维护痛点时才提出具体方案 | 必须证明权限、顺序、状态所有权、未知结果可保持；有影响真实 Cloud/Blob 的运行时变更必须安排独立资格验证，不与 UI/格式迁移/性能改写打包 |
| 阶段 4，可先继续 | 文档→实现→测试映射，过时说明和 manifest/触发路径核对 | 先做只读审计及文档，改变门禁需独立行为证据；不删除失败项，不减弱安全断言 |

具体候选必须回答：解决了哪一项实际修改困难；删除了哪些跨层依赖；所有调用者如何迁移；谁拥有状态和副作用；失败在哪里停止；是否增加网络请求/存储写入；如何验证并撤回。只减少行数或将原函数再包一层，不构成实施理由。

## 后续运行时变更必须具备的验证证据

下表是**已核对存在的契约文件和未来验证要求**，不是本轮运行结果。按触点选择适用集合，不能以全量数量代替相关性。

| 触点 | 必须保留的故障对照 | 现有验证入口 |
| --- | --- | --- |
| auth/body/gateway | 无效或撤销会话先拒绝；body 接收失败仅一次安全重试；未读取两次；普通 500/503 不重放 | `tests/cloud/s2-write-route.test.mjs`、`safe-body-retry.test.mjs`、`session-handoff-gateway.test.mjs` |
| 不可变分片 | 丢 ACK 后仅相同对象重试；坏 SHA、缺片、错 owner 不提交；失败等待在途请求结束 | `v4-http-parts.test.mjs`、`v4-http-part-retry.test.mjs` |
| Blob/最终提交 | 分片失败不推进 revision；manifest 已落地但响应丢失保持未知并只读确认；精确读回错字节不能确认成功；stale base 拒绝 | `edgeone-blob-storage.test.mjs`、`v4-commit-outcome.test.mjs`、`backend-core.test.mjs` |
| 校验/兼容 | Node/browser 同指纹；六表/Unicode/settings/owner 校验；Base64 与 binary 互读、升级保持逻辑内容 | `sync-v4-server.test.mjs`、`v4-http-parts.test.mjs`；必要时真实浏览器 V4 用例 |
| handoff 装配 | 新方法不绕过分类；guard 内再次核对身份；活动/清理失败不能误报安全释放；scope 关闭后禁止延迟写；普通生产账号不开启试验 | `session-handoff-service.test.mjs`、`session-handoff-gateway.test.mjs`、`session-handoff-production-off.test.mjs`、`session-handoff-stopped.test.mjs` |
| 跨端恢复语义 | 成功/冲突/未知映射不变；S1/S2/M4 journal 未决不挂载或继续写；旧会话失效、reload/owner 检查不变 | 原阶段 3a 契约及针对受影响恢复路径的 browser 用例 |

若真正实施拆分，应以同输入、同故障注入对照基线和候选的状态码、错误 code/details、持久化字节/key、请求数量、写入顺序和恢复动作；时间/随机数只在测试中注入固定值，不能放宽产品判断。快照日志相似或类型通过不能替代行为对照。

本地模拟不能证明 Maker body 接收、Blob 一致性/尺寸限制、部署环境绑定和真实丢 ACK 行为。涉及这些边界的候选，后续必须按项目流程取得同 SHA 的实际 etest Cloud/Blob 证据；master 发布还需明确授权、同 SHA Pages 与 release-ready，不能复用旧版本通过记录。本轮不推进 etest，也不为评估主动触发真实账号测试。

## 并行任务、回退与交付限制

初次 fetch 发现 product/main 从 `78d1515` 前进到 `91b773b`。另一任务早期报告曾记录：旧门禁要求主线与 etest 相同，PR #47 的合并导致旧候选资格需要调整。该报告还保留历史 503、丢 ACK 及未确认清理记录。**这是其他任务的报告证据，不是本任务重新验证的云状态，也不授权重试其操作。**

交付前再次 fetch，上游前进到 `a0754e72728d86e1f5b3a3c3973a16fb89e60581`，新增用户明确的独立分支规则及门禁实现：**main 持续开发，etest 独立固定候选，master 只快进到精确合格候选；允许 master → etest → main 的祖先关系，main/Pages 前进不使旧候选已有的同 SHA 证据失效。** 这替代了上述早期假设，不应冻结开发或为主线推进强迫更换 etest 候选。

本任务独立分支从 `91b773b` 建立，交付前已快进纳入 `a0754e7`，无冲突。两版本之间 `cloud-functions/` 与 `src/` 均无变更，静态风险结论和源码定位仍适用；上游 CI/发布策略变更不计为本任务修改或验证。本轮不合并 PR #48 或本文档 PR，不改 CURRENT_TASK、对方报告或任何部署分支；这是本轮评估范围，不是阻止主线继续开发的要求。

成果以原分支/不可变提交/PR/报告保存，不新建重复的业务实现。未来代码回退用可追踪提交并遵循部署资格，不重写历史；**回退代码不等于回退用户数据**。若曾发生云写入或本地迁移，应先检查 durable journal、owner、revision、SHA 与 fingerprint，保留恢复日志和现场，不清存储、不盲目重放、不把旧快照覆盖回去。

本次交付文件仅为原整改计划、新评估任务及本报告。验证为文档范围/链接、`git diff --check` 与已有分支提交核对；应用测试、构建、真实云和物理设备测试均 NOT_RUN。没有声称整个架构整改或发布审计已完成。

保存提交 `bdfa6723eec634e8c991885129d6d12a3095101a` 已推送独立分支并建立 [草稿 PR #49](https://github.com/smhe00/qwerty-learner/pull/49)。随后交付检查发现主线为 `12c2069469c0c00d85f2e9c238eb4e2c2b955f01`，较已集成的 a0754e7 仅增加另一任务的状态/发布报告，不涉及本任务文件或运行时代码，无需为本次评估重复合并。PR #49 的三文件差异保持隔离；PR #48 远端 head 仍为 af98c482，本地前期分支和已合并历史均保留。远端已不再提供阶段 2b 分支，删除的仅是本 clone 中该失效 fetch 配置，不删除任何本地分支或提交。

精确后续起点：保留 PR #48，后续依审查结果和用户授权决定合并；主线开发可与 etest 固定候选验收独立进行。优先进行阶段 4 的文档/契约映射，或为一个有证据的云维护痛点补边界矩阵；在满足本报告准入要求前，不开始云编排拆分。
