# Qwerty Plus · Focus UI v1 工程收口审计

> 评审日期：2026-10-12  
> 范围：Focus UI v1 的 P0 / P1 / P2；不包含新增 Learn 算法、Cloud V4/S1、EdgeOne 发布。  
> **判定：工程实现及隔离分支全套浏览器验证已通过；主线 Gate 与 Pages SHA 须按本 PR 合并后验证。人工审美验收及双站线上兼容性单独跟踪，不伪称已通过。**

## 1. 交付范围与来源

| 阶段 | 代码 PR | 完成内容 |
|---|---|---|
| P0 | [#8](https://github.com/smhe00/qwerty-learner/pull/8) | 语义设计 tokens、明暗双主题、Header/Mode、主学习区、五项 Learn 统计、统一弹窗与 Block 页面 |
| P1 | [#9](https://github.com/smhe00/qwerty-learner/pull/9) | 降低拼错/拼对动画干扰、提示与双语例句层级、克制的 Block 里程碑呈现 |
| P2 | [#10](https://github.com/smhe00/qwerty-learner/pull/10) | 长单词在 200% 缩放下换行、低矮视窗自然滚动、加学第六统计项响应式布局、44px 关闭触控区 |
| 收口 | [#13](https://github.com/smhe00/qwerty-learner/pull/13) | 修复生产 smoke 的异步 Learn Session 断言竞态，归档工程证据 |

设计源规范：[`Qwerty-Plus-Focus-UI-Architecture-v1.md`](./Qwerty-Plus-Focus-UI-Architecture-v1.md)。

收口 PR 中唯一的行为相关改动是 **浏览器测试**：Learn 的提示文字可以比异步 Session 注册更早出现，原测试在 Session 未建立时读到 undefined，并且会出现前后同为 undefined 的假阳性。现在先轮询确认真实未完成 Session 的持久化身份，再验证刷新与跨模式往返后该身份不改变。**未修改学习状态机或引擎。**

## 2. 已完成的自动化证据

隔离分支专项 Actions：[Focus UI v1 Closure Branch Gate #38254068205](https://github.com/smhe00/qwerty-learner/actions/runs/38254068205) — **success**。

| Gate | 结果 | 实际检查 |
|---|---|---|
| 内置词典 Node contracts | PASS | 内置词库数据契约 |
| Production build | PASS | Vite 正式产物生成 |
| Chrome production smoke | **5/5 PASS** | 路由、默认词库、词库自愈、Learn 异步离开、Session 身份跨刷新/模式恢复 |
| Chrome Learn/Focus P0–P2 | **79/79 PASS** | Focus 视觉/响应式/缩放与 Learn 会话、Block、恢复及弹窗 |
| Chrome Typing/Pause | **22/22 PASS** | Typing 兼容、新暂停图标/Enter 行为及 Session 状态保持 |

- 所有上述浏览器检查均为实际 Chrome、**零重试**；未通过假数据或跳过失败用例达成。
- 临时的分支专用 CI 文件在成功后移除，**不进入 `product/main`**。
- 最初 P0 的独立 Gate 还记录 8/8 Focus 浏览器验收 + 7/7 导航/模式回归；相关截图由 Actions 归档。P2 回归覆盖 200% 缩放和极长单词。
- 同一批测试不表示 EdgeOne 生产站已经发布当前版本。

## 3. 发布与非目标边界

- `product/main`：开发/Pages，合并后要求 Pages `source-commit.txt` 等于开发主线 HEAD。
- `master`：EdgeOne 正式发布，**本次未授权写入，也不会触发 EdgeOne 构建**。
- 不修改 FSRS-6、Hint/ESC、冻结 Daily Session、Block 自动同步、备份 V4、S1 Workspace、Typing 拼写逻辑及用户学习数据。
- 本报告不会把主观审美判断等同于自动测试。正式的人工体验检查仍需在 Pages 对 Learn/Typing 明暗主题、模态窗口和 Block 界面逐项确认。

## 4. 已隔离但未关闭的问题（不得掩盖）

**Published Dual-Site Explorer（Pages + EdgeOne）仍为 RED**，不属于可据此判定 Focus 实现失败或成功的单版本测试：

- [首次最新主线运行 #38246282083](https://github.com/smhe00/qwerty-learner/actions/runs/38246282083)：EdgeOne 在 /analysis?from=learn 未呈现预期 FSRS 分析容器；没有证据证明 Pages 相同问题。
- 同一工作流的失败 Job 重跑（attempt 2）：**11 个场景通过，1 个 EdgeOne 场景失败**，在 /gallery 页面未找到可见的“英语”文本。失败点与首次不同。
- 处理方向：在获授权的正式发布窗口核对 EdgeOne 真正服务的源码版本；对失败 route 附加可见根 DOM、加载状态、控制台错误与版本号诊断，区分发布版本差异、SPA 挂载异常、异步加载/选择器问题；发现真实缺陷则单独修复。**不删除失败用例、不屏蔽 EdgeOne。**

人工体验验收与双站版本一致性问题独立于 Focus v1 工程验收；这两项保持可追踪的显式限制。

## 5. 收口检查清单

- [x] P0、P1、P2 已分别合入 `product/main`，且有 PR 审计链。
- [x] 独立分支上生产构建/内置词库/Chrome 全回归通过（5 + 79 + 22）。
- [x] 不增加第三方字体或改变 Learn/Typing/Sync 业务语义。
- [x] 移除临时分支专用 CI。
- [ ] #13 合入 `product/main` 后 Review Gate、Dictionary Gate 成功。
- [ ] Pages Deployment 成功，公开 `source-commit.txt` 与 HEAD 完全一致。
- [ ] 人工视觉验收和双站线上异常单独关闭（不作为本次工程变更的虚假绿色项）。

**收口口径：技术开发/自动化 QA 合格；主线 Gate 与 Pages 验证后可标记 Focus UI v1 工程完成。对外产品/双站体验仍遵守独立的发布验收。**
