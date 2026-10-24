# QWERTY Plus 文档索引

> 2026-10-25 整理；产品 `0.2.0-beta.1`，最近已验收运行基线 `ea4ede53`。文档提交与部署提交分开记录。
> 正式站：[q.smhe.cn](https://q.smhe.cn/)；测试站：[t.smhe.cn](https://t.smhe.cn/)。Pages 禁用云能力。

## 当前维护入口

| 文档 | 面向谁 / 用途 |
| --- | --- |
| [项目 README](../README.md) | 功能、默认值、边界及开发入口。 |
| [Beta 使用指南](./BETA_USER_GUIDE_ZH.md) | 桌面/手机学习、记录、账号和备份操作。 |
| [云同步用户指南](./CLOUD_SYNC_USER_GUIDE.md) | 自动合并、单一登录、手动替换与异常处理。 |
| [当前云架构](./CLOUD_SYNC_ARCHITECTURE.md) | 完整 V4、M3/M4、身份与事务职责。 |
| [分支策略](./BRANCH_STRATEGY.md) | main -> eTest -> master，版本与验收规则。 |
| [当前收尾清单](./release/BETA_CLOSEOUT_2026-10-25.md) | 已完成范围、未闭环风险、建议验收标准。 |
| [已发布证据](../interactive/reports/MOBILE-MENU-RELEASE-20261025-report.md) | 精确 SHA、运行编号、失败及复验记录。 |

## 工程专题：必须与当前源码交叉核对

[Learn 架构](./LEARN_ARCHITECTURE_V1.md)、[使用语义](./LEARN_USER_GUIDE_V1.md)、[每日计划](./LEARN_DAILY_PLAN_V1.md)、[统计](./LEARN_STATS_V1.md)、[Rating 合约](./REVIEW_RATING_CONTRACT_V1.md)、[提示梯度](./REVIEW_HINT_LADDER_V1.md)、[状态机](./REVIEW_STATE_MACHINE_V2.md)、[形式化模型](./REVIEW_FORMAL_MODEL.md) 保留设计来源。文件名 V1/V2 不直接表示对应运行模块已废弃；其中旧默认值不能覆盖当前代码。

[云运维](./CLOUD_SYNC_OPERATIONS.md)、[部署说明](./CLOUD_SYNC_EDGEONE_DEPLOYMENT.md)、[历史发布审计](./CLOUD_SYNC_RELEASE_AUDIT.md)、[同步 V2 模型](./CLOUD_SYNC_V2_MODEL.md) 含不同阶段材料，本轮未逐条重写平台限制、保留策略或配置默认值。执行生产操作前先核对当前实现与配置，不按旧示例直接删数据或变更认证。

## 实验范围

[圈子 API 发布边界](./CIRCLE_PUBLIC_API_LAUNCH_20261017.md)：API-only，不代表完整用户前端和删除生命周期已经交付。FSRS 研究分支、延迟巩固和未来后端替换不自动纳入当前 Beta 收尾。

## 冻结的历史资料

[历史副本索引](./history/README.md) 中保存原 V1/V3 云架构全文，现行架构已由上方新入口替代。

[Alpha 用户说明](./ALPHA_CUSTOMER_GUIDE_ZH.md)、[Alpha 发布基线](./ALPHA_RELEASE_BASELINE.md)、[早期云开发计划](./CLOUD_SYNC_DEVELOPMENT_PLAN.md)、[2026-10-13 Beta 状态](./release/BETA_READINESS_2026-10-13.md) 是历史快照，不是当前操作指南或最新完成状态。

[上游英文介绍](./README_EN.md) 与 [上游日文介绍](./README_JP.md) 保留来源资料，不是本项目当前功能清单。历史任务、失败报告和协议证明不因“清理”而删除。

## 权威性与维护规则

```text
明确产品约束与安全要求
  -> 已核实部署 SHA / 对应代码和协议测试
  -> 当前维护指南及状态清单
  -> 阶段性设计与历史记录
```

当前指南应标注核对基线；计划写成计划，已执行写明提交和证据。文档不能把 mock 当作实网、模拟手机当作真机、复测成功当作根因修复，也不能将运行中未满足约束的行为解释为约束已取消。
