# Qwerty Learner — Learn Alpha

> 当前产品版本：`0.2.0-alpha.1`  
> 集成产品主线：`product/main`  
> 在线入口：<https://qwerty.kaiyi.cool/>

Qwerty Learner Learn Alpha 是基于开源项目
[RealKai42/qwerty-learner](https://github.com/RealKai42/qwerty-learner)
持续演进的学习版本。

当前产品保留原有 Typing 练习，同时新增独立的 **Learn 长期学习模式**，
用于把“看过/打过单词”进一步转化为可验证的独立回忆和长期复习。

本仓库当前处于 **受控 Alpha** 阶段：核心学习流程、数据边界和控制稳定性
已经通过自动化 Gate，但长期学习效率与个体参数仍需要真实用户数据继续验证。

## 当前产品模型

### Typing

Typing 保持原 Qwerty Learner 的章节练习逻辑，适合：

- 键盘输入训练；
- 单词熟悉；
- 发音、音标和释义辅助；
- 章节化练习与原有 Typing 工作流。

Typing 不直接修改 Learn 的长期记忆 scheduler。

### Learn

Learn 管理长期学习：

```text
新词 Acquisition
Exposure
  -> Supported Recall
  -> Independent Recall
  -> ACTIVE

到期 Review
Cold Probe
  -> Rating Gate
  -> Scheduler
```

核心原则：

- 看着答案输入正确，不等于已经掌握；
- 只有无提示、无错误、满足间隔要求的 Independent Recall 才能形成新的独立掌握证据；
- 提示、强支架、Recovery Window 都可以改善训练体验，但不能降低长期掌握标准；
- Due Review 优先于新增词。

## Learn Alpha 当前能力

- Typing / Learn 一级模式分离；
- 沪教版新初中英语 2027 词库作为默认词库（1751 词）；
- 双语例句与语境提示；
- 分阶段新词 Acquisition；
- 到期长期 Review；
- Hint 0/1/2/3；
- Dynamic Scaffold S0/S1/S2/S3；
- 基于具体错误位置的 targeted support；
- Interaction Strain EWMA + hysteresis；
- bounded Recovery Window；
- 每日新词 quota 与 Learn workload plan；
- Learn 专属统计；
- 手工移出/恢复长期学习计划；
- 本地备份/恢复；
- 可选云账号与手工云同步。

## 控制稳定性

Learn 的自适应学习控制不是无限自由变化的模型。

当前版本对关键控制量设置了明确边界：

```text
strain                         in [0, 1]
daily new-word target          <= 20
Recovery Window                <= 2 elevated / <= 3 recovery
Acquisition assistedCycles     <= 2
Independent mastery admission  only from valid S3 evidence
```

CI 中包含独立的 **Learn Control Stability Gate**，验证：

- EWMA BIBO boundedness；
- hysteresis / no-chatter；
- Acquisition finite termination；
- Recovery Window bounded / non-recursive；
- quota saturation；
- due-first backlog behavior；
- deterministic virtual-learner closed-loop regression；
- 防止“通过过度帮助换取表面稳定”的效率回归。

这不等于已经证明对所有真实学生全局最优。Alpha 阶段的重点之一，
就是用真实长期保持数据继续校准效率目标。

## Alpha 学习目标

产品最终追求的不是短期“正确率最高”，而是：

```text
在可接受的心理负担下
用尽可能少的有效学习时间
获得尽可能多的长期可独立回忆
```

长期希望用类似下列指标评估策略：

```text
7-day retained words / active learning hour
30-day retained words / active learning hour
```

当前版本尚未启用自动 Personal Calibration。控制参数仍使用经过约束的
全局策略，避免在没有稳定性边界前进入高风险自适应参数学习。

## Alpha 客户使用说明

首次试用、数据说明、云同步限制和反馈重点请阅读：

- [Alpha 客户使用说明](./docs/ALPHA_CUSTOMER_GUIDE_ZH.md)

完整文档入口：

- [文档索引](./docs/README.md)
- [Learn 使用指南](./docs/LEARN_USER_GUIDE_V1.md)
- [Learn 架构](./docs/LEARN_ARCHITECTURE_V1.md)
- [云账号与同步说明](./docs/CLOUD_SYNC_USER_GUIDE.md)

## 数据与云同步

产品采用 local-first 模型：

- 不登录也可以学习；
- 本地 IndexedDB 是日常工作数据库；
- 云同步是可选能力；
- 当前云同步为手动上传/下载；
- 云端存在 revision 冲突保护；
- 同一账号只保留一个当前有效云会话；
- 当前云快照 **不是端到端加密**。

当前备份格式：

```text
qwerty-backup-v3
```

并兼容恢复：

```text
qwerty-dexie-gzip-v2
```

更详细的信息见
[云账号与同步使用说明](./docs/CLOUD_SYNC_USER_GUIDE.md)。

## Alpha 平台范围

当前核心学习流程的自动化发布 Gate 以桌面 Chrome 环境为主要浏览器基线。

移动端当前主要提供产品介绍页面，**不是本次 Learn Alpha 的主要验证入口**。
Alpha 用户建议使用桌面 Chrome / Edge 访问。

## 开发与验证

环境：

- Node.js 20（CI 基线）；
- Yarn；
- Vite / React。

启动：

```bash
yarn install
yarn dev
```

构建：

```bash
yarn build
```

关键集成 Gate 位于：

```text
.github/workflows/review-gate.yml
```

目前 Gate 包含：

- lint；
- Learn/Review domain tests；
- formal model checker；
- Learn Control Stability Gate；
- Typing audio formal model；
- FSRS shadow/G3 contracts；
- Typing lifecycle browser gate；
- production build/smoke；
- multi-word Learn/Review browser gate。

## 分支约定

长期集成产品主线：

```text
product/main
```

`master` 用于保持与 upstream 基线的关系，不承载 fork-only 产品功能。

具体约定见：

- [Branch Strategy](./docs/BRANCH_STRATEGY.md)

## 开源来源与许可证

本项目基于：

- [RealKai42/qwerty-learner](https://github.com/RealKai42/qwerty-learner)

并继续遵循仓库中的 GPL-3.0 许可证要求。原项目在词库、Typing 交互、
UI 与开源社区方面提供了基础能力；本 fork 的 Learn、Review、控制稳定性、
云同步和相关产品能力在此基础上持续演进。

详见 [LICENSE](./LICENSE)。
