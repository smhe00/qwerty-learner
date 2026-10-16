# 宋韵成就系统 · 图片优先实施进度（2026-10-16）

> 只在研究分支 `design/achievement-song-aesthetic-20261016` 执行；未获美术批准，不合入 `product/main`、`edgeone-test`、`master`。  
> 目标视觉：[参考概念图](../references/README.md) · [视觉架构](../architecture/Achievement-Visual-Architecture-v1.md) · [百词基石制作单](./Hundred-Words-Masterpiece-v1.md)

## 已有可核实产物

- 视觉分层协议：`src/achievement/visual-assets/spec.ts`。`ACH_MASTERED_100` 的母版 **stage 为 pending_art_review**，未经美术验收严禁转为 `approved`，防止粗糙 SVG 变相被当作成品发布。
- 图片合成组件：`SongImageComposer.tsx`。静态场景、透明器物、云雾、印模及实印分别加载；标题、达成条件、文化引文、日期均为 React 动态文字。隐藏未解锁状态不请求其专属素材。
- 真实雾图：`public/assets/achievements/song/shared/mist/`，包含 `far-light.webp`、`near-light.webp`、`far-dark.webp`、`near-dark.webp`。分辨率均为 1024×512，WebP 透明通道经过 GitHub Actions 实测；这四张为**状态与过渡素材**，不是器物精修图。
- 成就范围内的 Focus 入境：`SongPortalEntry.tsx`，在既有 `NavigationOverlay` 内演示晨雾与夜墨的短暂进入过渡，不修改通用 Focus UI。
- 锁定云雾：`SongMistLayer.tsx`，现有锁定卡片叠加透明图片；展示文本保持前景可读。`hidden` 锁定只能呈现通用画面而非对应真实器物。
- 研究预览：Vite 仅携带 Song 素材目录，页面支持亮暗切换、未解锁微露和展卷钤印的视觉技术演示。真实学习数据/成就记录不在预览里读写。
- CI：`scripts/validate-song-art-assets.mjs` 校验四张雾图、字节头、尺寸预算、真实成就 ID、目标图存档及**不得提前批准缺失图片的成就画包**；浏览器专项测试 `tests/song-preview/smoke.mjs` 覆盖桌面 1440 和手机 390。

## 尚未完成（不能冒充验收通过）

1. **真正的无字、无章、高画质「百词基石」场景母版**（亮/暗）：尚未得到可批准的图片文件。
2. **独立透明青瓷碗、朱砂四字篆印、印模动作素材**：尚未获得专属图片资产；当前旧版 SongArtwork/SongMasterpiece 的 SVG 只是技术研究原型，视觉品质未达到目标图。
3. **纯图片构建的详情弹窗**：`SongImageComposer` 已准备分层接口，但 pack 尚未 `approved`，不替代真实已解锁详情。
4. **生产用新解锁队列**：视觉演示不能自动视为实时发奖。必须在存储成功与可靠回放机制确认后才接入。
5. **真机截图及审美验收**：CI 自动测试不是人工设计评审；亮暗材质画卷仍需要完整图片作品。
6. **手机主应用入口**：生产移动端原有 `/mobile` 路由可能与桌面成就 overlay 不同，需在最终产品集成前另作专用入口验收。

## 有界的下一制作任务

1. 先拿到 `ACH_MASTERED_100/scene-light.webp`、`scene-dark.webp` 和 `artifact.webp` 三张**无字纯美术**，进行目标图并排验收；可以退稿，不为了上线采用不合格贴图。
2. 再制作 `seal-red.webp`、`seal-ghost.webp`、`seal-press.webp`，验证印模下压→抬离→留下朱砂痕，绝不以“红色方块飞入”代替。
3. 最后补近远雾质量评审和响应式排版，走 Storybook/独立 preview 浏览器 E2E、Focus overlay 实网前门禁；用户明确批准后才能考虑合入主线。

注：本轮图像生成产物主要是整页概念流程板，没有符合生产约束的“无字器物透明图”，**不按资产表入库，也不会标记美术已完成**。
