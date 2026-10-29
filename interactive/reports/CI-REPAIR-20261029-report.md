# CI 修复与远端事件重复上传修复

执行基线：`6f5c9026d9949b219cf8bec0042341243b84f463`。当前阶段：本地验证完成，准备 main CI 和 etest 实网验证。独立于 Circle 性能任务，CURRENT_TASK 不变，master 不发布。

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

## 远端验证待办

先等待本次提交的 Pages 发布/界面、Cloud Sync、Review、Mobile P0、双站 Explorer。满足 etest 准入后快进 edgeone-test 到该精确 SHA，等待 source-commit.txt 更新，再检查历史登录和其他自动云端回归。一次性测试账号只由既有 CI 创建并清理。不直接推进 master。
