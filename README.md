# QWERTY Plus — Beta

> **版本：`0.2.0-beta.1`** · **产品：打字 & 背单词**  
> 开发主线：`product/main` · Beta 验证站：[t.smhe.cn](https://t.smhe.cn/)  
> **正式站：[q.smhe.cn](https://q.smhe.cn/)**（`master`；以正式站实际部署版本为准）

QWERTY Plus 基于 [Qwerty Learner](https://github.com/RealKai42/qwerty-learner) 持续开发，在保留 Typing 打字练习的同时，增加 Learn 长期记忆学习、FSRS-6 复习调度、学习成就以及可选的云同步。产品面向持续积累词汇和练习英文拼写的用户。

目前为 **Beta 测试版本**：功能已覆盖日常学习、恢复与同步的主要流程，但长期学习效果、不同设备环境下的稳定性仍需持续验证。**重要学习数据建议定期导出完整本地备份。**

## 核心功能

| 模式 | 用途 |
| --- | --- |
| **Typing · 打字** | 词库与章节练习、拼写熟悉、发音、音标、释义和输入统计。 |
| **Learn · 学习** | 新词引入、逐步提示、独立拼写检验、到期复习、FSRS-6 长期调度与进度统计。 |

- 支持中考等英语词库，包括**上海中考 2027**和**沪教新初 2027**等；可在词库页面选择。
- Learn 的每日新词目标默认为 **32 个**，可以在设置中调整；已到期复习按学习计划安排。
- 学习中可以随时退出，系统保存学习会话和长期记忆进度；数据首先写入本地浏览器。
- Learn 默认任意键开始，**Enter 暂停**，**Esc 表示不会、进入提示流程**。拼写完成后可继续下一个词。
- 成就与学习统计用于查看持续学习情况，不代替长期掌握的判定。

## 数据备份与云同步

QWERTY Plus 采用 **local-first** 模型：不注册账号也可以学习，本地学习记录保存在浏览器 IndexedDB。

- **完整备份**：数据设置支持导出、校验、导入标准 `qwerty-backup-v4` 备份（gzip）。备份包含学习记录、记忆状态、成就、会话与相关设置。
- **跨账号导入**：可把备份恢复到当前本地工作区，但会**替换当前工作区数据**，不会自动合并；操作前应保存当前完整备份并确认接收身份。
- **可选云账号**：注册登录后，可以通过统一的“同步”入口协调本地与云端备份，支持云备份导出及高级冲突恢复。
- **自动同步**：每日学习会话完成后支持自动同步；“每个 Block 完成后自动同步”由用户选择，默认关闭。
- **冲突保护**：两端数据不一致时不会静默覆盖；需备份双方并明确选择保留本地或保留云端。失败或结果不确定时，不要盲目重复覆盖。
- **数据安全**：云端通过 HTTPS 和账号会话进行访问控制，**云备份不是端到端加密（E2EE）**。请妥善保管账号密码及导出的备份文件。

> 备份中的 `V4` 仅表示备份格式，不代表产品发布阶段。更详细的操作步骤见 [Beta 使用指南](./docs/BETA_USER_GUIDE_ZH.md) 和 [云同步指南](./docs/CLOUD_SYNC_USER_GUIDE.md)。

## 支持环境与 Beta 边界

- 优先支持桌面端 **Chrome / Edge**；移动端目前以介绍和基础浏览为主，不作为完整 Learn 学习环境的主要验收基线。
- Beta 不承诺自动合并多设备上的不同学习历史，也不提供云备份端到端加密。
- 学习系统不保证对所有学习者都达到最优记忆效率；个性化策略还需要长期真实数据验证。
- 如遇进度、备份、账号或同步异常，请先保留当前本地备份，再使用设置中的**开发诊断 → 导出现场诊断包**协助排查。诊断包可能包含学习数据，只应提供给可信开发者。

## 快速开始

需要 Node.js 20 和 Yarn：

```bash
yarn install
yarn dev
```

构建与基础检查：

```bash
yarn build
yarn lint
```

具体测试和发布门禁见 [文档索引](./docs/README.md) 与 [Beta Readiness](./docs/release/BETA_READINESS_2026-10-13.md)。**只有同一候选 SHA 的相关门禁全部通过且生产站点完成验收，才视为正式 Beta 发布完成。**

## 分支与发布

| 分支 | 用途 |
| --- | --- |
| `product/main` | 开发主线与版本集成 |
| `edgeone-test` | EdgeOne Beta 验证站：[t.smhe.cn](https://t.smhe.cn/)；云存储与生产环境隔离 |
| `master` | EdgeOne Maker 正式发布站：[q.smhe.cn](https://q.smhe.cn/) |

EdgeOne Maker 构建次数有限，因此不能因普通开发提交持续更新 `master`。Beta 候选版本在测试站通过验收后，才将经过确认的版本发布到 `master`。

## 文档

- [Beta 用户使用指南](./docs/BETA_USER_GUIDE_ZH.md)
- [云账号、备份和同步](./docs/CLOUD_SYNC_USER_GUIDE.md)
- [Learn 设计与使用语义](./docs/LEARN_USER_GUIDE_V1.md)
- [文档索引与历史资料](./docs/README.md)

## 开源来源与许可证

Qwerty Plus 是基于 [RealKai42/qwerty-learner](https://github.com/RealKai42/qwerty-learner) 修改开发的版本。感谢原作者和贡献者。与原项目相比，本项目增加了 Learn 长期记忆、FSRS-6 复习、云同步和成就系统等功能；具体改动可在本仓库 Git 历史中查阅。

本项目按 **GNU GPL-3.0** 发布。使用、修改及再分发须遵守 [LICENSE](./LICENSE)；原有源码中的版权、许可证声明应予保留，原项目版权归原权利人所有。软件按许可证约定提供，不附带任何担保。

[完整源码及修改历史](https://github.com/smhe00/qwerty-learner) · [原项目](https://github.com/RealKai42/qwerty-learner) · [GPL-3.0](./LICENSE)
