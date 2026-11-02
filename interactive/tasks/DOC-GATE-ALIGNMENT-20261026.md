---
protocol_version: '1.1'
task_id: DOC-GATE-ALIGNMENT-20261026
status: REVIEW
executor: Codex
target_branch: codex/docs-gate-alignment-20261026
base_commit: 875c82a2c404b441dc582aa3a018288edeed1f9a
allow_parallel_executors: false
report_file: interactive/reports/DOC-GATE-ALIGNMENT-20261026-report.md
release_to_master: false
---

# 文档与验证映射对齐

用户在只读审计后要求“处理吧”。执行上一轮建议的文档优先范围：修正主线整改状态、历史部署说明、同步规范、回归目录及测试与实际门禁的映射。云相关运行时重构已取消，不重新打开或合并 #48/#49。

## 范围与隔离

使用已有独立 clone `C:/Users/peter/Documents/Codex/2026-10-26/qwerty-architecture-remediation` 的新分支，从上述 product/main 基线开始。只改 Markdown 与 `tests/verification/` 下的 JSON 索引，不改 src、cloud-functions、测试断言、校验脚本、CI workflow、依赖或部署配置，不接管 Circle 任务或修改 CURRENT_TASK。只推送本分支并交付独立 PR，不直接推进 product/main、edgeone-test、master。

## 验收

1. 主线计划明确 #46/#47 已合并、#48/#49 关闭未合并及云整改停止。
2. 部署文档醒目标明历史范围，撤销旧的 main→Maker 生产映射说明，链接当前分支规则。
3. SPEC-SYNC-001 描述现有受保护 V4 路径、失败和证据边界，不改变运行时权限或行为。
4. 失效回归保留原 ID，关联现有生产防回归与故障检测证据；不只做标题替换。
5. TLC 模型、trace bridge、本地完成、backend、etest 完成和旧 V3 浏览器各映射到实际执行入口；本地通过不等于实网通过。
6. 映射校验、相关现有模拟用例、范围和链接检查通过；无真实网络/账号测试。

## 已知后续

Verification Contract Gate 的 PR/引用测试变更触发缺口，以及校验器不验证执行入口的问题，本批只准确记载，不调整 CI 或脚本。相关工作独立安排，不靠删除安全断言或把手工检查描述为强制门禁解决。

本批已完成上述文档和索引整改，清单校验通过、四项现有模拟回归通过，执行入口和链接检查通过。提交前快进纳入 `a82f9d95b1fb4c3dc24d77a4951d234fd43d9955` 的 Circle 工作，无重叠修改。详细范围和未执行项见报告。
