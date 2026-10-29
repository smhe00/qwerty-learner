# CI 修复与远端事件重复上传修复

执行基线：`6f5c9026d9949b219cf8bec0042341243b84f463`。修复提交：`d094a45ad4037ce18e8913b7fa8bc05ad1fecb1f`。当前阶段：REVIEW。原四项失败 CI 全部通过，etest 9 项实网回归全部通过。独立于 Circle 性能任务，CURRENT_TASK 不变，master 不发布。

## 已确认原因和修复

1. Mobile P0 `40801097802` 指定已删除的 `chrome` 项目名。修正调用，执行六种屏幕/配色项目。
2. 双站 Explorer `40801097859` 仍要求 Pages 账号入口不存在。改为验证入口存在、能提交本地预览并返回、无认证凭据和 API 请求；云同步禁用断言保留。
3. Review Gate `40801097715` 用“开始”模糊匹配两个按钮。改为 exact 精确匹配，不移除真实按钮；其余 124 项在原运行中通过。
4. Etest `40798830071`：M4 接收并成功恢复远端事件后，没有把已验证云端证据记入本机 outbox 去重映射。下一次登录扫描六张表中的 wordRecords，又把这些事件当作未上传，产生 POST 加安全读回 GET。历史不变时 M4 自身已走 verified-prefix-already-local，失败不是 M4 重新恢复全量历史。

## 安全边界

- 复用现有账号/设备隔离的 `confirmedEvidence` 映射，不增加数据表、版本或词条字段。它仅用于防止相同不可变事件再次入队，不代表全账号已同步。
- 只有完整远端链校验、独立候选审计以及 M4 本机事务提交全部成功之后，才补记精确远端事件。普通 V4 导入、Blob 列表和缓存头都不会调用此入口。
- 复用原有事件规范化和 UUID 冲突检查，冲突不能部分更新；不推进本设备 confirmedHead、不伪造序号或收据。
- 已经在途的批次及其 pending 行保留原字节；任何实际发布仍须 POST 后 exact GET 校验才能推进链。
- M4 与 outbox 属于不同 IDB，不能原子提交。补记失败只可能留下重复上传，仍必须返回 adopted 并完成原有重载；不能把已提交 M4 误当作未恢复而继续挂载旧内存状态。
- 历史登录实网回归保留 GET=0 断言，并新增 POST=0，防止只放宽断言掩盖冗余上传。

## 本地验证

- 事件 outbox、publisher、recovery、witnessed receiver、M4 candidate、checkout：52 通过。
- M4 合并事务故障/恢复单测：11 通过。
- Chromium 实际 IndexedDB/M4 journal：12 通过（含新增确认信息跨刷新持久化、账号隔离、矛盾写入不改变旧状态）。
- 原 Review 失败用例：Chromium 1 通过。本地没有 branded Chrome，使用临时 Chromium 配置；CI 继续使用原 Chrome 配置。
- 与修复工作流完全相同的 Pages 登录命令：20 通过，4 个设备不适用组合跳过。
- 修改源码 ESLint：0 错误、5 个原有警告。
- Pages 生产构建通过；TypeScript 基线 143 / 当前 143，无新增诊断。
- 双站 Explorer 本地线上预检：首次缺少必需的 PAGES_SOURCE_SHA 参数，补充后遇到静态 JS 503；未修改产品代码或降低断言。原断言不变重试 1 通过；最终仍以本次精确提交 CI 为准。

## 发布范围

Pages 发布/界面、Cloud Sync 和 etest 准入全部成功后，快进 edgeone-test 到同一修复 SHA。一次性测试账号由既有 CI 创建并清理。最终报告仅提交 product/main，不再次构建 etest，不推进 master。


## 精确提交远端验证

所有链接均对应修复提交 `d094a45ad4037ce18e8913b7fa8bc05ad1fecb1f`。

- [Review Gate](https://github.com/smhe00/qwerty-learner/actions/runs/40810752581)：成功。
- [Mobile P0 Gate](https://github.com/smhe00/qwerty-learner/actions/runs/40810752474)：成功。
- [Published Dual-Site Explorer](https://github.com/smhe00/qwerty-learner/actions/runs/40810752506)：成功。
- [Pages 发布与线上回归](https://github.com/smhe00/qwerty-learner/actions/runs/40810752509)：成功，含 Pages/EdgeOne 双构建界面门禁。
- [Cloud Sync Gate](https://github.com/smhe00/qwerty-learner/actions/runs/40810752471)：成功。
- [Etest 准入](https://github.com/smhe00/qwerty-learner/actions/runs/40810752491)：成功。

edgeone-test 已由 `9ef113301f2a03b8f4528621e5eefda076672f24` 快进到修复提交。2026-10-29 11:22:50（北京时间）实站 source-commit.txt 已确认 `d094a45`。master 保持 `ad862b392c6a935ca49514fc9df146932aa02ed2`。

Etest 原失败场景：[历史登录回归](https://github.com/smhe00/qwerty-learner/actions/runs/40811538832) 成功。无新增学习的重新登录事件 POST=0、GET=0，额外 M4 capture=0；六表精确恢复、分叉合并收敛、重新登录记录保留及临时账号清理均通过。

Etest 自动回归 9/9 成功：历史登录、分段历史恢复、安全 V4 合并写回、账号清理结果、自动空闲清理、学习完成云端旅程、M3 设备接力、三设备离线接力、Branch EdgeOne Cloud E2E。精确运行编号及状态见 [证据快照](evidence/CI-REPAIR-20261029.json)。

main 的 11 项已完成检查全部成功；独立 Pages Explorer Agent（40810752410）仍在运行，不将其记为通过，也不声称全部 CI 已结束。上述原四项故障已全部闭环。

## 性能边界和剩余风险

无变化重新登录本次仍耗时 31.346 秒。主要阶段 remote-meta 5.951 秒、M4 observe 5.573 秒、M4 witness 11.169 秒；guarded-bootstrap 合计 23.678 秒（包含子阶段，不应再与子阶段相加）。本次修复消除了重复事件传输，不代表完整登录已达到快速启动目标，后续需要单独测量、优化元数据和见证请求。proof 中 publications=1 表示发布阶段被调用一次，不是一次事件 POST。

既有 source-rows 快速审计未通过后，fallback-roundtrip-audit 通过；保留回退与安全读回流程，不为缩短时间绕过验证。M4 与 outbox 跨 IDB 的崩溃窗口可能仍导致冗余传输，但不丢学习记录、不跳过恢复重载。实际 iOS/HarmonyOS 设备未在本次验证，不将 Chromium 证据解释为所有终端零缺陷。

## 提交文件

修复提交改动 12 个文件：Mobile P0 workflow；M4 browser、outbox reducer 和 IDB；outbox 单测；E2E backup harness、历史登录、learn-shell、双站 Explorer、M4 journal；本任务及报告。结项提交仅更新本任务、报告与脱敏证据。CURRENT_TASK 保持原 Circle 任务。
