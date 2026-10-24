# 启动 / 登录完整 V4 同步修复与 eTest 验收

日期：2026-10-24。执行者：Codex，单一执行者。应用验收通过；原始清理失败独立保留。

## 当前部署与授权边界

- product/main 与 edgeone-test：1bce4bfa2afc4c712338bebc4bb6303293c8100d。
- eTest 实际 source-commit.txt：1bce4bf；真实浏览器实验使用 https://t.smhe.cn/。
- master 与正式站 https://q.smhe.cn/：a2dc907c9c0f6e8924f441fa360ebabd317233dd / a2dc907，未改动、未发布。
- 全部线上实验仅使用新建的 eTest 隔离账号。没有登录或修改任何正式用户账号、备份或学习记录。
- 本最终报告经用户授权保存于独立文档分支 codex/login-v4-etest-report-20261024，应用分支保持已验收 SHA，避免为报告触发额外 Maker 发布。

## 结论：启动实际执行了什么

普通学习入口（根目录、/learn、/mobile、/mobile/study，普通无工具查询）的已隔离账号，在有效会话、联网、允许域名及 S2 开关开启时，于 S1 独占写锁内先检查完整 V4。

1. 刷新已知写入者；并行读取云端 metadata、当前账号完整本地快照与基线。
2. 内容相同：noop；可证明的单边本地变化：revision CAS 上传。
3. 可证明的单边云端变化 / 空白本地副本：下载 binary manifest 和 pinned parts，检查 SHA、指纹、账号、revision，保存原本地快照，暂存持久化 Pull 日志。
4. 重新加载后，在任何 React / 学习写入者挂载前恢复六表、会话、设置和导航；再次读取实际本地内容验证，然后完成基线与日志事务。
5. 随后进行 M3 不可变事件发布及 M4 可验证事件前缀采用。该证据不代表所有设备或全部历史收敛。

账户管理、导入、恢复、工具页面，以及匿名、离线、过期会话、Pages / cloud-disabled，不进入普通启动的新增自动流程。

**双端历史都有变化，或无共同基线的已有本地历史，仍明确 conflict / pending，保留双方；没有实现任意六表历史的通用融合。旧记录缺少有效 attemptId 时，M3/M4 的保守阻断仍保留，不能补造身份或绕过审计。**

## 源码审计定位（固定版本）

以下行号均针对固定 SHA。master 仍是 a2dc907；product/main、edgeone-test 和 PR #32 合并后的最终应用是1bce4bfa。PR #33 只改变测试与准入，没有改变应用或 Cloud API。

| 检查点 | 文件与行号 | 实际含义 |
| --- | --- | --- |
| 正式域名 | [master learning-sync-policy.ts:3](https://github.com/smhe00/qwerty-learner/blob/a2dc907c9c0f6e8924f441fa360ebabd317233dd/src/sync/learning-sync-policy.ts#L3) | q.smhe.cn 明确允许；Pages、全局禁用仍优先。并非只允许 eTest 的域名门控 |
| 原 master 启动 | [workspace-bootstrap.ts:220](https://github.com/smhe00/qwerty-learner/blob/a2dc907c9c0f6e8924f441fa360ebabd317233dd/src/sync/workspace-bootstrap.ts#L220) | 只进入 M3/M4 事件前缀流程，普通启动没有新增的完整 S2 preflight |
| 原 master 重新登录 | [workspace-account-ui.ts:153](https://github.com/smhe00/qwerty-learner/blob/a2dc907c9c0f6e8924f441fa360ebabd317233dd/src/sync/workspace-account-ui.ts#L153)、[191](https://github.com/smhe00/qwerty-learner/blob/a2dc907c9c0f6e8924f441fa360ebabd317233dd/src/sync/workspace-account-ui.ts#L191) | M3→M4，blocked / 异常主要记日志，最后仍报告登录成功；不能据此声称完整云历史已下载 |
| 环境变量 | [.env.production:1](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/.env.production#L1)、[api.ts:48](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/api.ts#L48) | BASE_URL 为空，同源 /api；S2=true。Pages / VITE_QWERTY_SYNC_DISABLED 阻止请求。构建平台可以覆盖变量，仓库默认不能证明远程控制台的全部值 |
| EdgeOne 路由 | [edgeone.json:11](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/edgeone.json#L11)、[api/[[default]].js:639](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/cloud-functions/api/%5B%5Bdefault%5D%5D.js#L639) | SPA fallback 至 index.html；实际 API catchall 单独提供 manifest / pinned part / meta。成功的真实 API 与浏览器实验说明 eTest 的 API 未被 SPA fallback 吞掉 |
| 服务端开关 | [api/[[default]].js:178](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/cloud-functions/api/%5B%5Bdefault%5D%5D.js#L178)、[s2-write-gate.js:10](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/cloud-functions/_shared/s2-write-gate.js#L10)、[etest-pilot-origin.js:2](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/cloud-functions/_shared/etest-pilot-origin.js#L2) | S2_SYNC_WRITES_DISABLED 可关写；旧账号 allowlist 被忽略。t 域名检测只是诊断，不作为数据写授权；会话、账号绑定和 CAS 仍必需 |
| 新启动与登录接线 | [workspace-bootstrap.ts:224](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/workspace-bootstrap.ts#L224)、[workspace-account-ui.ts:159](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/workspace-account-ui.ts#L159) | 完整 S2 先于 M3/M4；网络失败、历史冲突和事件采用的提示分开 |
| S2 实际 metadata | [v2-browser-executor.ts:59](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/v2-browser-executor.ts#L59)、[v2-manual-executor.ts:95](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/v2-manual-executor.ts#L95)、[api.ts:198](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/api.ts#L198) | flush 后并行获取本地快照、基线、GET /api/sync/v2/meta；blocked/conflict 在下载或上传前返回 |
| S2 完整下载与恢复 | [api.ts:466](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/api.ts#L466)、[v2-manual-executor.ts:171](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/v2-manual-executor.ts#L171)、[workspace-bootstrap.ts:189](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/workspace-bootstrap.ts#L189) | binary manifest→pinned parts→校验→重读metadata→备份原本地→持久化Pull日志→新文档挂载前恢复 |
| M3 无网络也可能 blocked | [m3-publication-browser.ts:24](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/m3-publication-browser.ts#L24)、[multi-device-recovery.ts:26](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/multi-device-recovery.ts#L26) | 域名、认证、工作区或旧/坏 attempt 扫描均可在发布前阻断。checkout 的附带检查不能代替完整 S2 |
| M4 仅事件融合 | [m4-witnessed-prefix-browser.ts:119](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/m4-witnessed-prefix-browser.ts#L119)、[m4-witnessed-prefix-candidate.ts:113](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/m4-witnessed-prefix-candidate.ts#L113)、[217](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/m4-witnessed-prefix-candidate.ts#L217) | 发布blocked则不接收；服务端验证的事件前缀只推进 wordRecords / reviewWordStates，其他四表受保护；convergenceComplete=false |
| 可见失败提示 | [account-login-v4-check.ts:18](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/account-login-v4-check.ts#L18)、[49](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/src/sync/account-login-v4-check.ts#L49)、[vite.config.ts:66](https://github.com/smhe00/qwerty-learner/blob/1bce4bfa2afc4c712338bebc4bb6303293c8100d/vite.config.ts#L66) | 明确区分未执行、检查后冲突、无损审计失败与传输失败；生产构建移除console，原有警告不能当用户通知 |

因此不能把“没同步”一律归因于域名或合并失败：原 master 缺完整检查接线；新代码需分别判断未进入、已发metadata后拒绝、成功单边下载、仅事件前缀采用。

## 后续安全修复建议

- 任意旧账号 / 双端历史的一般融合仍需单独设计按表规则、稳定身份、去重和回滚，先导出两侧不可变证据，在新隔离账号验证；不得用云覆盖本地、补造 attemptId 或清空基线来通过测试。
- eTest DELETE / 重新认证偶发500需另查服务端请求日志和存储结果。未知删除不能自动重放；原身份无法重新核验时保留“未确认”，不能用新账号成功清理替代原事件结论。
- master 保持原版本，生产仍存在原启动接线问题；是否发布需另行明确授权。远程构建变量与管理员控制台未作为已完整审计的证据。

## 修复文件

- src/sync/account-login-v4-check.ts：登录及启动复用的完整 S2 admission；开关一致、禁用时不初始化 RecordDB 模块、失败 / 冲突可见。
- src/sync/account-startup-v4.ts、workspace-bootstrap.ts、src/index.tsx：限定普通启动入口、完整 V4 检查和 Pull 暂存后的新文档恢复。
- workspace-account-ui.ts：S2 先于 M3/M4；分开认证成功、事件前缀采用、完整历史未确认；保留未发布事件提示。
- workspace-v4-browser.ts、m4-lossless-idb-compare.ts：临时 IndexedDB 六表按稳定主键无损回读、共享引用拓扑核对，负零不能无损导出时拒绝；不重写原始学习行。
- .env.production：移除过时的仅 t 域名 pilot 说明。实际允许域名仍由 learning-sync-policy.ts 控制。
- tests/cloud/account-login-v4-check.test.mjs：禁用 / 离线 / 账号未就绪、noop、push、Pull 暂存、冲突、审计 / 未知传输失败不重试、普通启动入口合同。
- tests/e2e/etest-login-v4-history.*：真正部署的两个隔离浏览器、历史六表、故意失败一次登录 metadata 后的独立普通启动下载、双端分歧内容保护、身份核验清理。

## 顺序及验证证据

用户要求：先合并 product/main，再同步 eTest；没有 master 发布授权。

| 阶段 | 实际结果 / 证据 |
| --- | --- |
| PR #32 候选 38fe5ddf | 7 项 check 全通过；完整安全 https://github.com/smhe00/qwerty-learner/actions/runs/40041410119 ，含 S1 / Cloud / Review / Mobile |
| 第一次 main 合并 cc37bc45 | https://github.com/smhe00/qwerty-learner/pull/32 |
| cc37bc45 main 准入 | Pages40042674926、Cloud40042674916、独立准入40042674980 均 PASS 后，才正常快进 eTest |
| 测试定位器修正 PR #33 | https://github.com/smhe00/qwerty-learner/pull/33 。只改测试定位器、准入触发范围和报告；应用 src / Cloud API / public 不变 |
| 最终 main 1bce4bfa 准入 | Pages https://github.com/smhe00/qwerty-learner/actions/runs/40044000708 、Cloud https://github.com/smhe00/qwerty-learner/actions/runs/40044000704 、独立准入 https://github.com/smhe00/qwerty-learner/actions/runs/40044000766 全 PASS 后，才正常快进 eTest |
| 最终三设备真实 Learn | PASS https://github.com/smhe00/qwerty-learner/actions/runs/40044357798 |
| 最终单会话 M3 接力 | PASS https://github.com/smhe00/qwerty-learner/actions/runs/40044357397 |
| 最终真实 Blob / 浏览器 / 同 SHA 技术准入 | PASS https://github.com/smhe00/qwerty-learner/actions/runs/40044357504 。不构成 master 发布授权 |
| 最终历史六表应用证明 | 全部应用断言通过 https://github.com/smhe00/qwerty-learner/actions/runs/40044357407 ，第1轮整体因清理 DELETE500 保持失败；第2轮新隔离账号整体 PASS，详见下节 |

本地：构建 PASS；登录 / 启动合同12项 PASS；相关合同初轮92/92，新增启动项另测通过；会话撤销4/4；20种子 / 100动作 fuzz5/5。完整 S1 117项在最终候选 CI PASS。

TypeScript：与 a2dc907c 基线的真实编译对照均144条诊断，新增0；全库 tsc 仍非全绿。全库 lint0错误、129警告。没有更改依赖或放宽数据断言。

## 完整历史实验：实际数据证明

历史夹具包含：wordRecords3、chapterRecords1、reviewRecords64、reviewWordStates1、achievementEvents1、achievementStates1。ReviewRecord 索引38有共享 words 引用。

最终1bce4bfa第1轮所有应用证明均为 true：

- ordinaryStartupRecoveredFullV4：故意让登录 metadata 失败一次，后续普通启动自己完成完整云端下载恢复。
- sixTablePullExact：六表独立内容摘要与源端完全一致；不是只比较行数。
- sharedReferencePreserved：实际导入后共享引用仍保留。
- conflictPreservesBoth：两端各自新增不同历史后，本地两侧内容均完整保留。
- cloudRevisionUnchanged：冲突时云端 revision 与 fingerprint 不变，并且没有发出任何 POST 写请求。

脱敏证明：interactive/evidence/CODEX-P0-LOGIN-V4-ETEST-20261024-attempt1-redacted.json。只含版本、布尔值、计数和清理状态，无账号、令牌、词条或原始备份。

## 失败保留与清理边界

- 早期本地会话测试把 token 已写入误当作账号文档交接结束，导致 readback goto 被 location.replace 中断。改为等待真实根页面与应用就绪；原账号 / 记录 / 日志断言全部保留，4/4通过。
- Review 夹具在初始 S1 页面完成挂载前注入模块，遇到文档替换；等待真实应用挂载后注入，20种子 / 100动作及 checkpoint 前后持久化断言通过。
- 首轮 cc37bc4 历史实验已证明启动下载和六表一致，之后 role=status 匹配3个元素而停止。限定冲突提示后，独立真实浏览器完整实验通过，清理200。没有把首轮未执行的后续断言记为通过。
- M3 40043194200 第1轮：应用 PASS，清理前重新认证 HTTP500；DELETE 未执行，清理未确认。第2轮用不同新账号整体 PASS。
- 最终历史40044357407 第1轮：所有应用证明 PASS，DELETE HTTP500，删除结果不明，未重试该删除。原运行的随机密码未保存，也没有可用的明确 staging 管理凭证，不能绕过身份核验声称已清理。
- 两个原始清理事件均属于本次新建的 eTest 测试身份，与正式用户无关。不能宣称所有历史测试账号均已删除。
- cc37bc4 的历史 Maker 别名双站 Explorer 11/12，旧移动端说明断言失败（40042674956）；不计为通过，也不在本次 t.smhe.cn 同步验收范围内。
- 旧 cc37bc4 Branch E2E 的 Blob / 浏览器通过，随后因 main 已前进到1bce4bfa，同 SHA 准入正确拒绝；最终1bce4bfa同 SHA准入已通过。

## 新账号复核最终状态

最终 SHA 1bce4bfa 的第2轮（job 120745192097，2026-10-24 01:58 UTC）整体 SUCCESS，1项真实浏览器实验通过（1.4分钟）。ordinaryStartupRecoveredFullV4、sixTablePullExact、sharedReferencePreserved、conflictPreservesBoth、cloudRevisionUnchanged 均为 true；cleanupStatus=200、cleanupVerified=true。

链接：https://github.com/smhe00/qwerty-learner/actions/runs/40044357407/attempts/2 。本轮使用全新身份，并非重试第1轮的未知 DELETE；此前两个测试身份的清理未确认状态保持。脱敏日志同步保存于 interactive/evidence/CODEX-P0-LOGIN-V4-ETEST-20261024-attempt2-redacted.json。

## 使用限制

本次合格范围是普通启动 / 登录的完整 S2 检查、安全单边同步、持久化恢复与受支持事件前缀采用；不承诺任意旧数据或双端历史的一般融合，不声称所有设备历史完整性。离线、过期、旧身份和未知状态继续保留本机数据并失败关闭。

没有修改 master，没有生产发布，没有生产用户数据操作，没有把模糊云端写入自动重放。
