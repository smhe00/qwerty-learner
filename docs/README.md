# QWERTY Plus 文档索引

> 产品阶段：**Beta `0.2.0-beta.1`** · 开发主线：`product/main`  
> 此目录保留用户指南、工程规范和历史研发记录。**历史发布文档不代表当前运行行为。**

## 用户指南（当前）

- [Beta 使用指南](./BETA_USER_GUIDE_ZH.md) — Typing / Learn、键盘操作、备份、风险与反馈。
- [云账号、备份和同步](./CLOUD_SYNC_USER_GUIDE.md) — 当前 V4、本机工作区、自动同步、冲突恢复和数据安全。
- [Learn 使用语义](./LEARN_USER_GUIDE_V1.md) — 详细学习状态机及策略术语；具体默认参数以产品设置为准。
- [README](../README.md) — 产品定位、功能总览、分支与发布流程。

## 学习与记忆系统

- [Learn 架构](./LEARN_ARCHITECTURE_V1.md)
- [新词引入与额度](./LEARN_ACQUISITION_QUOTA_V3.md)
- [每日学习计划](./LEARN_DAILY_PLAN_V1.md)
- [Learn 统计](./LEARN_STATS_V1.md)
- [Review Rating Gate](./REVIEW_RATING_CONTRACT_V1.md)
- [Hint Ladder](./REVIEW_HINT_LADDER_V1.md)
- [Review 状态机](./REVIEW_STATE_MACHINE_V2.md)
- [Formal Model](./REVIEW_FORMAL_MODEL.md)

部分研发文档保留了当时版本的默认参数，不能直接替代 Beta 运行时配置。

## 云同步与发布

- [云同步架构](./CLOUD_SYNC_ARCHITECTURE.md)
- [云同步运维](./CLOUD_SYNC_OPERATIONS.md)
- [EdgeOne 部署](./CLOUD_SYNC_EDGEONE_DEPLOYMENT.md)
- [发布审计](./CLOUD_SYNC_RELEASE_AUDIT.md)
- [Beta 准备状态与历史问题](./release/BETA_READINESS_2026-10-13.md)
- [分支策略](./BRANCH_STRATEGY.md)
- [贡献指南](./CONTRIBUTING.md)

## 历史资料（不适用于当前 Beta 操作）

以下文件为保留的**旧阶段快照**，不能作为当前备份、账号或学习策略的操作依据：

- [旧 Alpha 使用说明](./ALPHA_CUSTOMER_GUIDE_ZH.md)
- [旧 Alpha 发布基线](./ALPHA_RELEASE_BASELINE.md)
- [云同步早期计划](./CLOUD_SYNC_DEVELOPMENT_PLAN.md)
- 旧版额度、Review 与 FSRS 阶段性研发文档。
- [上游英文介绍](./README_EN.md) 与 [上游日文介绍](./README_JP.md) — 保留来源资料，不是 QWERTY Plus Beta 的当前产品说明。

## 文档权威性

发生冲突时，按以下优先级：

```text
已部署且核实 SHA 的运行代码
→ 当前代码及协议测试
→ 当前 Beta 用户指南
→ 历史开发文档
```

发布前必须更新当前用户指南和 README；不得把历史文件的旧备份格式、产品阶段或默认目标复制到当前使用说明。
