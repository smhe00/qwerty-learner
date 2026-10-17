# 宋式成就雅集：第一批 10 张独立图片（2026-10-17）

## 已接入

本次把用户确认的第一批无字宋式成就画转换成 `960×1391`、WebP、逐 ID 命名图片，持久化于：

`public/assets/achievements/song/first-batch/ACH_*.webp`

完整的源图文件名、真实成就中文名、rarity、rollout、SHA-256、字节数可在 [First-Batch-20261017.json](../assets/First-Batch-20261017.json) 查阅。

| 成就 ID | 当前代码真实稀有度 | 发布阶段 | 主画意境 |
| --- | --- | --- | --- |
| ACH_FIRST_TRY | common | P1 | 开卷提笔、桃花晨光 |
| ACH_FIRST_DECODE | common | P0 | 竹影、古卷、山图 |
| ACH_WARMING_UP | common | P0 | 初沏青瓷茶、春山渐暖 |
| ACH_NEW_UNIT | common | P0 | 经折装册页、山水新章 |
| ACH_DAILY_GOAL | common | P0 | 书案日晷、日课有成 |
| ACH_7_OF_10 | rare | P0 | 七枚天青日签、日课渐满 |
| ACH_RECOVER_1 | common | P0 | 回澜墨流、重整笔势 |
| ACH_AUDIO_10 | rare | P0 | 青铜风铃、飞燕听泉 |
| ACH_NO_HINT_10 | rare | P0 | 青玉佩、空谷孤峰 |
| ACH_7_DAY | rare | P0 | 月相、七日时序 |

> **重要**：上一份 34 成就创作分批表把首批十张图片统归“素笺墨印”，这不是实际程序中的稀有度分组。这里完全以 `achievements.json` 为准，不为配图修改稀有度或解锁条件。`ACH_FIRST_TRY` 当前属于 P1，因此文件已存储，但默认 P0 19 项收藏页暂不显示。

## 实现方式

- `src/achievement/visual-assets/firstBatch.ts`：ID 白名单，不能因任意路径字符串引入非白名单图片；未解锁隐藏成就不会请求真图。
- `src/pages/Achievements/index.tsx`：首批成就使用整卡竖版插画，其余 24 项继续使用历史美术拼图；详情窗沿用对应独立插画。
- `src/pages/Achievements/song-collector-v2.css`：稀有度胶囊、动态标题、描述、时间、云雾遮挡与夜卷调色均为前端可变图层，卡图内部无动态文字/真实印章。底部有渐隐文字安全区，避免小卡片文字压住主体。
- `scripts/validate-song-first-batch-art.mjs`：目录只允许十个文件；验证 RIFF 长度、SHA-256、文件上限、实际业务 rarity / rollout；构建 Gate 加跑 Chromium 真实图片解码。

## 约束

这是一套**第一批图片预览素材**，不表示已通过所有独立器物/专属篆刻印章的最终美术验收；图片本身不含成就日期、真实发奖印章或用户名。用户继续可以逐张调整意境、画面密度与保留的文本安全区。该分支合入 `product/main` 后，仅 GitHub Pages 测试部署；`master`、`edgeone-test` 均不跟随。
