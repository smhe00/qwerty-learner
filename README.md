# QWERTY Plus — Beta

> 产品版本：`0.2.0-beta.1` · 文档核对：2026-10-25  
> 正式站：[q.smhe.cn](https://q.smhe.cn/) · [手机入口](https://q.smhe.cn/mobile)  
> 开发主线：`product/main` · 云验证站：[t.smhe.cn](https://t.smhe.cn/)（`edgeone-test`）

QWERTY Plus 基于 [Qwerty Learner](https://github.com/RealKai42/qwerty-learner)，保留 Typing 打字练习，并提供 Learn 长期记忆学习、FSRS-6 复习调度、手机触控学习、成就、学习记录和可选云同步。

**当前定位：核心学习 Beta 已发布，进入稳定性与工程收尾阶段；不是所有扩展愿景已经完成。** 最近已验收发布基线为 `ea4ede5380dfdc899a94371a5bc5289cb036004e`，正式站发布探测于 `2026-10-24T18:02:00Z` 通过。后续纯文档提交不等于新的运行版本。[发布证据](./interactive/reports/MOBILE-MENU-RELEASE-20261025-report.md) · [当前收尾清单](./docs/release/BETA_CLOSEOUT_2026-10-25.md)。

## 核心功能

| 入口 | 用途 |
| --- | --- |
| 桌面 Typing | 词库、章节、拼写与输入训练。 |
| 桌面 Learn | 新词引入、提示、独立拼写检验、到期复习及长期调度。 |
| 手机 Learn | 独立触控学习界面，共用学习记录与记忆状态，不要求照搬桌面打字操作。 |
| 成就与记录 | 成就卡片、学习统计；手机可按日期和词库查看学习记录。 |
| 账号与数据管理 | 本地完整备份、校验、安全导入、云端状态与同步。 |

全新工作区默认使用**上海中考 2027、英音、每日 20 个新词、每阶段 10 词**；阶段词数允许 1–50。已有设置与恢复数据按实际保存值处理，不因文档更新而重置。

桌面 Learn 支持任意键开始、Enter 暂停或继续、Esc 表示不会并进入提示流程。手机使用页面触控操作。提示辅助完成不等于独立掌握，练习次数也不等于掌握词数。

## 数据与同步边界

学习采用 **local-first**：未注册也能学习；匿名工作区与各账号工作区隔离。已有账号登录不能把匿名记录自动混入账号；新注册时可按页面明确选择复制匿名记录。

当前完整备份是 gzip `qwerty-backup-v4`，包含六张业务表、每日学习会话、设置与导航状态。**手动导入是替换当前工作区，不是自动合并**；操作前先导出并校验当前备份。

云端保留**单账号单有效登录会话**。支持同账号、受支持数据结构的分叉记录自动协调与合并；异地再次登录可能使旧设备需要重新认证。离线记录保留在本机，恢复联网且认证有效后由适用同步流程处理；这不等于任意设备永久同时在线，或每次按键立即全量同步。

登录/启动检查、学习事件后台上传和完整 V4 同步各有职责；事件上传成功不代表完整六表已收敛。每日全部完成仍可自动同步；“每个 Block 完成后自动同步”是本机当前账号的可选设置，默认关闭。

校验失败、身份不匹配或提交结果不确定时，系统保留数据并限制危险操作。不要为了消除提示而清空浏览器、反复导入或强行选一端覆盖。**云备份不是端到端加密（E2EE）**，重要进度仍建议定期保存独立完整备份。

## 已知边界

手机学习、历史、成就和数据页面已上线，不再只是介绍页。但 Chromium 触控模拟不能替代华为浏览器、Android Chrome、iOS Safari/PWA 真机验收。

发布验证保留过注册 HTTP 500、云端 revision 未达到预期的首轮失败；同源新测试身份复验通过，**不代表根因已经修复**。另有测试注册结果不确定后的账号清理待核实，见收尾清单。

圈子目前属于实验性 API 能力，不能当作完整社交产品已交付。长期记忆效果、全面真机兼容性及扩展功能不由这次发布验收一并证明。

## 开发与验证

以下为当前仓库工具链用法，不是依赖长期支持声明：

```bash
yarn install --frozen-lockfile
yarn dev
yarn build
yarn lint
yarn tsc --noEmit
yarn test:cloud
yarn validate:gate-manifest
```

**注意：当前 `yarn test` 仍是 `echo "No tests"` 占位，不能据此声称测试通过。** 实际验证由专用脚本与 GitHub Actions 执行。已有验收记录只证明相应范围；不能把局部 TypeScript/lint PASS 写成全仓零错误。

小改动按风险做定向验证；发布仍必须满足同一候选 SHA 的 Pages、eTest 实网与发布准入要求。参见 [分支策略](./docs/BRANCH_STRATEGY.md) 和 [代理执行约定](./AGENTS.md)。

## 部署分工

| 分支 | 用途 |
| --- | --- |
| `product/main` | 集成开发；GitHub Pages 云功能禁用，不能用它证明云同步。 |
| `edgeone-test` | `t.smhe.cn` 实网云验证；与生产 Blob 空间隔离。 |
| `master` | `q.smhe.cn` 正式发布；需要明确发布授权，不能随开发提交自动追平。 |

普通文档整理不推进 eTest/master，不为此消耗 Maker 构建。HTTP 与 HTTPS、不同域名的浏览器本地数据不能视为同一份；正式使用统一 HTTPS 地址。

## 文档

[用户使用指南](./docs/BETA_USER_GUIDE_ZH.md) · [云同步指南](./docs/CLOUD_SYNC_USER_GUIDE.md) · [当前架构](./docs/CLOUD_SYNC_ARCHITECTURE.md) · [文档索引](./docs/README.md) · [收尾与已知风险](./docs/release/BETA_CLOSEOUT_2026-10-25.md)

## 开源来源与许可证

QWERTY Plus 是基于 [RealKai42/qwerty-learner](https://github.com/RealKai42/qwerty-learner) 修改开发的版本。感谢原作者和贡献者；改动保留在本仓库 Git 历史中。

本项目按 **GNU GPL-3.0** 发布。使用、修改和再分发须遵守 [LICENSE](./LICENSE)，并保留原有版权与许可证声明；软件按许可证约定提供，不附带担保。
