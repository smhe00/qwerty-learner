# 宋韵成就雅集 · 全 34 项收藏与第二批美术 (2026-10-17)

## 设计变更

- 收藏页从原来的 **19 项 P0** 扩展为 **34 项 enabled 成就**（19 P0 + 11 P1 + 4 P2），但 P1/P2 的发奖机制与 rollout 并未自动开放。保留既有稀缺性节奏。
- 未解锁卡片保留完整竖版构图和宋韵云雾，但使用原生 disabled 按钮、不接受鼠标、键盘或程序化 click 打开详情；同时在 `openDetail` 内二次校验解锁状态。
- 隐藏且未解锁的 5 项继续隐藏真实名称、描述和专属素材；仅使用通用云雾的匿名提示。
- 已解锁成就才允许点击打开卷轴详情；原来的「展卷演示」作为单独标注的视觉测试入口，**不改变学习或成就数据**。
- 分类稀有度使用真实 `achievements.json`：common、rare、epic、legendary 四级；卡片宋韵材质沿用三档配色语义。图片批次只决定资产到位情况，不更改 rarity。

## 图片资产

第一批 10 张位于 `public/assets/achievements/song/first-batch/`；
第二批 10 张位于 `public/assets/achievements/song/second-batch/`。
每项文件名为成就 ID、均为**无文字** 640×928 WebP，标题、日期、稀有度印章和未解锁雾层均由 DOM 动态叠加。
第二批精确 ID / 文件大小 / SHA256 / 实际等级 / 原始作图文件清单见 [Second-Batch-20261017.json](./Second-Batch-20261017.json)。

尚未制作专属美术的 14 项仍使用原有参考图的装饰构图作为回退，不虚构图片已完成。

## 验证关注点

- 34 项目录完整性、2 批图片共 20 个独立 WebP + RIFF/sha256 校验。
- 未解锁按钮 disabled、点击无弹窗、上锁图片始终被云雾覆盖；只有真实解锁后才能查看详情。
- Chromium 桌面/手机两端测试、Cards 筛选计数、夜卷模式和无横向溢出。
- 只合入开发 `product/main` 供 Pages 预览，正式 `master` 与 `edgeone-test` 均不自动修改。
