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

真实 Cloud/Blob、发布门禁、物理手机测试未执行，本批也不宣称这些验证通过。阶段 2b–5 按计划后续独立推进。

## 阶段 2a：接口与依赖

- `learn/durable-word-record.ts` 为桌面和触屏提供同一持久化 ID 校验，拒绝负值、0、非有限值、非整数和不安全整数。仍是本地记录 ID，不是云端回执。
- 原始 `add()` 已成功后，UI 通知或 M3 policy 读取异常不会覆盖成功结果，避免误提示失败而诱导重复写入；原有成就/M3 恢复职责保留。
- `trackLearnPersistence` 改为双结果清理，不再让 `finally()` 生成未被消费的拒绝 promise；仍把原 promise 返回调用者，flush 继续等待后续派生写入。
- ReviewRecord 的时间工具改为叶模块导入，切断 `review-record → utils → mixpanel → store → reviewInfoAtom → review-record`。边界检查增加此适配器的反向依赖约束；不宣称所有模块循环已清理。
- 新增 6 个执行真实模块的持久化边界测试、2 个架构门禁正反例；不再只依靠正则检查源码字符串。

## 阶段 2a 验证

- 新增浏览器故障回归 6/6；包含真实事务 abort、重复失败及双击恢复、最后一词、离开页面、FSRS 派生失败无未处理拒绝。
- `node --test tests/learn/persistence-boundary.test.mjs` 6/6；`persistence-architecture.test.mjs` 2/2；既有 mobile contract 6/6。
- `yarn playwright test --config=tests/e2e/learn-completion-journey.config.ts` 12/12，包括 guarded V4 本地路由夹具；这不是实网云证明。
- Review 定向 5/5：多词完成、Typing 不重开 Learn、桌面 Tap Recall 的纠错/暂停/按住键、触屏键盘连续提交、新词独立回忆准入。
- 六个修改源码 ESLint：0 errors，1 个历史 warning（Word hook 依赖）。
- `tsc --noEmit` 全仓仍失败。用 TypeScript 编译器对 98697131 的变更文件做虚拟回读对照，基线/当前均 147 项诊断，按文件/错误码/消息多重集比较新增 0；没有改 tsconfig 或屏蔽错误。修改文件内仍有 5 项原有诊断（ES5 Set/Map 迭代及其推导错误），不能声称全仓或全部修改文件类型检查干净。
- `yarn build` PASS，4366 模块；保留既有大 chunk/use client/Browserslist 提示。`git diff --check` PASS。
- 测试编写过程中首次存储适配器单测夹具遗漏 ReviewRecord.words，修正夹具为 words=[] 后 6/6；没有更改产品断言来通过测试。

## Git 检查点

- 阶段 1：`fd5b547`。
- 推送前 fetch 发现上游从 98697131 前进到 8356b50（恢复测试站 UI 与直达账号入口）。没有重叠修改本批 WordPanel/db/learn 核心文件；在本任务分支正常 merge 后补集成验证，保留对方全部提交，不反向撤销或覆盖。

## 安全约束

没有改变 schema、attemptId、合并、鉴权、会话隔离、云传输、回滚日志或 S1/S2/M3/M4。新增失败注入只在 Playwright 页面环境替换依赖，不在产品内增加调试入口。
