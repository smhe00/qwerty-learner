---
protocol_version: '1.1'
task_id: ARCHITECTURE-REMEDIATION-20261026
status: IN_PROGRESS
executor: Codex
target_branch: codex/architecture-remediation-phase1-20261026
claim_base_commit: 98697131d09393a479f30da9eb9b117e8117a0e7
start_commit: 98697131d09393a479f30da9eb9b117e8117a0e7
release_to_master: false
---

# 架构整改执行报告

## 范围与阶段

分阶段计划及验收条件见 `interactive/tasks/ARCHITECTURE-REMEDIATION-20261026.md`。本批只交付阶段 1 与 2a。使用独立 clone/分支；没有接管 CURRENT_TASK 指向的发布任务，没有直接修改 product/main、edgeone-test、master。

## 根因与阶段 1

`useSaveWordRecord` 在事务失败时返回 -1；桌面 Word 未校验成功 ID，并在 catch/finally 中继续通知完成。触屏已有失败校验，但两入口未共享契约。

- 桌面 Learn 只有正整数持久化 ID 才允许完成，失败时保留冻结答题证据和当前队列，显示存储错误与手动重试。
- 同一保存只允许一个进行中请求；成功后不允许再次写原始记录。离开页面后允许已启动事务完成，但不调用旧组件完成回调。
- 成功 ID 附到完成结果；普通 Typing 失败行为保留。
- CI 的 Learn Completion Journey 增加本地保存故障回归及对应路径触发。

## 已执行验证（持续追加）

- 修复前：新增 negative-id Playwright 用例失败，缺少错误提示；此前审计的实际函数注入也证明 -1/throw 都调用完成。
- 修复后：负 ID、QuotaExceededError、真实 Dexie 事务 abort、最后一词不误结算 4/4；页面切换后不执行旧完成回调 1/1。前三项均验证第二次失败仍可重试、同时双击仅一次写入、成功仅一条记录、原始证据不重算。
- 现有 mobile-review-commit-contract 6/6。
- 修改桌面源码 ESLint：0 errors、1 个已有 hook 依赖 warning。
- 环境记录：Playwright 对 localhost 的探测最初被代理响应误判为端口占用；仅对测试进程设置 NO_PROXY=127.0.0.1,localhost 后正常执行，没有停止或复用其他任务服务。Yarn 在只读沙箱创建临时目录失败后，静态检查改用本地 node 直接启动工具。

## 尚未执行/剩余

阶段 2a、完整本批静态检查/构建/成功流程回归和上游分歧核查待完成。真实 Cloud/Blob、发布门禁、物理手机测试未执行，本批也不宣称这些验证通过。

## 安全约束

没有改变 schema、attemptId、合并、鉴权、会话隔离、云传输、回滚日志或 S1/S2/M3/M4。新增失败注入只在 Playwright 页面环境替换依赖，不在产品内增加调试入口。
