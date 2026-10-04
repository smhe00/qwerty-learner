# Qwerty Learner 文档索引

> 发布基线：Learn Alpha 1 / `0.2.0-alpha.1`
>
> 集成产品真源：`product/main`

本目录同时保留产品规范、内部技术合同、开发历史与 upstream 相关资料。
为避免“旧计划文档被误认为当前实现”，发布版本按以下层级解释。

## 1. 客户 / 使用者文档

这些文档描述当前 Alpha 用户实际会遇到的行为。

- [ALPHA_CUSTOMER_GUIDE_ZH.md](./ALPHA_CUSTOMER_GUIDE_ZH.md) — Alpha 客户说明、适用范围、已知限制、反馈重点。
- [LEARN_USER_GUIDE_V1.md](./LEARN_USER_GUIDE_V1.md) — Typing / Learn 当前使用语义。
- [CLOUD_SYNC_USER_GUIDE.md](./CLOUD_SYNC_USER_GUIDE.md) — 云账号、手工同步、冲突与数据安全说明。

## 2. 当前产品 / 控制规范

这些文档应与 `product/main` 的运行代码保持一致。

- [LEARN_ARCHITECTURE_V1.md](./LEARN_ARCHITECTURE_V1.md) — Learn 总体架构、Dynamic Scaffold、Recovery Window、Control Stability Gate。
- [LEARN_ACQUISITION_QUOTA_V2.md](./LEARN_ACQUISITION_QUOTA_V2.md) — 当前每日新词 quota 与 Interaction Strain v2 安全限流。
- [LEARN_DAILY_PLAN_V1.md](./LEARN_DAILY_PLAN_V1.md) — 每日工作量与 due-first 规划。
- [LEARN_STATS_V1.md](./LEARN_STATS_V1.md) — Learn 统计口径。
- [REVIEW_RATING_CONTRACT_V1.md](./REVIEW_RATING_CONTRACT_V1.md) — Learn 内部 Review 的 Rating Gate。
- [REVIEW_HINT_LADDER_V1.md](./REVIEW_HINT_LADDER_V1.md) — Hint 有界状态。
- [REVIEW_STATE_MACHINE_V2.md](./REVIEW_STATE_MACHINE_V2.md) — Review 状态机。
- [REVIEW_CANONICAL_PROBE_V1.md](./REVIEW_CANONICAL_PROBE_V1.md) — Canonical probe 约束。
- [REVIEW_FORMAL_MODEL.md](./REVIEW_FORMAL_MODEL.md) — Formal / bounded verification。
- [REVIEW_SYSTEM_ARCHITECTURE.md](./REVIEW_SYSTEM_ARCHITECTURE.md) — Review 内核技术架构；Review 现在是 Learn 内部技术概念。

## 3. 云同步当前技术资料

- [CLOUD_SYNC_ARCHITECTURE.md](./CLOUD_SYNC_ARCHITECTURE.md)
- [CLOUD_SYNC_OPERATIONS.md](./CLOUD_SYNC_OPERATIONS.md)
- [CLOUD_SYNC_EDGEONE_DEPLOYMENT.md](./CLOUD_SYNC_EDGEONE_DEPLOYMENT.md)
- [CLOUD_SYNC_RELEASE_AUDIT.md](./CLOUD_SYNC_RELEASE_AUDIT.md)
- [CLOUD_SYNC_ENCRYPTION.md](./CLOUD_SYNC_ENCRYPTION.md) — 文件名保留历史原因；正文已明确当前产品不启用客户端 E2EE。

## 4. 发布与工程协作

- [BRANCH_STRATEGY.md](./BRANCH_STRATEGY.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [ALPHA_RELEASE_BASELINE.md](./ALPHA_RELEASE_BASELINE.md) — 当前 Alpha 基线、Gate 与发布约束。

## 5. 历史 / 开发计划文档

以下内容用于追溯研发过程，**不作为当前产品行为真源**：

- `LEARN_ACQUISITION_QUOTA_V1.md` — 已由 V2 取代；
- `CLOUD_SYNC_DEVELOPMENT_PLAN.md` — 云同步研发过程记录；
- `REVIEW_ADAPTIVE_DEVELOPMENT_PLAN.md` — Adaptive Review 阶段性研发计划；
- `REVIEW_UPSTREAM_PLAN.md` — upstream 拆分贡献策略；
- `REVIEW_USER_GUIDE.md` — 旧顶层 Review 产品形态说明，当前 Review 已内收为 Learn 子系统；
- `FSRS_PHASE_G.md` — FSRS 研发/分析阶段资料。

如果历史文档与当前规范冲突，以：

```text
运行代码
→ 当前产品/控制规范
→ 客户文档
→ 历史开发计划
```

的优先级解释。

## 6. 文档维护规则

发布分支合入前必须检查：

1. 用户可见行为变化是否更新客户/使用者文档；
2. 控制参数或 policy version 变化是否更新对应规范；
3. 云同步格式、安全边界变化是否更新 `CLOUD_SYNC_USER_GUIDE.md`；
4. 旧文档如果不再代表当前实现，必须显式标记 Historical / Superseded；
5. 不通过大规模文档重命名制造无意义 release diff。
